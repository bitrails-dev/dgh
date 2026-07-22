// Migration backfill (Plan §5.2–§5.6) — promotes legacy commerce rows into plugin `store-*`
// collections. Idempotent, side-by-side, and rerunnable without duplicates.
//
// Idempotency strategy: every legacy row is fingerprinted with a stable legacy-* extension field
// on its destination `store-*` row. The backfill queries by that fingerprint first; if a migrated
// row already exists, it skips. Re-running on the same DB is a no-op for already-migrated rows.
//
// Modes:
//   - 'dry-run': read legacy data, compute the migration plan, return per-tenant counts + money
//     parity, perform NO writes. Used for rehearsal on a copied-real DB (§5.7.2).
//   - 'apply'  : perform the writes via Payload Local API (so plugin + multi-tenant hooks fire).
//     Still idempotent — already-migrated rows are detected and skipped.
//
// Plan contracts honored:
//   §5.2.6–§5.2.8 — no-variant products copy SKU onto store-products; variant products null the
//     product-level SKU and create one store-variants row per legacy JSON variant.
//   §5.2.9       — variant types/options are created/reused deterministically by normalized
//     label/value. We use one synthetic "Default" variant-type per tenant and one option per
//     distinct variant name (the legacy schema has no explicit type taxonomy).
//   §5.3         — customers: derive `<tenantId>:<normalizedEmail>` username; copy identity +
//     profile; NO password hash copied (Payload's auth strategy owns hashing); mark
//     reset-required via the dedicated `resetPasswordToken` field (treated as "must reset on next
//     login" by the customer-auth wrapper).
//   §5.4         — carts: NOT migrated. Caller must expire legacy cart cookies at cutover.
//   §5.5         — orders: preserve number/timestamps/status/paymentState/fulfillment/totals;
//     map item SKUs to migrated product/variant IDs; link customer by email; set legacyOrderId.
//   §5.6         — transactions: link migrated order, copy amount/currency/status, provider IDs,
//     set legacyTransactionId.
//
// All money values are integer minor units (no conversion needed — the legacy schema already
// stores minor units). All rates are integer basis points.

import { sql } from '@payloadcms/db-sqlite'
import type { Payload } from 'payload'

import type { DB } from './preflight'

// --- legacy shapes (raw rows read out of the legacy tables) -----------------

type LegacyVariant = {
  sku?: string
  name?: string
  price?: number
  compareAtPrice?: number | null
  taxBps?: number | null
}

type LegacyProduct = {
  id: number
  tenantId: number | string
  name: string | null
  slug: string | null
  description: string | null
  sku: string | null
  price: number
  compareAtPrice: number | null
  taxClass: string | null
  taxBps: number | null
  status: string | null
  productKind: string | null
  trackInventory: number | boolean
  images: string | null // JSON
  variants: LegacyVariant[] | null
}

type LegacyCustomer = {
  id: number
  tenantId: number | string
  email: string
  normalizedEmail: string | null
  name: string | null
  phone: string | null
  status: string | null
}

type LegacyOrderItem = {
  sku?: string
  qty?: number
  unitPrice?: number
  name?: string
}

type LegacyOrder = {
  id: number
  tenantId: number | string
  orderNumber: string
  cartToken: string | null
  customerEmail: string | null
  customerPhone: string | null
  status: string | null
  paymentState: string | null
  fulfillmentState: string | null
  currency: string | null
  subtotal: number | null
  totalDiscount: number | null
  shippingPrice: number | null
  totalTax: number | null
  grandTotal: number
  giftCardApplied: number | null
  amountDue: number
  quoteHash: string | null
  quoteSnapshot: string | null
  items: string | null
  shippingAddress: string | null
  billingAddress: string | null
  placedAt: string | null
  checkoutKey: string | null
  checkoutFingerprint: string | null
  expiresAt: string | null
}

type LegacyTransaction = {
  id: number
  tenantId: number | string
  orderId: number | null
  gateway: string | null
  providerTransactionId: string | null
  amount: number
  state: string | null
  capturedAmount: number | null
  refundedAmount: number | null
}

// --- input/result ----------------------------------------------------------

export type BackfillMode = 'dry-run' | 'apply'

export interface BackfillInput {
  payload: Payload
  db: DB
  mode: BackfillMode
  /** Restrict to a single tenant (string or numeric id). Empty = all tenants. */
  tenantId?: number | string
}

export interface BackfillMoneyParity {
  /** Sum of legacy orders.grand_total across migrated tenants. */
  legacyOrdersTotal: number
  /** Sum of legacy transactions.amount across migrated tenants. */
  legacyTransactionsTotal: number
  /** Sum of store_orders.amount_due for rows with a legacy_order_id (this backfill's output). */
  storeOrdersTotal: number
  /** Sum of store_transactions.amount for rows with a legacy_transaction_id (this backfill's output). */
  storeTransactionsTotal: number
  /** True iff legacy orders sum equals store orders sum AND legacy txns sum equals store txns sum. */
  equal: boolean
}

