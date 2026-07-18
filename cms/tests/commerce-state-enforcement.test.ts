// Centralized transition enforcement: order status / payment state / fulfillment state may only
// advance along the pure state machines. The collection beforeChange hook rejects illegal moves even
// via overrideAccess (system paths are validated too). And the order's paymentState syncs from the
// folded payment state through setOrderPaymentState.
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

const { checkout, setOrderPaymentState } = await import('../src/commerce/checkout')

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

async function placeOrder(orderNumberExpect: string) {
  const sku = `STATE-A-${orderNumberExpect}`
  await seedLevel(payload, tenantId, locationId, sku, 10)
  await payload.create({ collection: 'products', overrideAccess: true, data: { tenant: tenantId, name: sku, sku, price: 1000, taxBps: 0, status: 'active' } as any })
  const r = await checkout({ payload, tenantId, cartToken: `state-${orderNumberExpect}`, locationId, currency: 'EGP', taxMode: 'exclusive', lines: [{ sku, quantity: 1 }], customerEmail: 'x@y.test' })
  if (!r.ok) throw new Error('checkout failed')
  return r.order as { id: number | string; orderNumber: string }
}

test('legal order/fulfillment transitions are allowed; illegal ones are rejected (400)', async () => {
  const order = await placeOrder('1')
  // legal: pending → confirmed
  await payload.update({ collection: 'orders', id: order.id, data: { status: 'confirmed' }, overrideAccess: true })
  // illegal: confirmed → pending (regression)
  await assert.rejects(
    () => payload.update({ collection: 'orders', id: order.id, data: { status: 'pending' }, overrideAccess: true }),
    /Illegal order status transition/,
  )
  // legal: fulfillment unfulfilled → fulfilled
  await payload.update({ collection: 'orders', id: order.id, data: { fulfillmentState: 'fulfilled' }, overrideAccess: true })
  // illegal: fulfilled → unfulfilled
  await assert.rejects(
    () => payload.update({ collection: 'orders', id: order.id, data: { fulfillmentState: 'unfulfilled' }, overrideAccess: true }),
    /Illegal fulfillment transition/,
  )
})

test('setOrderPaymentState advances along the payment machine and rejects regressions', async () => {
  const order = await placeOrder('2')
  assert.equal(((await payload.findByID({ collection: 'orders', id: order.id, overrideAccess: true })) as any).paymentState, 'pending')

  // legal: pending → captured (a successful payment)
  await setOrderPaymentState({ payload, tenantId, orderNumber: order.orderNumber, state: 'captured' })
  assert.equal(((await payload.findByID({ collection: 'orders', id: order.id, overrideAccess: true })) as any).paymentState, 'captured')

  // illegal: captured → pending (regression) — the enforcement hook throws
  await assert.rejects(
    () => setOrderPaymentState({ payload, tenantId, orderNumber: order.orderNumber, state: 'pending' }),
    /Illegal payment state transition/,
  )
  // legal onward: captured → refunded
  await setOrderPaymentState({ payload, tenantId, orderNumber: order.orderNumber, state: 'refunded' })
  assert.equal(((await payload.findByID({ collection: 'orders', id: order.id, overrideAccess: true })) as any).paymentState, 'refunded')
})

test('setOrderPaymentState is a no-op when the state is unchanged', async () => {
  const order = await placeOrder('3')
  const r = await setOrderPaymentState({ payload, tenantId, orderNumber: order.orderNumber, state: 'pending' })
  assert.equal(r.updated, false)
})
