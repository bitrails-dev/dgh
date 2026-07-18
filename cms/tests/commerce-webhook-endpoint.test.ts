// Webhook endpoint orchestration. The HTTP route is a thin wrapper over handleProviderWebhook; this
// tests the orchestration directly with a fake adapter injected via the buildAdapter seam: tenant
// resolution by slug, the commerce-feature 404, gateway-not-configured 404, signature 401, and
// idempotent duplicate handling.
import assert from 'node:assert/strict'
import { rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import type { Payload } from 'payload'

const TEMP_DB = join(tmpdir(), `commerce-webhook-itest-${process.pid}-${Date.now()}.db`)
process.env.DATABASE_URI = `file:${TEMP_DB}`
process.env.PAYLOAD_SECRET = process.env.PAYLOAD_SECRET || 'commerce-webhook-itest-secret'

const { default: config } = await import('../src/payload.config')
const { getPayload } = await import('payload')
const { seedTenant } = await import('./helpers/commerce')
const payload = (await getPayload({ config })) as unknown as Payload
await payload.db.migrate()

const { handleProviderWebhook } = await import('../src/commerce/payments/webhook')
import type { PaymentAdapter, NormalizedEvent } from '../src/commerce/payments/types'
import type { AdapterBuilder } from '../src/commerce/payments/adapters/registry'

let commerceSlug: string
let noCommerceSlug: string
let noGatewaySlug: string

// A fake adapter whose verifyWebhook accepts only when headers['x-test'] === 'good', returning a
// configurable (fixed) providerEventId so duplicate deliveries collide on the unique index.
const fakeBuilder = (providerEventId: string): AdapterBuilder => () => ({
  provider: 'paymob',
  capabilities: () => ({ hostedCheckout: true, authorization: true, refunds: true, partialRefunds: true, voiding: true, recurring: false, webhookSignature: 'hmac' }),
  createHostedCheckout: async () => ({ checkoutUrl: '', providerSessionId: '' }),
  refund: async () => ({ ok: true }),
  verifyWebhook: async ({ headers }) =>
    headers['x-test'] === 'good'
      ? { accepted: true, event: { provider: 'paymob', providerEventId, merchantReference: 'ORD-WH', targetState: 'captured' } as NormalizedEvent }
      : { accepted: false, reason: 'bad_sig' },
  lookup: async () => ({ state: 'pending' }),
}) as PaymentAdapter

const slugOf = async (id: number | string): Promise<string> =>
  ((await payload.findByID({ collection: 'tenants', id, overrideAccess: true })) as { slug: string }).slug

test.before(async () => {
  const a = await seedTenant(payload, { features: ['commerce'] })
  commerceSlug = await slugOf(a.tenantId)
  await payload.create({
    collection: 'commerce-settings', overrideAccess: true,
    data: { tenant: a.tenantId, status: 'live', currency: 'EGP', taxMode: 'exclusive', sandbox: true,
      paymob: { enabled: true, apiKey: 'k', hmacSecret: 'h', iframeId: '1', integrationId: '2' } } as any,
  })
  const b = await seedTenant(payload, { features: [] })
  noCommerceSlug = await slugOf(b.tenantId)
  const ng = await seedTenant(payload, { features: ['commerce'] })
  noGatewaySlug = await slugOf(ng.tenantId)
  await payload.create({
    collection: 'commerce-settings', overrideAccess: true,
    data: { tenant: ng.tenantId, status: 'setup', paymob: { enabled: false } } as any,
  })
})
test.after(async () => {
  try { try { await (payload.db as any).drizzle?.session?.client?.close?.() } catch { /* libsql native teardown fix (commit 1630a03) */ } await payload.destroy() } finally { try { rmSync(TEMP_DB, { force: true }) } catch { /* */ } }
})

test('unknown tenant slug -> 404', async () => {
  const r = await handleProviderWebhook({ payload, tenantSlug: 'no-such-tenant', provider: 'paymob', rawBody: Buffer.from('{}'), headers: {}, buildAdapter: fakeBuilder('e1') })
  assert.equal(r.status, 404)
})

test('a tenant without the commerce feature -> 404', async () => {
  const r = await handleProviderWebhook({ payload, tenantSlug: noCommerceSlug, provider: 'paymob', rawBody: Buffer.from('{}'), headers: {}, buildAdapter: fakeBuilder('e2') })
  assert.equal(r.status, 404)
})

test('a tenant whose gateway is not configured -> 404', async () => {
  const r = await handleProviderWebhook({ payload, tenantSlug: noGatewaySlug, provider: 'paymob', rawBody: Buffer.from('{}'), headers: {}, buildAdapter: fakeBuilder('e3') })
  assert.equal(r.status, 404)
})

test('a bad signature -> 401', async () => {
  const r = await handleProviderWebhook({ payload, tenantSlug: commerceSlug, provider: 'paymob', rawBody: Buffer.from('{}'), headers: { 'x-test': 'bad' }, buildAdapter: fakeBuilder('e4') })
  assert.equal(r.status, 401)
})

test('a verified event is inserted and ACKed; a redelivery is an idempotent 200', async () => {
  const ok = await handleProviderWebhook({ payload, tenantSlug: commerceSlug, provider: 'paymob', rawBody: Buffer.from('{}'), headers: { 'x-test': 'good' }, buildAdapter: fakeBuilder('wh-dup') })
  assert.equal(ok.status, 200)
  assert.equal(ok.body.inserted, true)
  const dup = await handleProviderWebhook({ payload, tenantSlug: commerceSlug, provider: 'paymob', rawBody: Buffer.from('{}'), headers: { 'x-test': 'good' }, buildAdapter: fakeBuilder('wh-dup') })
  assert.equal(dup.status, 200)
  assert.equal(dup.body.duplicate, true, 'redelivery is a no-op success')
})
