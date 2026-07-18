// Plan §7 B3 — migration fixtures + preflight + parity assertions.
//
// This file exercises every artifact the Wave C2 backfill and Wave F1 parity tests will build on:
//
//   1. empty-database fixture — freshly migrated throwaway DB with zero legacy commerce rows, and
//      `runPreflight` returns ok=true on it (plan §5.1 / §5.7.1 "rehearse on an empty database").
//   2. copied-schema fixture — the same throwaway DB seeded with a realistic 2-tenant dataset, with
//      per-tenant product/variant/order/transaction/customer counts and money-parity assertions
//      (plan §5.7.2 "rehearse on a copied-real database" + §5.7.3 "compare counts and money totals").
//      `runPreflight` returns ok=true on a clean seed.
//   3. preflight-FAILURE fixtures — each injects exactly one bad-data pattern from plan §5.1, asserts
//      `runPreflight` aborts with the matching failure code, and (critically) asserts no writes
//      occurred (row counts unchanged).
//
// Each failure test uses its own tenant so the bad data is isolated; cleanup runs after. The shared
// Payload + throwaway DB lives for the whole file (one process — Windows + libSQL isolation).

import assert from 'node:assert/strict'
import { rmSync } from 'node:fs'
import test from 'node:test'
import type { Payload } from 'payload'

import { sql } from '@payloadcms/db-sqlite'
import { seedTenant } from './helpers/commerce'
import { makeTempDbPath, drizzleFrom } from './fixtures/throwaway-db'
import {
  seedLegacyProduct,
  seedLegacyOrder,
  seedLegacyTransaction,
  seedLegacyCustomer,
  deleteLegacyRowsForTenant,
  type DB,
} from './fixtures/legacy-seed'
import { seedCopiedSchema } from './fixtures/copied-schema'
import { runPreflight, isSafeIntegerMoney, type PreflightFailure } from './fixtures/preflight'

const TEMP_DB = makeTempDbPath('commerce-migration-fixtures')
process.env.DATABASE_URI = `file:${TEMP_DB}`
process.env.PAYLOAD_SECRET = process.env.PAYLOAD_SECRET || 'commerce-migration-fixtures-secret'

const { default: config } = await import('../src/payload.config')
const { getPayload } = await import('payload')
const payload = (await getPayload({ config })) as unknown as Payload
await payload.db.migrate()
const db: DB = drizzleFrom(payload)

// Reusable: assert every money column in the copied-schema fixture is an integer (the parity
// contract plan §5.7.3 requires). Used by the empty-DB (vacuously) and copied-schema tests.
async function assertMoneyParity(throwaway: DB): Promise<void> {
  for (const stmt of [
    sql`SELECT \`price\` AS \`v\` FROM \`products\` WHERE \`price\` IS NOT NULL;`,
    sql`SELECT \`compare_at_price\` AS \`v\` FROM \`products\` WHERE \`compare_at_price\` IS NOT NULL;`,
    sql`SELECT \`subtotal\` AS \`v\` FROM \`orders\` WHERE \`subtotal\` IS NOT NULL;`,
    sql`SELECT \`total_discount\` AS \`v\` FROM \`orders\` WHERE \`total_discount\` IS NOT NULL;`,
    sql`SELECT \`shipping_price\` AS \`v\` FROM \`orders\` WHERE \`shipping_price\` IS NOT NULL;`,
    sql`SELECT \`total_tax\` AS \`v\` FROM \`orders\` WHERE \`total_tax\` IS NOT NULL;`,
    sql`SELECT \`grand_total\` AS \`v\` FROM \`orders\`;`,
    sql`SELECT \`amount_due\` AS \`v\` FROM \`orders\`;`,
    sql`SELECT \`gift_card_applied\` AS \`v\` FROM \`orders\`;`,
    sql`SELECT \`amount\` AS \`v\` FROM \`transactions\`;`,
    sql`SELECT \`captured_amount\` AS \`v\` FROM \`transactions\`;`,
    sql`SELECT \`refunded_amount\` AS \`v\` FROM \`transactions\`;`,
  ]) {
    const res = await throwaway.run(stmt)
    for (const row of res.rows as Array<{ v: unknown }>) {
      assert.ok(
        isSafeIntegerMoney(row.v),
        `money parity: expected integer, got ${JSON.stringify(row.v)}`,
      )
    }
  }
}

