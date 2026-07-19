// Operational commerce reports (Plan §7 E2) — integration coverage. Boots an isolated SQLite DB,
// seeds minimal rows across the `store-*`, policy, inventory, and jobs collections, and asserts the
// aggregates. All money assertions are integer minor units (EGP). Every report is tenant-scoped: a
// second tenant's rows are seeded once to prove they do not leak into the first tenant's report.
import assert from 'node:assert/strict'
import { rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import type { Payload } from 'payload'

const TEMP_DB = join(tmpdir(), `commerce-reports-${process.pid}-${Date.now()}.db`)
process.env.DATABASE_URI = `file:${TEMP_DB}`
process.env.PAYLOAD_SECRET = process.env.PAYLOAD_SECRET || 'commerce-reports-secret'

const { default: config } = await import('../src/payload.config')
const { getPayload } = await import('payload')
const { seedTenant, seedLocation } = await import('./helpers/commerce')
const payload = (await getPayload({ config })) as unknown as Payload
await payload.db.migrate()

const { sql } = await import('@payloadcms/db-sqlite')
const {
  salesTotals,
  reconciliationExceptions,
  unpaidOrExpiredOrders,
  lowStock,
  promotionUsage,
  giftCardLiabilities,
  failedNotificationJobs,
} = await import('../src/commerce/reports')
const { SEND_COMMERCE_NOTIFICATION_TASK } = await import('../src/commerce/payments/job')

let tenantA: number | string
let tenantB: number | string
let locationA: number | string
let locationB: number | string

const DAY = '2026-07-19T12:00:00.000Z'

test.before(async () => {
  ;({ tenantId: tenantA } = await seedTenant(payload))
  ;({ tenantId: tenantB } = await seedTenant(payload))
  locationA = await seedLocation(payload, tenantA)
  locationB = await seedLocation(payload, tenantB)
})
test.after(async () => {
  try {
    try { await (payload.db as any).drizzle?.session?.client?.close?.() } catch { /* best-effort */ }
    await payload.destroy()
  } finally { try { rmSync(TEMP_DB, { force: true }) } catch { /* */ } }
})

// Seed helpers — minimal rows with the money fields the reports aggregate.
async function seedOrder(t: number | string, over: Record<string, unknown> = {}) {
  const o = await payload.create({
    collection: 'store-orders',
    overrideAccess: true,
    data: {
      tenant: t,
      orderNumber: `ORD-${t}-${Math.random().toString(36).slice(2, 8)}`,
      status: 'completed',
      paymentState: 'captured',
      currency: 'EGP',
      amount: 0,
      subtotal: 10000,
      totalDiscount: 0,
      shippingPrice: 0,
      totalTax: 0,
      giftCardApplied: 0,
      amountDue: 10000,
      placedAt: DAY,
      customerEmail: 'customer@dgh.test',
      ...over,
    } as any,
  })
  return o.id
}

async function seedTransaction(t: number | string, over: Record<string, unknown> = {}) {
  const tx = await payload.create({
    collection: 'store-transactions',
    overrideAccess: true,
    data: {
      tenant: t,
      status: 'succeeded',
      currency: 'EGP',
      amount: 10000,
      paymentMethod: 'paymob',
      reconciliationStatus: 'matched',
      capturedAmount: 10000,
      refundedAmount: 0,
      ...over,
    } as any,
  })
  return tx.id
}

async function seedPromotion(t: number | string, code: string) {
  const p = await payload.create({
    collection: 'promotions',
    overrideAccess: true,
    data: {
      tenant: t,
      code,
      type: 'percentage',
      value: 1000, // 10%
      minimumSubtotal: 0,
      startsAt: DAY,
      enabled: true,
    } as any,
  })
  return p.id
}

async function seedGiftCard(
  t: number | string,
  initial: number,
  ledger: Array<{ kind: 'issue' | 'redeem' | 'refund'; amount: number; idempotencyKey: string }>,
) {
  // Reconstruct the expected cached balance from the ledger so the cached column matches the fold
  // (the report reconstructs from the ledger and falls back to the cached value when absent).
  let balance = initial
  for (const e of ledger) balance += e.amount
  const card = await payload.create({
    collection: 'gift-cards',
    overrideAccess: true,
    data: {
      tenant: t,
      codeHash: `hash-${t}-${Math.random().toString(36).slice(2, 10)}`,
      lastFour: '1234',
      currency: 'EGP',
      initialBalance: initial,
      balance: Math.max(0, balance),
      status: 'active',
    } as any,
  })
  for (const e of ledger) {
    await payload.create({
      collection: 'gift-card-ledger',
      overrideAccess: true,
      data: {
        tenant: t,
        giftCard: card.id,
        kind: e.kind,
        amount: e.amount,
        idempotencyKey: e.idempotencyKey,
        createdAt: DAY,
      } as any,
    })
  }
  return card.id
}

// Raw SQL insert for a failed `send-commerce-notification` job row. payload-jobs is a system
// collection; its `taskSlug` select options are generated from registered tasks, and the task is not
// registered in this test env, so a payload.create would fail select validation. Insert directly.
async function seedFailedJob(t: number | string, idempotencyKey: string) {
  const drizzle = (payload.db as unknown as { drizzle: { run: (s: ReturnType<typeof sql>) => Promise<unknown> } }).drizzle
  await drizzle.run(sql`INSERT INTO \`payload_jobs\`
    (\`task_slug\`, \`queue\`, \`has_error\`, \`total_tried\`, \`input\`, \`error\`, \`completed_at\`, \`processing\`)
    VALUES (${SEND_COMMERCE_NOTIFICATION_TASK}, ${'commerce'}, ${1}, ${6},
      ${JSON.stringify({ idempotencyKey, tenantId: Number(t), trigger: 'payment_event' })},
      ${JSON.stringify({ message: 'boom' })},
      ${DAY}, ${0})`)
}

// ----------------------------------------------------------------------------
// 1. Sales totals
// ----------------------------------------------------------------------------

test('salesTotals sums store-orders integer totals and groups by day/status/paymentState', async () => {
  await seedOrder(tenantA, { subtotal: 10000, totalDiscount: 0, shippingPrice: 500, totalTax: 1500, giftCardApplied: 0, amountDue: 12000, paymentState: 'captured', status: 'completed' })
  await seedOrder(tenantA, { subtotal: 5000, totalDiscount: 1000, shippingPrice: 0, totalTax: 0, giftCardApplied: 0, amountDue: 4000, paymentState: 'pending', status: 'processing' })
  // Tenant B row must NOT leak into tenant A's report.
  await seedOrder(tenantB, { subtotal: 999999, totalDiscount: 0, shippingPrice: 0, totalTax: 0, giftCardApplied: 0, amountDue: 999999, paymentState: 'captured', status: 'completed' })

  const r = await salesTotals({ payload, tenantId: tenantA })
  assert.equal(r.currency, 'EGP')
  assert.equal(r.totals.count, 2, 'tenant B order excluded by tenant scoping')
  // grandTotal = subtotal + shipping + tax − discount. amountDue is the authoritative charged total.
  assert.equal(r.totals.subtotal, 15000)
  assert.equal(r.totals.totalDiscount, 1000)
  assert.equal(r.totals.shippingPrice, 500)
  assert.equal(r.totals.totalTax, 1500)
  assert.equal(r.totals.grandTotal, 15000 + 500 + 1500 - 1000, '16000 = 15000+500+1500-1000')
  assert.equal(r.totals.amountDue, 12000 + 4000, '16000 = amountDue of both orders')

  // One bucket per (day, status, paymentState) combination.
  assert.equal(r.buckets.length, 2)
  const captured = r.buckets.find((b) => b.paymentState === 'captured')
  assert.ok(captured, 'captured bucket exists')
  assert.equal(captured!.count, 1)
  assert.equal(captured!.amountDue, 12000)
})

test('salesTotals honors status + date filters', async () => {
  await seedOrder(tenantA, { subtotal: 3000, amountDue: 3000, paymentState: 'captured', status: 'completed', placedAt: '2026-07-01T00:00:00.000Z' })
  const byStatus = await salesTotals({ payload, tenantId: tenantA }, { status: 'completed' })
  // Includes the completed order from THIS test plus the completed order from the prior test.
  assert.ok(byStatus.buckets.every((b) => b.status === 'completed'))
  assert.ok(byStatus.totals.count >= 1)

  const inRange = await salesTotals({ payload, tenantId: tenantA }, { from: '2026-06-01', to: '2026-06-30' })
  assert.equal(inRange.totals.count, 0, 'no orders placed in June')
})

// ----------------------------------------------------------------------------
// 2. Reconciliation exceptions
// ----------------------------------------------------------------------------

test('reconciliationExceptions returns only transactions whose status ≠ matched', async () => {
  await seedTransaction(tenantA, { reconciliationStatus: 'matched', amount: 1000 })
  await seedTransaction(tenantA, { reconciliationStatus: 'exception', amount: 2000, capturedAmount: 0 })
  await seedTransaction(tenantA, { reconciliationStatus: 'pending', amount: 3000 })
  await seedTransaction(tenantB, { reconciliationStatus: 'exception', amount: 999999 })

  const r = await reconciliationExceptions({ payload, tenantId: tenantA })
  assert.equal(r.exceptionCount, 2, 'matched + tenant-B exception excluded')
  const amounts = r.exceptions.map((e) => e.amount).sort((a, b) => a - b)
  assert.deepEqual(amounts, [2000, 3000])
  assert.equal(r.exceptions[0].reconciliationStatus !== 'matched', true)
})

// ----------------------------------------------------------------------------
// 3. Unpaid / expired orders
// ----------------------------------------------------------------------------

test('unpaidOrExpiredOrders labels unpaid and expired orders; excludes paid+current', async () => {
  // Dedicated tenant: this file shares one DB across tests, so a fresh tenant isolates the count
  // from orders seeded by the salesTotals tests above.
  const { tenantId: uoe } = await seedTenant(payload)
  await seedOrder(uoe, { amountDue: 1000, paymentState: 'captured', expiresAt: null }) // paid, no expiry → excluded
  await seedOrder(uoe, { amountDue: 2000, paymentState: 'pending', expiresAt: null }) // unpaid
  const future = '2099-01-01T00:00:00.000Z'
  const past = '2020-01-01T00:00:00.000Z'
  await seedOrder(uoe, { amountDue: 3000, paymentState: 'captured', expiresAt: future }) // paid + not expired → excluded
  await seedOrder(uoe, { amountDue: 4000, paymentState: 'authorized', expiresAt: past }) // expired (and unpaid)

  const r = await unpaidOrExpiredOrders({ payload, tenantId: uoe }, { now: new Date('2026-07-19T12:00:00Z') })
  assert.equal(r.count, 2)
  const dues = r.orders.map((o) => o.amountDue).sort((a, b) => a - b)
  assert.deepEqual(dues, [2000, 4000])
  const expired = r.orders.find((o) => o.amountDue === 4000)
  assert.equal(expired!.expired, true)
  assert.equal(expired!.unpaid, true)
  const unpaid = r.orders.find((o) => o.amountDue === 2000)
  assert.equal(unpaid!.unpaid, true)
  assert.equal(unpaid!.expired, false)
})

// ----------------------------------------------------------------------------
// 4. Low stock
// ----------------------------------------------------------------------------

test('lowStock returns levels where onHand − reserved <= threshold', async () => {
  await payload.create({
    collection: 'inventory-levels', overrideAccess: true,
    data: { tenant: tenantA, location: locationA, sku: 'SKU-OK', onHand: 100, reserved: 0, lowStockThreshold: 5 } as any,
  })
  await payload.create({
    collection: 'inventory-levels', overrideAccess: true,
    data: { tenant: tenantA, location: locationA, sku: 'SKU-LOW', onHand: 5, reserved: 3, lowStockThreshold: 5 } as any,
  })
  await payload.create({
    collection: 'inventory-levels', overrideAccess: true,
    data: { tenant: tenantB, location: locationB, sku: 'SKU-OTHER-TENANT', onHand: 1, reserved: 0, lowStockThreshold: 0 } as any,
  })

  const r = await lowStock({ payload, tenantId: tenantA })
  assert.equal(r.count, 1, 'only the low + cross-tenant-excluded level')
  assert.equal(r.items[0].sku, 'SKU-LOW')
  assert.equal(r.items[0].available, 2, 'onHand 5 − reserved 3')
  assert.equal(r.items[0].threshold, 5)

  // threshold override widens the net.
  const wide = await lowStock({ payload, tenantId: tenantA }, { thresholdOverride: 100 })
  assert.ok(wide.count >= 2, 'override threshold catches both tenant-A levels')
})

// ----------------------------------------------------------------------------
// 5. Promotion usage
// ----------------------------------------------------------------------------

test('promotionUsage aggregates redemption counts + total discount per promotion', async () => {
  const promoA = await seedPromotion(tenantA, 'SAVE10')
  const o1 = await seedOrder(tenantA, { paymentState: 'captured' })
  const o2 = await seedOrder(tenantA, { paymentState: 'captured' })
  await payload.create({
    collection: 'promotion-redemptions', overrideAccess: true,
    data: { tenant: tenantA, promotion: promoA, order: o1, customerIdentityHash: 'h1', discountAmount: 1500, redeemedAt: DAY } as any,
  })
  await payload.create({
    collection: 'promotion-redemptions', overrideAccess: true,
    data: { tenant: tenantA, promotion: promoA, order: o2, customerIdentityHash: 'h2', discountAmount: 2500, redeemedAt: DAY } as any,
  })

  const r = await promotionUsage({ payload, tenantId: tenantA })
  assert.equal(r.totalRedemptions, 2)
  assert.equal(r.promotionCount, 1)
  assert.equal(r.promotions[0].code, 'SAVE10')
  assert.equal(r.promotions[0].redemptionCount, 2)
  assert.equal(r.promotions[0].totalDiscount, 4000)
})

// ----------------------------------------------------------------------------
// 6. Gift-card liabilities
// ----------------------------------------------------------------------------

test('giftCardLiabilities reconstructs active balances from the append-only ledger', async () => {
  // Card 1: issued 5000, redeemed 1500 → reconstructed balance 3500.
  await seedGiftCard(tenantA, 5000, [
    { kind: 'issue', amount: 5000, idempotencyKey: 'gc1-issue' },
    { kind: 'redeem', amount: -1500, idempotencyKey: 'gc1-redeem' },
  ])
  // Card 2: issued 2000, redeemed 2000 → reconstructed balance 0 (still active, contributes 0).
  await seedGiftCard(tenantA, 2000, [
    { kind: 'issue', amount: 2000, idempotencyKey: 'gc2-issue' },
    { kind: 'redeem', amount: -2000, idempotencyKey: 'gc2-redeem' },
  ])
  // Inactive card on tenant A — must be excluded from liabilities.
  await payload.create({
    collection: 'gift-cards', overrideAccess: true,
    data: { tenant: tenantA, codeHash: 'inactive', lastFour: '9999', currency: 'EGP', initialBalance: 99999, balance: 99999, status: 'revoked' } as any,
  })

  const r = await giftCardLiabilities({ payload, tenantId: tenantA })
  assert.equal(r.activeCardCount, 2)
  assert.equal(r.totalLiability, 3500, '3500 + 0; revoked card excluded')
})

// ----------------------------------------------------------------------------
// 7. Failed notification jobs
// ----------------------------------------------------------------------------

test('failedNotificationJobs surfaces exhausted-retry send-commerce-notification jobs, tenant-scoped', async () => {
  await seedFailedJob(tenantA, 'payment:A:evt:failed')
  await seedFailedJob(tenantB, 'payment:B:evt:failed') // different tenant — must be excluded
  // A non-commerce-queue failed job with the same slug should not appear.
  const drizzle = (payload.db as unknown as { drizzle: { run: (s: ReturnType<typeof sql>) => Promise<unknown> } }).drizzle
  await drizzle.run(sql`INSERT INTO \`payload_jobs\`
    (\`task_slug\`, \`queue\`, \`has_error\`, \`total_tried\`, \`input\`, \`completed_at\`, \`processing\`)
    VALUES (${SEND_COMMERCE_NOTIFICATION_TASK}, ${'default'}, ${1}, ${6},
      ${JSON.stringify({ idempotencyKey: 'wrong-queue', tenantId: Number(tenantA), trigger: 'payment_event' })},
      ${DAY}, ${0})`)

  const r = await failedNotificationJobs({ payload, tenantId: tenantA })
  assert.equal(r.count, 1, 'only tenant-A commerce-queue failed job')
  const job = r.jobs[0]
  assert.ok(job.input, 'failed job carries its input envelope')
  assert.equal(job.input!.idempotencyKey, 'payment:A:evt:failed')
  assert.equal(job.totalTried, 6)
  assert.equal(job.queue, 'commerce')
})