export interface BackfillResult {
  mode: BackfillMode
  /** Every tenant id (as a string) the backfill considered (legacy rows seen). */
  tenantsSeen: string[]
  /** Per-tenant counts of legacy rows that were planned/created. */
  perTenant: Record<string, {
    legacyProducts: number
    legacyVariants: number
    legacyCustomers: number
    legacyOrders: number
    legacyTransactions: number
    products: number      // store-products planned/created
    variants: number      // store-variants planned/created
    variantTypes: number  // store-variant-types planned/created
    variantOptions: number // store-variant-options planned/created
    customers: number     // store-customers (=customers) planned/created (B2 converted; backfill skips)
    orders: number        // store-orders planned/created
    transactions: number  // store-transactions planned/created
  }>
  totals: {
    products: number
    variants: number
    variantTypes: number
    variantOptions: number
    orders: number
    transactions: number
  }
  moneyParity: BackfillMoneyParity
}

// --- helpers ---------------------------------------------------------------

function parseJson<T>(value: string | null | undefined): T | null {
  if (!value) return null
  try { return JSON.parse(value) as T } catch { return null }
}

function normalizeEmail(email: string): string {
  return email.toLowerCase().trim()
}

function normalizeCode(value: string): string {
  return value.trim().toUpperCase().replace(/\s+/g, '-')
}

// Map legacy `status` (the legacy orders.status free-form string) onto the plugin's OrderStatus enum
// (processing | completed | cancelled | refunded — see @payloadcms/plugin-ecommerce orders
// collection). Plan §3.8: the plugin status is the administrative lifecycle, distinct from the
// retained paymentState/fulfillmentState extension fields, so the mapping is intentionally coarse.
// Unknown values default to 'processing' (the plugin default) rather than rejecting the row — the
// granular state is preserved in paymentState + fulfillmentState.
function mapOrderStatus(legacy: string | null | undefined): 'processing' | 'completed' | 'cancelled' | 'refunded' {
  switch ((legacy ?? '').toLowerCase()) {
    case 'completed': return 'completed'
    case 'cancelled': return 'cancelled'
    case 'refunded': return 'refunded'
    case 'pending':
    case 'confirmed':
    case 'processing':
    default:
      return 'processing'
  }
}

// Map legacy paymentState onto the B1 store-orders.paymentState select options
// (pending | authorized | captured | partially_captured | partially_refunded | refunded | failed
// | cancelled). 'voided' (legacy cancellation term) maps to 'cancelled'; everything else passes
// through if it matches an option, else falls back to 'pending'.
const PAYMENT_STATE_OPTIONS = new Set([
  'pending', 'authorized', 'captured', 'partially_captured', 'partially_refunded',
  'refunded', 'failed', 'cancelled',
])
function mapPaymentState(legacy: string | null | undefined): string {
  if (!legacy) return 'pending'
  const v = String(legacy).toLowerCase()
  if (v === 'voided') return 'cancelled'
  return PAYMENT_STATE_OPTIONS.has(v) ? v : 'pending'
}

// Map legacy fulfillmentState onto the B1 store-orders.fulfillmentState select options
// (unfulfilled | processing | shipped | delivered | cancelled | returned). 'fulfilled' (legacy)
// maps to 'delivered'; 'voided' maps to 'cancelled'; everything else passes through or falls back.
const FULFILLMENT_STATE_OPTIONS = new Set([
  'unfulfilled', 'processing', 'shipped', 'delivered', 'cancelled', 'returned',
])
function mapFulfillmentState(legacy: string | null | undefined): string {
  if (!legacy) return 'unfulfilled'
  const v = String(legacy).toLowerCase()
  if (v === 'fulfilled') return 'delivered'
  if (v === 'voided') return 'cancelled'
  return FULFILLMENT_STATE_OPTIONS.has(v) ? v : 'unfulfilled'
}

// Map legacy transaction.state onto the plugin's transactions.status enum
// (pending | succeeded | failed | cancelled | refunded | expired — the actual values the plugin
// emits; verified via the schema probe).
function mapTransactionStatus(legacy: string | null | undefined): string {
  if (!legacy) return 'pending'
  const v = String(legacy).toLowerCase()
  // Legacy uses 'captured' for success; plugin uses 'succeeded'.
  if (v === 'captured' || v === 'succeeded') return 'succeeded'
  if (v === 'cancelled' || v === 'voided') return 'cancelled'
  if (v === 'failed') return 'failed'
  if (v === 'refunded') return 'refunded'
  if (v === 'expired') return 'expired'
  return 'pending'
}

function asIntArray(v: unknown): number[] {
  if (!Array.isArray(v)) return []
  return v.map((x) => Number(x)).filter((n) => Number.isInteger(n) && n > 0)
}

// Normalize a variant name into a stable option value. Empty names fall back to the SKU.
function normalizeOptionValue(variant: LegacyVariant): string {
  const v = (variant.name ?? '').trim()
  if (v.length > 0) return v
  return (variant.sku ?? '').trim()
}

