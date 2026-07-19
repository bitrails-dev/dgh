// Wave D2 plugin-compatible Kashier adapter tests (Plan §3.2, §3.9, §4.2, §7 D2).
//
// These tests verify the NEW plugin surface (`kashierAdapter(opts): PluginPaymentAdapter`) without
// touching the network or booting Payload. All Local API calls go through injected fakes; all Kashier
// REST calls go through the existing `fetcher` seam. The Phase 1 signing primitives are already
// covered by commerce-kashier-adapter.test.ts; here we focus on the plugin-specific contracts:
//
//   - the adapter exposes the plugin PaymentAdapter shape (name/label/group/initiatePayment/
//     confirmOrder/endpoints) and the /webhooks endpoint path is registered;
//   - initiatePayment performs the §3.2 tenant re-read (ignores unscoped wrapper docs), rejects
//     non-integer / non-EGP amounts, and writes the §3.9 fields with a `rawPayloadHash` (hash, not
//     raw payload);
//   - the webhook handler accepts a valid FIXED-order provider signature and writes the §3.9 fields
//     to the matching transaction; bad/missing signatures produce 401 with no write;
//   - idempotency: replaying a webhook with the same providerEventId is a no-op (the unique
//     `(tenant, gateway, provider_event_id)` index on payment-events makes the ledger insert return
//     `{ inserted: false, duplicate: true }`).
//
// Independent re-implementation of Kashier's documented signing is reused from the Phase 1 oracle
// (commerce-kashier-adapter.test.ts); we recompute the ten-field FIXED-order webhook HMAC here too.

import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import test from 'node:test'

import { kashierAdapter } from '../src/commerce/payments/adapters/kashier'
import type { PaymentAdapter as PluginPaymentAdapter } from '@payloadcms/plugin-ecommerce/types'
import type { PayloadRequest } from 'payload'

const API_KEY = 'test-api-key-0123456789abcdef'
const WEBHOOK_SECRET = 'iframe-secret-0123456789abcdef'
const MID = 'MID-2-670'
const TENANT_ID = 42
const OTHER_TENANT_ID = 99

// ─── independent oracle for Kashier's documented signing ──────────────────────────────────────
// Same algorithm as the Phase 1 test (commerce-kashier-adapter.test.ts) — recomputed here to keep
// these tests self-contained. Reproduced from Kashier-payments/NodeJs-Checkout-Demo: backend.js.

const SIG_FIELDS = [
  'paymentStatus',
  'cardDataToken',
  'maskedCard',
  'merchantOrderId',
  'orderId',
  'cardBrand',
  'orderReference',
  'transactionId',
  'amount',
  'currency',
]

function oracleWebhookHash(p: Record<string, string>): string {
  const finalUrl = SIG_FIELDS.map((k) => `&${k}=${p[k] ?? ''}`).join('').slice(1)
  return crypto.createHmac('sha256', WEBHOOK_SECRET).update(finalUrl).digest('hex')
}

// A canonical webhook payload (all 10 fields populated). amount "22.00" corresponds to 2200 minor.
function sampleWebhook(over: Partial<Record<string, string>> = {}): Record<string, string> {
  return {
    paymentStatus: 'SUCCESS',
    cardDataToken: 'tok_abc',
    maskedCard: '512345****0008',
    merchantOrderId: 'cart-123',
    orderId: 'KAS-ORD-1',
    cardBrand: 'MasterCard',
    orderReference: 'ref-1',
    transactionId: 'txn-9',
    amount: '22.00',
    currency: 'EGP',
    ...over,
  }
}

// ─── fakes ───────────────────────────────────────────────────────────────────────────────────

// Extract the /webhooks endpoint from the adapter. Throws (test-fails) if missing — the adapter
// MUST register it. The cast bypasses the `endpoints?: ...` optional type without losing safety.
function webhookOf(a: PluginPaymentAdapter): { path: string; method: string; handler: NonNullable<PluginPaymentAdapter['endpoints']>[number]['handler'] } {
  const endpoints = a.endpoints
  assert.ok(Array.isArray(endpoints), 'adapter must register endpoints')
  const e = endpoints.find((ep) => ep.path === '/webhooks' && ep.method === 'post')
  assert.ok(e, '/webhooks POST endpoint must be registered')
  return e as unknown as { path: string; method: string; handler: NonNullable<PluginPaymentAdapter['endpoints']>[number]['handler'] }
}

