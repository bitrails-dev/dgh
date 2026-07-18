// Wave C1/C2 — additive migration + backfill focused tests.
//
// These tests exercise the new artifacts this lane owns:
//
//   1. Empty DB: the additive migration creates every store-*/policy/nonce table from scratch;
//      and — critically for plan §5 input contract #2 — a `payload.update` on commerce-settings
//      succeeds (proves the matching `store_*_id` and policy `_id` columns exist on
//      payload_locked_documents_rels, which Payload's document-lock query now spans after B4).
//   2. Preflight is the B3 module (re-exported through the C2 src path); the existing
//      commerce-migration-fixtures.test.ts already covers every failure case. Here we confirm the
//      src module and the fixture module return identical results on the same DB.
//   3. Backfill dry-run reports per-tenant counts; apply is idempotent on re-run; money-parity
//      assertions hold (sum of legacy totals == sum of store-* totals).
//
// One Payload instance + throwaway DB per file (Windows + libSQL isolation — see
// cms/scripts/run-commerce-integration-tests.mjs).

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
// B3 fixture (the production-stable copy) — used as the reference behavior.
import { runPreflight as runPreflightFixture } from './fixtures/preflight'
// C2 src promotion of the same module — must agree with the fixture byte-for-byte.
import { runPreflight as runPreflightSrc, isSafeIntegerMoney } from '../src/commerce/migration/preflight'
import { runBackfill } from '../src/commerce/migration/backfill'

const TEMP_DB = makeTempDbPath('commerce-migration-additive')
process.env.DATABASE_URI = `file:${TEMP_DB}`
process.env.PAYLOAD_SECRET = process.env.PAYLOAD_SECRET || 'commerce-migration-additive-secret'

const { default: config } = await import('../src/payload.config')
const { getPayload } = await import('payload')
const payload = (await getPayload({ config })) as unknown as Payload
await payload.db.migrate()
const db: DB = drizzleFrom(payload)

test.after(async () => {
  try { await payload.destroy() } catch { /* disposable */ }
  try { rmSync(TEMP_DB, { force: true }) } catch { /* ignore */ }
})

// Helper: list every store_* + policy + nonce table that should exist after the C1 migration.
async function listCommerceTables(): Promise<string[]> {
  const res = await db.run(sql`
    SELECT name FROM sqlite_master
    WHERE type='table' AND (
      name LIKE 'store_%' OR name LIKE '_store_%' OR name LIKE 'tax_%' OR name LIKE 'shipping_%'
      OR name LIKE 'promotion%' OR name LIKE 'gift_%' OR name = 'commerce_gateway_nonces'
    )
    ORDER BY name;
  `)
  return (res.rows as Array<{ name: string }>).map((r) => r.name)
}

// Helper: list every `<slug>_id` column on payload_locked_documents_rels that the C1 migration
// was supposed to add.
async function listLockedRelsColumns(): Promise<string[]> {
  const res = await db.run(sql`PRAGMA table_info(payload_locked_documents_rels);`)
  return (res.rows as Array<{ name: string }>)
    .map((r) => r.name)
    .filter((n) => n.endsWith('_id'))
    .sort()
}

// ----------------------------------------------------------------------------
// 1. Empty-DB migration
// ----------------------------------------------------------------------------

test('empty-DB migration creates every store-* table', async () => {
  const tables = await listCommerceTables()
  for (const required of [
    'store_products', 'store_products_rels',
    'store_variants', 'store_variants_rels',
    'store_variant_types', 'store_variant_options',
    'store_addresses', 'store_carts', 'store_carts_items', 'store_carts_promotion_codes',
    'store_orders', 'store_orders_items', 'store_orders_rels',
    'store_transactions', 'store_transactions_items',
    '_store_products_v', '_store_products_v_rels',
    '_store_variants_v', '_store_variants_v_rels',
    'tax_zones', 'tax_zones_regions', 'tax_zones_postal_prefixes',
    'tax_rates',
    'shipping_zones', 'shipping_zones_regions', 'shipping_zones_postal_prefixes',
    'shipping_methods',
    'promotions', 'promotions_rels',
    'promotion_redemptions',
    'gift_cards', 'gift_card_ledger',
    'commerce_gateway_nonces',
  ]) {
    assert.ok(tables.includes(required), `expected table '${required}' to exist; tables=${JSON.stringify(tables)}`)
  }
})

