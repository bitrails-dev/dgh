// Paymob adapter contract tests. No network: a single fake fetcher routes by URL and returns canned
// gateway JSON, and the recorded request bodies are asserted on. The webhook HMAC is produced with
// the adapter's own computeTransactionHmac so the signature round-trip is exercised end to end.

import assert from 'node:assert/strict'
import test from 'node:test'

import { money } from '../src/commerce/money'
import { computeTransactionHmac, createPaymobAdapter } from '../src/commerce/payments/adapters/paymob'

const SECRET = 'test-hmac-secret'

// Minimal Response stand-in: the adapter only reads .status and .text().
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

// A canonical Paymob transaction callback object. Filled with the documented HMAC fields so the
// signature round-trip is valid; tests mutate the state-bearing flags.
function txObj(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
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
    ...overrides,
  }
}

function webhookInput(obj: Record<string, unknown>, hmac?: string) {
  const envelope = { type: 'TRANSACTION', obj }
  const rawBody = Buffer.from(JSON.stringify(envelope), 'utf8')
  const headers: Record<string, string | undefined> = hmac === undefined ? {} : { hmac }
  return { rawBody, headers }
}

// --- hosted checkout -----------------------------------------------------------------------

test('createHostedCheckout composes auth -> order -> payment key -> iframe URL', async () => {
  const { fetcher, calls } = makeFetcher([
    (_url, body) =>
      body && typeof body === 'object' && 'api_key' in body
        ? json(200, { token: 'tok_secret_123' })
        : null,
    (_url, body) =>
      body && typeof body === 'object' && 'merchant_order_id' in body
        ? json(200, { id: 9001 })
        : null,
    (_url, body) =>
      body && typeof body === 'object' && 'integration_id' in body
        ? json(200, { token: 'pk_token_xyz' })
        : null,
  ])

  const adapter = createPaymobAdapter({
    apiKey: 'k',
    iframeId: '5555',
    integrationId: 12345,
    hmacSecret: SECRET,
    sandbox: true,
    sandboxBaseURL: 'https://accept.paym.com/api',
    fetcher,
  })

  const result = await adapter.createHostedCheckout({
    merchantReference: 'order-abc',
    amount: money(5000, 'EGP'), // 5000 piasters == 50.00 EGP
    customerEmail: 'a@b.com',
    sandbox: true,
  })

  assert.equal(
    result.checkoutUrl,
    'https://accept.paym.com/api/acceptance/iframes/5555?payment_token=pk_token_xyz',
  )
  assert.equal(result.providerSessionId, '9001')

  // Amount is integer minor units, passed straight through to amount_cents (no scaling).
  const orderCall = calls.find((c) => c.url.includes('/ecommerce/orders'))
  assert.ok(orderCall, 'order request was made')
  assert.equal((orderCall.body as { amount_cents: number }).amount_cents, 5000)
  assert.ok(Number.isInteger((orderCall.body as { amount_cents: number }).amount_cents))

  const keyCall = calls.find((c) => c.url.includes('/acceptance/payment_keys'))
  assert.ok(keyCall, 'payment-key request was made')
  assert.equal((keyCall.body as { order_id: number }).order_id, 9001)
  assert.equal((keyCall.body as { amount_cents: number }).amount_cents, 5000)
  assert.equal((keyCall.body as { integration_id: number }).integration_id, 12345)
})

test('createHostedCheckout throws "Paymob not configured" when credentials are absent', async () => {
  const { fetcher } = makeFetcher([])
  const adapter = createPaymobAdapter({ sandbox: true, fetcher })
  await assert.rejects(
    adapter.createHostedCheckout({
      merchantReference: 'order-x',
      amount: money(5000, 'EGP'),
      sandbox: true,
    }),
    /Paymob not configured/,
  )
})

// --- webhook verification ------------------------------------------------------------------

test('verifyWebhook accepts a correctly-signed transaction callback', async () => {
  const obj = txObj({ success: true })
  const hmac = computeTransactionHmac(obj, SECRET)
  const adapter = createPaymobAdapter({ apiKey: 'k', iframeId: '1', integrationId: 1, hmacSecret: SECRET })
  const res = await adapter.verifyWebhook(webhookInput(obj, hmac))

  assert.equal(res.accepted, true)
  assert.ok(res.event)
  assert.equal(res.event.provider, 'paymob')
  assert.equal(res.event.providerEventId, '1000123') // transaction id, stable across calls
  assert.equal(res.event.merchantReference, '9001') // Paymob order id == providerSessionId
  assert.equal(res.event.targetState, 'captured')
  assert.deepEqual(res.event.amount, money(5000, 'EGP'))
})

test('verifyWebhook rejects a tampered signature and a missing header', async () => {
  const obj = txObj({ success: true })
  const adapter = createPaymobAdapter({ apiKey: 'k', iframeId: '1', integrationId: 1, hmacSecret: SECRET })

  const tampered = await adapter.verifyWebhook(webhookInput(obj, '0'.repeat(128)))
  assert.equal(tampered.accepted, false)
  assert.match(tampered.reason ?? '', /signature/i)

  const missing = await adapter.verifyWebhook(webhookInput(obj))
  assert.equal(missing.accepted, false)
  assert.match(missing.reason ?? '', /hmac/i)
})

test('verifyWebhook providerEventId is stable across repeated signatures', async () => {
  const obj = txObj({ success: true })
  const adapter = createPaymobAdapter({ apiKey: 'k', iframeId: '1', integrationId: 1, hmacSecret: SECRET })
  const a = await adapter.verifyWebhook(webhookInput(obj, computeTransactionHmac(obj, SECRET)))
  const b = await adapter.verifyWebhook(webhookInput(obj, computeTransactionHmac(obj, SECRET)))
  assert.equal(a.event?.providerEventId, b.event?.providerEventId)
})