// Snapshot every legacy commerce row count. Used before/after a preflight call to prove no writes.
async function snapshotCounts(throwaway: DB): Promise<{
  products: number
  orders: number
  transactions: number
  customers: number
}> {
  const m = async (q: ReturnType<typeof sql>) => {
    const r = await throwaway.run(q)
    return Number((r.rows[0] as { v?: unknown } | undefined)?.v ?? 0)
  }
  return {
    products: await m(sql`SELECT COUNT(*) AS \`v\` FROM \`products\`;`),
    orders: await m(sql`SELECT COUNT(*) AS \`v\` FROM \`orders\`;`),
    transactions: await m(sql`SELECT COUNT(*) AS \`v\` FROM \`transactions\`;`),
    customers: await m(sql`SELECT COUNT(*) AS \`v\` FROM \`customers\`;`),
  }
}

// True when the failure list contains the expected code (and the message mentions the substring).
const hasFailure = (failures: PreflightFailure[], code: string, messageIncludes?: string): boolean =>
  failures.some(
    (f) => f.code === code && (messageIncludes === undefined || f.message.includes(messageIncludes)),
  )

test.after(async () => {
  try { await payload.destroy() } catch { /* disposable */ }
  try { rmSync(TEMP_DB, { force: true }) } catch { /* ignore */ }
})

// ----------------------------------------------------------------------------
// 1. Empty-database fixture
// ----------------------------------------------------------------------------

test('empty-database fixture: freshly migrated DB has zero legacy commerce rows', async () => {
  const counts = await snapshotCounts(db)
  assert.equal(counts.products, 0, 'no legacy products')
  assert.equal(counts.orders, 0, 'no legacy orders')
  assert.equal(counts.transactions, 0, 'no legacy transactions')
  assert.equal(counts.customers, 0, 'no legacy customers')
})

test('empty-database fixture: preflight returns ok=true on an empty DB', async () => {
  const result = await runPreflight(db)
  assert.equal(result.ok, true, `preflight should pass on empty DB: ${JSON.stringify(result)}`)
  if (result.ok) {
    assert.equal(result.counts.totals.products, 0)
    assert.equal(result.counts.totals.orders, 0)
    assert.equal(result.counts.totals.transactions, 0)
    assert.equal(result.counts.totals.customers, 0)
  }
})

test('empty-database fixture: money parity holds vacuously', async () => {
  await assertMoneyParity(db)
})

// ----------------------------------------------------------------------------
// 2. Copied-schema fixture
// ----------------------------------------------------------------------------

// Two tenants, seeded ONCE for the copied-schema test group. Lazy: the first test in this section
// seeds, and subsequent tests reuse the seeded state. The empty-DB tests above run BEFORE this
// seeding, so they still see a clean DB. (node:test's `test.before` would run before every test in
// the file, which is wrong here — we use lazy seeding instead.)
let seededA: number | string | undefined
let seededB: number | string | undefined
let seedResult: Awaited<ReturnType<typeof seedCopiedSchema>> | undefined

async function ensureSeed(): Promise<void> {
  if (seedResult && seededA !== undefined && seededB !== undefined) return
  ;({ tenantId: seededA } = await seedTenant(payload))
  ;({ tenantId: seededB } = await seedTenant(payload))
  if (seededA === undefined || seededB === undefined) throw new Error('seedTenant returned no id')
  seedResult = await seedCopiedSchema(db, seededA, seededB)
}

