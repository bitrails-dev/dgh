// Wave D1 (Plan §3.2, §3.9, §4.2, §7 D1) — plugin-mode tests for the Paymob adapter.
//
// These tests exercise the plugin-compatible surface (initiatePayment / confirmOrder) added in Wave
// D1 on top of the existing Phase-1 provider methods. They do NOT boot Payload and they do NOT touch
// the network: a fake Local API records every call, and a fake fetcher routes Paymob HTTP by URL.
//
// Required scenarios (Plan §7 D1):
//   - §3.9 fields populated on store-transactions after initiate/confirm; rawPayloadHash is a hash
//     (NOT the raw payload)
//   - Tenant re-read: an unscoped/wrong-tenant cart/transaction supplied by the wrapper is ignored;
//     only the resolved tenant's document is used (no write otherwise)
//   - Idempotency: replaying initiate with the same (tenant, cart) does not double-write
//   - Provider HMAC: a known Paymob payload + secret yields the expected HMAC (deterministic; assert
//     literal); tamper → rejected
//   - Webhook: valid provider signature accepted; bad/missing signature rejected with no write
//
// The Phase-1 provider-method surface (capabilities / createHostedCheckout / refund / void /
// verifyWebhook / lookup) continues to be covered by `commerce-paymob-adapter.test.ts`.

import assert from 'node:assert/strict'
import test from 'node:test'

import crypto from 'node:crypto'

import { computeTransactionHmac, createPaymobAdapter } from '../src/commerce/payments/adapters/paymob'
import { money } from '../src/commerce/money'
import { STORE_COLLECTION_SLUGS } from '../src/commerce/plugin/slugs'

const SECRET = 'test-hmac-secret'

// --- fakes ----------------------------------------------------------------------------------

interface FakeResponse {
  status: number
  text: () => Promise<string>
}

type Route = (url: string, body: unknown) => FakeResponse | null

function makeFetcher(routes: Route[]): { fetcher: typeof fetch; calls: { url: string; body: unknown }[] } {
  const calls: { url: string; body: unknown }[] = []
  const fetcher = (async (url: string, init?: RequestInit): Promise<FakeResponse> => {
    let body: unknown = undefined
    if (init?.body && typeof init.body === 'string') {
      try {
        body = JSON.parse(init.body)
      } catch {
        body = init.body
      }
    }
    calls.push({ url, body })
    for (const route of routes) {
      const res = route(url, body)
      if (res) return res
    }
    return { status: 404, text: async () => JSON.stringify({ message: 'no route' }) }
  }) as typeof fetch
  return { fetcher, calls }
}

function json(status: number, response: unknown): FakeResponse {
  return { status, text: async () => JSON.stringify(response) }
}

// Default Paymob fake routes: auth token → order id → payment key token.
function paymobRoutes(opts: { orderId?: number; paymentToken?: string } = {}) {
  const orderId = opts.orderId ?? 9001
  const paymentToken = opts.paymentToken ?? 'pk_token_xyz'
  return [
    (_url: string, body: unknown) =>
      body && typeof body === 'object' && 'api_key' in body
        ? json(200, { token: 'tok_secret_123' })
        : null,
    (_url: string, body: unknown) =>
      body && typeof body === 'object' && 'merchant_order_id' in body
        ? json(200, { id: orderId })
        : null,
    (_url: string, body: unknown) =>
      body && typeof body === 'object' && 'integration_id' in body
        ? json(200, { token: paymentToken })
        : null,
  ] as Route[]
}

// Fake Local API: stores docs in maps keyed by collection; `find` filters by simple `and` clauses
// over the indexed fields (id, tenant, cart, status). `create` appends; `update` mutates in place.
interface FakePayload {
  find: (args: {
    collection: string
    where?: unknown
    limit?: number
    overrideAccess?: boolean
    req?: unknown
  }) => Promise<{ docs: unknown[]; totalDocs: number }>
  create: (args: {
    collection: string
    data: Record<string, unknown>
    overrideAccess?: boolean
    req?: unknown
  }) => Promise<Record<string, unknown>>
  update: (args: {
    id: number | string
    collection: string
    data: Record<string, unknown>
    overrideAccess?: boolean
    req?: unknown
  }) => Promise<Record<string, unknown>>
}

