// Storefront quote endpoint orchestration (plugin-first, Wave F2 rewrite). The HTTP route
// (commerce/store/quote.ts) is a thin wrapper over quoteStoreItems (commerce/store/quote-plugin.ts):
// tenant-by-slug + feature 404, invalid-items 400, and the server-authoritative quote — currency /
// taxMode / prices are resolved server-side from store-products (store-variants for variant SKUs);
// the body carries no price. This exercises quoteStoreItems directly (the authoritative plugin
// validator + engine) over the REAL Payload + migrated DB, mirroring the matrix in
// commerce-store-quote-plugin.test.ts (priced items, unknown sku, no-settings, unpriced doc), and
// also drives the real handler with a fake PayloadRequest to assert the 404/400 HTTP boundaries.
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

const { quoteStoreItems } = await import('../src/commerce/store/quote-plugin')
const { quoteEndpoints } = await import('../src/commerce/store/quote')

let commerceTenantId: number | string
let commerceSlug: string
let noSettingsTenantId: number | string
const BASE_SKU = 'QUOTE-BASE'
const UNPRICED_SKU = 'QUOTE-UNPRICED'

const slugOf = async (id: number | string): Promise<string> =>
  ((await payload.findByID({ collection: 'tenants', id, overrideAccess: true })) as { slug: string }).slug

// Plugin store-product seed (the only catalog the plugin-first quote reads). priceInEGP is integer
// EGP minor units; taxClass 'standard' (no tax policy seeded → 0% tax here, so the DB path's
// merchandise subtotal == grand total, matching the unit suite's arithmetic).
async function seedStoreProduct(
  tid: number | string,
  sku: string,
  priceInEGP: number | null,
): Promise<void> {
  await payload.create({
    collection: 'store-products', overrideAccess: true,
    data: {
      tenant: tid, slug: `slug-${sku.toLowerCase()}`, sku,
      priceInEGPEnabled: priceInEGP !== null, ...(priceInEGP !== null ? { priceInEGP } : {}),
      taxClass: 'standard', trackInventory: true,
    } as any,
  })
}

test.before(async () => {
  const a = await seedTenant(payload, { features: ['commerce'] })
  commerceTenantId = a.tenantId
  commerceSlug = await slugOf(commerceTenantId)
  await payload.create({
    collection: 'commerce-settings', overrideAccess: true,
    data: { tenant: commerceTenantId, status: 'live', currency: 'EGP', taxMode: 'exclusive', sandbox: true } as any,
  })
  // Base product: 100.00 EGP (10000 minor). The request never sends a price.
  await seedStoreProduct(commerceTenantId, BASE_SKU, 10000)
  // An enabled but UNPRICED store-product (no priceInEGP) — mirrors the unit suite's "unpriced doc"
  // case: the items path cannot price it → 422 product_not_found.
  await seedStoreProduct(commerceTenantId, UNPRICED_SKU, null)

  // A second commerce-enabled tenant with NO commerce-settings doc → 503 commerce_not_configured.
  const b = await seedTenant(payload, { features: ['commerce'] })
  noSettingsTenantId = b.tenantId
})
test.after(async () => {
  try { try { await (payload.db as any).drizzle?.session?.client?.close?.() } catch { /* libsql native teardown fix (commit 1630a03) */ } await payload.destroy() } finally { try { rmSync(TEMP_DB, { force: true }) } catch { /* */ } }
})

test('priced store-product is server-priced: qty 2 × 10000 -> grandTotal/amountDue 20000 (no price in the request)', async () => {
  const r = await quoteStoreItems(payload, commerceTenantId, [{ sku: BASE_SKU, quantity: 2 }])
  assert.equal(r.ok, true)
  if (!r.ok) throw new Error('expected ok')
  assert.equal(r.quote.currency, 'EGP')
  assert.equal(r.quote.subtotal, 20000)
  assert.equal(r.quote.grandTotal, 20000)
  assert.equal(r.quote.amountDue, 20000)
  assert.equal(r.quote.totalTax, 0, 'no tax policy seeded → 0 tax')
  assert.ok(typeof r.quote.quoteHash === 'string' && r.quote.quoteHash.length > 0, 'quote is hashed')
})

test('unknown sku -> { ok:false, status:422, code:"product_not_found" }', async () => {
  const r = await quoteStoreItems(payload, commerceTenantId, [{ sku: 'NO-SUCH-SKU', quantity: 1 }])
  assert.equal(r.ok, false)
  if (r.ok) throw new Error('expected not ok')
  assert.equal(r.status, 422)
  assert.equal(r.code, 'product_not_found')
})

test('an enabled but unpriced store-product -> 422 product_not_found', async () => {
  const r = await quoteStoreItems(payload, commerceTenantId, [{ sku: UNPRICED_SKU, quantity: 1 }])
  assert.equal(r.ok, false)
  if (r.ok) throw new Error('expected not ok')
  assert.equal(r.status, 422)
  assert.equal(r.code, 'product_not_found')
})

test('empty items -> { ok:false, status:400, code:"invalid_items" }', async () => {
  const r = await quoteStoreItems(payload, commerceTenantId, [])
  assert.equal(r.ok, false)
  if (r.ok) throw new Error('expected not ok')
  assert.equal(r.status, 400)
  assert.equal(r.code, 'invalid_items')
})

test('a tenant with no commerce-settings doc -> { ok:false, status:503, code:"commerce_not_configured" }', async () => {
  const r = await quoteStoreItems(payload, noSettingsTenantId, [{ sku: BASE_SKU, quantity: 1 }])
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
  assert.equal(body.grandTotal, 20000)
  assert.equal(body.amountDue, 20000)
  assert.ok(typeof body.quoteHash === 'string' && body.quoteHash.length > 0)
})