// Helper for the assert.rejects overloads — the plugin's initiatePayment returns
// `T | Promise<T>` so accept both via Promise.resolve wrapping.
async function expectReject(p: Promise<unknown> | unknown, re: RegExp): Promise<void> {
  await assert.rejects(Promise.resolve(p), (err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err)
    if (!re.test(msg)) {
      throw new Error(`expected ${re.source} in "${msg}"`)
    }
    return true
  })
}
interface StoredDoc {
  id: number
  tenant: number
  [k: string]: unknown
}
interface FakePayload {
  _store: Record<string, StoredDoc[]>
  _nextId: number
  _events: Array<{ tenantId: number | string; gateway: string; providerEventId: string }>
  find: (args: { collection: string; where?: unknown; limit?: number }) => Promise<{ docs: unknown[]; totalDocs?: number }>
  create: (args: { collection: string; data: Record<string, unknown> }) => Promise<Record<string, unknown>>
  update: (args: { id: number | string; collection: string; data: Record<string, unknown> }) => Promise<Record<string, unknown>>
}

// Fake ledger inserter that routes through the fake's `payment-events` store (which enforces the
// unique `(tenant_id, gateway, provider_event_id)` index — see makeFakePayload.create above).
function fakeInsertPaymentEvent(fake: FakePayload) {
  return async (input: {
    payload: unknown
    tenantId: number | string
    gateway: 'paymob' | 'kashier'
    providerEventId: string
    merchantReference?: string
    targetState?: string
    amount?: number
    rawRedacted?: string
    receivedAt?: string
  }): Promise<{ inserted: boolean; id?: number; duplicate?: boolean }> => {
    return fake.create({
      collection: 'payment-events',
      data: {
        tenantId: input.tenantId,
        gateway: input.gateway,
        providerEventId: input.providerEventId,
        merchantReference: input.merchantReference,
        targetState: input.targetState,
        amount: input.amount,
        rawRedacted: input.rawRedacted,
      },
    }) as Promise<{ inserted: boolean; id?: number; duplicate?: boolean }>
  }
}

function whereMatches(doc: StoredDoc, where: unknown): boolean {
  // Minimal where-clause evaluator: handles { and: [...] } and { <field>: { equals: X } }.
  // Sufficient for the adapter's re-read patterns (id+tenant filter, providerOrderReference lookup,
  // transactions relationship lookup).
  if (!where || typeof where !== 'object') return true
  const w = where as Record<string, unknown>
  if (Array.isArray(w.and)) {
    return (w.and as unknown[]).every((clause) => whereMatches(doc, clause))
  }
  for (const [key, cond] of Object.entries(w)) {
    if (key === 'and' || key === 'or') continue
    const c = cond as { equals?: unknown }
    if (c === null || typeof c !== 'object') continue
    if ('equals' in c) {
      const expected = c.equals
      // Special case: array relationship membership (e.g. { transactions: { equals: txId } }).
      const actual = doc[key]
      if (Array.isArray(actual)) {
        if (!actual.some((el) => (typeof el === 'object' && el !== null ? (el as { id?: unknown }).id === expected : el === expected))) {
          return false
        }
      } else if (typeof actual === 'object' && actual !== null) {
        if ((actual as { id?: unknown }).id !== expected && actual !== expected) return false
      } else if (actual !== expected) {
        return false
      }
    }
  }
  return true
}

