// The closed inventory loop: checkout reserves stock → a captured payment event folds to
// 'captured' → the job's commit side-effect consumes the order's reservation. Verifies on-hand drops
// and reserved returns to 0, the fold result carries the order ref the job needs, and the commit is
// idempotent (a second capture/re-run commits nothing).
import assert from 'node:assert/strict'
import { rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import type { Payload } from 'payload'

const TEMP_DB = join(tmpdir(), `commerce-capture-itest-${process.pid}-${Date.now()}.db`)
process.env.DATABASE_URI = `file:${TEMP_DB}`
process.env.PAYLOAD_SECRET = process.env.PAYLOAD_SECRET || 'commerce-capture-itest-secret'

const { default: config } = await import('../src/payload.config')
const { getPayload } = await import('payload')
const { seedTenant, seedLocation, seedLevel } = await import('./helpers/commerce')
const payload = (await getPayload({ config })) as unknown as Payload
await payload.db.migrate()

const { checkout, commitOrderInventory } = await import('../src/commerce/checkout')
const { insertPaymentEvent, processPaymentEvent } = await import('../src/commerce/payments/events')
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

test('checkout reserves; a captured payment event folds to "captured" and commits the reservation', async () => {
  await seedLevel(payload, tenantId, locationId, 'CAP-A', 5) // 5 on hand
  await payload.create({ collection: 'products', overrideAccess: true, data: { tenant: tenantId, name: 'A', sku: 'CAP-A', price: 1000, taxBps: 0, status: 'active' } as any })

  const result = await checkout({ payload, tenantId, cartToken: 'cap-cart', locationId, currency: 'EGP', taxMode: 'exclusive', lines: [{ sku: 'CAP-A', quantity: 2 }], customerEmail: 'x@y.test' })
  if (!result.ok) throw new Error('checkout failed')
  const orderNumber = (result.order as any).orderNumber
  assert.equal((await getLevel({ payload, tenantId, locationId, sku: 'CAP-A' }))?.reserved, 2, 'reserved at checkout')

  // The webhook writes a captured event for this order; the job folds it.
  const ev = await insertPaymentEvent({ payload, tenantId, gateway: 'paymob', providerEventId: 'cap-evt-1', merchantReference: orderNumber, targetState: 'captured' })
  const fold = await processPaymentEvent(payload, (ev as any).id)
  assert.equal(fold.foldedState, 'captured')
  assert.equal(fold.changed, true)
  assert.equal(fold.merchantReference, orderNumber, 'fold carries the order ref the job needs')
  assert.equal(fold.tenantId, tenantId)

  // The job's commit side-effect (mirrored here): consume the order's reservation.
  const committed = await commitOrderInventory({ payload, tenantId, orderNumber })
  assert.equal(committed.found, true)
  assert.equal(committed.committed, 1, 'one reservation consumed')

  const lvl = await getLevel({ payload, tenantId, locationId, sku: 'CAP-A' })
  assert.equal(lvl?.onHand, 3, 'on-hand dropped by the committed quantity')
  assert.equal(lvl?.reserved, 0, 'reservation fulfilled')
})

test('commit is idempotent: a second capture re-run commits nothing', async () => {
  await seedLevel(payload, tenantId, locationId, 'CAP-B', 4)
  await payload.create({ collection: 'products', overrideAccess: true, data: { tenant: tenantId, name: 'B', sku: 'CAP-B', price: 500, taxBps: 0, status: 'active' } as any })
  const result = await checkout({ payload, tenantId, cartToken: 'cap-cart-2', locationId, currency: 'EGP', taxMode: 'exclusive', lines: [{ sku: 'CAP-B', quantity: 3 }], customerEmail: 'x@y.test' })
  if (!result.ok) throw new Error('checkout failed')
  const orderNumber = (result.order as any).orderNumber

  const first = await commitOrderInventory({ payload, tenantId, orderNumber })
  assert.equal(first.committed, 1)
  const second = await commitOrderInventory({ payload, tenantId, orderNumber })
  assert.equal(second.committed, 0, 'already committed — no double-consume')
  assert.equal((await getLevel({ payload, tenantId, locationId, sku: 'CAP-B' }))?.onHand, 1, 'dropped exactly once (4 - 3)')
})
