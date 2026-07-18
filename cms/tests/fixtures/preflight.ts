// Pure migration preflight (plan §5.1 / §7 B3).
//
// This module implements the read-only checks from plan §5.1 (steps 3–7) against the LEGACY
// commerce tables (products, orders, transactions, customers) on a Payload SQLite DB. It does not
// write. It is rerunnable. Aborting on failure is the caller's responsibility: the function simply
// returns `{ ok: false, errors }` so the Wave C2 backfill can surface a precise report before any
// cutover writes occur (plan §5.1: "Any failure aborts migration without writes").
//
// B3 deliberately keeps this module under `cms/tests/fixtures/` so it never collides with the
// integration-owned `cms/src/` tree. INTEGRATION-OWNER EDIT (flagged for Wave C2): promote this
// module to `cms/src/commerce/migration/preflight.ts` and re-export from a barrel so the backfill
// task and the release runbook can import it. The signature must stay stable.

import { sql } from '@payloadcms/db-sqlite'
import type { DB } from './legacy-seed'

export type PreflightFailure = { code: string; message: string }

export type TenantCounts = {
  products: number
  variants: number
  orders: number
  transactions: number
  customers: number
  activeReservations: number
  unpaidOrders: number
}

export type PreflightCounts = {
  tenants: Record<string, TenantCounts>
  totals: TenantCounts
}

export type PreflightResult =
  | { ok: true; counts: PreflightCounts; failures: [] }
  | { ok: false; code: 'PREFLIGHT_FAILED'; counts: PreflightCounts; failures: PreflightFailure[] }

// Money columns (per legacy table) the preflight must verify are safe integers. Mirrors the column
// lists in the legacy migrations (products 100300, orders 100200 + 100000-order-scoped, transactions
// 100200). `tax_bps` and `quantity`-style numeric columns are NOT money and are intentionally
// excluded — the plan only constrains money fields.
const MONEY_COLUMNS: Record<'products' | 'orders' | 'transactions', string[]> = {
  products: ['price', 'compare_at_price'],
  orders: [
    'subtotal', 'total_discount', 'shipping_price', 'total_tax',
    'grand_total', 'gift_card_applied', 'amount_due',
  ],
  transactions: ['amount', 'captured_amount', 'refunded_amount'],
}

// Payment states that count as "unpaid" for the active-reservation / unpaid-order report (plan §5.1.2).
// `pending` (no funds moved) and `failed` (funds rejected) are clearly unpaid. `authorized` is
// unsettled — the order is still owed money — so it is included.
const UNPAID_PAYMENT_STATES = ['pending', 'authorized', 'failed'] as const

// Run every preflight check. Returns the full list of failures; never throws on bad data.
//
// Step 8 of §5.1 ("Phase 1 tests pass at e07850c") is a CI/release gate, not a runtime check on the
// target DB, so this function does not attempt it. The release runbook must run it independently.
export async function runPreflight(db: DB): Promise<PreflightResult> {
  const failures: PreflightFailure[] = []

  const [skuFailures, orphanTxnFailures, digitalFailures, dupSkuFailures, moneyFailures] = await Promise.all([
    checkOrderItemSkusResolve(db),
    checkTransactionsHaveOrder(db),
    checkNoPublishedDigitalProduct(db),
    checkNoDuplicateSkuWithinTenant(db),
    checkMoneyColumnsAreIntegers(db),
  ])
  failures.push(...skuFailures, ...orphanTxnFailures, ...digitalFailures, ...dupSkuFailures, ...moneyFailures)

  const counts = await computeCounts(db)

  if (failures.length === 0) {
    return { ok: true, counts, failures: [] }
  }
  return { ok: false, code: 'PREFLIGHT_FAILED', counts, failures }
}

// §5.1.3 — every order item SKU resolves to exactly one legacy product/variant in its tenant.
//
// For each order, parse items JSON; for each item.sku, count matches across (a) products with a
// matching product-level SKU and (b) products whose variants[] JSON contains a variant with that
// SKU. Sum must equal 1. Zero (no match) or >1 (ambiguous) is a failure.
type OrderItem = { sku?: unknown; qty?: unknown; unitPrice?: unknown; name?: unknown }
type Variant = { sku?: unknown; name?: unknown; price?: unknown; compareAtPrice?: unknown; taxBps?: unknown }