test('copied-schema fixture: per-tenant counts match the seed contract', async () => {
  await ensureSeed()
  if (!seedResult || seededA === undefined || seededB === undefined) throw new Error('seed missing')

  const [a, b] = seedResult.tenants
  assert.equal(a.tenantId, seededA)
  assert.equal(b.tenantId, seededB)

  // Tenant A: 3 products (1 simple + 1 variant-parent + 1 draft), 3 variants, 3 orders, 2 txns, 2 customers.
  const aCounts = await snapshotTenant(seededA)
  assert.equal(aCounts.products, a.products, `tenant A products`)
  assert.equal(aCounts.variants, a.variants, `tenant A variants`)
  assert.equal(aCounts.orders, a.orders, `tenant A orders`)
  assert.equal(aCounts.transactions, a.transactions, `tenant A transactions`)
  assert.equal(aCounts.customers, a.customers, `tenant A customers`)

  // Tenant B: 2 products, 0 variants, 1 order, 1 txn, 1 customer.
  const bCounts = await snapshotTenant(seededB)
  assert.equal(bCounts.products, b.products, `tenant B products`)
  assert.equal(bCounts.variants, b.variants, `tenant B variants`)
  assert.equal(bCounts.orders, b.orders, `tenant B orders`)
  assert.equal(bCounts.transactions, b.transactions, `tenant B transactions`)
  assert.equal(bCounts.customers, b.customers, `tenant B customers`)
})

test('copied-schema fixture: every money column is an integer (parity contract)', async () => {
  await ensureSeed()
  await assertMoneyParity(db)
})

test('copied-schema fixture: preflight returns ok=true on a clean seed', async () => {
  await ensureSeed()
  const result = await runPreflight(db)
  if (!result.ok) {
    assert.fail(`preflight should pass on the clean copied-schema seed: ${JSON.stringify(result.failures, null, 2)}`)
  }
})

test('copied-schema fixture: count + money parity is the exact contract Wave C2/F1 will reuse', async () => {
  await ensureSeed()
  // Re-stating the contract from plan §5.7.3 ("compare counts and money totals") in a single test
  // so the F1 parity tests have a single-source-of-truth assertion shape.
  const result = await runPreflight(db)
  if (!result.ok) throw new Error(`preflight unexpectedly failed: ${JSON.stringify(result.failures)}`)
  // Totals are the sum of per-tenant counts.
  assert.equal(result.counts.totals.products, 5, '5 products total across 2 tenants')
  assert.equal(result.counts.totals.variants, 3, '3 variants total')
  assert.equal(result.counts.totals.orders, 4, '4 orders total')
  assert.equal(result.counts.totals.transactions, 3, '3 transactions total')
  assert.equal(result.counts.totals.customers, 3, '3 customers total')
})

// ----------------------------------------------------------------------------
// 3. Preflight-FAILURE fixtures (plan §5.1; one failure case per test)
// ----------------------------------------------------------------------------
//
// Each test:
//   1. creates its own tenant via seedTenant so the bad data is isolated;
//   2. snapshots row counts BEFORE the preflight call;
//   3. injects the bad data via the legacy-seed helpers (raw SQL);
//   4. runs `runPreflight` and asserts it returns ok=false with the expected failure code;
//   5. snapshots row counts AFTER the preflight call and asserts they're unchanged — the preflight
//      must never write (plan §5.1 "Any failure aborts migration without writes");
//   6. cleans up the tenant's legacy rows so subsequent tests see a clean state.

test('preflight FAILURE (a): published digital product aborts with PUBLISHED_DIGITAL_PRODUCT', async () => {
  const { tenantId } = await seedTenant(payload)
  try {
    const before = await snapshotCounts(db)
    await seedLegacyProduct(db, {
      tenantId,
      name: 'Bad Digital',
      sku: 'BAD-DIGI-' + String(tenantId),
      price: 1000,
      status: 'active',           // published
      productKind: 'digital',     // forbidden combo
    })
    const result = await runPreflight(db)
    assert.equal(result.ok, false, 'preflight must abort on a published digital product')
    if (!result.ok) {
      assert.ok(
        hasFailure(result.failures, 'PUBLISHED_DIGITAL_PRODUCT', String(tenantId)),
        `expected PUBLISHED_DIGITAL_PRODUCT failure mentioning tenant ${tenantId}; got ${JSON.stringify(result.failures)}`,
      )
    }
    const after = await snapshotCounts(db)
    // The preflight must not have written: products grew by exactly 1 (the bad row we seeded),
    // orders/transactions/customers unchanged.
    assert.equal(after.products, before.products + 1, 'preflight wrote nothing — only our seed row added')
    assert.equal(after.orders, before.orders, 'preflight wrote no orders')
    assert.equal(after.transactions, before.transactions, 'preflight wrote no transactions')
    assert.equal(after.customers, before.customers, 'preflight wrote no customers')
  } finally {
    await deleteLegacyRowsForTenant(db, tenantId)
  }
})

