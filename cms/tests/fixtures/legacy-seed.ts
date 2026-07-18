// Legacy commerce seed builders for the plugin-first migration fixtures (plan §7 B3).
//
// These helpers insert RAW rows into the legacy commerce tables (products / orders / transactions /
// customers) exactly as the Wave C2 backfill will read them. They bypass Payload's create operation
// on purpose: the migration reads bytes from disk, not documents shaped by today's hooks, so the
// fixtures must control every column (including `tenant_id`, JSON shapes, and money values) directly.
//
// Each builder accepts the drizzle-like `db` handle exposed by `payload.db.drizzle` (the same handle
// Payload passes into migrations as `db`) and returns the inserted row id.
//
// B3 owns these. Do NOT edit `cms/tests/helpers/commerce.ts` (shared live-test fixtures).

import { sql } from '@payloadcms/db-sqlite'

export type DB = { run: (q: unknown) => Promise<{ rows: unknown[] }> }

// Variant stored inside products.variants JSON. Mirrors the legacy schema
// (cms/src/migrations/20260717_100500): { sku, name, price, compareAtPrice?, taxBps? }.
export type LegacyVariantInput = {
  sku: string
  name?: string
  price?: number
  compareAtPrice?: number | null
  taxBps?: number | null
}

export type LegacyProductInput = {
  tenantId: number | string
  sku: string // legacy column is NOT NULL
  name?: string | null
  slug?: string | null
  description?: string | null
  price: number // NOT NULL; integer minor units
  compareAtPrice?: number | null
  taxClass?: string // default 'standard'
  taxBps?: number // default 0 (basis points; not money — kept integer)
  status?: string // 'active' | 'draft' | 'archived'; 'active' = published
  productKind?: string // 'physical' | 'digital' | 'service'
  trackInventory?: boolean // default true
  images?: unknown[] | null // JSON array of media ids
  variants?: LegacyVariantInput[] | null
}

export type LegacyOrderItemInput = {
  sku: string
  qty: number
  unitPrice?: number
  name?: string
}

export type LegacyOrderInput = {
  tenantId: number | string
  orderNumber: string
  cartToken?: string | null
  checkoutKey?: string | null
  checkoutFingerprint?: string | null
  expiresAt?: string | null
  customerEmail?: string | null
  customerPhone?: string | null
  status?: string
  paymentState?: string
  fulfillmentState?: string
  currency?: string
  subtotal?: number
  totalDiscount?: number
  shippingPrice?: number
  totalTax?: number
  grandTotal: number // NOT NULL
  giftCardApplied?: number
  amountDue: number // NOT NULL
  quoteHash?: string | null
  quoteSnapshot?: unknown | null
  items?: LegacyOrderItemInput[] | null
  shippingAddress?: unknown | null
  billingAddress?: unknown | null
  placedAt?: string | null
}

export type LegacyTransactionInput = {
  tenantId: number | string
  orderId: number | string // references orders.id
  gateway?: string // 'paymob' | 'kashier' | 'cod' | 'bank_transfer'
  providerTransactionId?: string | null
  amount: number
  state?: string
  capturedAmount?: number
  refundedAmount?: number
  notes?: string | null
}

export type LegacyCustomerInput = {
  tenantId: number | string
  email: string
  normalizedEmail?: string // default: email.toLowerCase().trim()
  name?: string | null
  phone?: string | null
  passwordHash?: string | null
  passwordSalt?: string | null
  verified?: boolean
  verificationTokenHash?: string | null
  resetTokenHash?: string | null
  status?: string
}

const now = () => new Date().toISOString()

const asJson = (value: unknown): string | null => {
  if (value === null || value === undefined) return null
  return JSON.stringify(value)
}

const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v))

// Insert a legacy product row. Returns the inserted id.
//
// Raw SQL is used (not payload.create) because the migration backfill reads disk bytes and must not
// be Fooled by collection hooks (e.g. the productBeforeChange hook that may re-shape fields). It also
// lets the preflight-failure fixtures inject values Payload would reject (non-integer money, etc.).
export async function seedLegacyProduct(db: DB, input: LegacyProductInput): Promise<number> {
  const img = asJson(input.images ?? null)
  const variants = asJson(input.variants ?? null)
  const result = await db.run(sql`
    INSERT INTO \`products\` (
      \`name\`, \`slug\`, \`sku\`, \`description\`, \`price\`, \`compare_at_price\`,
      \`tax_class\`, \`tax_bps\`, \`status\`, \`product_kind\`, \`track_inventory\`,
      \`images\`, \`variants\`, \`tenant_id\`
    ) VALUES (
      ${input.name ?? null}, ${input.slug ?? null}, ${input.sku}, ${input.description ?? null},
      ${input.price}, ${num(input.compareAtPrice ?? null)},
      ${input.taxClass ?? 'standard'}, ${input.taxBps ?? 0},
      ${input.status ?? 'active'}, ${input.productKind ?? 'physical'},
      ${input.trackInventory === false ? 0 : 1},
      ${img}, ${variants}, ${input.tenantId}
    );
  `)
  const idRow = await db.run(sql`SELECT last_insert_rowid() AS \`v\`;`)
  const id = (idRow.rows[0] as { v?: unknown } | undefined)?.v
  if (id === undefined || id === null) throw new Error('seedLegacyProduct: last_insert_rowid returned nothing')
  return Number(id)
}