type ResolvedProduct = {
  id: number
  tenantId: number | string
  sku: string | null
  variants: Variant[] | null
}

async function loadProducts(db: DB): Promise<ResolvedProduct[]> {
  const res = await db.run(
    sql`SELECT \`id\`, \`tenant_id\`, \`sku\`, \`variants\` FROM \`products\`;`,
  )
  const rows = res.rows as Array<{ id: number; tenant_id: number; sku: string | null; variants: string | null }>
  return rows.map((row) => ({
    id: Number(row.id),
    tenantId: row.tenant_id,
    sku: row.sku,
    variants: parseJson<Variant[]>(row.variants),
  }))
}

function parseJson<T>(value: string | null | undefined): T | null {
  if (!value) return null
  try { return JSON.parse(value) as T } catch { return null }
}

async function checkOrderItemSkusResolve(db: DB): Promise<PreflightFailure[]> {
  const failures: PreflightFailure[] = []
  const products = await loadProducts(db)
  const orders = await db.run(
    sql`SELECT \`id\`, \`tenant_id\`, \`order_number\`, \`items\` FROM \`orders\`;`,
  )
  for (const row of orders.rows as Array<{ id: number; tenant_id: number; order_number: string; items: string | null }>) {
    const items = parseJson<OrderItem[]>(row.items)
    if (!Array.isArray(items)) continue // null/empty items → nothing to resolve
    for (const item of items) {
      const sku = item.sku
      if (typeof sku !== 'string' || sku.length === 0) {
        failures.push({ code: 'ORDER_ITEM_SKU_MISSING', message: `order ${row.order_number} (id=${row.id}, tenant=${row.tenant_id}) has an item without a string sku` })
        continue
      }
      const matches = countSkuMatchesInTenant(products, row.tenant_id, sku)
      if (matches === 0) {
        failures.push({ code: 'ORDER_ITEM_SKU_UNRESOLVED', message: `order ${row.order_number} (id=${row.id}, tenant=${row.tenant_id}) item sku '${sku}' resolves to zero legacy products/variants in its tenant` })
      } else if (matches > 1) {
        failures.push({ code: 'ORDER_ITEM_SKU_AMBIGUOUS', message: `order ${row.order_number} (id=${row.id}, tenant=${row.tenant_id}) item sku '${sku}' resolves to ${matches} legacy products/variants in its tenant (expected exactly 1)` })
      }
    }
  }
  return failures
}

// Count matches for a SKU within a tenant: each product contributes (1 if its product-level sku
// equals the target) + (count of variants whose sku equals the target).
function countSkuMatchesInTenant(products: ResolvedProduct[], tenantId: number | string, sku: string): number {
  let n = 0
  for (const product of products) {
    if (product.tenantId !== Number(tenantId) && product.tenantId !== String(tenantId)) continue
    if (product.sku === sku) n += 1
    if (Array.isArray(product.variants)) {
      for (const v of product.variants) {
        if (v && typeof v === 'object' && v.sku === sku) n += 1
      }
    }
  }
  return n
}

// §5.1.4 — every transaction resolves to exactly one order in its tenant.
async function checkTransactionsHaveOrder(db: DB): Promise<PreflightFailure[]> {
  const failures: PreflightFailure[] = []
  const res = await db.run(sql`
    SELECT t.\`id\` AS \`tid\`, t.\`tenant_id\` AS \`tenant\`, t.\`order_id\` AS \`oid\`
    FROM \`transactions\` t
    LEFT JOIN \`orders\` o ON o.\`id\` = t.\`order_id\` AND o.\`tenant_id\` = t.\`tenant_id\`
    WHERE o.\`id\` IS NULL;
  `)
  for (const row of res.rows as Array<{ tid: number; tenant: number; oid: number | null }>) {
    failures.push({
      code: 'ORPHAN_TRANSACTION',
      message: `transaction id=${row.tid} (tenant=${row.tenant}) references order_id=${row.oid} which does not exist in the same tenant`,
    })
  }
  return failures
}

