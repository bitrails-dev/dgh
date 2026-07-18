// Checkout orchestration end-to-end: cart → server-resolved prices → inventory reservation →
// quote → order. Verifies order totals match the server quote, stock is reserved, and the failure
// paths (unknown product, insufficient stock with full reservation release) behave correctly.
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

const { checkout } = await import('../src/commerce/checkout')
const { getLevel } = await import('../src/commerce/inventory')

let tenantId: number | string
let locationId: number | string

test.before(async () => {
  ;({ tenantId } = await seedTenant(payload))
  await payload.create({ collection: 'commerce-settings', overrideAccess: true, data: { tenant: tenantId, status: 'live', currency: 'EGP', taxMode: 'exclusive', sandbox: false } as any })
  locationId = await seedLocation(payload, tenantId)
})
test.after(async () => {
  try { await payload.destroy() } finally { try { rmSync(TEMP_DB, { force: true }) } catch { /* */ } }
})

async function seedProduct(sku: string, price: number, taxBps = 0) {
  return payload.create({ collection: 'products', overrideAccess: true, data: { tenant: tenantId, name: sku, sku, price, taxBps, status: 'active', productKind: 'physical', trackInventory: true } as any })
}

test('checkout places an order with server-resolved totals and reserves stock', async () => {
  const level = await seedLevel(payload, tenantId, locationId, 'CHECKOUT-A', 5) // 5 on hand
  await seedProduct('CHECKOUT-A', 1050, 1400) // 10.50, 14%

  const result = await checkout({
    payload, tenantId, cartToken: 'cart-ok', locationId, currency: 'EGP', taxMode: 'exclusive',
    lines: [{ sku: 'CHECKOUT-A', quantity: 2 }], customerEmail: 'shopper@test',
  })
  assert.equal(result.ok, true)
  if (!result.ok) throw new Error('expected ok')
  const order: any = result.order
  assert.equal(order.orderNumber, 'ORD-1')
  assert.equal(order.cartToken, 'cart-ok')
  // 2 × 10.50 = 21.00; 14% tax = 2.94; grand total 23.94 (computed server-side; client never priced).
  assert.equal(order.grandTotal, 2394)
  assert.equal(order.totalTax, 294)
  assert.equal(order.amountDue, 2394)
  assert.equal(order.status, 'pending')

  const lvl = await getLevel({ payload, tenantId, locationId, sku: 'CHECKOUT-A' })
  assert.equal(lvl?.reserved, 2, '2 units reserved until payment capture')
  assert.equal(lvl?.onHand, 5, 'on-hand unchanged by reservation')
})

test('checkout rejects an unknown product before reserving anything', async () => {
  await seedLevel(payload, tenantId, locationId, 'CHECKOUT-B', 5)
  const result = await checkout({
    payload, tenantId, cartToken: 'cart-missing', locationId, currency: 'EGP', taxMode: 'exclusive',
    lines: [{ sku: 'DOES-NOT-EXIST', quantity: 1 }],
  })
  assert.equal(result.ok, false)
  if (result.ok) throw new Error('expected failure')
  assert.equal(result.code, 'PRODUCT_NOT_FOUND')
})

test('checkout with insufficient stock releases the whole reservation and creates no order', async () => {
  await seedLevel(payload, tenantId, locationId, 'CHECKOUT-C', 1) // only 1 on hand
  await seedProduct('CHECKOUT-C', 1000, 0)

  const result = await checkout({
    payload, tenantId, cartToken: 'cart-short', locationId, currency: 'EGP', taxMode: 'exclusive',
    lines: [{ sku: 'CHECKOUT-C', quantity: 2 }], // wants 2
  })
  assert.equal(result.ok, false)
  if (result.ok) throw new Error('expected failure')
  assert.equal(result.code, 'INSUFFICIENT_STOCK')

  const lvl = await getLevel({ payload, tenantId, locationId, sku: 'CHECKOUT-C' })
  assert.equal(lvl?.reserved, 0, 'no partial reservation leaked')
  assert.equal(lvl?.onHand, 1)
})