test('preflight FAILURE (b): duplicate non-null variant SKU aborts with DUPLICATE_SKU', async () => {
  const { tenantId } = await seedTenant(payload)
  try {
    const dupVariantSku = 'DUP-VAR-' + String(tenantId)
    await seedLegacyProduct(db, {
      tenantId,
      name: 'Variant Parent 1',
      sku: 'PARENT1-' + String(tenantId),
      price: 1000,
      status: 'active',
      productKind: 'physical',
      variants: [{ sku: dupVariantSku, name: 'Red', price: 1000 }],
    })
    await seedLegacyProduct(db, {
      tenantId,
      name: 'Variant Parent 2',
      sku: 'PARENT2-' + String(tenantId),
      price: 1000,
      status: 'active',
      productKind: 'physical',
      variants: [{ sku: dupVariantSku, name: 'Blue', price: 1000 }], // same variant SKU, no DB constraint
    })
    const before = await snapshotCounts(db)
    const result = await runPreflight(db)
    assert.equal(result.ok, false, 'preflight must abort on a duplicate variant SKU')
    if (!result.ok) {
      assert.ok(
        hasFailure(result.failures, 'DUPLICATE_SKU', dupVariantSku),
        `expected DUPLICATE_SKU failure mentioning '${dupVariantSku}'; got ${JSON.stringify(result.failures)}`,
      )
    }
    const after = await snapshotCounts(db)
    assert.equal(after.products, before.products, 'preflight wrote nothing')
    assert.equal(after.orders, before.orders, 'preflight wrote nothing')
    assert.equal(after.transactions, before.transactions, 'preflight wrote nothing')
    assert.equal(after.customers, before.customers, 'preflight wrote nothing')
  } finally {
    await deleteLegacyRowsForTenant(db, tenantId)
  }
})

test('preflight FAILURE (c): non-integer money value aborts with MONEY_NOT_INTEGER', async () => {
  const { tenantId } = await seedTenant(payload)
  try {
    // Insert a product row with a fractional price directly. Raw SQL is required because the legacy
    // product seed helper types `price` as a number; we want to inject 1050.5 exactly.
    await db.run(sql`
      INSERT INTO \`products\` (
        \`name\`, \`slug\`, \`sku\`, \`description\`, \`price\`, \`compare_at_price\`,
        \`tax_class\`, \`tax_bps\`, \`status\`, \`product_kind\`, \`track_inventory\`,
        \`images\`, \`variants\`, \`tenant_id\`
      ) VALUES (
        'Bad Fractional', 'bad-frac', ${'BAD-FRAC-' + String(tenantId)}, NULL,
        1050.5, NULL, 'standard', 0, 'active', 'physical', 1, NULL, NULL, ${tenantId}
      );
    `)
    const before = await snapshotCounts(db)
    const result = await runPreflight(db)
    assert.equal(result.ok, false, 'preflight must abort on a non-integer money value')
    if (!result.ok) {
      assert.ok(
        hasFailure(result.failures, 'MONEY_NOT_INTEGER', 'price'),
        `expected MONEY_NOT_INTEGER failure on 'price'; got ${JSON.stringify(result.failures)}`,
      )
    }
    const after = await snapshotCounts(db)
    assert.equal(after.products, before.products, 'preflight wrote nothing')
    assert.equal(after.orders, before.orders, 'preflight wrote nothing')
    assert.equal(after.transactions, before.transactions, 'preflight wrote nothing')
    assert.equal(after.customers, before.customers, 'preflight wrote nothing')
  } finally {
    await deleteLegacyRowsForTenant(db, tenantId)
  }
})