function makeFakePayload(seed: Record<string, StoredDoc[]> = {}): FakePayload {
  const store: Record<string, StoredDoc[]> = { ...seed }
  const events: FakePayload['_events'] = []
  let nextId = 1000
  const fp: FakePayload = {
    _store: store,
    _nextId: nextId,
    _events: events,
    find: async ({ collection, where, limit }) => {
      const docs = (store[collection] ?? []).filter((d) => whereMatches(d, where))
      const sliced = limit ? docs.slice(0, limit) : docs
      return { docs: sliced, totalDocs: sliced.length }
    },
    create: async ({ collection, data }) => {
      const id = nextId++
      const doc: StoredDoc = { id, ...(data as { tenant?: number }), tenant: (data.tenant as number) ?? 0 }
      store[collection] = [...(store[collection] ?? []), doc]
      // Intercept payment-events inserts to simulate the unique (tenant_id, gateway, provider_event_id)
      // index. A duplicate returns { inserted: false, duplicate: true } — the idempotency contract.
      if (collection === 'payment-events') {
        const tenantId = (data.tenantId as number) ?? 0
        const gateway = (data.gateway as string) ?? ''
        const providerEventId = (data.providerEventId as string) ?? ''
        const dup = events.find((e) => e.tenantId === tenantId && e.gateway === gateway && e.providerEventId === providerEventId)
        if (dup) {
          // Remove the doc we just added — the unique index would have blocked it.
          store[collection] = store[collection].filter((d) => d.id !== id)
          return { inserted: false, duplicate: true }
        }
        events.push({ tenantId, gateway, providerEventId })
        return { inserted: true, id }
      }
      return doc as unknown as Record<string, unknown>
    },
    update: async ({ id, collection, data }) => {
      const arr = store[collection] ?? []
      const idx = arr.findIndex((d) => String(d.id) === String(id))
      if (idx === -1) throw new Error(`fake: ${collection} doc ${id} not found`)
      arr[idx] = { ...arr[idx], ...data } as StoredDoc
      return arr[idx] as unknown as Record<string, unknown>
    },
  }
  return fp
}

// Fake PayloadRequest. Carries the resolved tenant id (set by the D4 helper in production) and the
// injected Local API fake.
function makeReq(opts: {
  payload: FakePayload
  tenantID?: number | string
  body?: string
  headers?: Record<string, string>
}): PayloadRequest {
  const headers = new Headers(opts.headers ?? {})
  const text = () => Promise.resolve(opts.body ?? '')
  const req = {
    payload: opts.payload as unknown as PayloadRequest['payload'],
    tenantID: opts.tenantID,
    headers,
    text,
    // Most other PayloadRequest members are unused by the adapter; leave them undefined.
  } as unknown as PayloadRequest
  return req
}

// ─── tests ────────────────────────────────────────────────────────────────────────────────────

test('kashierAdapter exposes the plugin PaymentAdapter shape and registers /webhooks', () => {
  const a = kashierAdapter({
    apiKey: API_KEY,
    merchantId: MID,
    webhookSecret: WEBHOOK_SECRET,
    sandbox: true,
  })
  assert.equal(a.name, 'kashier')
  assert.equal(typeof a.label, 'string')
  assert.ok(a.group)
  // GroupField is a union; narrow to the group variant before reading `.name`.
  assert.equal((a.group as { name?: string }).name, 'kashier')
  assert.equal(typeof a.initiatePayment, 'function')
  assert.equal(typeof a.confirmOrder, 'function')
  assert.ok(Array.isArray(a.endpoints))
  assert.ok(webhookOf(a), '/webhooks POST endpoint must be registered')
})

test('initiatePayment writes the §3.9 fields with a hash (not raw) and the correct providerOrderReference', async () => {
  const fake = makeFakePayload({
    'store-carts': [{ id: 123, tenant: TENANT_ID, subtotal: 2200, currency: 'EGP', items: [] }],
  })
  const a = kashierAdapter({
    apiKey: API_KEY,
    merchantId: MID,
    webhookSecret: WEBHOOK_SECRET,
    sandbox: true,
    resolvedTenantId: TENANT_ID,
  })
  const res = await a.initiatePayment({
    data: {
      cart: { id: 123 },
      currency: 'EGP',
      customerEmail: 'guest@example.com',
    },
    // The adapter reads `req.payload` and `req.commerceTenantID/tenantID`; resolvedTenantId in opts
    // takes precedence so we don't need a verified-tenant helper here.
    req: makeReq({ payload: fake }),
  } as never)

  assert.equal(res.message, 'Kashier payment initiated')
  assert.ok(res.checkoutUrl?.startsWith('https://checkout.kashier.io/?'))
  assert.equal(res.providerSessionId, '123', 'providerSessionId is the cart id (merchantReference)')
  assert.equal(res.providerOrderReference, '123')
  assert.ok(res.transactionID !== undefined)

  // The store-transactions row carries the §3.9 fields.
  const tx = fake._store['store-transactions']?.[0]
  assert.ok(tx, 'transaction created')
  assert.equal(tx.tenant, TENANT_ID)
  assert.equal(tx.paymentMethod, 'kashier')
  assert.equal(tx.providerOrderReference, '123')
  assert.equal(tx.providerTransactionId, '', 'unknown until webhook fires')
  assert.equal(tx.capturedAmount, 0)
  assert.equal(tx.refundedAmount, 0)
  assert.equal(tx.reconciliationStatus, 'pending')
  assert.equal(tx.lastProviderStatus, 'initiated')
  assert.ok(tx.lastProviderEventTimestamp, 'timestamp populated')
  // rawPayloadHash is a 64-char lowercase hex SHA-256, NOT the raw payload.
  assert.match(String(tx.rawPayloadHash), /^[0-9a-f]{64}$/, 'rawPayloadHash is a SHA-256 hex')
  assert.equal(String(tx.rawPayloadHash).includes(API_KEY), false, 'rawPayloadHash must not contain the API key')
})