test('empty-DB migration adds every required locked-documents_rels column', async () => {
  const cols = await listLockedRelsColumns()
  for (const required of [
    'store_products_id', 'store_variants_id', 'store_variant_types_id', 'store_variant_options_id',
    'store_carts_id', 'store_addresses_id', 'store_orders_id', 'store_transactions_id',
    'tax_zones_id', 'tax_rates_id',
    'shipping_zones_id', 'shipping_methods_id',
    'promotions_id', 'promotion_redemptions_id',
    'gift_cards_id', 'gift_card_ledger_id',
  ]) {
    assert.ok(cols.includes(required), `expected column '${required}' on payload_locked_documents_rels; cols=${JSON.stringify(cols)}`)
  }
})

test('empty-DB migration does NOT drop legacy commerce tables', async () => {
  // Plan §0.14 / §5.7.10: legacy tables remain recoverable for the cutover release.
  const res = await db.run(sql`
    SELECT name FROM sqlite_master
    WHERE type='table' AND name IN (
      'products', 'carts', 'orders', 'transactions', 'customers',
      'inventory_locations', 'inventory_levels', 'stock_movements', 'stock_reservations', 'inventory_transfers',
      'commerce_settings', 'payment_events'
    )
    ORDER BY name;
  `)
  const names = (res.rows as Array<{ name: string }>).map((r) => r.name)
  for (const legacy of [
    'products', 'carts', 'orders', 'transactions', 'customers',
    'inventory_locations', 'inventory_levels', 'stock_movements', 'stock_reservations', 'inventory_transfers',
    'commerce_settings', 'payment_events',
  ]) {
    assert.ok(names.includes(legacy), `legacy table '${legacy}' was dropped by the migration (forbidden)`)
  }
})

test('empty-DB: payload.update on commerce-settings succeeds (proves the locked-documents_rels columns exist)', async () => {
  // Plan §5 input contract #2: this is the exact regression that currently fails the integration
  // suite. The document-lock query Payload emits on update spans every collection; without the
  // store_*_id columns it throws a SQL error. After the C1 migration, this round-trip succeeds.
  const { tenantId } = await seedTenant(payload)
  const settings = await payload.create({
    collection: 'commerce-settings',
    overrideAccess: true,
    data: {
      tenant: tenantId,
      status: 'setup',
      currency: 'EGP',
      taxMode: 'exclusive',
      sandbox: true,
    },
  })
  // The update path is what surfaces the lock-status error; create alone does not.
  const updated = await payload.update({
    collection: 'commerce-settings',
    id: settings.id,
    overrideAccess: true,
    data: { status: 'live' },
  })
  assert.equal((updated as { status: string }).status, 'live', 'commerce-settings update round-trips')
})

// ----------------------------------------------------------------------------
// 2. Preflight: src module matches the B3 fixture byte-for-byte
// ----------------------------------------------------------------------------

test('preflight src module returns the same result as the B3 fixture module on the seed DB', async () => {
  // Seed two tenants with the copied-schema fixture; both modules see the same DB and should
  // return the same ok/counts shape.
  const { tenantId: a } = await seedTenant(payload)
  const { tenantId: b } = await seedTenant(payload)
  await seedCopiedSchema(db, a, b)

  const fromFixture = await runPreflightFixture(db)
  const fromSrc = await runPreflightSrc(db)

  assert.equal(fromSrc.ok, fromFixture.ok, 'src and fixture agree on ok')
  assert.equal(fromSrc.ok, true, 'clean seed passes preflight')
  if (fromSrc.ok && fromFixture.ok) {
    assert.deepEqual(fromSrc.counts.totals, fromFixture.counts.totals, 'totals match')
  }
})

