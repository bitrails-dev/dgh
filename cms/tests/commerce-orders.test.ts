// Order model + creation: a server-computed QuoteSnapshot becomes an immutable order with a
// per-tenant, atomically-allocated order number. Tamper-evident quote verification, sequential
// numbering, concurrent no-duplicate numbering, and the not-initialized guard.
import assert from 'node:assert/strict'
import { rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import type { Payload } from 'payload'
import type { QuoteSnapshot } from '../src/commerce/pricing'

const TEMP_DB = join(tmpdir(), `commerce-orders-itest-${process.pid}-${Date.now()}.db`)
process.env.DATABASE_URI = `file:${TEMP_DB}`
process.env.PAYLOAD_SECRET = process.env.PAYLOAD_SECRET || 'commerce-orders-itest-secret'

const { default: config } = await import('../src/payload.config')
const { getPayload } = await import('payload')
const { seedTenant } = await import('./helpers/commerce')
const payload = (await getPayload({ config })) as unknown as Payload
await payload.db.migrate()

const { money } = await import('../src/commerce/money')
const { quote, verifySnapshot } = await import('../src/commerce/pricing')
const { createOrder } = await import('../src/commerce/orders/create')
const { allocateOrderNumber } = await import('../src/commerce/orders/numbering')

let tenantId: number | string
let tenantBId: number | string

const sampleQuote = (): QuoteSnapshot =>
  quote({ currency: 'EGP', taxMode: 'exclusive', lines: [{ key: 'a', sku: 'A', quantity: 2, unitPrice: money(1050, 'EGP'), taxBps: 1400 }] })

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
  try { await payload.destroy() } finally { try { rmSync(TEMP_DB, { force: true }) } catch { /* */ } }
})

test('createOrder persists an immutable snapshot with a sequential per-tenant order number', async () => {
  const q = sampleQuote()
  const o1: any = await createOrder({ payload, tenantId, quote: q, items: [{ sku: 'A', qty: 2 }], customerEmail: 'a@b.test' })
  assert.equal(o1.orderNumber, 'ORD-1')
  assert.equal(o1.status, 'pending')
  assert.equal(o1.paymentState, 'pending')
  assert.equal(o1.fulfillmentState, 'unfulfilled')
  assert.equal(o1.currency, 'EGP')
  assert.equal(o1.grandTotal, q.grandTotal)
  assert.equal(o1.amountDue, q.amountDue)
  assert.equal(o1.totalTax, q.totalTax)
  assert.equal(o1.quoteHash, q.hash)
  assert.deepEqual(o1.quoteSnapshot.hash, q.hash)

  const o2: any = await createOrder({ payload, tenantId, quote: sampleQuote(), items: [] })
  assert.equal(o2.orderNumber, 'ORD-2', 'sequence advances per tenant')
})

test('a tampered quote snapshot is rejected before an order is created', async () => {
  const tampered = { ...sampleQuote(), grandTotal: sampleQuote().grandTotal + 1 }
  assert.equal(verifySnapshot(tampered), false)
  await assert.rejects(() => createOrder({ payload, tenantId, quote: tampered as QuoteSnapshot, items: [] }), /tamper/)
})

test('20 concurrent createOrder calls allocate 20 distinct order numbers (no duplicates)', async () => {
  const orders = await Promise.all(
    Array.from({ length: 20 }, () => createOrder({ payload, tenantId, quote: sampleQuote(), items: [] }).catch((e) => ({ error: String(e) }))),
  )
  const errors = orders.filter((o) => (o as any).error)
  assert.equal(errors.length, 0, `no allocation should fail: ${JSON.stringify(errors)}`)
  const numbers = orders.map((o: any) => o.orderNumber)
  assert.equal(new Set(numbers).size, 20, 'all order numbers are distinct')
  // they occupy a contiguous block (3..22, since 1+2 already allocated)
  const seqs = numbers.map((n) => Number(n.replace('ORD-', ''))).sort((a, b) => a - b)
  assert.deepEqual(seqs, Array.from({ length: 20 }, (_, i) => i + 3))
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