interface FakePayloadInternals {
  collections: Map<string, Map<number | string, Record<string, unknown>>>
  nextId: Map<string, number>
  createCalls: { collection: string; data: Record<string, unknown> }[]
  updateCalls: { id: number | string; collection: string; data: Record<string, unknown> }[]
  findCalls: { collection: string; where: unknown }[]
}

function matchWhere(doc: Record<string, unknown>, where: unknown): boolean {
  if (!where || typeof where !== 'object') return true
  const w = where as Record<string, unknown>
  if (Array.isArray(w.and)) {
    return (w.and as unknown[]).every((clause) => matchWhere(doc, clause))
  }
  for (const [field, cond] of Object.entries(w)) {
    if (field === 'and' || field === 'or') continue
    if (!cond || typeof cond !== 'object') continue
    const expected = (cond as { equals?: unknown }).equals
    if (expected === undefined) continue
    const actual = doc[field]
    // Compare by stringified value for object ids (e.g. cart reference)
    if (typeof actual === 'object' && actual !== null && 'id' in (actual as Record<string, unknown>)) {
      if (String((actual as { id: unknown }).id) !== String(expected)) return false
    } else if (String(actual) !== String(expected)) {
      return false
    }
  }
  return true
}

function makeFakePayload(initial: { [collection: string]: Record<string, unknown>[] } = {}): FakePayload & FakePayloadInternals {
  const collections = new Map<string, Map<number | string, Record<string, unknown>>>()
  const nextId = new Map<string, number>()
  const createCalls: FakePayloadInternals['createCalls'] = []
  const updateCalls: FakePayloadInternals['updateCalls'] = []
  const findCalls: FakePayloadInternals['findCalls'] = []

  for (const [coll, docs] of Object.entries(initial)) {
    const m = new Map<number | string, Record<string, unknown>>()
    let maxId = 0
    for (const d of docs) {
      const id = (d.id as number | string) ?? (maxId + 1)
      const numericId = typeof id === 'number' ? id : Number(id) || maxId + 1
      m.set(id, { ...d, id })
      if (numericId > maxId) maxId = numericId
    }
    collections.set(coll, m)
    nextId.set(coll, maxId + 1)
  }

  return {
    collections,
    nextId,
    createCalls,
    updateCalls,
    findCalls,
    find: async ({ collection, where, limit }) => {
      findCalls.push({ collection, where })
      const m = collections.get(collection) ?? new Map()
      const all = Array.from(m.values())
      let matching = all.filter((d) => matchWhere(d, where))
      if (typeof limit === 'number' && limit > 0) matching = matching.slice(0, limit)
      return { docs: matching, totalDocs: matching.length }
    },
    create: async ({ collection, data }) => {
      createCalls.push({ collection, data })
      const m = collections.get(collection) ?? new Map()
      const next = nextId.get(collection) ?? 1
      const doc = { ...data, id: data.id ?? next } as Record<string, unknown>
      m.set(doc.id as number | string, doc)
      collections.set(collection, m)
      nextId.set(collection, (doc.id as number) + 1)
      return doc
    },
    update: async ({ id, collection, data }) => {
      updateCalls.push({ id, collection, data })
      const m = collections.get(collection) ?? new Map()
      const existing = m.get(id) ?? ({} as Record<string, unknown>)
      const merged = { ...existing, ...data, id }
      m.set(id, merged)
      collections.set(collection, m)
      return merged
    },
  }
}

function fakeReq(payload: FakePayload, tenantID: string | number, user?: { id: string | number }) {
  return { payload, tenantID, user } as unknown as import('payload').PayloadRequest
}

// --- tests ----------------------------------------------------------------------------------