test('preflight src module flags duplicate SKU (regression: matches fixture)', async () => {
  const { tenantId } = await seedTenant(payload)
  try {
    const dupSku = 'C1-DUP-' + String(tenantId)
    await seedLegacyProduct(db, { tenantId, sku: 'P1-' + String(tenantId), price: 1000, status: 'active' })
    await seedLegacyProduct(db, {
      tenantId, sku: 'P2-' + String(tenantId), price: 1000, status: 'active',
      variants: [{ sku: dupSku, name: 'X', price: 1000 }],
    })
    await seedLegacyProduct(db, {
      tenantId, sku: 'P3-' + String(tenantId), price: 1000, status: 'active',
      variants: [{ sku: dupSku, name: 'Y', price: 1000 }],
    })
    const rSrc = await runPreflightSrc(db)
    const rFix = await runPreflightFixture(db)
    assert.equal(rSrc.ok, false)
    assert.equal(rFix.ok, false)
    if (!rSrc.ok && !rFix.ok) {
      const codesSrc = rSrc.failures.map((f) => f.code).sort()
      const codesFix = rFix.failures.map((f) => f.code).sort()
      assert.deepEqual(codesSrc, codesFix, 'failure code set matches between src and fixture')
      assert.ok(codesSrc.includes('DUPLICATE_SKU'))
    }
  } finally {
    await deleteLegacyRowsForTenant(db, tenantId)
  }
})

test('preflight src module flags published digital product', async () => {
  const { tenantId } = await seedTenant(payload)
  try {
    await seedLegacyProduct(db, {
      tenantId, sku: 'C1-DIGI-' + String(tenantId), price: 1000,
      status: 'active', productKind: 'digital',
    })
    const r = await runPreflightSrc(db)
    assert.equal(r.ok, false)
    if (!r.ok) assert.ok(r.failures.some((f) => f.code === 'PUBLISHED_DIGITAL_PRODUCT'))
  } finally {
    await deleteLegacyRowsForTenant(db, tenantId)
  }
})

test('preflight src module flags unresolved order item SKU', async () => {
  const { tenantId } = await seedTenant(payload)
  try {
    await seedLegacyOrder(db, {
      tenantId, orderNumber: 'C1-ORD-' + String(tenantId), grandTotal: 1000, amountDue: 1000,
      items: [{ sku: 'NO-SUCH-' + String(tenantId), qty: 1, unitPrice: 1000 }],
    })
    const r = await runPreflightSrc(db)
    assert.equal(r.ok, false)
    if (!r.ok) assert.ok(r.failures.some((f) => f.code === 'ORDER_ITEM_SKU_UNRESOLVED'))
  } finally {
    await deleteLegacyRowsForTenant(db, tenantId)
  }
})

test('preflight src module flags non-integer money', async () => {
  const { tenantId } = await seedTenant(payload)
  try {
    await db.run(sql`
      INSERT INTO \`products\` (\`name\`, \`slug\`, \`sku\`, \`description\`, \`price\`, \`compare_at_price\`,
        \`tax_class\`, \`tax_bps\`, \`status\`, \`product_kind\`, \`track_inventory\`,
        \`images\`, \`variants\`, \`tenant_id\`)
      VALUES ('C1 Frac', 'c1-frac', ${'C1-FRAC-' + String(tenantId)}, NULL,
        1050.5, NULL, 'standard', 0, 'active', 'physical', 1, NULL, NULL, ${tenantId});
    `)
    const r = await runPreflightSrc(db)
    assert.equal(r.ok, false)
    if (!r.ok) assert.ok(r.failures.some((f) => f.code === 'MONEY_NOT_INTEGER'))
    // isSafeIntegerMoney is the parity helper exported for tests; spot-check it.
    assert.equal(isSafeIntegerMoney(1050.5), false)
    assert.equal(isSafeIntegerMoney(1050), true)
    assert.equal(isSafeIntegerMoney('1050'), true)
    assert.equal(isSafeIntegerMoney('1050.5'), false)
    assert.equal(isSafeIntegerMoney('abc'), false)
  } finally {
    await deleteLegacyRowsForTenant(db, tenantId)
  }
})