// --- legacy loaders --------------------------------------------------------

async function loadLegacyProducts(db: DB, tenantId: number | string | undefined): Promise<LegacyProduct[]> {
  const res = tenantId === undefined
    ? await db.run(sql`SELECT \`id\`, \`tenant_id\`, \`name\`, \`slug\`, \`description\`, \`sku\`, \`price\`, \`compare_at_price\`, \`tax_class\`, \`tax_bps\`, \`status\`, \`product_kind\`, \`track_inventory\`, \`images\`, \`variants\` FROM \`products\` ORDER BY \`id\`;`)
    : await db.run(sql`SELECT \`id\`, \`tenant_id\`, \`name\`, \`slug\`, \`description\`, \`sku\`, \`price\`, \`compare_at_price\`, \`tax_class\`, \`tax_bps\`, \`status\`, \`product_kind\`, \`track_inventory\`, \`images\`, \`variants\` FROM \`products\` WHERE \`tenant_id\` = ${tenantId} ORDER BY \`id\`;`)
  return (res.rows as Array<Record<string, unknown>>).map((row) => ({
    id: Number(row.id),
    tenantId: row.tenant_id as number | string,
    name: (row.name as string | null) ?? null,
    slug: (row.slug as string | null) ?? null,
    description: (row.description as string | null) ?? null,
    sku: (row.sku as string | null) ?? null,
    price: Number(row.price),
    compareAtPrice: row.compare_at_price === null || row.compare_at_price === undefined ? null : Number(row.compare_at_price),
    taxClass: (row.tax_class as string | null) ?? null,
    taxBps: row.tax_bps === null || row.tax_bps === undefined ? null : Number(row.tax_bps),
    status: (row.status as string | null) ?? null,
    productKind: (row.product_kind as string | null) ?? null,
    trackInventory: Number(row.track_inventory ?? 1) !== 0,
    images: (row.images as string | null) ?? null,
    variants: parseJson<LegacyVariant[]>(row.variants as string | null),
  }))
}

async function loadLegacyCustomers(db: DB, tenantId: number | string | undefined): Promise<LegacyCustomer[]> {
  const res = tenantId === undefined
    ? await db.run(sql`SELECT \`id\`, \`tenant_id\`, \`email\`, \`normalized_email\`, \`name\`, \`phone\`, \`status\` FROM \`customers\` ORDER BY \`id\`;`)
    : await db.run(sql`SELECT \`id\`, \`tenant_id\`, \`email\`, \`normalized_email\`, \`name\`, \`phone\`, \`status\` FROM \`customers\` WHERE \`tenant_id\` = ${tenantId} ORDER BY \`id\`;`)
  return (res.rows as Array<Record<string, unknown>>).map((row) => ({
    id: Number(row.id),
    tenantId: row.tenant_id as number | string,
    email: String(row.email),
    normalizedEmail: (row.normalized_email as string | null) ?? null,
    name: (row.name as string | null) ?? null,
    phone: (row.phone as string | null) ?? null,
    status: (row.status as string | null) ?? null,
  }))
}

async function loadLegacyOrders(db: DB, tenantId: number | string | undefined): Promise<LegacyOrder[]> {
  const res = tenantId === undefined
    ? await db.run(sql`SELECT \`id\`, \`tenant_id\`, \`order_number\`, \`cart_token\`, \`checkout_key\`, \`checkout_fingerprint\`, \`expires_at\`, \`customer_email\`, \`customer_phone\`, \`status\`, \`payment_state\`, \`fulfillment_state\`, \`currency\`, \`subtotal\`, \`total_discount\`, \`shipping_price\`, \`total_tax\`, \`grand_total\`, \`gift_card_applied\`, \`amount_due\`, \`quote_hash\`, \`quote_snapshot\`, \`items\`, \`shipping_address\`, \`billing_address\`, \`placed_at\` FROM \`orders\` ORDER BY \`id\`;`)
    : await db.run(sql`SELECT \`id\`, \`tenant_id\`, \`order_number\`, \`cart_token\`, \`checkout_key\`, \`checkout_fingerprint\`, \`expires_at\`, \`customer_email\`, \`customer_phone\`, \`status\`, \`payment_state\`, \`fulfillment_state\`, \`currency\`, \`subtotal\`, \`total_discount\`, \`shipping_price\`, \`total_tax\`, \`grand_total\`, \`gift_card_applied\`, \`amount_due\`, \`quote_hash\`, \`quote_snapshot\`, \`items\`, \`shipping_address\`, \`billing_address\`, \`placed_at\` FROM \`orders\` WHERE \`tenant_id\` = ${tenantId} ORDER BY \`id\`;`)
  return (res.rows as Array<Record<string, unknown>>).map((row) => ({
    id: Number(row.id),
    tenantId: row.tenant_id as number | string,
    orderNumber: String(row.order_number),
    cartToken: (row.cart_token as string | null) ?? null,
    checkoutKey: (row.checkout_key as string | null) ?? null,
    checkoutFingerprint: (row.checkout_fingerprint as string | null) ?? null,
    expiresAt: (row.expires_at as string | null) ?? null,
    customerEmail: (row.customer_email as string | null) ?? null,
    customerPhone: (row.customer_phone as string | null) ?? null,
    status: (row.status as string | null) ?? null,
    paymentState: (row.payment_state as string | null) ?? null,
    fulfillmentState: (row.fulfillment_state as string | null) ?? null,
    currency: (row.currency as string | null) ?? null,
    subtotal: row.subtotal === null || row.subtotal === undefined ? null : Number(row.subtotal),
    totalDiscount: row.total_discount === null || row.total_discount === undefined ? null : Number(row.total_discount),
    shippingPrice: row.shipping_price === null || row.shipping_price === undefined ? null : Number(row.shipping_price),
    totalTax: row.total_tax === null || row.total_tax === undefined ? null : Number(row.total_tax),
    grandTotal: Number(row.grand_total),
    giftCardApplied: row.gift_card_applied === null || row.gift_card_applied === undefined ? null : Number(row.gift_card_applied),
    amountDue: Number(row.amount_due),
    quoteHash: (row.quote_hash as string | null) ?? null,
    quoteSnapshot: (row.quote_snapshot as string | null) ?? null,
    items: (row.items as string | null) ?? null,
    shippingAddress: (row.shipping_address as string | null) ?? null,
    billingAddress: (row.billing_address as string | null) ?? null,
    placedAt: (row.placed_at as string | null) ?? null,
  }))
}