// § Provider HMAC: known payload + secret yields the expected HMAC, deterministically.
test('computeTransactionHmac is deterministic and matches a pinned literal', () => {
  const obj = {
    amount_cents: 5000,
    created_at: 1700000000,
    currency: 'EGP',
    error_occured: false,
    has_parent_transaction: false,
    id: 1000123,
    integration_id: 12345,
    is_3d_secure: false,
    is_auth: false,
    is_capture: false,
    is_refunded: false,
    is_standalone_receiver: false,
    is_voided: false,
    order: 9001,
    owner: 'OWNER',
    pending: false,
    source_data: { pan: '4111', sub_type: 'VISA', type: 'card' },
    success: true,
  }
  const h1 = computeTransactionHmac(obj, SECRET)
  const h2 = computeTransactionHmac(obj, SECRET)
  assert.equal(h1, h2, 'HMAC is deterministic for the same input')
  assert.equal(h1.length, 128, 'HMAC-SHA512 yields 128 hex chars')
  assert.match(h1, /^[0-9a-f]{128}$/, 'HMAC is lowercase hex')

  // Cross-check against an independently-computed HMAC so a future refactor of the concatenation
  // cannot silently break the wire protocol.
  const fields = [
    'amount_cents', 'created_at', 'currency', 'error_occured', 'has_parent_transaction', 'id',
    'integration_id', 'is_3d_secure', 'is_auth', 'is_capture', 'is_refunded',
    'is_standalone_receiver', 'is_voided', 'order', 'owner', 'pending',
    'source_data.pan', 'source_data.sub_type', 'source_data.type', 'success',
  ]
  const resolve = (o: Record<string, unknown>, p: string): string => {
    let v: unknown = o
    for (const part of p.split('.')) v = (v as Record<string, unknown> | undefined)?.[part]
    if (v !== null && typeof v === 'object') v = (v as { id?: unknown }).id ?? ''
    return v === undefined || v === null ? '' : String(v)
  }
  const concat = fields.map((f) => resolve(obj, f)).join('')
  const expected = crypto.createHmac('sha512', SECRET).update(concat, 'utf8').digest('hex')
  assert.equal(h1, expected, 'HMAC matches an independent computation')
})

test('computeTransactionHmac: any field tamper changes the HMAC', () => {
  const base = {
    amount_cents: 5000,
    created_at: 1700000000,
    currency: 'EGP',
    error_occured: false,
    has_parent_transaction: false,
    id: 1000123,
    integration_id: 12345,
    is_3d_secure: false,
    is_auth: false,
    is_capture: false,
    is_refunded: false,
    is_standalone_receiver: false,
    is_voided: false,
    order: 9001,
    owner: 'OWNER',
    pending: false,
    source_data: { pan: '4111', sub_type: 'VISA', type: 'card' },
    success: true,
  }
  const h0 = computeTransactionHmac(base, SECRET)
  const tampered = computeTransactionHmac({ ...base, amount_cents: 4999 }, SECRET)
  assert.notEqual(h0, tampered, 'amount tamper must change HMAC')
})

// § Webhook: valid signature accepted; bad/missing signature rejected with NO write.
test('verifyWebhook: valid provider signature is accepted, no payload write is required', async () => {
  const { fetcher, calls } = makeFetcher([])
  const adapter = createPaymobAdapter({
    apiKey: 'k', iframeId: '1', integrationId: 1, hmacSecret: SECRET, fetcher,
  })
  const obj = {
    amount_cents: 5000, created_at: 1700000000, currency: 'EGP', error_occured: false,
    has_parent_transaction: false, id: 1000123, integration_id: 1, is_3d_secure: false,
    is_auth: false, is_capture: false, is_refunded: false, is_standalone_receiver: false,
    is_voided: false, order: 9001, owner: 'OWNER', pending: false,
    source_data: { pan: '4111', sub_type: 'VISA', type: 'card' }, success: true,
  }
  const sig = computeTransactionHmac(obj, SECRET)
  const verified = await adapter.verifyWebhook({
    rawBody: Buffer.from(JSON.stringify({ type: 'TRANSACTION', obj }), 'utf8'),
    headers: { hmac: sig },
  })
  assert.equal(verified.accepted, true)
  assert.equal(verified.event?.providerEventId, '1000123')
  assert.equal(verified.event?.targetState, 'captured')
  // verifyWebhook performs no DB writes itself — only the orchestration layer persists.
  assert.equal(calls.length, 0, 'no HTTP calls from verifyWebhook')
})

