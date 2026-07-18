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
  try { try { await (payload.db as any).drizzle?.session?.client?.close?.() } catch { /* libsql native teardown fix (commit 1630a03) */ } await payload.destroy() } finally { try { rmSync(TEMP_DB, { force: true }) } catch { /* */ } }
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

// === Commit 1.1 — exploit tests for C-01 / C-02. These MUST fail on the baseline; Commit 1.3 fixes
// them by making reservations order-scoped and normalizing duplicate/changed-quantity lines.
// (Case 4 — commit idempotency — is already covered by the test above.)

test('C-01: paying one order does not commit another order\'s reservations sharing the cart token', async () => {
  await seedLevel(payload, tenantId, locationId, 'C01-CHEAP', 10)
  await seedLevel(payload, tenantId, locationId, 'C01-EXP', 10)
  await payload.create({ collection: 'products', overrideAccess: true, data: { tenant: tenantId, name: 'Cheap', sku: 'C01-CHEAP', price: 100, taxBps: 0, status: 'active' } as any })
  await payload.create({ collection: 'products', overrideAccess: true, data: { tenant: tenantId, name: 'Expensive', sku: 'C01-EXP', price: 9999, taxBps: 0, status: 'active' } as any })

  const CART = 'c01-shared-cart'
  // Order 1 = cheap + expensive; Order 2 = cheap only; both on the same cart token.
  const r1 = await checkout({ payload, tenantId, cartToken: CART, locationId, currency: 'EGP', taxMode: 'exclusive', lines: [{ sku: 'C01-CHEAP', quantity: 1 }, { sku: 'C01-EXP', quantity: 1 }], customerEmail: 'a@y.test' })
  if (!r1.ok) throw new Error('order 1 checkout failed')
  const order1 = (r1.order as any).orderNumber
  const r2 = await checkout({ payload, tenantId, cartToken: CART, locationId, currency: 'EGP', taxMode: 'exclusive', lines: [{ sku: 'C01-CHEAP', quantity: 1 }], customerEmail: 'b@y.test' })
  if (!r2.ok) throw new Error('order 2 checkout failed')
  const order2 = (r2.order as any).orderNumber

  // Pay Order 2 only.
  await commitOrderInventory({ payload, tenantId, orderNumber: order2 })

  // C-01 invariant: EXPENSIVE belongs to Order 1. Paying Order 2 must not commit or release it.
  const exp = await getLevel({ payload, tenantId, locationId, sku: 'C01-EXP' })
  assert.equal(exp?.onHand, 10, 'expensive on-hand untouched by order 2 payment')
  assert.equal(exp?.reserved, 1, 'order 1 expensive reservation still active after order 2 paid')
})

test('C-02: duplicate SKU lines reserve their summed quantity', async () => {
  await seedLevel(payload, tenantId, locationId, 'C02-DUP', 10)
  await payload.create({ collection: 'products', overrideAccess: true, data: { tenant: tenantId, name: 'Dup', sku: 'C02-DUP', price: 100, taxBps: 0, status: 'active' } as any })

  const r = await checkout({ payload, tenantId, cartToken: 'c02-cart', locationId, currency: 'EGP', taxMode: 'exclusive', lines: [{ sku: 'C02-DUP', quantity: 2 }, { sku: 'C02-DUP', quantity: 3 }], customerEmail: 'd@y.test' })
  if (!r.ok) throw new Error('checkout failed')

  const lvl = await getLevel({ payload, tenantId, locationId, sku: 'C02-DUP' })
  assert.equal(lvl?.reserved, 5, 'duplicate lines are normalized and reserve the summed quantity (2 + 3)')
})

test('C-02: a later checkout reusing a cart token with a different quantity reserves distinctly', async () => {
  await seedLevel(payload, tenantId, locationId, 'C03-REUSE', 10)
  await payload.create({ collection: 'products', overrideAccess: true, data: { tenant: tenantId, name: 'Reuse', sku: 'C03-REUSE', price: 100, taxBps: 0, status: 'active' } as any })

  const CART = 'c03-shared-cart'
  const r1 = await checkout({ payload, tenantId, cartToken: CART, locationId, currency: 'EGP', taxMode: 'exclusive', lines: [{ sku: 'C03-REUSE', quantity: 1 }], customerEmail: 'e@y.test' })
  if (!r1.ok) throw new Error('order A checkout failed')
  const r2 = await checkout({ payload, tenantId, cartToken: CART, locationId, currency: 'EGP', taxMode: 'exclusive', lines: [{ sku: 'C03-REUSE', quantity: 4 }], customerEmail: 'f@y.test' })
  if (!r2.ok) throw new Error('order B checkout failed')

  // Both orders must hold their own stock: 1 + 4 = 5. Baseline reuses the first hold (reserved stays 1).
  const lvl = await getLevel({ payload, tenantId, locationId, sku: 'C03-REUSE' })
  assert.equal(lvl?.reserved, 5, "order B reserved its own 4 on top of order A's 1")
})

test('C-01: releasing one order cannot release another order\'s reservation', async () => {
  await seedLevel(payload, tenantId, locationId, 'C05-REL', 10)
  await payload.create({ collection: 'products', overrideAccess: true, data: { tenant: tenantId, name: 'Rel', sku: 'C05-REL', price: 100, taxBps: 0, status: 'active' } as any })

  const CART = 'c05-shared-cart'
  const r1 = await checkout({ payload, tenantId, cartToken: CART, locationId, currency: 'EGP', taxMode: 'exclusive', lines: [{ sku: 'C05-REL', quantity: 2 }], customerEmail: 'h@y.test' })
  if (!r1.ok) throw new Error('order 1 checkout failed')
  const order1 = (r1.order as any).orderNumber
  const r2 = await checkout({ payload, tenantId, cartToken: CART, locationId, currency: 'EGP', taxMode: 'exclusive', lines: [{ sku: 'C05-REL', quantity: 3 }], customerEmail: 'i@y.test' })
  if (!r2.ok) throw new Error('order 2 checkout failed')

  // releaseOrder arrives in Commit 1.3. Dynamic-import + guard so this file still loads on the
  // baseline; the test fails here because releaseOrder is not implemented yet (expected at 1.1).
  const mod = (await import('../src/commerce/inventory')) as { releaseOrder?: (i: any) => Promise<unknown> }
  if (typeof mod.releaseOrder !== 'function') throw new Error('releaseOrder not implemented yet (arrives in commit 1.3)')
  await mod.releaseOrder({ payload, tenantId, orderNumber: order1 })

  // Releasing Order 1 must leave Order 2's reservation of 3 intact.
  const lvl = await getLevel({ payload, tenantId, locationId, sku: 'C05-REL' })
  assert.ok(lvl && lvl.reserved >= 3, `order 2 reservation of 3 survives releasing order 1 (reserved=${lvl?.reserved})`)
})