// Insert a legacy order row. Returns the inserted id.
export async function seedLegacyOrder(db: DB, input: LegacyOrderInput): Promise<number> {
  const items = asJson(input.items ?? null)
  const snap = asJson(input.quoteSnapshot ?? null)
  const ship = asJson(input.shippingAddress ?? null)
  const bill = asJson(input.billingAddress ?? null)
  await db.run(sql`
    INSERT INTO \`orders\` (
      \`order_number\`, \`cart_token\`, \`checkout_key\`, \`checkout_fingerprint\`, \`expires_at\`,
      \`customer_email\`, \`customer_phone\`,
      \`status\`, \`payment_state\`, \`fulfillment_state\`, \`currency\`,
      \`subtotal\`, \`total_discount\`, \`shipping_price\`, \`total_tax\`,
      \`grand_total\`, \`gift_card_applied\`, \`amount_due\`,
      \`quote_hash\`, \`quote_snapshot\`, \`items\`, \`shipping_address\`, \`billing_address\`,
      \`placed_at\`, \`tenant_id\`
    ) VALUES (
      ${input.orderNumber}, ${input.cartToken ?? null}, ${input.checkoutKey ?? null},
      ${input.checkoutFingerprint ?? null}, ${input.expiresAt ?? null},
      ${input.customerEmail ?? null}, ${input.customerPhone ?? null},
      ${input.status ?? 'pending'}, ${input.paymentState ?? 'pending'},
      ${input.fulfillmentState ?? 'unfulfilled'}, ${input.currency ?? 'EGP'},
      ${num(input.subtotal ?? null)}, ${input.totalDiscount ?? 0},
      ${input.shippingPrice ?? 0}, ${input.totalTax ?? 0},
      ${input.grandTotal}, ${input.giftCardApplied ?? 0}, ${input.amountDue},
      ${input.quoteHash ?? null}, ${snap}, ${items}, ${ship}, ${bill},
      ${input.placedAt ?? null}, ${input.tenantId}
    );
  `)
  const idRow = await db.run(sql`SELECT last_insert_rowid() AS \`v\`;`)
  const id = (idRow.rows[0] as { v?: unknown } | undefined)?.v
  if (id === undefined || id === null) throw new Error('seedLegacyOrder: last_insert_rowid returned nothing')
  return Number(id)
}

// Insert a legacy transaction row. Returns the inserted id.
export async function seedLegacyTransaction(db: DB, input: LegacyTransactionInput): Promise<number> {
  await db.run(sql`
    INSERT INTO \`transactions\` (
      \`order_id\`, \`gateway\`, \`provider_transaction_id\`, \`amount\`, \`state\`,
      \`captured_amount\`, \`refunded_amount\`, \`notes\`, \`tenant_id\`
    ) VALUES (
      ${input.orderId}, ${input.gateway ?? 'paymob'}, ${input.providerTransactionId ?? null},
      ${input.amount}, ${input.state ?? 'pending'},
      ${input.capturedAmount ?? 0}, ${input.refundedAmount ?? 0},
      ${input.notes ?? null}, ${input.tenantId}
    );
  `)
  const idRow = await db.run(sql`SELECT last_insert_rowid() AS \`v\`;`)
  const id = (idRow.rows[0] as { v?: unknown } | undefined)?.v
  if (id === undefined || id === null) throw new Error('seedLegacyTransaction: last_insert_rowid returned nothing')
  return Number(id)
}

// Insert a legacy customer row. Returns the inserted id.
//
// `normalized_email` defaults to a simple lowercase+trim of `email` (the production hook uses a more
// involved normalizer, but for fixtures the simple form is enough — the column just has to be unique
// per tenant, which the test controls by using distinct emails).
export async function seedLegacyCustomer(db: DB, input: LegacyCustomerInput): Promise<number> {
  const normalized = input.normalizedEmail ?? input.email.toLowerCase().trim()
  await db.run(sql`
    INSERT INTO \`customers\` (
      \`email\`, \`normalized_email\`, \`name\`, \`phone\`,
      \`password_hash\`, \`password_salt\`, \`verified\`,
      \`verification_token_hash\`, \`reset_token_hash\`, \`status\`, \`tenant_id\`
    ) VALUES (
      ${input.email}, ${normalized}, ${input.name ?? null}, ${input.phone ?? null},
      ${input.passwordHash ?? null}, ${input.passwordSalt ?? null},
      ${input.verified === true ? 1 : 0},
      ${input.verificationTokenHash ?? null}, ${input.resetTokenHash ?? null},
      ${input.status ?? 'active'}, ${input.tenantId}
    );
  `)
  const idRow = await db.run(sql`SELECT last_insert_rowid() AS \`v\`;`)
  const id = (idRow.rows[0] as { v?: unknown } | undefined)?.v
  if (id === undefined || id === null) throw new Error('seedLegacyCustomer: last_insert_rowid returned nothing')
  return Number(id)
}

// Test-only helper: delete every legacy commerce row for a tenant. Used by the preflight-failure
// fixtures so each test can clean up its polluting rows and keep the shared DB usable for later
// tests in the same file.
export async function deleteLegacyRowsForTenant(db: DB, tenantId: number | string): Promise<void> {
  await db.run(sql`DELETE FROM \`transactions\` WHERE \`tenant_id\` = ${tenantId};`)
  await db.run(sql`DELETE FROM \`orders\` WHERE \`tenant_id\` = ${tenantId};`)
  await db.run(sql`DELETE FROM \`products\` WHERE \`tenant_id\` = ${tenantId};`)
  await db.run(sql`DELETE FROM \`customers\` WHERE \`tenant_id\` = ${tenantId};`)
  await db.run(sql`DELETE FROM \`carts\` WHERE \`tenant_id\` = ${tenantId};`)
}

export { now, asJson }