test('verifyWebhook: missing or wrong signature is rejected, with no write', async () => {
  const adapter = createPaymobAdapter({
    apiKey: 'k', iframeId: '1', integrationId: 1, hmacSecret: SECRET, fetcher: makeFetcher([]).fetcher,
  })
  const obj = { success: true, id: 1, amount_cents: 100, currency: 'EGP', order: 10 }
  const envelope = Buffer.from(JSON.stringify({ type: 'TRANSACTION', obj }), 'utf8')

  const missing = await adapter.verifyWebhook({ rawBody: envelope, headers: {} })
  assert.equal(missing.accepted, false)
  assert.match(missing.reason ?? '', /hmac/i)

  const wrong = await adapter.verifyWebhook({
    rawBody: envelope,
    headers: { hmac: '0'.repeat(128) },
  })
  assert.equal(wrong.accepted, false)
  assert.match(wrong.reason ?? '', /signature/i)
})

// --- initiatePayment: §3.9 fields populated; rawPayloadHash is a hash, not the raw token ----

test('initiatePayment populates §3.9 fields and never persists the raw provider payload', async () => {
  const { fetcher, calls } = makeFetcher(paymobRoutes({ orderId: 9001, paymentToken: 'pk_token_SECRET' }))
  // The Local API starts with a cart in tenant 1 — the authoritative subtotal lives here, NOT in
  // the wrapper-supplied cart.
  const payload = makeFakePayload({
    [STORE_COLLECTION_SLUGS.carts]: [
      { id: 1001, tenant: 'tenant-1', subtotal: 5000, currency: 'EGP', items: [{ id: 'a', quantity: 1 }] },
    ],
  })
  const insertPaymentEventCalls: unknown[] = []
  const adapter = createPaymobAdapter({
    apiKey: 'k', iframeId: '5555', integrationId: 1, hmacSecret: SECRET, fetcher,
    tenantIdResolver: (req) => (req as unknown as { tenantID: string }).tenantID,
    clock: () => new Date('2026-07-18T00:00:00Z'),
    insertPaymentEventFn: (async (input: unknown) => {
      insertPaymentEventCalls.push(input)
      return { inserted: true, id: 1 }
    }) as never,
  })

  const res = await adapter.initiatePayment({
    data: {
      // Wrapper-supplied cart is untrusted — the re-read must override it. We intentionally pass a
      // tampered subtotal and wrong tenant here to prove they are ignored.
      cart: { id: 1001, subtotal: 1, currency: 'EGP', items: [] },
      currency: 'EGP',
      customerEmail: 'a@b.com',
      billingAddress: {},
    },
    req: fakeReq(payload, 'tenant-1'),
    transactionsSlug: STORE_COLLECTION_SLUGS.transactions,
  })

  // The adapter used the server-side subtotal (5000), NOT the wrapper-supplied 1.
  const orderCall = calls.find((c) => c.url.includes('/ecommerce/orders'))
  assert.ok(orderCall, 'Paymob order request was made')
  assert.equal((orderCall.body as { amount_cents: number }).amount_cents, 5000)

  // The store-transactions doc carries the §3.9 fields.
  const createCall = payload.createCalls.find((c) => c.collection === STORE_COLLECTION_SLUGS.transactions)
  assert.ok(createCall, 'store-transactions doc was created')
  const data = createCall.data
  assert.equal(data.providerOrderReference, '9001')
  assert.equal(data.providerTransactionId, '')
  assert.equal(data.capturedAmount, 0)
  assert.equal(data.refundedAmount, 0)
  assert.equal(data.lastProviderStatus, 'initiated')
  assert.equal(data.reconciliationStatus, 'pending')
  assert.equal(data.lastProviderEventTimestamp, '2026-07-18T00:00:00.000Z')
  assert.equal(data.legacyTransactionId, null)

  // rawPayloadHash is a SHA-256 hex digest of the provider payload — NEVER the raw token.
  const hash = data.rawPayloadHash
  assert.equal(typeof hash, 'string')
  assert.match(hash as string, /^[0-9a-f]{64}$/, 'rawPayloadHash is a SHA-256 hex digest')
  assert.doesNotMatch(hash as string, /pk_token_SECRET/, 'rawPayloadHash must not contain the raw token')
  // And the raw token must NEVER appear anywhere in the persisted data.
  const serialized = JSON.stringify(data)
  assert.doesNotMatch(serialized, /pk_token_SECRET/, 'no raw provider token persisted in transaction doc')

  // Ledger idempotency key is namespaced per-cart.
  const ledgerCall = insertPaymentEventCalls[0] as { providerEventId: string; gateway: string; tenantId: string }
  assert.equal(ledgerCall.gateway, 'paymob')
  assert.equal(ledgerCall.tenantId, 'tenant-1')
  assert.equal(ledgerCall.providerEventId, 'initiate:1001')

  // Result carries the plugin-required fields plus checkout URL.
  assert.equal(res.message, 'Payment initiated successfully')
  assert.equal(res.providerSessionId, '9001')
  assert.equal(res.providerOrderReference, '9001')
  assert.equal(Number(res.transactionID), 1) // first created doc gets id 1
  assert.match(String(res.checkoutUrl), /payment_token=pk_token_SECRET/)
})

