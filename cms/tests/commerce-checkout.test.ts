// Plugin-first checkout orchestration end-to-end (Wave F2 rewrite): a verified gateway context +
// plugin `store-carts` cart → processCheckout → store-orders + Phase-1 reservation. Verifies the
// server-resolved amountDue matches the authoritative quote, stock is reserved by normalized SKU, the
// order is written to store-orders (never a legacy collection), and the failure paths (insufficient
// stock with full reservation release; an unresolvable cart line rejected before any reservation)
// behave correctly. Replaces the legacy checkout()-based suite (cart → products → orders).
import assert from 'node:assert/strict'
import { rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import type { Payload } from 'payload'

const TEMP_DB = join(tmpdir(), `commerce-checkout-itest-${process.pid}-${Date.now()}.db`)
process.env.DATABASE_URI = `file:${TEMP_DB}`
process.env.PAYLOAD_SECRET = process.env.PAYLOAD_SECRET || 'commerce-checkout-itest-secret'

const { default: config } = await import('../src/payload.config')
const { getPayload } = await import('payload')
const { seedTenant, seedLocation, seedLevel } = await import('./helpers/commerce')
const payload = (await getPayload({ config })) as unknown as Payload
await payload.db.migrate()

const { processCheckout } = await import('../src/commerce/checkout/process')
const { getLevel } = await import('../src/commerce/inventory')

let tenantId: number | string
let locationId: number | string

test.before(async () => {
  ;({ tenantId } = await seedTenant(payload, { features: ['commerce'] }))
  await payload.create({ collection: 'commerce-settings', overrideAccess: true, data: { tenant: tenantId, status: 'live', currency: 'EGP', taxMode: 'exclusive', sandbox: false } as any })
  locationId = await seedLocation(payload, tenantId)
})
test.after(async () => {
  try { try { await (payload.db as any).drizzle?.session?.client?.close?.() } catch { /* libsql native teardown fix (commit 1630a03) */ } await payload.destroy() } finally { try { rmSync(TEMP_DB, { force: true }) } catch { /* */ } }
})

// Plugin store-product seed (the only catalog processCheckout prices from). priceInEGP is integer
// EGP minor units; 'standard' tax class with no tax policy seeded → 0% tax.
async function seedStoreProduct(sku: string, priceInEGP: number): Promise<number | string> {
  const p = await payload.create({
    collection: 'store-products', overrideAccess: true,
    data: { tenant: tenantId, slug: `slug-${sku.toLowerCase()}`, sku, priceInEGPEnabled: true, priceInEGP, taxClass: 'standard', trackInventory: true } as any,
  })
  return p.id
}

// Plugin store-carts cart with one line. processCheckout re-reads it (tenant-scoped) inside the
// quoteCart loader.
async function seedCart(productId: number | string, quantity: number): Promise<number | string> {
  const c = await payload.create({
    collection: 'store-carts', overrideAccess: true,
    data: { tenant: tenantId, currency: 'EGP', items: [{ product: productId, quantity }] } as any,
  })
  return c.id
}

// Count legacy commerce docs for the tenant — the no-legacy probe.
async function countLegacy(slug: string): Promise<number> {
  const { totalDocs } = await payload.count({ collection: slug as never, where: { tenant: { equals: tenantId } }, overrideAccess: true })
  return totalDocs
}

test('processCheckout places a store-order with the server-resolved amountDue and reserves stock', async () => {
  await seedLevel(payload, tenantId, locationId, 'CHECKOUT-A', 5) // 5 on hand
  const pid = await seedStoreProduct('CHECKOUT-A', 5000) // 50.00 EGP, no tax
  const cartId = await seedCart(pid, 2)

  const beforeOrders = await countLegacy('orders')
  const beforeTxns = await countLegacy('transactions')

  const result = await processCheckout(payload, { tenantId }, {
    cartId, paymentMethod: 'cod', shippingAddress: { country: 'EG' }, customerEmail: 'shopper@dgh.test',
  })
  assert.equal(result.status, 200, `processCheckout: ${JSON.stringify(result.body)}`)
  // 2 × 5000 = 10000 minor, resolved server-side (no tax policy → 0 tax); the browser never priced.
  assert.equal(result.body.amountDue, 10000)
  assert.equal(result.body.currency, 'EGP')
  assert.equal(result.body.paymentMethod, 'cod')
  assert.equal(result.body.paymentState, 'pending')
  assert.ok(typeof result.body.orderNumber === 'string' && result.body.orderNumber.length > 0)

  const lvl = await getLevel({ payload, tenantId, locationId, sku: 'CHECKOUT-A' })
  assert.equal(lvl?.reserved, 2, '2 units reserved until capture / admin confirm')
  assert.equal(lvl?.onHand, 5, 'on-hand unchanged by reservation')

  // The store-order exists; no legacy order/transaction was written.
  const { totalDocs: storeOrders } = await payload.count({ collection: 'store-orders', where: { and: [{ tenant: { equals: tenantId } }, { orderNumber: { equals: result.body.orderNumber } }] }, overrideAccess: true })
  assert.equal(storeOrders, 1, 'store-order persisted')
  assert.equal(await countLegacy('orders'), beforeOrders, 'no legacy order written')
  assert.equal(await countLegacy('transactions'), beforeTxns, 'no legacy transaction written')
})

test('processCheckout with insufficient stock releases the whole reservation and creates no order', async () => {
  await seedLevel(payload, tenantId, locationId, 'CHECKOUT-C', 1) // only 1 on hand
  const pid = await seedStoreProduct('CHECKOUT-C', 1000)
  const cartId = await seedCart(pid, 2) // wants 2

  const storeOrdersBefore = (await payload.count({ collection: 'store-orders', where: { tenant: { equals: tenantId } }, overrideAccess: true })).totalDocs
  const result = await processCheckout(payload, { tenantId }, {
    cartId, paymentMethod: 'cod', shippingAddress: { country: 'EG' }, customerEmail: 'short@dgh.test',
  })
  assert.equal(result.status, 409, `shortage: ${JSON.stringify(result.body)}`)
  assert.equal(result.body.error, 'INSUFFICIENT_STOCK')

  const storeOrdersAfter = (await payload.count({ collection: 'store-orders', where: { tenant: { equals: tenantId } }, overrideAccess: true })).totalDocs
  assert.equal(storeOrdersAfter, storeOrdersBefore, 'no store-order created on shortage')

  const lvl = await getLevel({ payload, tenantId, locationId, sku: 'CHECKOUT-C' })
  assert.equal(lvl?.reserved, 0, 'no partial reservation leaked')
  assert.equal(lvl?.onHand, 1)
})

test('processCheckout rejects an unknown cart before reserving anything', async () => {
  // A cartId that does not exist — quoteCart's loader returns no lines, so processCheckout rejects
  // (422) at the quote step, before the reservation step runs. (The plugin's carts beforeChange hook
  // validates product relationships at cart-create time, so an unknown product cannot even be seeded
  // into a cart; an unknown cartId is the faithful plugin equivalent of "reject before reserving".)
  const storeOrdersBefore = (await payload.count({ collection: 'store-orders', where: { tenant: { equals: tenantId } }, overrideAccess: true })).totalDocs
  const result = await processCheckout(payload, { tenantId }, {
    cartId: 999999, paymentMethod: 'cod', shippingAddress: { country: 'EG' }, customerEmail: 'missing@dgh.test',
  })
  assert.ok(result.status >= 400, `expected a non-200 rejection, got ${result.status}: ${JSON.stringify(result.body)}`)
  const storeOrdersAfter = (await payload.count({ collection: 'store-orders', where: { tenant: { equals: tenantId } }, overrideAccess: true })).totalDocs
  assert.equal(storeOrdersAfter, storeOrdersBefore, 'no store-order created from an unknown cart')
})
