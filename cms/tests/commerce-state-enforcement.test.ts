// Payment-state sync, plugin-first (Wave F2 rewrite). Exercises the repointed setOrderPaymentState
// (commerce/checkout) — which now finds the order in store-orders and syncs its paymentState from
// the folded payment-event state — over a store-order placed by processCheckout. Verifies it
// advances the stored paymentState, is a no-op when the state is unchanged, and writes store-orders
// (never a legacy collection).
//
// NOTE (Wave F2): the retired legacy suite also asserted that illegal order-status / fulfillment /
// payment-state transitions were REJECTED by a beforeChange hook. That enforcement hook lives ONLY
// on the legacy `orders` collection (cms/src/collections/commerce/Orders.ts); the plugin store-orders
// override (cms/src/commerce/plugin/overrides/store-orders.ts) has no such hook — store-orders
// paymentState is a permissive denormalized field whose authoritative state machine is the
// payment-events ledger fold. Those rejection assertions are therefore legacy-only and are not
// reproduced here; restoring them on store-orders would require adding a beforeChange hook to the
// plugin override (an integration-owner decision, outside this lane).
import assert from 'node:assert/strict'
import { rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import type { Payload } from 'payload'

const TEMP_DB = join(tmpdir(), `commerce-state-itest-${process.pid}-${Date.now()}.db`)
process.env.DATABASE_URI = `file:${TEMP_DB}`
process.env.PAYLOAD_SECRET = process.env.PAYLOAD_SECRET || 'commerce-state-itest-secret'

const { default: config } = await import('../src/payload.config')
const { getPayload } = await import('payload')
const { seedTenant, seedLocation, seedLevel } = await import('./helpers/commerce')
const payload = (await getPayload({ config })) as unknown as Payload
await payload.db.migrate()

const { setOrderPaymentState } = await import('../src/commerce/checkout')
const { processCheckout } = await import('../src/commerce/checkout/process')

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

// Place a store-order via the plugin checkout so setOrderPaymentState has a real store-orders row to
// sync. Each call uses a unique SKU so reservations never collide across subtests.
async function placeStoreOrder(tag: string): Promise<string> {
  const sku = `STATE-A-${tag}`
  await seedLevel(payload, tenantId, locationId, sku, 10)
  const p = await payload.create({
    collection: 'store-products', overrideAccess: true,
    data: { tenant: tenantId, slug: `slug-${sku.toLowerCase()}`, sku, priceInEGPEnabled: true, priceInEGP: 1000, taxClass: 'standard', trackInventory: true } as any,
  })
  const cart = await payload.create({
    collection: 'store-carts', overrideAccess: true,
    data: { tenant: tenantId, currency: 'EGP', items: [{ product: p.id, quantity: 1 }] } as any,
  })
  const r = await processCheckout(payload, { tenantId }, { cartId: cart.id, paymentMethod: 'cod', shippingAddress: { country: 'EG' }, customerEmail: 'state@dgh.test' })
  if (r.status !== 200) throw new Error(`processCheckout failed: ${JSON.stringify(r.body)}`)
  return r.body.orderNumber as string
}

async function countLegacy(slug: string): Promise<number> {
  const { totalDocs } = await payload.count({ collection: slug as never, where: { tenant: { equals: tenantId } }, overrideAccess: true })
  return totalDocs
}

test('setOrderPaymentState advances the store-order paymentState along the payment machine', async () => {
  const orderNumber = await placeStoreOrder('1')
  const beforeOrders = await countLegacy('orders')

  // A store-order starts pending (processCheckout).
  const order0 = (await payload.find({ collection: 'store-orders', where: { and: [{ tenant: { equals: tenantId } }, { orderNumber: { equals: orderNumber } }] }, overrideAccess: true, limit: 1 })).docs[0] as { paymentState?: string }
  assert.equal(order0.paymentState, 'pending')

  // legal onward: pending → captured (a successful payment).
  const r1 = await setOrderPaymentState({ payload, tenantId, orderNumber, state: 'captured' })
  assert.equal(r1.updated, true)
  const order1 = (await payload.find({ collection: 'store-orders', where: { and: [{ tenant: { equals: tenantId } }, { orderNumber: { equals: orderNumber } }] }, overrideAccess: true, limit: 1 })).docs[0] as { paymentState?: string }
  assert.equal(order1.paymentState, 'captured')

  // legal onward: captured → refunded.
  const r2 = await setOrderPaymentState({ payload, tenantId, orderNumber, state: 'refunded' })
  assert.equal(r2.updated, true)
  const order2 = (await payload.find({ collection: 'store-orders', where: { and: [{ tenant: { equals: tenantId } }, { orderNumber: { equals: orderNumber } }] }, overrideAccess: true, limit: 1 })).docs[0] as { paymentState?: string }
  assert.equal(order2.paymentState, 'refunded')

  // Every sync wrote store-orders; no legacy order was ever touched.
  assert.equal(await countLegacy('orders'), beforeOrders, 'no legacy order written by setOrderPaymentState')
})

test('setOrderPaymentState is a no-op when the state is unchanged', async () => {
  const orderNumber = await placeStoreOrder('2')
  // The store-order is already pending; syncing 'pending' again changes nothing.
  const r = await setOrderPaymentState({ payload, tenantId, orderNumber, state: 'pending' })
  assert.equal(r.updated, false)
})