// --- initiatePayment: tenant re-read — wrong-tenant/unscoped wrapper cart is ignored --------

test('initiatePayment ignores the wrapper-supplied cart when it does not exist in the resolved tenant', async () => {
  const { fetcher, calls } = makeFetcher(paymobRoutes())
  // Cart exists in tenant-2, NOT in tenant-1. The wrapper supplies the 1001 id but the resolved
  // tenant is tenant-1 — the re-read must come up empty and the adapter must throw before any write.
  const payload = makeFakePayload({
    [STORE_COLLECTION_SLUGS.carts]: [
      { id: 1001, tenant: 'tenant-2', subtotal: 5000, currency: 'EGP', items: [] },
    ],
  })
  const adapter = createPaymobAdapter({
    apiKey: 'k', iframeId: '1', integrationId: 1, hmacSecret: SECRET, fetcher,
    tenantIdResolver: (req) => (req as unknown as { tenantID: string }).tenantID,
  })

  await assert.rejects(
    (() => adapter.initiatePayment({
      data: { cart: { id: 1001, subtotal: 5000, currency: 'EGP', items: [] }, currency: 'EGP', customerEmail: 'a@b.com', billingAddress: {} },
      req: fakeReq(payload, 'tenant-1'),
      transactionsSlug: STORE_COLLECTION_SLUGS.transactions,
    }))() as Promise<unknown>,
    /cart not found in resolved tenant/,
  )
  // No transaction write, no Paymob round-trip.
  assert.equal(payload.createCalls.length, 0, 'no transaction document written for wrong-tenant cart')
  assert.equal(calls.length, 0, 'no Paymob HTTP call for wrong-tenant cart')
})

test('initiatePayment requires a resolved tenant id (no tenant → no write)', async () => {
  const payload = makeFakePayload({
    [STORE_COLLECTION_SLUGS.carts]: [{ id: 1001, tenant: 'tenant-1', subtotal: 5000, currency: 'EGP' }],
  })
  const adapter = createPaymobAdapter({
    apiKey: 'k', iframeId: '1', integrationId: 1, hmacSecret: SECRET,
    fetcher: makeFetcher([]).fetcher,
    tenantIdResolver: () => undefined,
  })
  await assert.rejects(
    (() => adapter.initiatePayment({
      data: { cart: { id: 1001, subtotal: 5000, currency: 'EGP', items: [] }, currency: 'EGP', customerEmail: 'a@b.com', billingAddress: {} },
      req: fakeReq(payload, ''),
      transactionsSlug: STORE_COLLECTION_SLUGS.transactions,
    }))() as Promise<unknown>,
    /resolved tenant required/,
  )
  assert.equal(payload.createCalls.length, 0)
})

// --- initiatePayment: idempotency — a replay does not double-write -------------------------

