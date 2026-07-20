// Order numbering (retained + live): per-tenant, atomically-allocated order numbers with
// concurrent no-duplicate allocation and the not-initialized guard. processCheckout allocates the
// order number via allocateOrderNumber before reserving stock, so numbering stays; the legacy
// createOrder helper (and its snapshot/tamper tests) was retired in Wave F2 because processCheckout
// creates the store-orders document inline with the immutable quote snapshot.
import assert from 'node:assert/strict'
import { rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import type { Payload } from 'payload'

const TEMP_DB = join(tmpdir(), `commerce-orders-itest-${process.pid}-${Date.now()}.db`)
process.env.DATABASE_URI = `file:${TEMP_DB}`
process.env.PAYLOAD_SECRET = process.env.PAYLOAD_SECRET || 'commerce-orders-itest-secret'

const { default: config } = await import('../src/payload.config')
const { getPayload } = await import('payload')
const { seedTenant } = await import('./helpers/commerce')
const payload = (await getPayload({ config })) as unknown as Payload
await payload.db.migrate()

const { allocateOrderNumber } = await import('../src/commerce/orders/numbering')

let tenantId: number | string
let tenantBId: number | string

test.before(async () => {
  ;({ tenantId } = await seedTenant(payload))
  ;({ tenantId: tenantBId } = await seedTenant(payload))
  await payload.create({
    collection: 'commerce-settings', overrideAccess: true,
    data: { tenant: tenantId, status: 'live', currency: 'EGP', taxMode: 'exclusive', sandbox: false, orderNumberPrefix: 'ORD-' } as any,
  })
  await payload.create({
    collection: 'commerce-settings', overrideAccess: true,
    data: { tenant: tenantBId, status: 'live', currency: 'EGP', taxMode: 'exclusive', sandbox: false, orderNumberPrefix: 'B-' } as any,
  })
})
test.after(async () => {
  try { try { await (payload.db as any).drizzle?.session?.client?.close?.() } catch { /* libsql native teardown fix (commit 1630a03) */ } await payload.destroy() } finally { try { rmSync(TEMP_DB, { force: true }) } catch { /* */ } }
})

test('20 concurrent allocations produce 20 distinct order numbers (no duplicates)', async () => {
  // Numbering atomicity: concurrent allocateOrderNumber calls never produce a duplicate (it retries
  // on SQLITE_BUSY; Payload's createOperation does not retry BEGIN).
  const numbers = await Promise.all(Array.from({ length: 20 }, () => allocateOrderNumber(payload, tenantId)))
  assert.equal(new Set(numbers).size, 20, 'concurrent allocation never produces a duplicate number')
})

test('order numbering is isolated per tenant', async () => {
  const a = await allocateOrderNumber(payload, tenantId)
  const b = await allocateOrderNumber(payload, tenantBId)
  assert.ok(a.startsWith('ORD-'))
  assert.ok(b.startsWith('B-'), 'tenant B uses its own prefix + independent sequence')
})

test('allocateOrderNumber throws when the tenant has no commerce-settings', async () => {
  const { tenantId: bare } = await seedTenant(payload)
  await assert.rejects(() => allocateOrderNumber(payload, bare), /not initialized/)
})