async function loadLegacyTransactions(db: DB, tenantId: number | string | undefined): Promise<LegacyTransaction[]> {
  const res = tenantId === undefined
    ? await db.run(sql`SELECT \`id\`, \`tenant_id\`, \`order_id\`, \`gateway\`, \`provider_transaction_id\`, \`amount\`, \`state\`, \`captured_amount\`, \`refunded_amount\` FROM \`transactions\` ORDER BY \`id\`;`)
    : await db.run(sql`SELECT \`id\`, \`tenant_id\`, \`order_id\`, \`gateway\`, \`provider_transaction_id\`, \`amount\`, \`state\`, \`captured_amount\`, \`refunded_amount\` FROM \`transactions\` WHERE \`tenant_id\` = ${tenantId} ORDER BY \`id\`;`)
  return (res.rows as Array<Record<string, unknown>>).map((row) => ({
    id: Number(row.id),
    tenantId: row.tenant_id as number | string,
    orderId: row.order_id === null || row.order_id === undefined ? null : Number(row.order_id),
    gateway: (row.gateway as string | null) ?? null,
    providerTransactionId: (row.provider_transaction_id as string | null) ?? null,
    amount: Number(row.amount),
    state: (row.state as string | null) ?? null,
    capturedAmount: row.captured_amount === null || row.captured_amount === undefined ? null : Number(row.captured_amount),
    refundedAmount: row.refunded_amount === null || row.refunded_amount === undefined ? null : Number(row.refunded_amount),
  }))
}

// --- lookup helpers (post-migration resolvers) -----------------------------

async function findStoreProductByLegacyId(payload: Payload, tenantId: number | string, legacyProductId: number): Promise<string | number | null> {
  const res = await payload.find({
    collection: 'store-products',
    overrideAccess: true,
    where: { and: [{ tenant: { equals: tenantId } }, { legacyProductId: { equals: legacyProductId } }] },
    limit: 1,
  })
  return res.docs.length > 0 ? (res.docs[0] as { id: string | number }).id : null
}

async function findStoreVariantByLegacyKey(payload: Payload, tenantId: number | string, legacyVariantKey: string): Promise<string | number | null> {
  const res = await payload.find({
    collection: 'store-variants',
    overrideAccess: true,
    where: { and: [{ tenant: { equals: tenantId } }, { legacyVariantKey: { equals: legacyVariantKey } }] },
    limit: 1,
  })
  return res.docs.length > 0 ? (res.docs[0] as { id: string | number }).id : null
}

async function findStoreOrderByLegacyId(payload: Payload, tenantId: number | string, legacyOrderId: number): Promise<string | number | null> {
  const res = await payload.find({
    collection: 'store-orders',
    overrideAccess: true,
    where: { and: [{ tenant: { equals: tenantId } }, { legacyOrderId: { equals: legacyOrderId } }] },
    limit: 1,
  })
  return res.docs.length > 0 ? (res.docs[0] as { id: string | number }).id : null
}

async function findStoreTransactionByLegacyId(payload: Payload, tenantId: number | string, legacyTransactionId: number): Promise<string | number | null> {
  const res = await payload.find({
    collection: 'store-transactions',
    overrideAccess: true,
    where: { and: [{ tenant: { equals: tenantId } }, { legacyTransactionId: { equals: legacyTransactionId } }] },
    limit: 1,
  })
  return res.docs.length > 0 ? (res.docs[0] as { id: string | number }).id : null
}