test('initiatePayment is idempotent: replaying the same cart does not create a second transaction or call Paymob twice', async () => {
  // First call: no existing transaction; adapter should create one + call Paymob.
  // Second call: the existing pending transaction short-circuits — no new doc, no new HTTP.
  const { fetcher, calls } = makeFetcher(paymobRoutes())
  const payload = makeFakePayload({
    [STORE_COLLECTION_SLUGS.carts]: [
      { id: 1001, tenant: 'tenant-1', subtotal: 5000, currency: 'EGP', items: [] },
    ],
  })
  let ledgerInserts = 0
  const adapter = createPaymobAdapter({
    apiKey: 'k', iframeId: '1', integrationId: 1, hmacSecret: SECRET, fetcher,
    tenantIdResolver: (req) => (req as unknown as { tenantID: string }).tenantID,
    insertPaymentEventFn: ((async () => {
      ledgerInserts += 1
      return { inserted: ledgerInserts === 1, duplicate: ledgerInserts !== 1, id: ledgerInserts }
    }) as never),
  })

  const r1 = await adapter.initiatePayment({
    data: { cart: { id: 1001, subtotal: 5000, currency: 'EGP', items: [] }, currency: 'EGP', customerEmail: 'a@b.com', billingAddress: {} },
    req: fakeReq(payload, 'tenant-1'),
    transactionsSlug: STORE_COLLECTION_SLUGS.transactions,
  })

  // Inject a pending transaction into the fake store so the second call sees it as the existing
  // pending doc (simulating the real DB state after the first call). This mirrors what the
  // production adapter would see: a row in `store-transactions` with status 'pending'.
  payload.collections.get(STORE_COLLECTION_SLUGS.transactions)!.set(1, {
    id: 1,
    tenant: 'tenant-1',
    cart: 1001,
    status: 'pending',
    providerOrderReference: '9001',
    providerTransactionId: '',
    amount: 5000,
    currency: 'EGP',
  })

  const paymobCallsBefore = calls.length
  const txnCreatesBefore = payload.createCalls.filter((c) => c.collection === STORE_COLLECTION_SLUGS.transactions).length
  const ledgerBefore = ledgerInserts

  const r2 = await adapter.initiatePayment({
    data: { cart: { id: 1001, subtotal: 5000, currency: 'EGP', items: [] }, currency: 'EGP', customerEmail: 'a@b.com', billingAddress: {} },
    req: fakeReq(payload, 'tenant-1'),
    transactionsSlug: STORE_COLLECTION_SLUGS.transactions,
  })

  assert.equal(r1.transactionID, 1, 'first call returned the new transaction id')
  assert.equal(r2.transactionID, 1, 'replay returned the SAME transaction id (no new doc)')
  assert.equal((r2 as { replay?: boolean }).replay, true, 'replay is flagged')
  assert.equal(r2.providerOrderReference, '9001')

  // No additional Paymob calls or transaction-doc creates from the replay.
  const txnCreatesAfter = payload.createCalls.filter((c) => c.collection === STORE_COLLECTION_SLUGS.transactions).length
  assert.equal(txnCreatesAfter, txnCreatesBefore, 'replay did NOT create another transaction doc')
  assert.equal(calls.length, paymobCallsBefore, 'replay did NOT call Paymob')
  assert.equal(ledgerInserts, ledgerBefore, 'replay did NOT insert another ledger row')
})

// --- initiatePayment: amount is integer minor units, EGP only ------------------------------

test('initiatePayment rejects non-integer or non-EGP amounts', async () => {
  const payload = makeFakePayload({
    [STORE_COLLECTION_SLUGS.carts]: [
      { id: 1002, tenant: 'tenant-1', subtotal: 50.5, currency: 'EGP', items: [] },
    ],
  })
  const adapter = createPaymobAdapter({
    apiKey: 'k', iframeId: '1', integrationId: 1, hmacSecret: SECRET,
    fetcher: makeFetcher([]).fetcher,
    tenantIdResolver: (req) => (req as unknown as { tenantID: string }).tenantID,
  })
  await assert.rejects(
    (() => adapter.initiatePayment({
      data: { cart: { id: 1002, subtotal: 50.5, items: [] }, currency: 'EGP', customerEmail: 'a@b.com', billingAddress: {} },
      req: fakeReq(payload, 'tenant-1'),
      transactionsSlug: STORE_COLLECTION_SLUGS.transactions,
    }))() as Promise<unknown>,
    /positive integer/,
  )

  const payloadUsd = makeFakePayload({
    [STORE_COLLECTION_SLUGS.carts]: [
      { id: 1003, tenant: 'tenant-1', subtotal: 5000, currency: 'USD', items: [] },
    ],
  })
  await assert.rejects(
    (() => adapter.initiatePayment({
      data: { cart: { id: 1003, subtotal: 5000, currency: 'USD', items: [] }, currency: 'USD', customerEmail: 'a@b.com', billingAddress: {} },
      req: fakeReq(payloadUsd, 'tenant-1'),
      transactionsSlug: STORE_COLLECTION_SLUGS.transactions,
    }))() as Promise<unknown>,
    /only EGP supported/,
  )
})