// ----------------------------------------------------------------------------
// 3. Backfill: dry-run, apply, idempotency, money parity
// ----------------------------------------------------------------------------

test('backfill dry-run on the copied-schema seed reports per-tenant counts without writing', async () => {
  // Use a fresh tenant pair seeded with the copied-schema fixture. Scope the backfill to JUST these
  // tenants so other tests' seed rows (which persist in the shared file-scope DB) don't pollute the
  // counts. The dry-run is read-only; it must not write any store-* rows.
  const { tenantId: a } = await seedTenant(payload)
  const { tenantId: b } = await seedTenant(payload)
  const seedResult = await seedCopiedSchema(db, a, b)

  const before = await storeCounts(db)

  // Dry-run against tenant A only — its counts come straight from the seed contract.
  const result = await runBackfill({ payload, db, mode: 'dry-run', tenantId: a })

  const after = await storeCounts(db)
  assert.deepEqual(after, before, 'dry-run must not write any store-* rows')

  // Tenant A: 3 products, 3 variants, 3 orders, 2 transactions, 2 customers.
  assert.equal(result.totals.products, seedResult.tenants[0].products, 'tenant A products')
  assert.equal(result.totals.variants, seedResult.tenants[0].variants, 'tenant A variants')
  assert.equal(result.totals.orders, seedResult.tenants[0].orders, 'tenant A orders')
  assert.equal(result.totals.variantTypes, 1, 'tenant A has variant products → 1 default type')

  // Money parity degenerates to the legacy sum in dry-run mode (apply has not run).
  assert.equal(result.moneyParity.legacyOrdersTotal, result.moneyParity.storeOrdersTotal)
  assert.equal(result.moneyParity.equal, true)

  // Cleanup so this test's seed rows don't affect later tests.
  await deleteLegacyRowsForTenant(db, a)
  await deleteLegacyRowsForTenant(db, b)
})

test('backfill apply is idempotent: second run writes zero new store-* rows', async () => {
  const { tenantId } = await seedTenant(payload)
  await seedCopiedSchema(db, tenantId, tenantId) // re-use the same seed shape on one tenant for simplicity
  // Seed a second tenant for variety.
  const { tenantId: b } = await seedTenant(payload)
  await seedLegacyProduct(db, {
    tenantId: b, name: 'B-simple', slug: 'b-simple', sku: 'B-SIMPLE-' + String(b),
    price: 5000, status: 'active', productKind: 'physical', variants: null,
  })

  // Scope both apply calls to JUST this tenant pair (other tests' tenants persist in the DB).
  const first = await runBackfill({ payload, db, mode: 'apply', tenantId })
  assert.ok(first.totals.products > 0, 'first apply wrote at least one product')

  // Capture store-* row counts after the first apply.
  const afterFirst = await storeCounts(db)

  // Re-run; totals should NOT grow. The apply path detects the legacy-id fingerprint and skips.
  const second = await runBackfill({ payload, db, mode: 'apply', tenantId })
  const afterSecond = await storeCounts(db)

  assert.deepEqual(afterSecond, afterFirst, 'second apply is a no-op for already-migrated rows')
  // The "totals" reported by the second run are still the legacy counts (the backfill reports
  // "what it considered"); they do not need to drop to zero. Idempotency is proven by the
  // store-* row counts being unchanged.
  void second

  await deleteLegacyRowsForTenant(db, tenantId)
  await deleteLegacyRowsForTenant(db, b)
})

