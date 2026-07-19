// Storefront quote endpoint orchestration. The HTTP route (commerce/store/quote.ts) is a thin wrapper
// over quoteItems (commerce/store/shared.ts): tenant-by-slug + feature 404, invalid-items 400, and the
// server-authoritative quote — currency/taxMode/prices are resolved server-side; the body carries no
// price. This exercises quoteItems directly (the authoritative validator + engine) for the core cases
// and also drives the real handler with a fake PayloadRequest to assert the 404/400 HTTP boundaries.
import assert from 'node:assert/strict'
import { rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import type { Payload, PayloadRequest } from 'payload'

const TEMP_DB = join(tmpdir(), `commerce-store-quote-itest-${process.pid}-${Date.now()}.db`)
process.env.DATABASE_URI = `file:${TEMP_DB}`
process.env.PAYLOAD_SECRET = process.env.PAYLOAD_SECRET || 'commerce-store-quote-itest-secret'

const { default: config } = await import('../src/payload.config')
const { getPayload } = await import('payload')
const { seedTenant } = await import('./helpers/commerce')
const payload = (await getPayload({ config })) as unknown as Payload
await payload.db.migrate()

const { quoteItems } = await import('../src/commerce/store/shared')
const { quoteEndpoints } = await import('../src/commerce/store/quote')

let commerceTenantId: number | string
let commerceSlug: string
let noSettingsTenantId: number | string
const BASE_SKU = 'QUOTE-BASE'
const VARIANT_SKU = 'V-RED'

const slugOf = async (id: number | string): Promise<string> =>
  ((await payload.findByID({ collection: 'tenants', id, overrideAccess: true })) as { slug: string }).slug

test.before(async () => {
  const a = await seedTenant(payload, { features: ['commerce'] })
  commerceTenantId = a.tenantId
  commerceSlug = await slugOf(commerceTenantId)
  await payload.create({
    collection: 'commerce-settings', overrideAccess: true,
    data: { tenant: commerceTenantId, status: 'live', currency: 'EGP', taxMode: 'exclusive', sandbox: true } as any,
  })
  // Base-sku product: 100.00 EGP (10000 minor units), tax-exempt (0 bps). The request never sends a price.
  await payload.create({
    collection: 'products', overrideAccess: true,
    data: { tenant: commerceTenantId, name: 'Base Product', sku: BASE_SKU, price: 10000, taxBps: 0, status: 'active' } as any,
  })
  // A product WITH a variant: base 120.00, variant V-RED at 150.00 — the variant sku resolves to 15000.
  await payload.create({
    collection: 'products', overrideAccess: true,
    data: {
      tenant: commerceTenantId, name: 'Shirt', sku: 'SHIRT-BASE', price: 12000, taxBps: 0, status: 'active',
      variants: [{ sku: VARIANT_SKU, name: 'Red', price: 15000, taxBps: 0 }],
    } as any,
  })
  // Plugin-first store-product mirror of BASE_SKU (10000 minor) so the rewired /quote endpoint — which
  // resolves store-products/store-variants via quoteStoreItems — can price the HTTP happy path. The
  // legacy quoteItems direct tests above still read the legacy `products` rows (retained until F2).
  await payload.create({
    collection: 'store-products', overrideAccess: true,
    data: {
      tenant: commerceTenantId, slug: 'slug-quote-base', sku: BASE_SKU,
      priceInEGPEnabled: true, priceInEGP: 10000, taxClass: 'standard', trackInventory: true,
    } as any,
  })
  // A second commerce-enabled tenant with NO commerce-settings doc -> 503 commerce_not_configured.
  const b = await seedTenant(payload, { features: ['commerce'] })
  noSettingsTenantId = b.tenantId
})
test.after(async () => {
  try { try { await (payload.db as any).drizzle?.session?.client?.close?.() } catch { /* libsql native teardown fix (commit 1630a03) */ } await payload.destroy() } finally { try { rmSync(TEMP_DB, { force: true }) } catch { /* */ } }
})

test('base sku is server-priced: qty 2 × 10000 -> grandTotal 20000 (no price in the request)', async () => {
  const r = await quoteItems(payload, commerceTenantId, [{ sku: BASE_SKU, quantity: 2 }])
  assert.equal(r.ok, true)
  if (!r.ok) throw new Error('expected ok')
  assert.equal(r.currency, 'EGP')
  assert.equal(r.taxMode, 'exclusive')
  assert.equal(r.snapshot.merchandiseSubtotal, 20000)
  assert.equal(r.snapshot.totalTax, 0)
  assert.equal(r.snapshot.grandTotal, 20000)
  assert.equal(r.snapshot.amountDue, 20000)
  assert.equal(r.snapshot.lines.length, 1)
  assert.ok(typeof r.snapshot.hash === 'string' && r.snapshot.hash.length > 0, 'snapshot is hashed')
})

test('variant sku resolves to the variant price (15000), not the product base (12000)', async () => {
  const r = await quoteItems(payload, commerceTenantId, [{ sku: VARIANT_SKU, quantity: 1 }])
  assert.equal(r.ok, true)
  if (!r.ok) throw new Error('expected ok')
  assert.equal(r.snapshot.grandTotal, 15000)
  assert.equal(r.snapshot.lines[0].unitPrice.amount, 15000)
})

test('unknown sku -> { ok:false, status:422, code:"product_not_found" }', async () => {
  const r = await quoteItems(payload, commerceTenantId, [{ sku: 'NO-SUCH-SKU', quantity: 1 }])
  assert.equal(r.ok, false)
  if (r.ok) throw new Error('expected not ok')
  assert.equal(r.status, 422)
  assert.equal(r.code, 'product_not_found')
})

test('a tenant with no commerce-settings doc -> { ok:false, status:503, code:"commerce_not_configured" }', async () => {
  const r = await quoteItems(payload, noSettingsTenantId, [{ sku: BASE_SKU, quantity: 1 }])
  assert.equal(r.ok, false)
  if (r.ok) throw new Error('expected not ok')
  assert.equal(r.status, 503)
  assert.equal(r.code, 'commerce_not_configured')
})

// HTTP boundary tests: drive the real handler mounted in quoteEndpoints with a fake PayloadRequest.

const fakeReq = (tenantSlug: string | undefined, bodyText: string): PayloadRequest =>
  ({
    payload,
    routeParams: tenantSlug ? { tenantSlug } : {},
    text: async () => bodyText,
  }) as unknown as PayloadRequest

const handler = quoteEndpoints[0].handler as (req: PayloadRequest) => Promise<Response>

test('handler: unknown tenant slug -> 404 not_found', async () => {
  const res = await handler(fakeReq('no-such-tenant', JSON.stringify({ items: [{ sku: BASE_SKU, quantity: 1 }] })))
  assert.equal(res.status, 404)
  assert.deepEqual(await res.json(), { error: 'not_found' })
})

test('handler: missing items -> 400 invalid_items', async () => {
  const res = await handler(fakeReq(commerceSlug, JSON.stringify({})))
  assert.equal(res.status, 400)
  assert.deepEqual(await res.json(), { error: 'invalid_items' })
})

test('handler: empty body -> 400 invalid_items', async () => {
  const res = await handler(fakeReq(commerceSlug, ''))
  assert.equal(res.status, 400)
  assert.deepEqual(await res.json(), { error: 'invalid_items' })
})

test('handler: a valid quote returns the storefront shape, server-priced from store-products', async () => {
  const res = await handler(fakeReq(commerceSlug, JSON.stringify({ items: [{ sku: BASE_SKU, quantity: 2 }] })))
  assert.equal(res.status, 200)
  const body = await res.json()
  assert.equal(body.currency, 'EGP')
  assert.equal(body.taxMode, 'exclusive')
  assert.equal(body.grandTotal, 20000)
  assert.equal(body.amountDue, 20000)
  assert.ok(typeof body.quoteHash === 'string' && body.quoteHash.length > 0)
})