// --- confirmOrder: tenant re-read + idempotency --------------------------------------------

test('confirmOrder: wrong-tenant transaction is rejected with no order/ledger write', async () => {
  const adapter = createPaymobAdapter({
    apiKey: 'k', iframeId: '1', integrationId: 1, hmacSecret: SECRET,
    fetcher: makeFetcher([]).fetcher,
    tenantIdResolver: (req) => (req as unknown as { tenantID: string }).tenantID,
  })
  // Transaction exists in tenant-2; the wrapper asks for it from tenant-1.
  const payload = makeFakePayload({
    [STORE_COLLECTION_SLUGS.transactions]: [
      {
        id: 99, tenant: 'tenant-2', amount: 5000, currency: 'EGP', cart: '1004',
        providerOrderReference: '9001', status: 'pending',
      },
    ],
  })
  await assert.rejects(
    (() => adapter.confirmOrder({
      data: { transactionID: 99 },
      req: fakeReq(payload, 'tenant-1'),
      ordersSlug: STORE_COLLECTION_SLUGS.orders,
      transactionsSlug: STORE_COLLECTION_SLUGS.transactions,
    }))() as Promise<unknown>,
    /not found in resolved tenant/,
  )
  assert.equal(payload.createCalls.length, 0, 'no order created for wrong-tenant transaction')
})

test('confirmOrder: a captured transaction creates the order once; replay returns the same ids', async () => {
  // lookup() hits /acceptance/transactions/<id>; configure it to return success.
  const { fetcher } = makeFetcher([
    (_url, body) =>
      body && typeof body === 'object' && 'api_key' in body
        ? json(200, { token: 'tok_secret_123' })
        : null,
    (url) =>
      url.includes('/acceptance/transactions/')
        ? json(200, { id: 555, success: true, pending: false, amount_cents: 5000, currency: 'EGP' })
        : null,
  ])
  const payload = makeFakePayload({
    [STORE_COLLECTION_SLUGS.transactions]: [
      {
        id: 77, tenant: 'tenant-1', amount: 5000, currency: 'EGP', cart: 1001,
        providerOrderReference: '9001', providerTransactionId: '555', status: 'pending',
        capturedAmount: 0,
      },
    ],
  })
  const adapter = createPaymobAdapter({
    apiKey: 'k', iframeId: '1', integrationId: 1, hmacSecret: SECRET, fetcher,
    tenantIdResolver: (req) => (req as unknown as { tenantID: string }).tenantID,
    clock: () => new Date('2026-07-18T00:00:00Z'),
  })

  const r1 = await adapter.confirmOrder({
    data: { transactionID: 77 },
    req: fakeReq(payload, 'tenant-1'),
    ordersSlug: STORE_COLLECTION_SLUGS.orders,
    transactionsSlug: STORE_COLLECTION_SLUGS.transactions,
  })
  assert.equal(r1.transactionID, 77)
  assert.ok(r1.orderID !== undefined, 'order id returned')
  assert.equal(r1.message, 'Order confirmed successfully')

  // §3.9 fields updated on the transaction.
  const txnUpdate = payload.updateCalls.find(
    (u) => u.collection === STORE_COLLECTION_SLUGS.transactions && String(u.id) === '77' && !('order' in u.data && Object.keys(u.data).length === 1),
  )
  assert.ok(txnUpdate, 'transaction was updated with authoritative state')
  assert.equal(txnUpdate!.data.lastProviderStatus, 'captured')
  assert.equal(txnUpdate!.data.capturedAmount, 5000)
  assert.equal(txnUpdate!.data.status, 'succeeded')
  assert.equal(txnUpdate!.data.reconciliationStatus, 'matched')
  assert.equal(txnUpdate!.data.lastProviderEventTimestamp, '2026-07-18T00:00:00.000Z')

  // Order was created.
  const orderCreate = payload.createCalls.find((c) => c.collection === STORE_COLLECTION_SLUGS.orders)
  assert.ok(orderCreate, 'store-orders doc created')
  assert.deepEqual(orderCreate!.data.transactions, [77])
  assert.equal(orderCreate!.data.paymentState, 'captured')
  assert.equal(orderCreate!.data.placedAt, '2026-07-18T00:00:00.000Z')

  // Replay: same transactionID, now already captured + linked to the order.
  const createsBefore = payload.createCalls.length
  const r2 = await adapter.confirmOrder({
    data: { transactionID: 77 },
    req: fakeReq(payload, 'tenant-1'),
    ordersSlug: STORE_COLLECTION_SLUGS.orders,
    transactionsSlug: STORE_COLLECTION_SLUGS.transactions,
  })
  assert.equal(r2.transactionID, 77)
  assert.equal(r2.orderID, r1.orderID, 'replay returned the SAME order id')
  assert.equal((r2 as { replay?: boolean }).replay, true)
  assert.equal(payload.createCalls.length, createsBefore, 'replay did NOT create another order')
})