async function findCustomerByUsername(payload: Payload, username: string): Promise<string | number | null> {
  const res = await payload.find({
    collection: 'customers',
    overrideAccess: true,
    where: { username: { equals: username } },
    limit: 1,
  })
  return res.docs.length > 0 ? (res.docs[0] as { id: string | number }).id : null
}

async function findVariantTypeByName(payload: Payload, tenantId: number | string, name: string): Promise<string | number | null> {
  const res = await payload.find({
    collection: 'store-variant-types',
    overrideAccess: true,
    where: { and: [{ tenant: { equals: tenantId } }, { name: { equals: name } }] },
    limit: 1,
  })
  return res.docs.length > 0 ? (res.docs[0] as { id: string | number }).id : null
}

async function findVariantOptionByValue(payload: Payload, tenantId: number | string, variantTypeId: string | number, value: string): Promise<string | number | null> {
  const res = await payload.find({
    collection: 'store-variant-options',
    overrideAccess: true,
    where: { and: [{ tenant: { equals: tenantId } }, { variantType: { equals: variantTypeId } }, { value: { equals: value } }] },
    limit: 1,
  })
  return res.docs.length > 0 ? (res.docs[0] as { id: string | number }).id : null
}

// --- public entry point ----------------------------------------------------

export async function runBackfill(input: BackfillInput): Promise<BackfillResult> {
  const { payload, db, mode } = input
  const tenantId = input.tenantId

  // Load every legacy row in scope (ordered, deterministic).
  const [products, customers, orders, transactions] = await Promise.all([
    loadLegacyProducts(db, tenantId),
    loadLegacyCustomers(db, tenantId),
    loadLegacyOrders(db, tenantId),
    loadLegacyTransactions(db, tenantId),
  ])

  // Aggregate per-tenant.
  const tenantsSeen = new Set<string>()
  for (const p of products) tenantsSeen.add(String(p.tenantId))
  for (const c of customers) tenantsSeen.add(String(c.tenantId))
  for (const o of orders) tenantsSeen.add(String(o.tenantId))
  for (const t of transactions) tenantsSeen.add(String(t.tenantId))

  const perTenant: BackfillResult['perTenant'] = {}
  const ensure = (tid: string) => {
    let bucket = perTenant[tid]
    if (!bucket) {
      bucket = {
        legacyProducts: 0, legacyVariants: 0, legacyCustomers: 0, legacyOrders: 0, legacyTransactions: 0,
        products: 0, variants: 0, variantTypes: 0, variantOptions: 0, customers: 0, orders: 0, transactions: 0,
      }
      perTenant[tid] = bucket
    }
    return bucket
  }

  // Index legacy products by (tenantId, sku) and (tenantId, variantSku) → product/variant, for
  // order-item resolution during order backfill.
  const productByTenantSku = new Map<string, LegacyProduct>()
  const productByTenantVariantSku = new Map<string, { product: LegacyProduct; variant: LegacyVariant }>()
  for (const p of products) {
    const tid = String(p.tenantId)
    if (p.sku) productByTenantSku.set(`${tid}|${p.sku}`, p)
    if (Array.isArray(p.variants)) {
      for (const v of p.variants) {
        if (v && typeof v === 'object' && typeof v.sku === 'string') {
          productByTenantVariantSku.set(`${tid}|${v.sku}`, { product: p, variant: v })
        }
      }
    }
  }

  let totalProducts = 0, totalVariants = 0, totalVariantTypes = 0, totalVariantOptions = 0
  let totalOrders = 0, totalTransactions = 0

  // ----- §5.2 products + variants + variant-types/options -----
  // Determinism: process tenants in sorted order; within a tenant, products in id order.
  const tenantIds = Array.from(tenantsSeen).sort()
  for (const tid of tenantIds) {
    const tenantProducts = products.filter((p) => String(p.tenantId) === tid)
    const bucket = ensure(tid)
    bucket.legacyProducts = tenantProducts.length
    bucket.legacyVariants = tenantProducts.reduce((n, p) => n + (Array.isArray(p.variants) ? p.variants.length : 0), 0)

    if (tenantProducts.length === 0) continue
    const tnum = tenantId !== undefined ? tenantId : tid

    if (mode === 'apply') {
      // Ensure exactly one "Default" variant-type per tenant that has variant products.
      const hasVariants = tenantProducts.some((p) => Array.isArray(p.variants) && p.variants.length > 0)
      let defaultTypeId: string | number | null = null
      if (hasVariants) {
        const typeName = 'Default'
        defaultTypeId = await findVariantTypeByName(payload, tnum, typeName)
        if (!defaultTypeId) {
          const created = await payload.create({
            collection: 'store-variant-types',
            overrideAccess: true,
            data: { tenant: tnum, name: typeName, label: { en: 'Default', ar: 'افتراضي' } } as any,
          })
          defaultTypeId = (created as { id: string | number }).id
        }
      }

      for (const lp of tenantProducts) {
        // Idempotency: skip if already migrated.
        if (await findStoreProductByLegacyId(payload, tnum, lp.id)) continue

        const variants = Array.isArray(lp.variants) ? lp.variants : []
        const hasVar = variants.length > 0
        const slug = lp.slug ?? `product-${lp.id}`
        const status = lp.status === 'active' ? 'published' : 'draft'

        // Product-level SKU: present when the product has NO variants; null when it does (the
        // variant SKU is the inventory key). Plan §5.2.6–§5.2.7.
        const productSku = hasVar ? null : (lp.sku ?? null)

        const productDoc = await payload.create({
          collection: 'store-products',
          overrideAccess: true,
          data: {
            tenant: tnum,
            slug,
            description: lp.description,
            sku: productSku,
            trackInventory: lp.trackInventory !== false,
            taxClass: lp.taxClass ?? 'standard',
            taxBps: lp.taxBps ?? null,
            images: asIntArray(parseJson<unknown[]>(lp.images)),
            legacyProductId: lp.id,
            // Plugin price field for EGP. The plugin stores price as `priceInEGP` (column
            // price_in_e_g_p). camelCase key maps via the slug-derived currency code. The
            // `priceInEGPEnabled` checkbox MUST be set alongside the amount — otherwise the
            // plugin's `admin.condition` hides the price input in the admin UI and the validator's
            // truthiness check on the amount alone passes but the field renders unticked/hidden.
            priceInEGPEnabled: lp.price != null,
            priceInEGP: lp.price,
            // Publish state — the plugin uses `_status`. Draft publishes when status='active'.
            _status: status,
            enableVariants: hasVar,
            variantTypes: hasVar && defaultTypeId ? [defaultTypeId] : [],
          } as any,
        })
        const productId = (productDoc as { id: string | number }).id
        bucket.products += 1
        totalProducts += 1

        if (!hasVar) continue

        for (const lv of variants) {
          if (!lv || typeof lv !== 'object') continue
          const variantSku = typeof lv.sku === 'string' ? lv.sku : null
          if (!variantSku) continue // cannot migrate a variant without an immutable SKU

          // Deterministic option value.
          const optionValue = normalizeOptionValue(lv)
          let optionId = defaultTypeId ? await findVariantOptionByValue(payload, tnum, defaultTypeId, optionValue) : null
          if (!optionId && defaultTypeId) {
            const created = await payload.create({
              collection: 'store-variant-options',
              overrideAccess: true,
              data: {
                tenant: tnum,
                variantType: defaultTypeId,
                label: { en: optionValue, ar: optionValue },
                value: optionValue,
              } as any,
            })
            optionId = (created as { id: string | number }).id
            bucket.variantOptions += 1
            totalVariantOptions += 1
          }

          // Idempotency: skip if variant already migrated by legacyVariantKey.
          const legacyVariantKey = `${lp.id}:${variantSku}`
          if (await findStoreVariantByLegacyKey(payload, tnum, legacyVariantKey)) continue

          const variantDoc = await payload.create({
            collection: 'store-variants',
            overrideAccess: true,
            data: {
              tenant: tnum,
              product: productId,
              sku: variantSku,
              legacyVariantKey,
              title: optionValue,
              // See the product block above: priceInEGPEnabled MUST accompany priceInEGP or the
              // admin UI hides the field and the row looks unpriced.
              priceInEGPEnabled:
                (typeof lv.price === 'number' ? lv.price : lp.price) != null,
              priceInEGP: typeof lv.price === 'number' ? lv.price : lp.price,
              options: optionId ? [optionId] : [],
              _status: status,
            } as any,
          })
          void variantDoc
          bucket.variants += 1
          totalVariants += 1
        }
      }
      if (defaultTypeId) {
        // Count the type as created/planned (deterministic single-per-tenant).
        bucket.variantTypes += 1
        totalVariantTypes += 1
      }
    } else {
      // dry-run: count what would be created.
      const hasVariants = tenantProducts.some((p) => Array.isArray(p.variants) && p.variants.length > 0)
      for (const lp of tenantProducts) {
        bucket.products += 1
        totalProducts += 1
        if (Array.isArray(lp.variants)) {
          bucket.variants += lp.variants.length
          totalVariants += lp.variants.length
          // Distinct option values for this tenant's variants.
          const distinctOptions = new Set<string>()
          for (const lv of lp.variants) distinctOptions.add(normalizeOptionValue(lv))
          bucket.variantOptions += distinctOptions.size
          totalVariantOptions += distinctOptions.size
        }
      }
      if (hasVariants) {
        bucket.variantTypes += 1
        totalVariantTypes += 1
      }
    }
  }

  // ----- §5.3 customers -----
  // The customers collection was converted to Payload auth in Wave B2. The existing rows ARE the
  // migrated rows (the B2 migration rewrote columns in place). The C2 backfill is therefore a
  // NO-OP for customers in apply mode, but it reports counts so the parity report matches §5.7.3.
  // If a customer row lacks the B2-derived username, the apply path fixes it up idempotently.
  for (const lc of customers) {
    const tid = String(lc.tenantId)
    const bucket = ensure(tid)
    bucket.legacyCustomers += 1
    if (mode === 'apply') {
      const username = `${lc.tenantId}:${lc.normalizedEmail ?? normalizeEmail(lc.email)}`
      const existingId = await findCustomerByUsername(payload, username)
      if (existingId) {
        // Already migrated by B2 — nothing to write.
        bucket.customers += 1
        continue
      }
      // Pre-B2 customer that escaped the conversion (rare): create a fresh auth-customer row with
      // NO password hash (Plan §5.3.4 — never copy legacy hashes) and mark reset-required.
      await payload.create({
        collection: 'customers',
        overrideAccess: true,
        data: {
          tenant: lc.tenantId,
          email: lc.email,
          normalizedEmail: lc.normalizedEmail ?? normalizeEmail(lc.email),
          username,
          name: lc.name,
          phone: lc.phone,
          status: lc.status ?? 'active',
          resetPasswordToken: `migrate:${lc.id}`,
          // NO hash/salt — Payload's auth strategy requires a reset before login.
        } as any,
      })
      bucket.customers += 1
    } else {
      bucket.customers += 1
    }
  }

  // ----- §5.5 orders -----
  for (const lo of orders) {
    const tid = String(lo.tenantId)
    const bucket = ensure(tid)
    bucket.legacyOrders += 1

    if (mode === 'apply') {
      if (await findStoreOrderByLegacyId(payload, lo.tenantId, lo.id)) continue
      const tnum = tenantId !== undefined ? tenantId : lo.tenantId

      // Map each item SKU to its migrated product/variant id. The preflight already verified each
      // SKU resolves to exactly one legacy product/variant in this tenant.
      const items = parseJson<LegacyOrderItem[]>(lo.items) ?? []
      const storeItems: Array<{ product: string | number; variant?: string | number; quantity: number }> = []
      for (const it of items) {
        if (!it || typeof it !== 'object') continue
        const sku = typeof it.sku === 'string' ? it.sku : null
        if (!sku) continue
        const qty = typeof it.qty === 'number' && Number.isInteger(it.qty) && it.qty > 0 ? it.qty : 1

        // Look up migrated IDs by resolving the legacy SKU → legacy product/variant → store-* ids.
        const fromVariant = productByTenantVariantSku.get(`${tid}|${sku}`)
        const fromProduct = productByTenantSku.get(`${tid}|${sku}`)
        let productId: string | number | null = null
        let variantId: string | number | null = null
        if (fromVariant) {
          productId = await findStoreProductByLegacyId(payload, tnum, fromVariant.product.id)
          variantId = await findStoreVariantByLegacyKey(payload, tnum, `${fromVariant.product.id}:${sku}`)
        } else if (fromProduct) {
          productId = await findStoreProductByLegacyId(payload, tnum, fromProduct.id)
        }
        if (!productId) continue
        const item: { product: string | number; variant?: string | number; quantity: number } = { product: productId, quantity: qty }
        if (variantId) item.variant = variantId
        storeItems.push(item)
      }

      // Resolve customer by email-derived username.
      let customerId: string | number | null = null
      if (lo.customerEmail) {
        const username = `${lo.tenantId}:${normalizeEmail(lo.customerEmail)}`
        customerId = await findCustomerByUsername(payload, username)
      }

      // Convert legacy shipping/billing address JSON into store-addresses rows (so the
      // store-orders.shippingAddress + billingAddress can point at them). When the legacy snapshot
      // is missing/empty, skip — the order is still migrated with its scalar state.
      const shipAddr = parseJson<{ country?: string }>(lo.shippingAddress)
      let shippingAddressId: string | number | null = null
      if (shipAddr && typeof shipAddr === 'object') {
        const addr = await payload.create({
          collection: 'store-addresses',
          overrideAccess: true,
          data: { tenant: tnum, country: (shipAddr.country ?? 'EG') as string } as any,
        })
        shippingAddressId = (addr as { id: string | number }).id
      }

      await payload.create({
        collection: 'store-orders',
        overrideAccess: true,
        data: {
          tenant: tnum,
          orderNumber: lo.orderNumber,
          checkoutKey: lo.checkoutKey,
          checkoutFingerprint: lo.checkoutFingerprint,
          expiresAt: lo.expiresAt,
          customer: customerId ?? undefined,
          customerEmail: lo.customerEmail,
          customerPhone: lo.customerPhone,
          status: mapOrderStatus(lo.status),
          paymentState: mapPaymentState(lo.paymentState),
          fulfillmentState: mapFulfillmentState(lo.fulfillmentState),
          currency: lo.currency ?? 'EGP',
          subtotal: lo.subtotal ?? 0,
          totalDiscount: lo.totalDiscount ?? 0,
          shippingPrice: lo.shippingPrice ?? 0,
          totalTax: lo.totalTax ?? 0,
          amountDue: lo.amountDue,
          giftCardApplied: lo.giftCardApplied ?? 0,
          quoteHash: lo.quoteHash,
          quoteSnapshot: parseJson<unknown>(lo.quoteSnapshot),
          items: storeItems,
          placedAt: lo.placedAt,
          legacyOrderId: lo.id,
          amount: lo.grandTotal,
          ...(shippingAddressId ? { shippingAddress: shippingAddressId } : {}),
        } as any,
      })
      bucket.orders += 1
      totalOrders += 1
    } else {
      bucket.orders += 1
      totalOrders += 1
    }
  }

  // ----- §5.6 transactions -----
  for (const lt of transactions) {
    const tid = String(lt.tenantId)
    const bucket = ensure(tid)
    bucket.legacyTransactions += 1

    if (mode === 'apply') {
      if (await findStoreTransactionByLegacyId(payload, lt.tenantId, lt.id)) continue
      const tnum = tenantId !== undefined ? tenantId : lt.tenantId

      // Find the migrated order (legacy order id → store-orders.legacyOrderId).
      let orderId: string | number | null = null
      if (lt.orderId !== null) {
        orderId = await findStoreOrderByLegacyId(payload, tnum, lt.orderId)
      }

      await payload.create({
        collection: 'store-transactions',
        overrideAccess: true,
        data: {
          tenant: tnum,
          order: orderId ?? undefined,
          amount: lt.amount,
          currency: 'EGP',
          status: mapTransactionStatus(lt.state),
          providerTransactionId: lt.providerTransactionId,
          providerOrderReference: lt.orderId !== null ? `legacy-${lt.orderId}` : null,
          capturedAmount: lt.capturedAmount ?? 0,
          refundedAmount: lt.refundedAmount ?? 0,
          reconciliationStatus: 'pending',
          legacyTransactionId: lt.id,
        } as any,
      })
      bucket.transactions += 1
      totalTransactions += 1
    } else {
      bucket.transactions += 1
      totalTransactions += 1
    }
  }

  // ----- money parity -----
  // Sum legacy totals and store-* totals for the rows this backfill owns. The two should match
  // exactly (no conversion; just identity copy of integer minor units).
  const legacyOrdersSum = orders.reduce((n, o) => n + o.grandTotal, 0)
  const legacyTxnsSum = transactions.reduce((n, t) => n + t.amount, 0)
  let storeOrdersSum = 0
  let storeTxnsSum = 0
  if (mode === 'apply') {
    // Scope the parity sums to the same tenantId filter the apply path used, so a single-tenant
    // apply does not count other tenants' store-* rows (and fail the parity assertion).
    const soRes = tenantId === undefined
      ? await db.run(sql`SELECT \`amount_due\` AS \`v\` FROM \`store_orders\` WHERE \`legacy_order_id\` IS NOT NULL;`)
      : await db.run(sql`SELECT \`amount_due\` AS \`v\` FROM \`store_orders\` WHERE \`legacy_order_id\` IS NOT NULL AND \`tenant_id\` = ${tenantId};`)
    for (const row of soRes.rows as Array<{ v: unknown }>) {
      if (row.v !== null && row.v !== undefined) storeOrdersSum += Number(row.v)
    }
    const stRes = tenantId === undefined
      ? await db.run(sql`SELECT \`amount\` AS \`v\` FROM \`store_transactions\` WHERE \`legacy_transaction_id\` IS NOT NULL;`)
      : await db.run(sql`SELECT \`amount\` AS \`v\` FROM \`store_transactions\` WHERE \`legacy_transaction_id\` IS NOT NULL AND \`tenant_id\` = ${tenantId};`)
    for (const row of stRes.rows as Array<{ v: unknown }>) {
      if (row.v !== null && row.v !== undefined) storeTxnsSum += Number(row.v)
    }
  } else {
    // dry-run: store-* rows do not exist yet; the parity assertion degenerates to "what the apply
    // step would produce." Reflect the legacy sums so the report's shape is stable across modes.
    storeOrdersSum = legacyOrdersSum
    storeTxnsSum = legacyTxnsSum
  }

  return {
    mode,
    tenantsSeen: Array.from(tenantsSeen),
    perTenant,
    totals: {
      products: totalProducts,
      variants: totalVariants,
      variantTypes: totalVariantTypes,
      variantOptions: totalVariantOptions,
      orders: totalOrders,
      transactions: totalTransactions,
    },
    moneyParity: {
      legacyOrdersTotal: legacyOrdersSum,
      legacyTransactionsTotal: legacyTxnsSum,
      storeOrdersTotal: storeOrdersSum,
      storeTransactionsTotal: storeTxnsSum,
      equal: storeOrdersSum === legacyOrdersSum && storeTxnsSum === legacyTxnsSum,
    },
  }
}
