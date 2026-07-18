// Copied-schema fixture (plan §7 B3 / §5.7 "rehearse on a copied-real database").
//
// Seeds a freshly migrated throwaway DB with a small but realistic legacy dataset spanning TWO
// tenants. The data is shaped to exercise every code path the Wave C2 backfill and the Wave F1
// parity tests will touch:
//
//   - products WITHOUT JSON variants (simple product, SKU on the product row);
//   - products WITH JSON variants (SKU on the product row + a variants[] of {sku, ...});
//   - orders across multiple status/payment/fulfillment states;
//   - transactions linked to orders;
//   - customers per tenant.
//
// Every amount is an integer minor unit and every SKU resolves to exactly one legacy product/variant
// in its tenant, so a clean preflight passes on this fixture. The preflight-FAILURE fixtures in
// commerce-migration-fixtures.test.ts layer bad data on top of isolated tenants and clean up after
// themselves so this baseline remains intact.

import { sql } from '@payloadcms/db-sqlite'
import type { DB, LegacyProductInput, LegacyOrderInput } from './legacy-seed'
import {
  seedLegacyProduct,
  seedLegacyOrder,
  seedLegacyTransaction,
  seedLegacyCustomer,
} from './legacy-seed'

export type TenantCounts = {
  tenantId: number | string
  products: number
  variants: number
  orders: number
  transactions: number
  customers: number
}

export type CopiedSchemaSeedResult = {
  tenants: [TenantCounts, TenantCounts]
}

// The deterministic seed. Idempotent across runs only because each caller spins up a fresh DB; if
// invoked twice on the same DB it would insert duplicates (just like a real legacy snapshot).
//
// Returns the expected per-tenant counts so tests can assert without hard-coding.
export async function seedCopiedSchema(
  db: DB,
  tenantA: number | string,
  tenantB: number | string,
): Promise<CopiedSchemaSeedResult> {
  // -------------------- Tenant A: full mix --------------------
  // Simple physical product (no variants).
  await seedLegacyProduct(db, {
    tenantId: tenantA,
    name: 'A - Cotton T-Shirt',
    slug: 'a-cotton-t-shirt',
    sku: 'A-TEE-001',
    description: 'Plain cotton tee',
    price: 25000, // 250.00 EGP
    compareAtPrice: 30000,
    taxClass: 'standard',
    taxBps: 1400,
    status: 'active',
    productKind: 'physical',
    trackInventory: true,
    images: [],
    variants: null,
  })

  // Variant product (product-level SKU + variants[] JSON). The legacy schema allows both; the
  // Wave C2 backfill will null the product-level SKU when variants exist (plan §5.2.7).
  await seedLegacyProduct(db, {
    tenantId: tenantA,
    name: 'A - Lab Coat',
    slug: 'a-lab-coat',
    sku: 'A-COAT-VAR', // legacy uses a placeholder SKU; backfill migrates variants to their own SKUs
    description: 'Hospital lab coat, multiple sizes',
    price: 75000,
    taxClass: 'standard',
    taxBps: 1400,
    status: 'active',
    productKind: 'physical',
    trackInventory: true,
    images: [],
    variants: [
      { sku: 'A-COAT-S', name: 'Small', price: 75000 },
      { sku: 'A-COAT-M', name: 'Medium', price: 78000 },
      { sku: 'A-COAT-L', name: 'Large', price: 78000, compareAtPrice: 82000 },
    ],
  })

  // Draft (unpublished) product — backfill must still migrate it as a draft.
  await seedLegacyProduct(db, {
    tenantId: tenantA,
    name: 'A - Service Coupon (draft)',
    sku: 'A-SVC-DRAFT',
    price: 5000,
    taxClass: 'standard',
    taxBps: 1400,
    status: 'draft',
    productKind: 'service',
    trackInventory: false,
    variants: null,
  })

  // Customers in tenant A.
  const cA1 = await seedLegacyCustomer(db, {
    tenantId: tenantA,
    email: 'adyer@example.test',
    name: 'Aida Dyer',
    phone: '+201000000001',
    passwordHash: 'legacy-hash-A1',
    passwordSalt: 'legacy-salt-A1',
    verified: true,
    status: 'active',
  })
  await seedLegacyCustomer(db, {
    tenantId: tenantA,
    email: 'a.plus+customer@example.test',
    name: 'Avery Plus',
    phone: '+201000000002',
    verified: false,
    status: 'active',
  })
  // Suppress unused-var lint for the captured ids — these are returned via counts below.
  void cA1

  // Orders across several states in tenant A. SKUs all resolve to one product/variant in this tenant.
  await seedLegacyOrder(db, orderA(tenantA, 'A-ORD-1001', 'completed', 'captured', 'fulfilled', 103000, [
    { sku: 'A-TEE-001', qty: 2, unitPrice: 25000 },
  ]))
  await seedLegacyOrder(db, orderA(tenantA, 'A-ORD-1002', 'pending', 'pending', 'unfulfilled', 78000, [
    { sku: 'A-COAT-M', qty: 1, unitPrice: 78000 },
  ]))
  await seedLegacyOrder(db, orderA(tenantA, 'A-ORD-1003', 'cancelled', 'voided', 'unfulfilled', 156000, [
    { sku: 'A-COAT-L', qty: 2, unitPrice: 78000 },
  ]))

  // One transaction per non-cancelled order in tenant A. (The cancelled order has no transaction.)
  const aOrders = await db.run(
    sql`SELECT \`id\`, \`order_number\` FROM \`orders\` WHERE \`tenant_id\` = ${tenantA} ORDER BY \`id\`;`,
  )
  const aOrderRows = aOrders.rows as Array<{ id: number; order_number: string }>
  for (const row of aOrderRows) {
    if (row.order_number === 'A-ORD-1003') continue // cancelled — no transaction
    await seedLegacyTransaction(db, {
      tenantId: tenantA,
      orderId: row.id,
      gateway: 'paymob',
      providerTransactionId: `paymob-${row.order_number}`,
      amount: 78000, // intentionally one of the order totals — parity assertions don't require sum-match
      state: row.order_number === 'A-ORD-1001' ? 'captured' : 'pending',
      capturedAmount: row.order_number === 'A-ORD-1001' ? 78000 : 0,
      refundedAmount: 0,
    })
  }

  // -------------------- Tenant B: smaller mix --------------------
  await seedLegacyProduct(db, {
    tenantId: tenantB,
    name: 'B - Surgical Mask',
    slug: 'b-surgical-mask',
    sku: 'B-MASK-50',
    description: 'Box of 50 surgical masks',
    price: 15000,
    taxClass: 'standard',
    taxBps: 1400,
    status: 'active',
    productKind: 'physical',
    trackInventory: true,
    images: [],
    variants: null,
  })
  await seedLegacyProduct(db, {
    tenantId: tenantB,
    name: 'B - Digital Health Guide',
    slug: 'b-digital-guide',
    sku: 'B-BOOK-DIGI',
    price: 0,
    taxClass: 'zero',
    taxBps: 0,
    status: 'draft', // DRAFT digital — allowed. Only PUBLISHED digital is a preflight failure.
    productKind: 'digital',
    trackInventory: false,
    variants: null,
  })

  await seedLegacyCustomer(db, {
    tenantId: tenantB,
    email: 'b.buyer@example.test',
    name: 'Bilal Buyer',
    phone: '+202000000001',
    verified: true,
    status: 'active',
  })

  await seedLegacyOrder(db, orderB(tenantB, 'B-ORD-2001', 'confirmed', 'authorized', 'unfulfilled', 30000, [
    { sku: 'B-MASK-50', qty: 2, unitPrice: 15000 },
  ]))

  // One transaction against B-ORD-2001.
  const bOrderRow = await db.run(
    sql`SELECT \`id\` FROM \`orders\` WHERE \`tenant_id\` = ${tenantB} AND \`order_number\` = 'B-ORD-2001' LIMIT 1;`,
  )
  const bOrderId = (bOrderRow.rows[0] as { id: number } | undefined)?.id
  if (bOrderId === undefined) throw new Error('seedCopiedSchema: B-ORD-2001 not inserted')
  await seedLegacyTransaction(db, {
    tenantId: tenantB,
    orderId: bOrderId,
    gateway: 'kashier',
    providerTransactionId: 'kashier-B-ORD-2001',
    amount: 30000,
    state: 'authorized',
    capturedAmount: 0,
    refundedAmount: 0,
  })

  return {
    tenants: [
      { tenantId: tenantA, products: 3, variants: 3, orders: 3, transactions: 2, customers: 2 },
      { tenantId: tenantB, products: 2, variants: 0, orders: 1, transactions: 1, customers: 1 },
    ],
  }
}