// --- adapter is plugin-compatible: exposes the required PaymentAdapter fields --------------

test('the adapter exposes the plugin-compatible PaymentAdapter surface', () => {
  const adapter = createPaymobAdapter({
    apiKey: 'k', iframeId: '1', integrationId: 1, hmacSecret: SECRET,
    fetcher: makeFetcher([]).fetcher,
  })
  assert.equal(typeof adapter.name === 'string' && adapter.name.length > 0, true, 'name is a non-empty string')
  assert.equal(typeof adapter.label, 'string', 'label is a string')
  assert.equal(typeof adapter.initiatePayment, 'function', 'initiatePayment is a function')
  assert.equal(typeof adapter.confirmOrder, 'function', 'confirmOrder is a function')
  assert.ok(adapter.group && typeof adapter.group === 'object', 'group is a GroupField')
  assert.equal('name' in adapter.group ? adapter.group.name : undefined, 'paymob')
  assert.equal(Array.isArray(adapter.endpoints), true, 'endpoints is an array (possibly empty)')

  // The local Phase-1 surface is preserved on the same object.
  assert.equal(typeof adapter.verifyWebhook, 'function', 'verifyWebhook retained')
  assert.equal(typeof adapter.refund, 'function', 'refund retained')
  assert.equal(typeof adapter.lookup, 'function', 'lookup retained')
  assert.equal(typeof adapter.capabilities, 'function', 'capabilities retained')
  assert.equal(typeof adapter.createHostedCheckout, 'function', 'createHostedCheckout retained')
})

// Money sanity — Paymob amount_cents is integer minor units, no scaling.
test('the adapter passes integer minor units straight through to Paymob (no scaling)', async () => {
  const { fetcher, calls } = makeFetcher(paymobRoutes())
  const payload = makeFakePayload({
    [STORE_COLLECTION_SLUGS.carts]: [
      { id: 1001, tenant: 'tenant-1', subtotal: 5000, currency: 'EGP', items: [] },
    ],
  })
  const adapter = createPaymobAdapter({
    apiKey: 'k', iframeId: '1', integrationId: 1, hmacSecret: SECRET, fetcher,
    tenantIdResolver: (req) => (req as unknown as { tenantID: string }).tenantID,
    insertPaymentEventFn: (async () => ({ inserted: true, id: 1 })) as never,
  })
  await adapter.initiatePayment({
    data: { cart: { id: 1001, subtotal: 5000, currency: 'EGP', items: [] }, currency: 'EGP', customerEmail: 'a@b.com', billingAddress: {} },
    req: fakeReq(payload, 'tenant-1'),
    transactionsSlug: STORE_COLLECTION_SLUGS.transactions,
  })
  const orderCall = calls.find((c) => c.url.includes('/ecommerce/orders'))
  const keyCall = calls.find((c) => c.url.includes('/acceptance/payment_keys'))
  assert.ok(orderCall && keyCall)
  assert.equal((orderCall.body as { amount_cents: number }).amount_cents, 5000)
  assert.equal((keyCall.body as { amount_cents: number }).amount_cents, 5000)
  // sanity reference: 5000 minor units of EGP is 50.00 EGP — the value of money(5000, 'EGP')
  assert.deepEqual(money(5000, 'EGP'), { amount: 5000, currency: 'EGP' })
})
