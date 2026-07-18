// Inventory integration coverage. Runs against an isolated, throwaway SQLite DB migrated from
// scratch (so the versioned migration is validated as SQL), then exercises the inventory domain
// module through the real Payload + libSQL stack. The concurrency test is the crown jewel: 50
// parallel reservations against constrained stock must never oversell.
import assert from 'node:assert/strict'
import { rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import type { Payload } from 'payload'

const TEMP_DB = join(tmpdir(), `commerce-inventory-itest-${process.pid}-${Date.now()}.db`)
process.env.DATABASE_URI = `file:${TEMP_DB}`
process.env.PAYLOAD_SECRET = process.env.PAYLOAD_SECRET || 'commerce-inventory-itest-secret'

const { default: config } = await import('../src/payload.config')
const { getPayload } = await import('payload')
const { seedTenant, seedLocation, seedLevel } = await import('./helpers/commerce')
const payload = (await getPayload({ config })) as unknown as Payload
await payload.db.migrate()

const { reserve, commitReservation, releaseReservation, releaseCart, expireDue, adjustOnHand, getLevel } =
  await import('../src/commerce/inventory')

let tenantId: number | string
let locationId: number | string
let skuCounter = 0
const nextSku = () => `SKU-${Date.now()}-${skuCounter++}`

test.before(async () => {
  ;({ tenantId } = await seedTenant(payload))
  locationId = await seedLocation(payload, tenantId)
})

test.after(async () => {
  try { await payload.destroy() } finally { try { rmSync(TEMP_DB, { force: true }) } catch { /* */ } }
})

async function readLevel(levelId: number | string) {
  const doc = await payload.findByID({ collection: 'inventory-levels', id: levelId, overrideAccess: true })
  return { onHand: Number(doc.onHand), reserved: Number(doc.reserved) }
}

test('50 concurrent reservations against 5 units never oversell', async () => {
  const sku = nextSku()
  const level = await seedLevel(payload, tenantId, locationId, sku, 5)
  const N = 50
  const results = await Promise.all(
    Array.from({ length: N }, (_, i) =>
      reserve({ payload, tenantId, locationId, sku, quantity: 1, cartToken: `cart-${sku}-${i}` })
        .catch((err) => ({ ok: false, code: 'THROWN', message: String(err) }) as const),
    ),
  )
  const winners = results.filter((r) => r.ok).length
  const rejected = results.filter((r) => !r.ok && (r as any).code === 'INSUFFICIENT_STOCK').length
  const thrown = results.filter((r) => !r.ok && (r as any).code === 'THROWN').length

  assert.equal(winners, 5, `expected exactly 5 winners, got ${winners}`)
  assert.equal(rejected, 45, `expected 45 rejections, got ${rejected}`)
  assert.equal(thrown, 0, `no reserve should throw: ${JSON.stringify(results.filter((r) => (r as any).code === 'THROWN'))}`)

  const lvl = await readLevel(level)
  assert.equal(lvl.onHand, 5, 'on-hand unchanged by reservation')
  assert.equal(lvl.reserved, 5, 'all 5 units reserved')
  assert.equal(lvl.onHand - lvl.reserved, 0, 'no availability remains')

  const active = await payload.find({
    collection: 'stock-reservations',
    where: { and: [{ level: { equals: level } }, { status: { equals: 'active' } }] },
    overrideAccess: true, limit: 100,
  })
  assert.equal(active.totalDocs, 5, 'five active reservation rows')
})

test('re-reserving the same cart+level is idempotent and never double-counts', async () => {
  const sku = nextSku()
  const level = await seedLevel(payload, tenantId, locationId, sku, 10)
  const r1 = await reserve({ payload, tenantId, locationId, sku, quantity: 3, cartToken: 'dup-cart' })
  const r2 = await reserve({ payload, tenantId, locationId, sku, quantity: 3, cartToken: 'dup-cart' })
  assert.ok(r1.ok && r2.ok)
  if (r1.ok && r2.ok) assert.equal(r1.reservationId, r2.reservationId, 'same reservation returned')
  const lvl = await readLevel(level)
  assert.equal(lvl.reserved, 3, 'reserved counted once, not twice')
})

test('commit consumes on-hand and is idempotent on repeat', async () => {
  const sku = nextSku()
  const level = await seedLevel(payload, tenantId, locationId, sku, 4)
  const r = await reserve({ payload, tenantId, locationId, sku, quantity: 2, cartToken: `commit-${sku}` })
  if (!r.ok) throw new Error('reserve failed')
  const c1 = await commitReservation({ payload, tenantId, reservationId: r.reservationId, orderRef: 'ORD-1' })
  const c2 = await commitReservation({ payload, tenantId, reservationId: r.reservationId, orderRef: 'ORD-1' })
  assert.ok(c1.ok, 'first commit succeeds')
  assert.ok(c2.ok && (c2 as any).idempotent, 'second commit is a no-op')

  const lvl = await readLevel(level)
  assert.equal(lvl.onHand, 2, 'on-hand dropped by the committed quantity')
  assert.equal(lvl.reserved, 0, 'reservation no longer holds stock')
})

test('release returns reserved stock to availability', async () => {
  const sku = nextSku()
  const level = await seedLevel(payload, tenantId, locationId, sku, 7)
  const r = await reserve({ payload, tenantId, locationId, sku, quantity: 3, cartToken: `rel-${sku}` })
  if (!r.ok) throw new Error('reserve failed')
  assert.equal((await readLevel(level)).reserved, 3)
  await releaseReservation({ payload, tenantId, reservationId: r.reservationId })
  const lvl = await readLevel(level)
  assert.equal(lvl.reserved, 0, 'reserved returned to 0')
  assert.equal(lvl.onHand, 7, 'on-hand unchanged by release')
})

test('releaseCart settles every active hold for a cart', async () => {
  const skuA = nextSku()
  const skuB = nextSku()
  await seedLevel(payload, tenantId, locationId, skuA, 5)
  await seedLevel(payload, tenantId, locationId, skuB, 5)
  const token = `cart-multi-${skuA}`
  await reserve({ payload, tenantId, locationId, sku: skuA, quantity: 2, cartToken: token })
  await reserve({ payload, tenantId, locationId, sku: skuB, quantity: 1, cartToken: token })
  const { released } = await releaseCart({ payload, tenantId, cartToken: token })
  assert.equal(released, 2, 'both lines released')
})

test('expired reservations are swept and release their stock', async () => {
  const sku = nextSku()
  const level = await seedLevel(payload, tenantId, locationId, sku, 6)
  await reserve({ payload, tenantId, locationId, sku, quantity: 2, cartToken: `exp-${sku}`, ttlMs: 1 })
  const future = new Date(Date.now() + 60_000)
  const { expired } = await expireDue({ payload, now: future, tenantId })
  assert.equal(expired, 1)
  const lvl = await readLevel(level)
  assert.equal(lvl.reserved, 0, 'expired hold released')
})

test('adjustOnHand receive/damage moves stock and rejects negative results', async () => {
  const sku = nextSku()
  const level = await seedLevel(payload, tenantId, locationId, sku, 2)
  const recv = await adjustOnHand({ payload, tenantId, levelId: level, delta: 10, type: 'receive' })
  assert.ok(recv.ok && recv.ok && recv.resultingOnHand === 12)
  const over = await adjustOnHand({ payload, tenantId, levelId: level, delta: -100, type: 'damage' })
  assert.ok(!over.ok && (over as any).code === 'INSUFFICIENT_STOCK', 'cannot damage below zero')
  const dmg = await adjustOnHand({ payload, tenantId, levelId: level, delta: -5, type: 'damage' })
  assert.ok(dmg.ok && (dmg as any).resultingOnHand === 7)
  assert.equal((await readLevel(level)).onHand, 7, 'unchanged after the rejected damage')
})

test('the movement ledger reconstructs on-hand exactly', async () => {
  const sku = nextSku()
  const level = await seedLevel(payload, tenantId, locationId, sku, 0)
  await adjustOnHand({ payload, tenantId, levelId: level, delta: 10, type: 'receive' })
  await adjustOnHand({ payload, tenantId, levelId: level, delta: -2, type: 'damage' })
  const r = await reserve({ payload, tenantId, locationId, sku, quantity: 3, cartToken: `ledger-${sku}` })
  if (r.ok) await commitReservation({ payload, tenantId, reservationId: r.reservationId })
  const movements = await payload.find({
    collection: 'stock-movements',
    where: { level: { equals: level } },
    overrideAccess: true, limit: 100,
  })
  // reserve/release affect the reserved counter only; sum on-hand-affecting deltas.
  const onHandAffecting = new Set(['receive', 'damage', 'adjust', 'count', 'commit'])
  const sum = movements.docs
    .filter((m: any) => onHandAffecting.has(m.type))
    .reduce((acc: number, m: any) => acc + Number(m.quantity), 0)
  const lvl = await readLevel(level)
  assert.equal(sum, lvl.onHand, 'ledger deltas sum to the cached on-hand')
})

test('tenant isolation: a reservation in one tenant never touches another', async () => {
  const { tenantId: tenantB } = await seedTenant(payload)
  const locB = await seedLocation(payload, tenantB)
  const sku = nextSku()
  await seedLevel(payload, tenantId, locationId, sku, 1)
  await seedLevel(payload, tenantB, locB, sku, 1)

  const a = await reserve({ payload, tenantId, locationId, sku, quantity: 1, cartToken: `iso-a-${sku}` })
  const b = await reserve({ payload, tenantId: tenantB, locationId: locB, sku, quantity: 1, cartToken: `iso-b-${sku}` })
  assert.ok(a.ok && b.ok, 'each tenant can reserve its own unit')

  const cross = await reserve({ payload, tenantId: tenantB, locationId, sku, quantity: 1, cartToken: `iso-x-${sku}` })
  assert.ok(!cross.ok && (cross as any).code === 'NOT_FOUND', 'tenant B cannot see tenant A location/sku')

  const levelB = await getLevel({ payload, tenantId: tenantB, locationId: locB, sku })
  assert.equal(levelB?.reserved, 1)
  assert.equal(levelB?.available, 0)
})

test('reserve against a missing level returns NOT_FOUND; reserve non-positive quantity throws', async () => {
  const missing = await reserve({ payload, tenantId, locationId, sku: 'does-not-exist', quantity: 1, cartToken: 'nope' })
  assert.ok(!missing.ok && (missing as any).code === 'NOT_FOUND')
  await assert.rejects(() => reserve({ payload, tenantId, locationId, sku: 'x', quantity: 0, cartToken: 'c' }), /positive integer/)
})