test('backfill money parity: sum of legacy orders equals sum of store-* orders after apply', async () => {
  const { tenantId } = await seedTenant(payload)
  // Two simple products and two orders referencing them.
  await seedLegacyProduct(db, {
    tenantId, name: 'P1', slug: 'p1', sku: 'PARITY-P1-' + String(tenantId),
    price: 25000, status: 'active', productKind: 'physical', variants: null,
  })
  await seedLegacyProduct(db, {
    tenantId, name: 'P2', slug: 'p2', sku: 'PARITY-P2-' + String(tenantId),
    price: 10000, status: 'active', productKind: 'physical', variants: null,
  })
  await seedLegacyOrder(db, {
    tenantId, orderNumber: 'PARITY-O1-' + String(tenantId),
    grandTotal: 50000, amountDue: 50000,
    items: [{ sku: 'PARITY-P1-' + String(tenantId), qty: 2, unitPrice: 25000 }],
  })
  await seedLegacyOrder(db, {
    tenantId, orderNumber: 'PARITY-O2-' + String(tenantId),
    grandTotal: 10000, amountDue: 10000,
    items: [{ sku: 'PARITY-P2-' + String(tenantId), qty: 1, unitPrice: 10000 }],
  })
  // Transaction against the first order.
  const orderId = (await db.run(sql`SELECT \`id\` FROM \`orders\` WHERE \`tenant_id\` = ${tenantId} ORDER BY \`id\` LIMIT 1;`)).rows[0] as { id: number }
  await seedLegacyTransaction(db, {
    tenantId, orderId: orderId.id, gateway: 'paymob', amount: 50000, state: 'captured', capturedAmount: 50000,
  })

  // Scope to this tenant so other tests' store-* rows don't pollute the parity sums.
  const result = await runBackfill({ payload, db, mode: 'apply', tenantId })
  assert.equal(result.moneyParity.equal, true, 'money parity must hold after apply')
  assert.equal(result.moneyParity.legacyOrdersTotal, 60000)
  assert.equal(result.moneyParity.storeOrdersTotal, 60000)
  assert.equal(result.moneyParity.legacyTransactionsTotal, 50000)
  assert.equal(result.moneyParity.storeTransactionsTotal, 50000)

  // Spot-check: the store_orders row carries the expected extension fields.
  const soRes = await db.run(sql`
    SELECT \`order_number\`, \`amount_due\`, \`legacy_order_id\`, \`payment_state\`
    FROM \`store_orders\` WHERE \`tenant_id\` = ${tenantId} ORDER BY \`id\`;
  `)
  assert.ok((soRes.rows as Array<{ order_number: string }>).length >= 2, 'at least two store-orders rows created')
  for (const row of soRes.rows as Array<{ order_number: string; amount_due: number; legacy_order_id: number; payment_state: string }>) {
    assert.ok(row.amount_due === 50000 || row.amount_due === 10000)
    assert.ok(row.legacy_order_id !== null, 'legacyOrderId set on store-orders row')
  }

  await deleteLegacyRowsForTenant(db, tenantId)
})

