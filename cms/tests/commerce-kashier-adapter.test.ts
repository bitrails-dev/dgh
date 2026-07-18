// Kashier adapter contract tests. No network: createHostedCheckout is pure (signed redirect URL),
// and refund/lookup inject a fake fetcher. Signatures are recomputed HERE from Kashier's documented
// algorithm (Kashier-payments/NodeJs-Checkout-Demo: backend.js) using node:crypto directly, so a
// transcription error in the adapter fails the test — a real conformance check, not a tautology.
//
// Documented schemes under test:
//   order hash    = HMAC_SHA256(apiKey, "/?payment={mid}.{orderId}.{amount}.{currency}").hex()
//   webhook hash  = HMAC_SHA256(secret, fixed-order "k=v&..." of 10 fields, leading & stripped).hex()
// amount is a decimal major-unit string ("22.00"); our Money is integer minor units (2200 → "22.00").

import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import test from 'node:test'

import { createKashierAdapter } from '../src/commerce/payments/adapters/kashier'
import { money } from '../src/commerce/money'

const API_KEY = 'test-api-key-0123456789abcdef'
const WEBHOOK_SECRET = 'iframe-secret-0123456789abcdef'
const MID = 'MID-2-670'

const adapter = createKashierAdapter({
  apiKey: API_KEY,
  merchantId: MID,
  webhookSecret: WEBHOOK_SECRET,
  sandbox: true,
})

// --- independent re-implementation of Kashier's documented signing (contract oracle) ----------

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

function oracleOrderHash(mid: string, orderId: string, amount: string, currency: string): string {
  const path = `/?payment=${mid}.${orderId}.${amount}.${currency}`
  return crypto.createHmac('sha256', API_KEY).update(path).digest('hex')
}

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
    merchantOrderId: 'order-123',
    orderId: 'KAS-ORD-1',
    cardBrand: 'MasterCard',
    orderReference: 'ref-1',
    transactionId: 'txn-9',
    amount: '22.00',
    currency: 'EGP',
    ...over,
  }
}

// --- tests -------------------------------------------------------------------------------------

test('capabilities declare instant-capture, refunds, no void/recurring, hmac webhooks', () => {
  const cap = adapter.capabilities()
  assert.equal(cap.hostedCheckout, true)
  assert.equal(cap.authorization, false)
  assert.equal(cap.refunds, true)
  assert.equal(cap.partialRefunds, true)
  assert.equal(cap.voiding, false)
  assert.equal(cap.recurring, false)
  assert.equal(cap.webhookSignature, 'hmac')
  assert.equal(typeof (adapter as { void?: unknown }).void, 'undefined', 'void must be omitted')
})

test('createHostedCheckout composes a signed URL with major-unit decimal amount', async () => {
  // 2200 minor (piasters) → "22.00". Kashier takes decimal major units, not minor units.
  const { checkoutUrl, providerSessionId } = await adapter.createHostedCheckout({
    merchantReference: 'order-123',
    amount: money(2200, 'EGP'),
    sandbox: true,
  })

  const u = new URL(checkoutUrl)
  assert.equal(u.origin, 'https://checkout.kashier.io')
  // payment token carries mid.orderId.amount.currency with amount as a 2-dp decimal string.
  assert.equal(u.searchParams.get('payment'), `${MID}.order-123.22.00.EGP`)
  assert.equal(u.searchParams.get('mode'), 'test')
  // signature matches the documented order-hash oracle over the same signed path.
  assert.equal(u.searchParams.get('signature'), oracleOrderHash(MID, 'order-123', '22.00', 'EGP'))
  assert.equal(providerSessionId, 'order-123')
})

test('amount conversion: sub-100 and non-round minor units format correctly', async () => {
  // 50 minor → "0.50"; 2199 minor → "21.99". Confirms integer-only math, no float drift.
  const a = await adapter.createHostedCheckout({ merchantReference: 'o1', amount: money(50, 'EGP'), sandbox: false })
  assert.equal(new URL(a.checkoutUrl).searchParams.get('payment'), `${MID}.o1.0.50.EGP`)
  const b = await adapter.createHostedCheckout({ merchantReference: 'o2', amount: money(2199, 'EGP'), sandbox: false })
  assert.equal(new URL(b.checkoutUrl).searchParams.get('payment'), `${MID}.o2.21.99.EGP`)
  assert.equal(new URL(b.checkoutUrl).searchParams.get('mode'), 'live')
})

test('createHostedCheckout throws "Kashier not configured" when credentials are absent', async () => {
  const unconfigured = createKashierAdapter({ apiKey: '', merchantId: '' })
  await assert.rejects(
    () => unconfigured.createHostedCheckout({ merchantReference: 'x', amount: money(100, 'EGP'), sandbox: true }),
    /Kashier not configured/,
  )
})