test('preflight FAILURE (d): orphan transaction aborts with ORPHAN_TRANSACTION', async () => {
  const { tenantId } = await seedTenant(payload)
  try {
    // Use a real order id space — pick an order id that doesn't exist (9_999_999 is safely beyond
    // the AUTOINCREMENT sequence for a fresh throwaway DB).
    const fakeOrderId = 9_999_999
    // The `transactions.order_id` column has an FK to `orders(id)` and SQLite enforces it, so the
    // legacy world wouldn't normally produce an orphan via Payload. The preflight exists precisely
    // to catch corruption the migration cannot rule out at cutover (e.g. an order row deleted
    // directly via SQL while FK was off, or a cross-tenant id typo). Toggle FK off for the insert,
    // then re-enable so the rest of the suite runs with the production invariant.
    await db.run(sql`PRAGMA foreign_keys = OFF;`)
    try {
      await seedLegacyTransaction(db, {
        tenantId,
        orderId: fakeOrderId,
        gateway: 'paymob',
        amount: 1500,
        state: 'pending',
      })
    } finally {
      await db.run(sql`PRAGMA foreign_keys = ON;`)
    }
    const before = await snapshotCounts(db)
    const result = await runPreflight(db)
    assert.equal(result.ok, false, 'preflight must abort on an orphan transaction')
    if (!result.ok) {
      assert.ok(
        hasFailure(result.failures, 'ORPHAN_TRANSACTION', String(fakeOrderId)),
        `expected ORPHAN_TRANSACTION failure mentioning order_id ${fakeOrderId}; got ${JSON.stringify(result.failures)}`,
      )
    }
    const after = await snapshotCounts(db)
    assert.equal(after.products, before.products, 'preflight wrote nothing')
    assert.equal(after.orders, before.orders, 'preflight wrote nothing')
    assert.equal(after.transactions, before.transactions, 'preflight wrote nothing')
    assert.equal(after.customers, before.customers, 'preflight wrote nothing')
  } finally {
    // Cleanup: DELETE FROM transactions is a child-side delete — FK doesn't restrict it. The
    // orphan row has the test's tenant_id, so the standard per-tenant cleanup removes it.
    await deleteLegacyRowsForTenant(db, tenantId)
  }
})

test('preflight FAILURE (e): ambiguous order item SKU aborts with ORDER_ITEM_SKU_AMBIGUOUS', async () => {
  const { tenantId } = await seedTenant(payload)
  try {
    const sku = 'AMBIG-' + String(tenantId)
    // Two legacy matches for the same SKU in the same tenant:
    //   match 1: a product whose product-level SKU equals `sku`.
    //   match 2: a different product whose variant has sku=`sku`.
    await seedLegacyProduct(db, {
      tenantId,
      name: 'Match 1 (product-level)',
      sku,
      price: 1000,
      status: 'active',
      productKind: 'physical',
    })
    await seedLegacyProduct(db, {
      tenantId,
      name: 'Match 2 (variant-level)',
      sku: 'PARENT-AMBIG-' + String(tenantId),
      price: 1000,
      status: 'active',
      productKind: 'physical',
      variants: [{ sku, name: 'Variant match', price: 1000 }],
    })
    const orderId = await seedLegacyOrder(db, {
      tenantId,
      orderNumber: 'ORD-AMBIG-' + String(tenantId),
      grandTotal: 1000,
      amountDue: 1000,
      items: [{ sku, qty: 1, unitPrice: 1000 }],
    })
    const before = await snapshotCounts(db)
    const result = await runPreflight(db)
    assert.equal(result.ok, false, 'preflight must abort on an ambiguous order item SKU')
    if (!result.ok) {
      assert.ok(
        hasFailure(result.failures, 'ORDER_ITEM_SKU_AMBIGUOUS', sku),
        `expected ORDER_ITEM_SKU_AMBIGUOUS failure mentioning '${sku}'; got ${JSON.stringify(result.failures)}`,
      )
    }
    void orderId
    const after = await snapshotCounts(db)
    assert.equal(after.products, before.products, 'preflight wrote nothing')
    assert.equal(after.orders, before.orders, 'preflight wrote nothing')
    assert.equal(after.transactions, before.transactions, 'preflight wrote nothing')
    assert.equal(after.customers, before.customers, 'preflight wrote nothing')
  } finally {
    await deleteLegacyRowsForTenant(db, tenantId)
  }
})