// §5.1.5 — no published digital product. Legacy `status='active'` means published.
async function checkNoPublishedDigitalProduct(db: DB): Promise<PreflightFailure[]> {
  const failures: PreflightFailure[] = []
  const res = await db.run(sql`
    SELECT \`id\`, \`tenant_id\`, \`sku\`, \`name\` FROM \`products\`
    WHERE \`status\` = 'active' AND \`product_kind\` = 'digital';
  `)
  for (const row of res.rows as Array<{ id: number; tenant_id: number; sku: string; name: string | null }>) {
    failures.push({
      code: 'PUBLISHED_DIGITAL_PRODUCT',
      message: `published digital product id=${row.id} (tenant=${row.tenant_id}, sku='${row.sku}', name='${row.name ?? ''}') blocks cutover (plan §2.3 / §5.1.5)`,
    })
  }
  return failures
}

// §5.1.6 — no duplicate non-null SKU within a tenant. Covers product-level SKUs AND variant SKUs in
// the products.variants JSON (no DB constraint exists for the latter — plan §7 B3 failure case b).
async function checkNoDuplicateSkuWithinTenant(db: DB): Promise<PreflightFailure[]> {
  const failures: PreflightFailure[] = []
  const products = await loadProducts(db)

  // tenant → Map<sku, count>
  const perTenant = new Map<string, Map<string, number>>()
  const incr = (tenantId: number | string, sku: string) => {
    const key = String(tenantId)
    let bucket = perTenant.get(key)
    if (!bucket) { bucket = new Map(); perTenant.set(key, bucket) }
    bucket.set(sku, (bucket.get(sku) ?? 0) + 1)
  }

  for (const product of products) {
    if (product.sku && product.sku.length > 0) incr(product.tenantId, product.sku)
    if (Array.isArray(product.variants)) {
      for (const v of product.variants) {
        if (v && typeof v === 'object' && typeof v.sku === 'string' && v.sku.length > 0) {
          incr(product.tenantId, v.sku)
        }
      }
    }
  }

  for (const [tenantKey, bucket] of perTenant) {
    for (const [sku, count] of bucket) {
      if (count > 1) {
        failures.push({
          code: 'DUPLICATE_SKU',
          message: `tenant=${tenantKey} has ${count} occurrences of sku='${sku}' across product-level and variant-level SKUs (plan §5.1.6)`,
        })
      }
    }
  }
  return failures
}

// §5.1.7 — every money field is a safe integer. SQLite stores numeric columns flexibly (integer,
// float, or text). The migration treats money as integer minor units; any non-integer value would
// silently corrupt accounting. Reject anything Number.isInteger() does not accept.
//
// Three explicit queries (one per table) — no dynamic column interpolation. The column list is
// closed and named in MONEY_COLUMNS, but the SELECT statement embeds the identifiers literally so
// the SQL template tag can parameterize everything else.
async function checkMoneyColumnsAreIntegers(db: DB): Promise<PreflightFailure[]> {
  const failures: PreflightFailure[] = []

  // products
  {
    const rows = await db.run(sql`
      SELECT \`id\`, \`tenant_id\`, \`sku\`, \`price\`, \`compare_at_price\` FROM \`products\`;
    `)
    for (const row of rows.rows as Array<Record<string, unknown>>) {
      for (const col of MONEY_COLUMNS.products) {
        const v = row[col]
        if (v === null || v === undefined) continue // nullable column
        if (!isSafeIntegerMoney(v)) {
          failures.push({ code: 'MONEY_NOT_INTEGER', message: `products id=${row.id} (tenant=${row.tenant_id}, sku='${row.sku}') column '${col}' = ${JSON.stringify(v)} is not an integer minor unit` })
        }
      }
    }
  }

  // orders
  {
    const rows = await db.run(sql`
      SELECT \`id\`, \`tenant_id\`, \`order_number\`, \`subtotal\`, \`total_discount\`, \`shipping_price\`,
             \`total_tax\`, \`grand_total\`, \`gift_card_applied\`, \`amount_due\`
      FROM \`orders\`;
    `)
    for (const row of rows.rows as Array<Record<string, unknown>>) {
      for (const col of MONEY_COLUMNS.orders) {
        const v = row[col]
        if (v === null || v === undefined) continue
        if (!isSafeIntegerMoney(v)) {
          failures.push({ code: 'MONEY_NOT_INTEGER', message: `orders id=${row.id} (tenant=${row.tenant_id}, order_number='${row.order_number}') column '${col}' = ${JSON.stringify(v)} is not an integer minor unit` })
        }
      }
    }
  }

  // transactions
  {
    const rows = await db.run(sql`
      SELECT \`id\`, \`tenant_id\`, \`amount\`, \`captured_amount\`, \`refunded_amount\` FROM \`transactions\`;
    `)
    for (const row of rows.rows as Array<Record<string, unknown>>) {
      for (const col of MONEY_COLUMNS.transactions) {
        const v = row[col]
        if (v === null || v === undefined) continue
        if (!isSafeIntegerMoney(v)) {
          failures.push({ code: 'MONEY_NOT_INTEGER', message: `transactions id=${row.id} (tenant=${row.tenant_id}) column '${col}' = ${JSON.stringify(v)} is not an integer minor unit` })
        }
      }
    }
  }

  return failures
}

