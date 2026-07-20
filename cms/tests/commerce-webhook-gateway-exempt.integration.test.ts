// Wave F3 — webhook-exempt provider-signature contract (Plan §4.2). Proves at the ROUTE level, for
// BOTH providers, through the REAL adapter built from the tenant's decrypted gateway config:
//
//   1. PROVIDER signature is verified: a correctly-signed callback is accepted (200, durably
//      inserted); a tampered or missing signature is rejected with 401 and writes nothing.
//   2. GATEWAY-EXEMPT: the webhook route resolves the tenant by URL slug and verifies ONLY the
//      provider signature. A callback carrying a valid provider signature but NO commerce-gateway
//      headers (no X-Commerce-Gateway-Key-Id / -Timestamp / -Nonce / -Signature) still succeeds —
//      provider webhooks never cross the `withVerifiedCommerceGateway` surface.
//
// The route-level `commerceWebhookEndpoints` are a thin wrapper over `handleProviderWebhook`; this
// drives that orchestration directly with NO `buildAdapter` override, so the real Paymob/Kashier
// adapters are constructed from the seeded, encrypted-then-decrypted commerce-settings (proving the
// full secret round-trip through handleSecrets → loadGatewayConfig → buildPaymentAdapter). The Paymob
// HMAC uses the adapter's own exported `computeTransactionHmac`; the Kashier signature is an
// INDEPENDENT oracle of the documented fixed-order HMAC (mirrors the adapter's private `webhookHash`
// and the oracle in commerce-kashier-plugin.test.ts, so a transcription error in either fails this).
//
// The adapter-level accept/reject of a provider signature is already covered by the plugin suites
// (commerce-paymob-plugin / commerce-kashier-plugin) and the route-level tenant/feature/404 paths by
// commerce-webhook-endpoint; the GAP this file closes is the gateway-exempt property asserted through
// the real config round-trip for both providers.
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import { rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import type { Payload } from 'payload'

const TEMP_DB = join(tmpdir(), `commerce-webhook-gateway-exempt-itest-${process.pid}-${Date.now()}.db`)
process.env.DATABASE_URI = `file:${TEMP_DB}`
process.env.PAYLOAD_SECRET = process.env.PAYLOAD_SECRET || 'commerce-webhook-gateway-exempt-itest-secret'

const { default: config } = await import('../src/payload.config')
const { getPayload } = await import('payload')
const { seedTenant } = await import('./helpers/commerce')
const payload = (await getPayload({ config })) as unknown as Payload
await payload.db.migrate()

const { handleProviderWebhook } = await import('../src/commerce/payments/webhook')
const { computeTransactionHmac } = await import('../src/commerce/payments/adapters/paymob')

// Realistic sandbox-style secrets. These are the secret material the adapters verify against; they
// are test fixtures, not live credentials, and only ever live in the test process + the temp DB.
const PAYMOB_HMAC = 'paymob-test-hmac-secret-0123456789abcdef'
const KASHIER_WEBHOOK = 'kashier-test-webhook-secret-01234567'

let tenantSlug: string
let tenantId: number | string

// Independent oracle for Kashier's documented webhook signature: HMAC-SHA256(secret, fixed-order
// "&k=v&k=v..." of the ten documented fields, leading "&" stripped). Mirrors the adapter's private
// `webhookHash` + the oracle in commerce-kashier-plugin.test.ts.
const KASHIER_SIG_FIELDS = [
  'paymentStatus', 'cardDataToken', 'maskedCard', 'merchantOrderId', 'orderId',
  'cardBrand', 'orderReference', 'transactionId', 'amount', 'currency',
] as const
function kashierWebhookHash(secret: string, params: Record<string, unknown>): string {
  const finalUrl = KASHIER_SIG_FIELDS.map((k) => `&${k}=${params[k] ?? ''}`).join('').slice(1)
  return crypto.createHmac('sha256', secret).update(finalUrl).digest('hex')
}

// Assert the headers carry no commerce-gateway material — the gateway-exempt invariant.
function assertNoGatewayHeaders(headers: Record<string, string | undefined>): void {
  assert.ok(
    !Object.keys(headers).some((k) => k.toLowerCase().startsWith('x-commerce-gateway')),
    'webhook request must not carry X-Commerce-Gateway-* headers (gateway-exempt, §4.2)',
  )
}

test.before(async () => {
  ;({ tenantId } = await seedTenant(payload, { features: ['commerce'] }))
  const t = (await payload.findByID({ collection: 'tenants', id: tenantId, overrideAccess: true })) as { slug: string }
  tenantSlug = t.slug
  // One settings doc carrying BOTH providers' real secrets. handleSecrets encrypts
  // paymob.apiKey/hmacSecret + kashier.apiKey/webhookSecret on write; loadGatewayConfig decrypts
  // them before buildPaymentAdapter constructs the real adapter.
  await payload.create({
    collection: 'commerce-settings', overrideAccess: true,
    data: {
      tenant: tenantId, status: 'live', currency: 'EGP', taxMode: 'exclusive', sandbox: true,
      paymob: { enabled: true, apiKey: 'paymob-api-key', hmacSecret: PAYMOB_HMAC, iframeId: '1', integrationId: '2' },
      kashier: { enabled: true, apiKey: 'kashier-api-key', webhookSecret: KASHIER_WEBHOOK, merchantId: 'MID-TEST' },
    } as any,
  })
})
test.after(async () => {
  try { try { await (payload.db as any).drizzle?.session?.client?.close?.() } catch { /* Windows libsql native teardown */ } await payload.destroy() } finally { try { rmSync(TEMP_DB, { force: true }) } catch { /* */ } }
})

// No-write probe: count durable payment-events for this tenant + merchantReference. A rejected
// signature must leave this at 0; an accepted one inserts exactly one row.
async function countEvents(merchantReference: string): Promise<number> {
  const { totalDocs } = await payload.count({
    collection: 'payment-events' as never,
    where: { and: [{ tenant: { equals: tenantId } }, { merchantReference: { equals: merchantReference } }] },
    overrideAccess: true,
  })
  return totalDocs
}

// ── Paymob ────────────────────────────────────────────────────────────────────────────────────

// A canonical Paymob transaction-callback `obj` carrying every HMAC field. `order` doubles as the
// merchantReference (unique per case) so the no-write probe can isolate each event.
function paymobCallbackObj(id: number, order: string): Record<string, unknown> {
  return {
    amount_cents: 5000, created_at: 1700000000, currency: 'EGP', error_occured: false,
    has_parent_transaction: false, id, integration_id: 12345, is_3d_secure: false, is_auth: false,
    is_capture: false, is_refunded: false, is_standalone_receiver: false, is_voided: false,
    order, owner: 'OWNER', pending: false,
    source_data: { pan: '4111', sub_type: 'VISA', type: 'card' }, success: true,
  }
}

test('Paymob webhook · valid provider signature + NO gateway headers → 200 (gateway-exempt)', async () => {
  const order = 'ORD-paymob-exempt-ok'
  const obj = paymobCallbackObj(7001, order)
  const headers = { hmac: computeTransactionHmac(obj, PAYMOB_HMAC) } // ONLY the provider sig header
  assertNoGatewayHeaders(headers)

  const r = await handleProviderWebhook({
    payload, tenantSlug, provider: 'paymob',
    rawBody: Buffer.from(JSON.stringify({ type: 'TRANSACTION', obj }), 'utf8'),
    headers,
    // Deliberately NO buildAdapter override → the real adapter is built from the decrypted config.
  })
  assert.equal(r.status, 200, `expected 200, got ${r.status}: ${JSON.stringify(r.body)}`)
  assert.equal(r.body.inserted, true, 'verified event was durably inserted through the real adapter')
  assert.equal(await countEvents(order), 1, 'exactly one durable payment-event row')
})

test('Paymob webhook · tampered provider signature → 401 + no write', async () => {
  const order = 'ORD-paymob-exempt-tamper'
  const obj = paymobCallbackObj(7002, order)
  const r = await handleProviderWebhook({
    payload, tenantSlug, provider: 'paymob',
    rawBody: Buffer.from(JSON.stringify({ type: 'TRANSACTION', obj }), 'utf8'),
    headers: { hmac: '0'.repeat(128) },
  })
  assert.equal(r.status, 401)
  assert.equal(await countEvents(order), 0, 'tampered signature wrote nothing')
})

test('Paymob webhook · missing provider signature → 401 + no write', async () => {
  const order = 'ORD-paymob-exempt-missing'
  const obj = paymobCallbackObj(7003, order)
  const r = await handleProviderWebhook({
    payload, tenantSlug, provider: 'paymob',
    rawBody: Buffer.from(JSON.stringify({ type: 'TRANSACTION', obj }), 'utf8'),
    headers: {},
  })
  assert.equal(r.status, 401)
  assert.equal(await countEvents(order), 0, 'missing signature wrote nothing')
})

// ── Kashier ───────────────────────────────────────────────────────────────────────────────────

// Kashier posts the signature IN the body (`params.signature`), alongside the ten signed fields.
// `merchantOrderId` is the merchantReference; `transactionId` drives idempotency.
function kashierCallbackParams(merchantOrderId: string, txnId: string): Record<string, unknown> {
  return {
    paymentStatus: 'SUCCESS', cardDataToken: '', maskedCard: '4111', merchantOrderId,
    orderId: 'K-9001', cardBrand: 'VISA', orderReference: 'KREF', transactionId: txnId,
    amount: '50.00', currency: 'EGP',
  }
}

test('Kashier webhook · valid provider signature + NO gateway headers → 200 (gateway-exempt)', async () => {
  const merchantOrderId = 'ORD-kashier-exempt-ok'
  const params = kashierCallbackParams(merchantOrderId, 'kashier-exempt-ok')
  params.signature = kashierWebhookHash(KASHIER_WEBHOOK, params)
  const headers = { 'content-type': 'application/json' } // no X-Commerce-Gateway-*
  assertNoGatewayHeaders(headers)

  const r = await handleProviderWebhook({
    payload, tenantSlug, provider: 'kashier',
    rawBody: Buffer.from(JSON.stringify(params), 'utf8'),
    headers,
    // NO buildAdapter override → the real Kashier adapter is built from the decrypted webhook secret.
  })
  assert.equal(r.status, 200, `expected 200, got ${r.status}: ${JSON.stringify(r.body)}`)
  assert.equal(r.body.inserted, true, 'verified event was durably inserted through the real adapter')
  assert.equal(await countEvents(merchantOrderId), 1, 'exactly one durable payment-event row')
})

test('Kashier webhook · tampered provider signature → 401 + no write', async () => {
  const merchantOrderId = 'ORD-kashier-exempt-tamper'
  const params = kashierCallbackParams(merchantOrderId, 'kashier-exempt-tamper')
  params.signature = '0'.repeat(64)
  const r = await handleProviderWebhook({
    payload, tenantSlug, provider: 'kashier',
    rawBody: Buffer.from(JSON.stringify(params), 'utf8'),
    headers: { 'content-type': 'application/json' },
  })
  assert.equal(r.status, 401)
  assert.equal(await countEvents(merchantOrderId), 0, 'tampered signature wrote nothing')
})

test('Kashier webhook · missing provider signature → 401 + no write', async () => {
  const merchantOrderId = 'ORD-kashier-exempt-missing'
  const params = kashierCallbackParams(merchantOrderId, 'kashier-exempt-missing')
  // no params.signature
  const r = await handleProviderWebhook({
    payload, tenantSlug, provider: 'kashier',
    rawBody: Buffer.from(JSON.stringify(params), 'utf8'),
    headers: { 'content-type': 'application/json' },
  })
  assert.equal(r.status, 401)
  assert.equal(await countEvents(merchantOrderId), 0, 'missing signature wrote nothing')
})