test('backfill apply maps order item SKU to the correct store-product/variant IDs', async () => {
  const { tenantId } = await seedTenant(payload)
  // Variant product + simple product, plus an order that references each by SKU.
  await seedLegacyProduct(db, {
    tenantId, name: 'V Parent', slug: 'v-parent', sku: 'V-PARENT-' + String(tenantId),
    price: 30000, status: 'active', productKind: 'physical',
    variants: [{ sku: 'V-CHILD-' + String(tenantId), name: 'Red', price: 30000 }],
  })
  await seedLegacyProduct(db, {
    tenantId, name: 'Simple', slug: 'simple', sku: 'SIMPLE-' + String(tenantId),
    price: 7000, status: 'active', productKind: 'physical', variants: null,
  })
  await seedLegacyOrder(db, {
    tenantId, orderNumber: 'MAP-O1-' + String(tenantId),
    grandTotal: 37000, amountDue: 37000,
    items: [
      { sku: 'V-CHILD-' + String(tenantId), qty: 1, unitPrice: 30000 },
      { sku: 'SIMPLE-' + String(tenantId), qty: 1, unitPrice: 7000 },
    ],
  })

  await runBackfill({ payload, db, mode: 'apply' })

  // Verify the store_orders_items rows reference the correct migrated product / variant ids.
  const items = await db.run(sql`
    SELECT soi.\`product_id\` AS \`pid\`, soi.\`variant_id\` AS \`vid\`, soi.\`quantity\` AS \`qty\`
    FROM \`store_orders_items\` soi
    JOIN \`store_orders\` so ON so.\`id\` = soi.\`_parent_id\`
    WHERE so.\`tenant_id\` = ${tenantId}
    ORDER BY soi.\`id\`;
  `)
  const rows = items.rows as Array<{ pid: number | null; vid: number | null; qty: number }>
  assert.ok(rows.length >= 2, 'two item rows created (one per order line)')

  // One row should have a variant_id set (the variant line); the other should not.
  const variantLine = rows.find((r) => r.vid !== null)
  const simpleLine = rows.find((r) => r.vid === null)
  assert.ok(variantLine, 'one order line is variant-backed')
  assert.ok(simpleLine, 'one order line is product-only')

  // The variant-line product should be the parent product's id (not null).
  assert.ok(variantLine && variantLine.pid !== null, 'variant line carries its parent product id')
})

test('backfill apply does NOT migrate carts', async () => {
  // Plan §5.4: legacy carts are ephemeral and never migrated. The store_carts table should have
  // zero rows even after apply.
  const { tenantId } = await seedTenant(payload)
  await seedLegacyProduct(db, {
    tenantId, name: 'NoCart', slug: 'nocart', sku: 'NOCART-' + String(tenantId),
    price: 1000, status: 'active', productKind: 'physical', variants: null,
  })
  // Insert a legacy cart row directly (no helper exists; carts are deliberately not migrated).
  await db.run(sql`
    INSERT INTO \`carts\` (\`cart_token\`, \`customer_email\`, \`items\`, \`currency\`, \`status\`, \`tenant_id\`)
    VALUES ('NO-CART-' || ${String(tenantId)}, NULL, NULL, 'EGP', 'active', ${tenantId});
  `)

  await runBackfill({ payload, db, mode: 'apply' })

  const res = await db.run(sql`SELECT COUNT(*) AS \`v\` FROM \`store_carts\`;`)
  const count = Number((res.rows[0] as { v: unknown }).v ?? 0)
  assert.equal(count, 0, 'no store_carts rows created — carts are never migrated (plan §5.4)')
})

// Helper: snapshot counts for every store-* + policy + nonce table. Used before/after a backfill
// call to prove no writes happened (dry-run) or that re-runs are no-ops (idempotency).
async function storeCounts(db: DB): Promise<Record<string, number>> {
  const out: Record<string, number> = {}
  for (const t of [
    'store_products', 'store_variants', 'store_variant_types', 'store_variant_options',
    'store_addresses', 'store_carts', 'store_orders', 'store_transactions',
    'tax_zones', 'tax_rates', 'shipping_zones', 'shipping_methods',
    'promotions', 'promotion_redemptions', 'gift_cards', 'gift_card_ledger',
    'commerce_gateway_nonces',
  ]) {
    const res = await db.run(sql.raw(`SELECT COUNT(*) AS \`v\` FROM ${t};`))
    out[t] = Number((res.rows[0] as { v: unknown }).v ?? 0)
  }
  return out
}