test('initiatePayment ignores an unscoped wrapper cart (tenant mismatch → throw, no write)', async () => {
  // The cart exists in OTHER_TENANT_ID but the adapter is resolved to TENANT_ID. The wrapper-supplied
  // cart is wrong-tenant; the tenant-scoped re-read finds nothing → throw, no transaction created.
  const fake = makeFakePayload({
    'store-carts': [{ id: 999, tenant: OTHER_TENANT_ID, subtotal: 2200, currency: 'EGP', items: [] }],
  })
  const a = kashierAdapter({
    apiKey: API_KEY,
    merchantId: MID,
    webhookSecret: WEBHOOK_SECRET,
    sandbox: true,
    resolvedTenantId: TENANT_ID,
  })

  await expectReject(
    a.initiatePayment({
      data: { cart: { id: 999 }, currency: 'EGP' },
      req: makeReq({ payload: fake }),
    } as never),
    /cart not found in resolved tenant/,
  )
  // No transaction was written.
  assert.equal(fake._store['store-transactions']?.length ?? 0, 0, 'no transaction created for wrong-tenant cart')
})

test('initiatePayment rejects a cart whose DB subtotal is non-integer / non-EGP (never trust browser totals)', async () => {
  const fake = makeFakePayload({
    'store-carts': [{ id: 5, tenant: TENANT_ID, subtotal: 22.5, currency: 'EGP', items: [] }],
  })
  const a = kashierAdapter({
    apiKey: API_KEY,
    merchantId: MID,
    webhookSecret: WEBHOOK_SECRET,
    sandbox: true,
    resolvedTenantId: TENANT_ID,
  })
  await expectReject(
    a.initiatePayment({
      data: { cart: { id: 5 }, currency: 'EGP' },
      req: makeReq({ payload: fake }),
    } as never),
    /subtotal must be a positive integer/,
  )

  // Non-EGP currency.
  const fakeUsd = makeFakePayload({
    'store-carts': [{ id: 6, tenant: TENANT_ID, subtotal: 2200, currency: 'USD', items: [] }],
  })
  await expectReject(
    a.initiatePayment({
      data: { cart: { id: 6 }, currency: 'USD' },
      req: makeReq({ payload: fakeUsd }),
    } as never),
    /only EGP supported/,
  )
})

test('initiatePayment without a resolved tenant id throws before any write', async () => {
  const fake = makeFakePayload({
    'store-carts': [{ id: 7, tenant: TENANT_ID, subtotal: 2200, currency: 'EGP', items: [] }],
  })
  const a = kashierAdapter({
    apiKey: API_KEY,
    merchantId: MID,
    webhookSecret: WEBHOOK_SECRET,
    sandbox: true,
    // NO resolvedTenantId, NO tenantIdResolver — req has no tenantID.
  })
  await expectReject(
    a.initiatePayment({
      data: { cart: { id: 7 }, currency: 'EGP' },
      req: makeReq({ payload: fake }),
    } as never),
    /resolved tenant id missing/,
  )
  assert.equal(fake._store['store-transactions']?.length ?? 0, 0)
})

test('initiatePayment is idempotent: replay returns the existing transaction + a fresh signed URL', async () => {
  const fake = makeFakePayload({
    'store-carts': [{ id: 200, tenant: TENANT_ID, subtotal: 2200, currency: 'EGP', items: [] }],
  })
  const a = kashierAdapter({
    apiKey: API_KEY,
    merchantId: MID,
    webhookSecret: WEBHOOK_SECRET,
    sandbox: true,
    resolvedTenantId: TENANT_ID,
  })
  const first = await a.initiatePayment({
    data: { cart: { id: 200 }, currency: 'EGP' },
    req: makeReq({ payload: fake }),
  } as never)
  const second = await a.initiatePayment({
    data: { cart: { id: 200 }, currency: 'EGP' },
    req: makeReq({ payload: fake }),
  } as never)
  assert.equal((first.transactionID as { id?: number }).id ?? first.transactionID, (second.transactionID as { id?: number }).id ?? second.transactionID, 'replay returns the same transaction id')
  assert.equal(second.replay, true, 'replay flagged')
  // Only one transaction row.
  assert.equal(fake._store['store-transactions']?.length, 1)
})

