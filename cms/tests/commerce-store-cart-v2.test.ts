// Wave E3 continuation (Lane B) — signed plugin-first storefront cart. Drives the post-gateway
// orchestration (pluginAddItem/pluginUpdateItem/pluginRemoveItem/pluginClearCart/readPluginCart)
// directly with a real Payload + migrated temp DB. The gateway verify these sit behind is covered by
// commerce-gateway.test.ts; the endpoint handlers are thin wrappers. Proves the plugin cart ops
// (addItem/updateItem/removeItem/clearCart) + resolveSellableBySku + the guest-cart secret lifecycle
// + server-authoritative cart totals (Lane A's quoteStoreCart) over store-carts/store-products.
//
// Variant SKUs in a cart use the same resolveSellableBySku + cart-item resolution path exercised here
// for simple products; variant SKU resolution itself is covered by commerce-inventory-adaptation.test.
import assert from 'node:assert/strict'
import { rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import type { Payload } from 'payload'

const TEMP_DB = join(tmpdir(), `commerce-store-cart-v2-itest-${process.pid}-${Date.now()}.db`)
process.env.DATABASE_URI = `file:${TEMP_DB}`
process.env.PAYLOAD_SECRET = process.env.PAYLOAD_SECRET || 'commerce-store-cart-v2-itest-secret'

const { default: config } = await import('../src/payload.config')
const { getPayload } = await import('payload')
const { seedTenant } = await import('./helpers/commerce')
const payload = (await getPayload({ config })) as unknown as Payload
await payload.db.migrate()

const { pluginAddItem, pluginUpdateItem, pluginRemoveItem, pluginClearCart, readPluginCart } =
  await import('../src/commerce/store/cart-v2')

// The orchestration returns a union (CartResponse | error shape); narrow once for the test's sake.
type ViewBody = {
  cartId: string
  items: Array<{ sku: string; quantity: number; product?: { priceInEGP?: number } }>
  quote: { currency: string; subtotal: number; grandTotal: number } | null
  error?: string
}
const view = (r: { status: number; body: unknown }): { status: number; body: ViewBody } =>
  r as { status: number; body: ViewBody }

let tenantId: number | string
let otherTenantId: number | string
const SIMPLE_SKU = 'SKU-CART-1'

async function seedProduct(sku: string, price: number) {
  const p = await payload.create({
    collection: 'store-products', overrideAccess: true,
    data: { tenant: tenantId, slug: `slug-${sku.toLowerCase()}`, sku, priceInEGPEnabled: true, priceInEGP: price, taxClass: 'standard', trackInventory: true } as any,
  })
  return p.id
}

test.before(async () => {
  ;({ tenantId } = await seedTenant(payload, { features: ['commerce'] }))
  await payload.create({
    collection: 'commerce-settings', overrideAccess: true,
    data: { tenant: tenantId, status: 'live', currency: 'EGP', taxMode: 'exclusive', sandbox: true } as any,
  })
  await seedProduct(SIMPLE_SKU, 5000) // 50.00 EGP
  // A second commerce tenant for cross-tenant isolation.
  const b = await seedTenant(payload, { features: ['commerce'] })
  otherTenantId = b.tenantId
})
test.after(async () => {
  try { try { await (payload.db as any).drizzle?.session?.client?.close?.() } catch { /* libsql native teardown */ } await payload.destroy() } finally { try { rmSync(TEMP_DB, { force: true }) } catch { /* */ } }
})

test('readPluginCart with no cart -> empty cart view (200, null quote)', async () => {
  const r = view(await readPluginCart(payload, tenantId, undefined))
  assert.equal(r.status, 200)
  assert.equal(r.body.cartId, '')
  assert.deepEqual(r.body.items, [])
  assert.equal(r.body.quote, null)
})

test('add mints a guest cart, resolves the SKU, and returns server-priced totals', async () => {
  const r = view(await pluginAddItem(payload, tenantId, { sku: SIMPLE_SKU, quantity: 2 }))
  assert.equal(r.status, 200, `got ${r.status}: ${JSON.stringify(r.body)}`)
  assert.ok(r.body.cartId.length > 0, 'a cart id is minted and returned')
  assert.equal(r.body.items.length, 1)
  assert.equal(r.body.items[0].sku, SIMPLE_SKU)
  assert.equal(r.body.items[0].quantity, 2)
  assert.equal(r.body.items[0].product?.priceInEGP, 5000)
  assert.equal(r.body.quote?.currency, 'EGP')
  assert.equal(r.body.quote?.subtotal, 10000, '2 × 5000 minor, server-priced')
  assert.equal(r.body.quote?.grandTotal, 10000)
})

test('adding the same SKU again merges (increments) instead of duplicating', async () => {
  const a = view(await pluginAddItem(payload, tenantId, { sku: SIMPLE_SKU, quantity: 1 }))
  const cartId = a.body.cartId
  const b = view(await pluginAddItem(payload, tenantId, { cartId, sku: SIMPLE_SKU, quantity: 3 }))
  assert.equal(b.body.cartId, cartId, 'same cart reused')
  assert.equal(b.body.items.length, 1)
  assert.equal(b.body.items[0].quantity, 4)
  assert.equal(b.body.quote?.subtotal, 20000, '4 × 5000')
})

test('update changes quantity; qty 0 removes the line', async () => {
  const a = view(await pluginAddItem(payload, tenantId, { sku: SIMPLE_SKU, quantity: 2 }))
  const cartId = a.body.cartId
  const up = view(await pluginUpdateItem(payload, tenantId, { cartId, sku: SIMPLE_SKU, quantity: 5 }))
  assert.equal(up.body.items[0].quantity, 5)
  assert.equal(up.body.quote?.subtotal, 25000)
  const rm = view(await pluginUpdateItem(payload, tenantId, { cartId, sku: SIMPLE_SKU, quantity: 0 }))
  assert.equal(rm.body.items.length, 0, 'qty 0 removes the line')
  assert.equal(rm.body.quote, null, 'empty cart → null quote')
})

test('remove drops the line; removing an absent line is idempotent', async () => {
  const a = view(await pluginAddItem(payload, tenantId, { sku: SIMPLE_SKU, quantity: 1 }))
  const cartId = a.body.cartId
  const r = view(await pluginRemoveItem(payload, tenantId, { cartId, sku: SIMPLE_SKU }))
  assert.equal(r.body.items.length, 0)
  const again = view(await pluginRemoveItem(payload, tenantId, { cartId, sku: SIMPLE_SKU }))
  assert.equal(again.status, 200)
  assert.equal(again.body.items.length, 0)
})

test('clear empties the cart but keeps the cart id', async () => {
  const a = view(await pluginAddItem(payload, tenantId, { sku: SIMPLE_SKU, quantity: 2 }))
  const cartId = a.body.cartId
  const r = view(await pluginClearCart(payload, tenantId, cartId))
  assert.equal(r.body.cartId, cartId)
  assert.equal(r.body.items.length, 0)
})

test('unknown SKU -> 422 product_not_found', async () => {
  const r = view(await pluginAddItem(payload, tenantId, { sku: 'NOPE', quantity: 1 }))
  assert.equal(r.status, 422)
  assert.equal(r.body.error, 'product_not_found')
})

test('invalid quantity -> 400 invalid_item', async () => {
  const r = view(await pluginAddItem(payload, tenantId, { sku: SIMPLE_SKU, quantity: 0 }))
  assert.equal(r.status, 400)
  assert.equal(r.body.error, 'invalid_item')
})

test('cross-tenant: a cart id from tenant A is invisible to tenant B (empty view)', async () => {
  const a = view(await pluginAddItem(payload, tenantId, { sku: SIMPLE_SKU, quantity: 1 }))
  const r = view(await readPluginCart(payload, otherTenantId, a.body.cartId))
  assert.equal(r.body.cartId, '', 'foreign cart is not found → empty view')
  assert.deepEqual(r.body.items, [])
})