// A safe integer money value: either a JS number that Number.isInteger accepts, OR a numeric string
// that parses to an integer (SQLite returns big numbers as strings sometimes). Rejects floats,
// NaN, Infinity, and arbitrary text. Returns false for null/undefined (caller handles nullables).
function isSafeIntegerMoney(v: unknown): boolean {
  if (typeof v === 'number') return Number.isInteger(v) && Number.isFinite(v)
  if (typeof v === 'string') {
    // must be all-digit with optional leading sign; no decimal point, no exponent, no text.
    return /^[+-]?\d+$/.test(v.trim())
  }
  // bigint is fine if within safe range; rare for SQLite numeric.
  if (typeof v === 'bigint') return v >= Number.MIN_SAFE_INTEGER && v <= Number.MAX_SAFE_INTEGER
  return false
}

// Compute per-tenant and total counts (plan §5.1.1, §5.1.2). Variant counts are derived from the
// products.variants JSON — the source of truth for "how many variants exist" pre-migration.
async function computeCounts(db: DB): Promise<PreflightCounts> {
  const products = await loadProducts(db)
  const tenants = new Map<string, TenantCounts>()

  const ensureTenant = (tenantId: number | string): TenantCounts => {
    const key = String(tenantId)
    let c = tenants.get(key)
    if (!c) {
      c = { products: 0, variants: 0, orders: 0, transactions: 0, customers: 0, activeReservations: 0, unpaidOrders: 0 }
      tenants.set(key, c)
    }
    return c
  }

  for (const p of products) {
    const c = ensureTenant(p.tenantId)
    c.products += 1
    if (Array.isArray(p.variants)) c.variants += p.variants.length
  }

  const orders = await db.run(sql`SELECT \`tenant_id\`, \`payment_state\` FROM \`orders\`;`)
  for (const row of orders.rows as Array<{ tenant_id: number; payment_state: string | null }>) {
    const c = ensureTenant(row.tenant_id)
    c.orders += 1
    if (row.payment_state && (UNPAID_PAYMENT_STATES as readonly string[]).includes(row.payment_state)) {
      c.unpaidOrders += 1
    }
  }

  const txns = await db.run(sql`SELECT \`tenant_id\` FROM \`transactions\`;`)
  for (const row of txns.rows as Array<{ tenant_id: number }>) {
    ensureTenant(row.tenant_id).transactions += 1
  }

  const customers = await db.run(sql`SELECT \`tenant_id\` FROM \`customers\`;`)
  for (const row of customers.rows as Array<{ tenant_id: number }>) {
    ensureTenant(row.tenant_id).customers += 1
  }

  const reservations = await db.run(sql`SELECT \`tenant_id\` FROM \`stock_reservations\` WHERE \`status\` = 'active';`)
  for (const row of reservations.rows as Array<{ tenant_id: number }>) {
    ensureTenant(row.tenant_id).activeReservations += 1
  }

  const totals: TenantCounts = { products: 0, variants: 0, orders: 0, transactions: 0, customers: 0, activeReservations: 0, unpaidOrders: 0 }
  for (const c of tenants.values()) {
    totals.products += c.products
    totals.variants += c.variants
    totals.orders += c.orders
    totals.transactions += c.transactions
    totals.customers += c.customers
    totals.activeReservations += c.activeReservations
    totals.unpaidOrders += c.unpaidOrders
  }

  const tenantsRecord: Record<string, TenantCounts> = {}
  for (const [k, v] of tenants) tenantsRecord[k] = v
  return { tenants: tenantsRecord, totals }
}

// Exported for tests so the parity assertions can reuse the same integer rule without a second
// implementation drifting from the preflight.
export { isSafeIntegerMoney, MONEY_COLUMNS, UNPAID_PAYMENT_STATES }