test('webhook accepts a valid FIXED-order provider signature and writes §3.9 fields', async () => {
  // Pre-existing transaction that the webhook will resolve by providerOrderReference.
  const fake = makeFakePayload({
    'store-transactions': [{
      id: 55,
      tenant: TENANT_ID,
      paymentMethod: 'kashier',
      providerOrderReference: 'cart-123',
      providerTransactionId: '',
      capturedAmount: 0,
      refundedAmount: 0,
      reconciliationStatus: 'pending',
      amount: 2200,
      currency: 'EGP',
      status: 'pending',
    }],
  })
  const a = kashierAdapter({
    apiKey: API_KEY,
    merchantId: MID,
    webhookSecret: WEBHOOK_SECRET,
    sandbox: true,
    insertPaymentEventFn: fakeInsertPaymentEvent(fake),
    // The webhook resolves the tenant from the transaction's tenant field, NOT from req.tenantID —
    // so resolvedTenantId is irrelevant here.
  })

  // Build a Kashier-signed webhook body.
  const p = sampleWebhook({ paymentStatus: 'SUCCESS', amount: '22.00', merchantOrderId: 'cart-123', transactionId: 'txn-9' })
  const bodyWithSig = new URLSearchParams({ ...p, signature: oracleWebhookHash(p) }).toString()
  const webhookEndpoint = webhookOf(a)
  const response = await webhookEndpoint.handler(
    makeReq({ payload: fake, body: bodyWithSig, headers: { 'content-type': 'application/x-www-form-urlencoded' } }),
  )
  assert.equal(response.status, 200)
  const json = (await response.json()) as { received: boolean }
  assert.equal(json.received, true)

  // The transaction's §3.9 fields are updated.
  const tx = fake._store['store-transactions']?.find((d) => d.id === 55)
  assert.ok(tx)
  assert.equal(tx.providerTransactionId, 'txn-9', 'providerTransactionId populated from webhook')
  assert.equal(tx.capturedAmount, 2200, 'capturedAmount in minor units (22.00 → 2200)')
  assert.equal(tx.refundedAmount, 0)
  assert.equal(tx.lastProviderStatus, 'captured', 'lastProviderStatus set to the mapped state')
  assert.equal(tx.status, 'succeeded', 'captured flips plugin status to succeeded')
  assert.ok(tx.lastProviderEventTimestamp)
  assert.match(String(tx.rawPayloadHash), /^[0-9a-f]{64}$/, 'rawPayloadHash is SHA-256 hex of the raw body')

  // The ledger row was inserted.
  const ledger = fake._store['payment-events'] ?? []
  assert.equal(ledger.length, 1)
  assert.equal(ledger[0].providerEventId, 'txn-9')
  assert.equal(ledger[0].gateway, 'kashier')
})

test('webhook rejects a tampered signature with 401 and writes nothing', async () => {
  const fake = makeFakePayload({
    'store-transactions': [{
      id: 66,
      tenant: TENANT_ID,
      paymentMethod: 'kashier',
      providerOrderReference: 'cart-123',
    }],
  })
  const a = kashierAdapter({
    apiKey: API_KEY,
    merchantId: MID,
    webhookSecret: WEBHOOK_SECRET,
    sandbox: true,
  })
  // Signature over a different amount — verification fails.
  const p = sampleWebhook({ amount: '22.00' })
  const tampered = oracleWebhookHash({ ...p, amount: '99.99' })
  const body = new URLSearchParams({ ...p, signature: tampered }).toString()
  const webhookEndpoint = webhookOf(a)
  const response = await webhookEndpoint.handler(
    makeReq({ payload: fake, body, headers: { 'content-type': 'application/x-www-form-urlencoded' } }),
  )
  assert.equal(response.status, 401)
  // No ledger row, no transaction update.
  assert.equal((fake._store['payment-events'] ?? []).length, 0)
  const tx = fake._store['store-transactions']?.find((d) => d.id === 66)
  assert.equal(tx?.providerTransactionId, undefined, 'no fields written on a rejected signature')
})