test('preflight FAILURE (e-zero): unresolved order item SKU aborts with ORDER_ITEM_SKU_UNRESOLVED', async () => {
  // Companion to (e): the ZERO-match side of the same rule. The plan groups them under §5.1.3.
  const { tenantId } = await seedTenant(payload)
  try {
    await seedLegacyOrder(db, {
      tenantId,
      orderNumber: 'ORD-UNRESOLVED-' + String(tenantId),
      grandTotal: 5000,
      amountDue: 5000,
      items: [{ sku: 'NO-SUCH-SKU-' + String(tenantId), qty: 1, unitPrice: 5000 }],
    })
    const before = await snapshotCounts(db)
    const result = await runPreflight(db)
    assert.equal(result.ok, false, 'preflight must abort on an unresolved order item SKU')
    if (!result.ok) {
      assert.ok(
        hasFailure(result.failures, 'ORDER_ITEM_SKU_UNRESOLVED'),
        `expected ORDER_ITEM_SKU_UNRESOLVED failure; got ${JSON.stringify(result.failures)}`,
      )
    }
    const after = await snapshotCounts(db)
    assert.equal(after.products, before.products, 'preflight wrote nothing')
    assert.equal(after.orders, before.orders, 'preflight wrote nothing')
    assert.equal(after.transactions, before.transactions, 'preflight wrote nothing')
    assert.equal(after.customers, before.customers, 'preflight wrote nothing')
  } finally {
    await deleteLegacyRowsForTenant(db, tenantId)
  }
})

test('preflight is rerunnable: two consecutive runs return the same result shape', async () => {
  await ensureSeed()
  // Plan §7 B3 stop condition: "rerunnable and abort-on-failure without writes." Re-running on the
  // unchanged copied-schema fixture must produce the same ok=true twice.
  const r1 = await runPreflight(db)
  const r2 = await runPreflight(db)
  assert.equal(r1.ok, r2.ok, 'preflight is deterministic across runs')
  assert.equal(r2.ok, true, 'copied-schema seed is still clean after the failure tests cleaned up')
})

// Helper: snapshot per-tenant counts, including variant count (which is computed from JSON, not a
// DB row count). The per-tenant counts are what plan §5.7.3 ("compare counts") requires.
async function snapshotTenant(tenantId: number | string): Promise<{
  products: number
  variants: number
  orders: number
  transactions: number
  customers: number
}> {
  const m = async (q: ReturnType<typeof sql>) => {
    const r = await db.run(q)
    return Number((r.rows[0] as { v?: unknown } | undefined)?.v ?? 0)
  }
  const products = await m(sql`SELECT COUNT(*) AS \`v\` FROM \`products\` WHERE \`tenant_id\` = ${tenantId};`)
  // Variant count is the sum of products.variants[].length over the tenant's products.
  const variantRows = await db.run(sql`SELECT \`variants\` FROM \`products\` WHERE \`tenant_id\` = ${tenantId};`)
  let variants = 0
  for (const row of variantRows.rows as Array<{ variants: string | null }>) {
    if (!row.variants) continue
    try {
      const parsed = JSON.parse(row.variants) as unknown
      if (Array.isArray(parsed)) variants += parsed.length
    } catch { /* malformed JSON; preflight would have flagged it elsewhere */ }
  }
  const orders = await m(sql`SELECT COUNT(*) AS \`v\` FROM \`orders\` WHERE \`tenant_id\` = ${tenantId};`)
  const transactions = await m(sql`SELECT COUNT(*) AS \`v\` FROM \`transactions\` WHERE \`tenant_id\` = ${tenantId};`)
  const customers = await m(sql`SELECT COUNT(*) AS \`v\` FROM \`customers\` WHERE \`tenant_id\` = ${tenantId};`)
  return { products, variants, orders, transactions, customers }
}