// Helper: build a tenant-A order input with sensible defaults so the test reads cleanly.
function orderA(
  tenantId: number | string,
  orderNumber: string,
  status: string,
  paymentState: string,
  fulfillmentState: string,
  grandTotal: number,
  items: NonNullable<LegacyOrderInput['items']>,
): LegacyOrderInput {
  return baseOrder(tenantId, orderNumber, status, paymentState, fulfillmentState, grandTotal, items)
}

function orderB(
  tenantId: number | string,
  orderNumber: string,
  status: string,
  paymentState: string,
  fulfillmentState: string,
  grandTotal: number,
  items: NonNullable<LegacyOrderInput['items']>,
): LegacyOrderInput {
  return baseOrder(tenantId, orderNumber, status, paymentState, fulfillmentState, grandTotal, items)
}

function baseOrder(
  tenantId: number | string,
  orderNumber: string,
  status: string,
  paymentState: string,
  fulfillmentState: string,
  grandTotal: number,
  items: NonNullable<LegacyOrderInput['items']>,
): LegacyOrderInput {
  const subtotal = items.reduce((sum, it) => sum + (it.unitPrice ?? 0) * it.qty, 0)
  const totalTax = Math.round(subtotal * 0.14)
  return {
    tenantId,
    orderNumber,
    status,
    paymentState,
    fulfillmentState,
    currency: 'EGP',
    subtotal,
    totalDiscount: 0,
    shippingPrice: 0,
    totalTax,
    grandTotal,
    giftCardApplied: 0,
    amountDue: grandTotal,
    quoteHash: `quote-${orderNumber}`,
    quoteSnapshot: { subtotal, totalTax, grandTotal, items },
    items,
    shippingAddress: { country: 'EG' },
    billingAddress: { country: 'EG' },
    placedAt: new Date().toISOString(),
  }
}

// Re-export inputs so callers don't need a second import for shaping.
export type { LegacyProductInput, LegacyOrderInput }