test('webhook rejects a missing signature with 401', async () => {
  const fake = makeFakePayload()
  const a = kashierAdapter({
    apiKey: API_KEY,
    merchantId: MID,
    webhookSecret: WEBHOOK_SECRET,
    sandbox: true,
  })
  const p = sampleWebhook()
  const body = new URLSearchParams(p).toString() // no signature
  const webhookEndpoint = webhookOf(a)
  const response = await webhookEndpoint.handler(
    makeReq({ payload: fake, body, headers: { 'content-type': 'application/x-www-form-urlencoded' } }),
  )
  assert.equal(response.status, 401)
  const json = (await response.json()) as { received: boolean; reason: string }
  assert.equal(json.received, false)
  assert.match(json.reason, /missing signature/)
})

test('webhook is idempotent: replaying the same providerEventId is a no-op', async () => {
  const fake = makeFakePayload({
    'store-transactions': [{
      id: 77,
      tenant: TENANT_ID,
      paymentMethod: 'kashier',
      providerOrderReference: 'cart-123',
      providerTransactionId: '',
      capturedAmount: 0,
      refundedAmount: 0,
    }],
  })
  const a = kashierAdapter({
    apiKey: API_KEY,
    merchantId: MID,
    webhookSecret: WEBHOOK_SECRET,
    sandbox: true,
    insertPaymentEventFn: fakeInsertPaymentEvent(fake),
  })
  const p = sampleWebhook({ transactionId: 'txn-replay', merchantOrderId: 'cart-123' })
  const body = new URLSearchParams({ ...p, signature: oracleWebhookHash(p) }).toString()
  const webhookEndpoint = webhookOf(a)

  // First delivery — accepted.
  const r1 = await webhookEndpoint.handler(
    makeReq({ payload: fake, body, headers: { 'content-type': 'application/x-www-form-urlencoded' } }),
  )
  assert.equal(r1.status, 200)

  // Capture the §3.9 field state after the first delivery.
  const txAfterFirst = { ...fake._store['store-transactions']?.find((d) => d.id === 77) }
  assert.equal(txAfterFirst.providerTransactionId, 'txn-replay')

  // Second delivery of the SAME body — the ledger index treats it as a duplicate.
  const r2 = await webhookEndpoint.handler(
    makeReq({ payload: fake, body, headers: { 'content-type': 'application/x-www-form-urlencoded' } }),
  )
  assert.equal(r2.status, 200)
  const json = (await r2.json()) as { received: boolean; duplicate?: boolean }
  assert.equal(json.duplicate, true, 'second delivery flagged as duplicate')

  // No additional ledger rows.
  assert.equal((fake._store['payment-events'] ?? []).length, 1, 'only one ledger row across the two deliveries')
  // The transaction's lastProviderEventTimestamp did not change (no update path ran).
  const txAfterSecond = fake._store['store-transactions']?.find((d) => d.id === 77)
  assert.equal(
    txAfterSecond?.lastProviderEventTimestamp,
    txAfterFirst.lastProviderEventTimestamp,
    'duplicate delivery did not re-write the transaction',
  )
})

test('webhook 200s on a verified signature for an unknown merchantReference (no transaction, no write)', async () => {
  const fake = makeFakePayload() // empty store
  const a = kashierAdapter({
    apiKey: API_KEY,
    merchantId: MID,
    webhookSecret: WEBHOOK_SECRET,
    sandbox: true,
    insertPaymentEventFn: fakeInsertPaymentEvent(fake),
  })
  const p = sampleWebhook({ merchantOrderId: 'cart-unknown' })
  const body = new URLSearchParams({ ...p, signature: oracleWebhookHash(p) }).toString()
  const webhookEndpoint = webhookOf(a)
  const response = await webhookEndpoint.handler(
    makeReq({ payload: fake, body, headers: { 'content-type': 'application/x-www-form-urlencoded' } }),
  )
  assert.equal(response.status, 200)
  const json = (await response.json()) as { received: boolean; noTransaction?: boolean }
  assert.equal(json.noTransaction, true)
  assert.equal((fake._store['payment-events'] ?? []).length, 0)
})