test('verifyWebhook accepts a correctly-signed body and normalizes the event', async () => {
  const p = sampleWebhook()
  const body = Buffer.from(new URLSearchParams(p).toString())
  const sig = oracleWebhookHash(p)
  const res = await adapter.verifyWebhook({
    rawBody: body,
    headers: { 'content-type': 'application/x-www-form-urlencoded', signature: sig },
  })
  // Kashier puts signature in the body, not a header — mirror that here.
  const withSig = { ...p, signature: sig }
  const res2 = await adapter.verifyWebhook({
    rawBody: Buffer.from(new URLSearchParams(withSig).toString()),
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
  })

  assert.equal(res2.accepted, true, 'body-embedded signature should verify')
  assert.ok(res2.event)
  assert.equal(res2.event?.provider, 'kashier')
  assert.equal(res2.event?.targetState, 'captured', 'SUCCESS → captured')
  assert.equal(res2.event?.merchantReference, 'order-123')
  assert.equal(res2.event?.providerEventId, 'txn-9', 'transactionId drives idempotency')
  assert.equal(res2.event?.amount?.amount, 2200, 'decimal amount parsed back to minor units')
  // rawRedacted must not carry card data or the signature.
  const red = res2.event?.rawRedacted as Record<string, unknown>
  assert.equal(red.cardDataToken, undefined)
  assert.equal(red.maskedCard, undefined)
  assert.equal(red.cardBrand, undefined)
  assert.equal(red.signature, undefined)
  // the header-only path (no body signature) is rejected as missing.
  assert.equal(res.accepted, false)
})

test('verifyWebhook rejects a tampered signature', async () => {
  const p = sampleWebhook({ paymentStatus: 'SUCCESS' })
  const tampered = oracleWebhookHash({ ...p, amount: '99.99' }) // signature over a different amount
  const res = await adapter.verifyWebhook({
    rawBody: Buffer.from(new URLSearchParams({ ...p, signature: tampered }).toString()),
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
  })
  assert.equal(res.accepted, false)
  assert.equal(res.reason, 'bad signature')
})

test('verifyWebhook rejects a missing signature', async () => {
  const p = sampleWebhook()
  const res = await adapter.verifyWebhook({
    rawBody: Buffer.from(new URLSearchParams(p).toString()),
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
  })
  assert.equal(res.accepted, false)
  assert.equal(res.reason, 'missing signature')
})

test('status mapping: FAILED→failed, REFUNDED→refunded, PENDING→pending, VOIDED→voided', async () => {
  const cases: Array<[string, 'failed' | 'refunded' | 'pending' | 'voided']> = [
    ['FAILED', 'failed'],
    ['REFUNDED', 'refunded'],
    ['PENDING', 'pending'],
    ['VOIDED', 'voided'],
  ]
  for (const [status, expected] of cases) {
    const p = sampleWebhook({ paymentStatus: status })
    const res = await adapter.verifyWebhook({
      rawBody: Buffer.from(new URLSearchParams({ ...p, signature: oracleWebhookHash(p) }).toString()),
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    })
    assert.equal(res.accepted, true, `${status} should be accepted`)
    assert.equal(res.event?.targetState, expected)
  }
})

test('refund posts to the order refund endpoint and returns a sanitized ProviderResult', async () => {
  // Capture via an array: TS control-flow can't see the closure assignment, so a `let` would narrow
  // to null/never. Array element access carries the declared element type, sidestepping the issue.
  const calls: Array<{ url: string; init?: { method?: string; headers?: Record<string, string>; body?: string } }> = []
  const fakeFetcher = async (
    url: string,
    init?: { method?: string; headers?: Record<string, string>; body?: string },
  ) => {
    calls.push({ url, init })
    return {
      ok: true,
      status: 200,
      json: async () => ({ id: 'refund-7', orderId: 'KAS-ORD-1', status: 'SUCCESS' }),
      text: async () => '',
    }
  }
  const a = createKashierAdapter({ apiKey: API_KEY, merchantId: MID, webhookSecret: WEBHOOK_SECRET, sandbox: true, fetcher: fakeFetcher })

  const res = await a.refund({ providerTransactionId: 'KAS-ORD-1', amount: money(500, 'EGP'), reason: 'customer request' })
  assert.equal(res.ok, true)
  assert.equal(res.providerEventId, 'refund-7')
  assert.equal(calls.length, 1)
  const req = calls[0]
  assert.equal(req.url, 'https://test-app.kashier.io/api/v1/orders/KAS-ORD-1/refund')
  assert.equal(req.init?.method, 'POST')
  // body carries the major-unit decimal amount, not minor units.
  assert.deepEqual(JSON.parse(req.init?.body ?? '{}'), { amount: '5.00', reason: 'customer request' })
})

test('refund sanitizes errors: the API key never appears in the error message', async () => {
  // The fetcher throws an error that echoes the auth header — a realistic gateway/transport leak.
  const leakingFetcher = async () => {
    throw new Error(`upstream reset while sending authorization: ${API_KEY}`)
  }
  const a = createKashierAdapter({ apiKey: API_KEY, merchantId: MID, webhookSecret: WEBHOOK_SECRET, fetcher: leakingFetcher })

  const res = await a.refund({ providerTransactionId: 'KAS-ORD-1', amount: money(100, 'EGP') })
  assert.equal(res.ok, false)
  assert.ok(res.error)
  assert.equal(res.error.message.includes(API_KEY), false, 'secret must be redacted from error.message')
  assert.ok(res.error.message.length <= 300, 'error message bounded')
})

test('lookup maps the gateway order status onto a PaymentState', async () => {
  const fakeFetcher = async () => ({
    ok: true,
    status: 200,
    json: async () => ({ data: { paymentStatus: 'SUCCESS', transactionId: 'txn-9' } }),
    text: async () => '',
  })
  const a = createKashierAdapter({ apiKey: API_KEY, merchantId: MID, webhookSecret: WEBHOOK_SECRET, fetcher: fakeFetcher })
  const { state, providerEventId } = await a.lookup('order-123')
  assert.equal(state, 'captured')
  assert.equal(providerEventId, 'txn-9')
})