// --- state mapping -------------------------------------------------------------------------

test('a pending (non-auth) transaction maps to pending', async () => {
  const obj = txObj({ success: false, pending: true })
  const adapter = createPaymobAdapter({ apiKey: 'k', iframeId: '1', integrationId: 1, hmacSecret: SECRET })
  const res = await adapter.verifyWebhook(webhookInput(obj, computeTransactionHmac(obj, SECRET)))
  assert.equal(res.accepted, true)
  assert.equal(res.event?.targetState, 'pending')
})

test('a pending auth transaction maps to authorized', async () => {
  const obj = txObj({ success: false, pending: true, is_auth: true })
  const adapter = createPaymobAdapter({ apiKey: 'k', iframeId: '1', integrationId: 1, hmacSecret: SECRET })
  const res = await adapter.verifyWebhook(webhookInput(obj, computeTransactionHmac(obj, SECRET)))
  assert.equal(res.event?.targetState, 'authorized')
})

test('a voided transaction maps to voided', async () => {
  const obj = txObj({ success: false, is_voided: true })
  const adapter = createPaymobAdapter({ apiKey: 'k', iframeId: '1', integrationId: 1, hmacSecret: SECRET })
  const res = await adapter.verifyWebhook(webhookInput(obj, computeTransactionHmac(obj, SECRET)))
  assert.equal(res.event?.targetState, 'voided')
})

test('a refunded transaction maps to refunded', async () => {
  const obj = txObj({ success: false, is_refunded: true })
  const adapter = createPaymobAdapter({ apiKey: 'k', iframeId: '1', integrationId: 1, hmacSecret: SECRET })
  const res = await adapter.verifyWebhook(webhookInput(obj, computeTransactionHmac(obj, SECRET)))
  assert.equal(res.event?.targetState, 'refunded')
})

// --- refund / void -------------------------------------------------------------------------

test('refund returns ok with the gateway transaction id', async () => {
  const { fetcher } = makeFetcher([
    (_url, body) =>
      body && typeof body === 'object' && 'api_key' in body ? json(200, { token: 'tok_secret_123' }) : null,
    (url) => (url.includes('/void_refund/refund') ? json(200, { id: 7700, success: true }) : null),
  ])
  const adapter = createPaymobAdapter({ apiKey: 'k', iframeId: '1', integrationId: 1, fetcher })
  const res = await adapter.refund({
    providerTransactionId: '1000123',
    amount: money(2000, 'EGP'),
    reason: 'customer request',
  })
  assert.equal(res.ok, true)
  assert.equal(res.providerEventId, '7700')
})

test('refund errors are sanitized: no gateway secret leaks into error.message', async () => {
  const { fetcher } = makeFetcher([
    (_url, body) =>
      body && typeof body === 'object' && 'api_key' in body ? json(200, { token: 'tok_secret_123' }) : null,
    (url) =>
      url.includes('/void_refund/refund')
        ? json(400, { detail: ['refund rejected: tok_secret_123 is invalid for api_key=ABCDEF'] })
        : null,
  ])
  const adapter = createPaymobAdapter({ apiKey: 'k', iframeId: '1', integrationId: 1, fetcher })
  const res = await adapter.refund({ providerTransactionId: '1000123', amount: money(2000, 'EGP') })
  assert.equal(res.ok, false)
  assert.ok(res.error)
  assert.match(res.error.code, /PAYMOB/)
  assert.doesNotMatch(res.error.message, /tok_secret_123|ABCDEF/)
})

test('void settles as ok before capture', async () => {
  const { fetcher } = makeFetcher([
    (_url, body) =>
      body && typeof body === 'object' && 'api_key' in body ? json(200, { token: 'tok_secret_123' }) : null,
    (url) => (url.includes('/void_refund/void') ? json(200, { id: 888, success: true }) : null),
  ])
  const adapter = createPaymobAdapter({ apiKey: 'k', iframeId: '1', integrationId: 1, fetcher })
  assert.equal(typeof adapter.void, 'function', 'capabilities.voiding -> adapter.void present')
  const res = await adapter.void!({ providerTransactionId: '1000123', reason: 'fraud' })
  assert.equal(res.ok, true)
  assert.equal(res.providerEventId, '888')
})

// --- lookup --------------------------------------------------------------------------------

test('lookup maps a captured transaction inquiry to captured', async () => {
  const { fetcher } = makeFetcher([
    (_url, body) =>
      body && typeof body === 'object' && 'api_key' in body ? json(200, { token: 'tok_secret_123' }) : null,
    (url) =>
      url.includes('/acceptance/transactions') ? json(200, txObj({ id: 555, success: true, pending: false })) : null,
  ])
  const adapter = createPaymobAdapter({ apiKey: 'k', iframeId: '1', integrationId: 1, fetcher })
  const res = await adapter.lookup('1000123')
  assert.equal(res.state, 'captured')
  assert.equal(res.providerEventId, '555')
})

// --- capabilities --------------------------------------------------------------------------

test('capabilities declares Paymob support and hmac webhook signing', () => {
  const adapter = createPaymobAdapter({ apiKey: 'k', iframeId: '1', integrationId: 1, hmacSecret: SECRET })
  assert.deepEqual(adapter.capabilities(), {
    hostedCheckout: true,
    authorization: true,
    refunds: true,
    partialRefunds: true,
    voiding: true,
    recurring: false,
    webhookSignature: 'hmac',
  })
})
