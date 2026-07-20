// Wave F1 → F2 plugin-cutover coverage (INTEGRATION, DB-backed). Originally a side-by-side parity
// suite that compared the legacy path (quoteItems / upsertCart / placeOrder) against the plugin path
// over the REAL Payload + migrated DB. Wave F2 retired the legacy runtime, so the legacy-comparison
// subtests were dropped (their parity purpose was recorded in commit baa540f). What remains is the
// PERMANENT plugin-path protection this file always carried:
//
//   - Variant-in-cart: a self-contained plugin variant-type/options/variant seed → cart → quote →
//              checkout, so variant coverage is not lost (the E3 cart suite covers simple products
//              only). Carries the plugin-totals assertions (subtotal / grandTotal).
//   - Plugin cart ops: update merges, remove drops, clear empties (line shapes + totals stable).
//   - Negative: after every plugin op (cart add/update/remove/clear, processCheckout cod+online,
//              the signed orders list/read), assert NO legacy products/carts/orders/transactions
//              doc was written — the contract that let F2 remove legacy.
//
// All money is integer EGP minor units. Nothing is removed here; this is read-only protection over
// the plugin-first runtime.

import assert from 'node:assert/strict'
import { rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import type { Payload } from 'payload'

const TEMP_DB = join(tmpdir(), `commerce-cutover-parity-itest-${process.pid}-${Date.now()}.db`)
process.env.DATABASE_URI = `file:${TEMP_DB}`
process.env.PAYLOAD_SECRET = process.env.PAYLOAD_SECRET || 'commerce-cutover-parity-itest-secret'

const { default: config } = await import('../src/payload.config')
const { getPayload } = await import('payload')
const { seedTenant, seedLocation, seedLevel } = await import('./helpers/commerce')
const payload = (await getPayload({ config })) as unknown as Payload
await payload.db.migrate()

const { quoteStoreCart } = await import('../src/commerce/store/quote-plugin')
const { pluginAddItem, pluginUpdateItem, pluginRemoveItem, pluginClearCart, readPluginCart } =
  await import('../src/commerce/store/cart-v2')
const { processCheckout } = await import('../src/commerce/checkout/process')
const { listOrders, readOrder } = await import('../src/commerce/store/orders')
const { getLevel } = await import('../src/commerce/inventory')
import type { PaymentAdapter } from '../src/commerce/payments/types'
import type { AdapterBuilder } from '../src/commerce/payments/adapters/registry'

// Fake gateway adapter (no network) — mirrors commerce-store-checkout-plugin's fakeBuilder.
const fakeBuilder: AdapterBuilder = () =>
  ({
    provider: 'paymob',
    capabilities: () => ({
      hostedCheckout: true, authorization: true, refunds: true, partialRefunds: true,
      voiding: true, recurring: false, webhookSignature: 'hmac',
    }),
    createHostedCheckout: async () => ({ checkoutUrl: 'https://paymob.example/iframes/1?t=1', providerSessionId: 'po-parity' }),
    refund: async () => ({ ok: true }),
    verifyWebhook: async () => ({ accepted: false, reason: 'no_verifying_in_parity_test' }),
    lookup: async () => ({ state: 'pending' }),
  }) as PaymentAdapter

let tenantId: number | string
let locationId: number | string

// ── seeding helpers ───────────────────────────────────────────────────────────────────────────

async function seedSettings(tid: number | string, taxMode: 'inclusive' | 'exclusive'): Promise<void> {
  await payload.create({
    collection: 'commerce-settings', overrideAccess: true,
    data: {
      tenant: tid, status: 'live', currency: 'EGP', taxMode, sandbox: true,
      paymob: { enabled: true, apiKey: 'k', hmacSecret: 'h', iframeId: '1', integrationId: '2' },
    } as any,
  })
}

// Seed a plugin store-product at `priceMinor` integer EGP minor units. (The legacy `products` mirror
// the original parity suite seeded is gone — the legacy runtime is retired.)
async function seedStoreProduct(tid: number | string, sku: string, priceMinor: number): Promise<void> {
  await payload.create({
    collection: 'store-products', overrideAccess: true,
    data: { tenant: tid, slug: `slug-${sku.toLowerCase()}`, sku, priceInEGPEnabled: true, priceInEGP: priceMinor, taxClass: 'standard', trackInventory: true } as any,
  })
}

// Seed the full plugin variant shape: a variant-type, an option, a variant-bearing parent product,
// and a priced variant. Returns the variant SKU + ids so a cart line + stock level can reference them.
async function seedVariantSet(tid: number | string, variantSku: string, priceMinor: number): Promise<{
  productId: number | string
  variantId: number | string
  optionId: number | string
  typeId: number | string
  sku: string
}> {
  const type = await payload.create({
    collection: 'store-variant-types', overrideAccess: true,
    data: { tenant: tid, label: 'Size', name: 'size' } as any,
  })
  const option = await payload.create({
    collection: 'store-variant-options', overrideAccess: true,
    data: { tenant: tid, variantType: type.id, label: 'Large', value: 'L' } as any,
  })
  // The parent product carries no product-level SKU (the variant SKU is the allocation key) and
  // declares the variant-type so the plugin's validateOptions hook accepts the variant.
  const product = await payload.create({
    collection: 'store-products', overrideAccess: true,
    data: {
      tenant: tid, slug: `slug-${variantSku.toLowerCase()}-parent`, sku: null,
      enableVariants: true, variantTypes: [type.id], taxClass: 'standard', trackInventory: true,
    } as any,
  })
  const variant = await payload.create({
    collection: 'store-variants', overrideAccess: true,
    data: {
      tenant: tid, product: product.id, options: [option.id], sku: variantSku,
      priceInEGPEnabled: true, priceInEGP: priceMinor,
    } as any,
  })
  return { productId: product.id, variantId: variant.id, optionId: option.id, typeId: type.id, sku: variantSku }
}

async function seedCart(productId: number | string, quantity: number, variantId?: number | string, tid: number | string = tenantId): Promise<number | string> {
  const c = await payload.create({
    collection: 'store-carts', overrideAccess: true,
    data: {
      tenant: tid, currency: 'EGP',
      items: [{ product: productId, quantity, ...(variantId !== undefined ? { variant: variantId } : {}) }],
    } as any,
  })
  return c.id
}

// Count legacy commerce docs for the tenant — the negative-assertion probe.
async function countLegacy(slug: string): Promise<number> {
  const { totalDocs } = await payload.count({ collection: slug as never, where: { tenant: { equals: tenantId } }, overrideAccess: true })
  return totalDocs
}

// Snapshot all four legacy collections, run a plugin op, then assert none gained a doc.
async function assertNoLegacyWrites<T>(label: string, op: () => Promise<T>): Promise<T> {
  const before = await Promise.all(['products', 'carts', 'orders', 'transactions'].map((s) => countLegacy(s)))
  const res = await op()
  const after = await Promise.all(['products', 'carts', 'orders', 'transactions'].map((s) => countLegacy(s)))
  const names = ['products', 'carts', 'orders', 'transactions']
  for (let i = 0; i < names.length; i++) {
    assert.equal(after[i], before[i], `[${label}] plugin op wrote a legacy ${names[i]} doc (before ${before[i]}, after ${after[i]})`)
  }
  return res
}

test.before(async () => {
  // The primary tenant: exclusive EGP, NO tax policy (0% everywhere). Keeping it tax-free means the
  // plugin (which reads the tenant's tax policy) prices at a clean 0%, so the plugin-totals
  // assertions have stable arithmetic.
  ;({ tenantId } = await seedTenant(payload, { features: ['commerce'] }))
  await seedSettings(tenantId, 'exclusive')
  locationId = await seedLocation(payload, tenantId)
})
test.after(async () => {
  try {
    try { await (payload.db as any).drizzle?.session?.client?.close?.() } catch { /* Windows libsql native teardown */ }
    await payload.destroy()
  } finally {
    try { rmSync(TEMP_DB, { force: true }) } catch { /* */ }
  }
})

// ── Section B — plugin cart ops (line shapes + totals stable) ─────────────────────────────────

test('plugin cart ops · update merges, remove drops, clear empties (line shapes stable)', async () => {
  const sku = 'PAR-C-OPS'
  await seedStoreProduct(tenantId, sku, 1000)
  const add = (await pluginAddItem(payload, tenantId, { sku, quantity: 1 })) as { status: number; body: { cartId: string; items: Array<{ sku: string; quantity: number }>; quote: { grandTotal: number } | null } }
  const cartId = add.body.cartId
  assert.equal(add.body.quote?.grandTotal, 1000)
  type CartView = { items: Array<{ sku: string; quantity: number }>; quote: { grandTotal: number } | null }
  const up = ((await pluginUpdateItem(payload, tenantId, { cartId, sku, quantity: 4 })).body as CartView)
  assert.equal(up.items[0].quantity, 4)
  assert.equal(up.quote?.grandTotal, 4000)
  const rm = ((await pluginRemoveItem(payload, tenantId, { cartId, sku })).body as CartView)
  assert.equal(rm.items.length, 0)
  // Re-add then clear keeps the cart id.
  const add2 = await pluginAddItem(payload, tenantId, { cartId, sku, quantity: 2 })
  const cleared = await pluginClearCart(payload, tenantId, cartId)
  assert.equal((cleared.body as { items: unknown[] }).items.length, 0)
  assert.ok(add2.status === 200)
})

// ── Section C — variant-in-cart (self-contained; exercises variant-type/options/variant) ───────

test('variant-in-cart · plugin variant-type + option + variant seeds, prices, and checks out', async () => {
  const variantSku = 'PAR-VAR-L'
  const { productId, variantId } = await seedVariantSet(tenantId, variantSku, 7500) // 75.00 EGP
  // Stock the variant SKU (the immutable reservation key).
  await seedLevel(payload, tenantId, locationId, variantSku, 10)

  // Add the variant to a plugin cart via its SKU; resolveSellableBySku maps it to the variant doc.
  const add = (await pluginAddItem(payload, tenantId, { sku: variantSku, quantity: 2 })) as { status: number; body: { cartId: string; items: Array<{ sku: string; quantity: number; product?: { priceInEGP?: number } }>; quote: { subtotal: number; grandTotal: number } | null } }
  assert.equal(add.status, 200, `variant add: ${JSON.stringify(add.body)}`)
  assert.equal(add.body.items.length, 1)
  assert.equal(add.body.items[0].sku, variantSku)
  assert.equal(add.body.items[0].quantity, 2)
  assert.equal(add.body.items[0].product?.priceInEGP, 7500, 'variant price resolved from store-variants')
  assert.equal(add.body.quote?.subtotal, 15000, '2 × 7500')
  assert.equal(add.body.quote?.grandTotal, 15000)

  // quoteStoreCart (the authoritative cart-totals path) agrees with the add response.
  const cartQuote = await quoteStoreCart(payload, tenantId, add.body.cartId)
  assert.equal(cartQuote.ok, true)
  if (cartQuote.ok) assert.equal(cartQuote.quote.grandTotal, 15000)

  // processCheckout handles the variant line and reserves stock by the variant SKU.
  const co = await processCheckout(payload, { tenantId }, {
    cartId: add.body.cartId, paymentMethod: 'cod', shippingAddress: { country: 'EG' }, customerEmail: 'v@dgh.test',
  })
  assert.equal(co.status, 200, `variant checkout: ${JSON.stringify(co.body)}`)
  assert.equal(co.body.amountDue, 15000)
  const lvl = await getLevel({ payload, tenantId, locationId, sku: variantSku })
  assert.equal(lvl?.reserved, 2, 'variant SKU reserved')
  // The variant line is present in the order snapshot.
  const snap = (co.body as { quote?: { subtotal?: number } }).quote
  assert.equal(snap?.subtotal, 15000)
  void productId
  void variantId
})

// ── Section E — negative assertions: plugin ops write NO legacy collection doc ─────────────────

test('negative · pluginAddItem writes store-carts, not legacy carts/products/orders/transactions', async () => {
  const sku = 'PAR-NEG-ADD'
  await seedStoreProduct(tenantId, sku, 1000)
  const beforeCarts = await countLegacy('carts')
  const r = (await assertNoLegacyWrites('pluginAddItem', () => pluginAddItem(payload, tenantId, { sku, quantity: 1 }))) as { status: number; body: { cartId: string } }
  assert.equal(r.status, 200)
  assert.ok(r.body.cartId.length > 0, 'a store-carts doc was minted')
  // And a store-carts doc exists (the plugin write target).
  const { totalDocs: storeCarts } = await payload.count({ collection: 'store-carts', where: { tenant: { equals: tenantId } }, overrideAccess: true })
  assert.ok(storeCarts > 0, 'store-carts doc written')
  void beforeCarts
})

test('negative · pluginUpdateItem / pluginRemoveItem / pluginClearCart touch no legacy collection', async () => {
  const sku = 'PAR-NEG-MUT'
  await seedStoreProduct(tenantId, sku, 1000)
  const add = (await pluginAddItem(payload, tenantId, { sku, quantity: 2 })) as { body: { cartId: string } }
  const cartId = add.body.cartId
  await assertNoLegacyWrites('pluginUpdateItem', () => pluginUpdateItem(payload, tenantId, { cartId, sku, quantity: 5 }))
  await assertNoLegacyWrites('pluginRemoveItem', () => pluginRemoveItem(payload, tenantId, { cartId, sku }))
  await assertNoLegacyWrites('pluginClearCart', () => pluginClearCart(payload, tenantId, cartId))
})

test('negative · processCheckout (cod) writes store-orders, not legacy orders/transactions', async () => {
  const sku = 'PAR-NEG-COD'
  await seedStoreProduct(tenantId, sku, 2000)
  await seedLevel(payload, tenantId, locationId, sku, 50)
  const pid = ((await payload.find({ collection: 'store-products', where: { and: [{ tenant: { equals: tenantId } }, { sku: { equals: sku } }] }, overrideAccess: true, limit: 1 })).docs[0] as { id: number | string }).id
  const cartId = await seedCart(pid, 2)
  await assertNoLegacyWrites('processCheckout(cod)', () => processCheckout(payload, { tenantId }, { cartId, paymentMethod: 'cod', shippingAddress: { country: 'EG' }, customerEmail: 'n@dgh.test' }))
  const { totalDocs: storeOrders } = await payload.count({ collection: 'store-orders', where: { tenant: { equals: tenantId } }, overrideAccess: true })
  assert.ok(storeOrders > 0, 'store-orders doc written by the plugin checkout')
})

test('negative · processCheckout (online) writes store-orders + store-transactions, not legacy', async () => {
  const sku = 'PAR-NEG-GW'
  await seedStoreProduct(tenantId, sku, 3000)
  await seedLevel(payload, tenantId, locationId, sku, 50)
  const pid = ((await payload.find({ collection: 'store-products', where: { and: [{ tenant: { equals: tenantId } }, { sku: { equals: sku } }] }, overrideAccess: true, limit: 1 })).docs[0] as { id: number | string }).id
  const cartId = await seedCart(pid, 1)
  const r = (await assertNoLegacyWrites('processCheckout(paymob)', () => processCheckout(
    payload, { tenantId },
    { cartId, paymentMethod: 'paymob', shippingAddress: { country: 'EG' }, customerEmail: 'g@dgh.test', returnUrl: 'https://shop/return' },
    { buildAdapter: fakeBuilder },
  ))) as { status: number; body: { transactionId?: string } }
  assert.equal(r.status, 200)
  assert.ok(r.body.transactionId !== undefined, 'store-transactions row created')
  const { totalDocs: storeTxns } = await payload.count({ collection: 'store-transactions', where: { tenant: { equals: tenantId } }, overrideAccess: true })
  assert.ok(storeTxns > 0, 'store-transactions doc written')
})

test('negative · signed orders endpoint (listOrders/readOrder) writes nothing to legacy', async () => {
  // Seed a plugin customer + a store-orders row so list/read have data to return (read-only).
  const { registerCustomer, verifyCustomerEmail, loginCustomer } = await import('../src/commerce/customers/payload-auth')
  const reg = await registerCustomer(payload, tenantId, { email: 'neg-orders@dgh.test', password: 'password123', name: 'Neg Orders' })
  const token = (reg.body as { verificationToken?: string }).verificationToken
  assert.ok(token)
  await verifyCustomerEmail(payload, token)
  const login = await loginCustomer(payload, tenantId, { email: 'neg-orders@dgh.test', password: 'password123' })
  const customerId = (login.body as { customer: { id: number | string } }).customer.id
  await payload.create({
    collection: 'store-orders', overrideAccess: true,
    data: {
      tenant: tenantId, customer: customerId, orderNumber: 'PAR-NEG-ORD-1',
      status: 'processing', paymentState: 'pending',
      subtotal: 5000, totalDiscount: 0, shippingPrice: 0, totalTax: 0, giftCardApplied: 0,
      amountDue: 5000, currency: 'EGP', placedAt: new Date().toISOString(),
      items: [], quoteSnapshot: { currency: 'EGP' }, quoteHash: 'h-par-neg',
    } as any,
  })
  // The orders endpoint is read-only; neither list nor read may mutate any legacy collection.
  await assertNoLegacyWrites('listOrders', () => listOrders(payload, tenantId, customerId))
  await assertNoLegacyWrites('readOrder', () => readOrder(payload, tenantId, customerId, 'PAR-NEG-ORD-1'))
  // And readOrder returns the row (proving the read path works, not just that it's inert).
  const detail = await readOrder(payload, tenantId, customerId, 'PAR-NEG-ORD-1')
  assert.equal(detail.status, 200)
  assert.equal((detail.body as { orderNumber: string }).orderNumber, 'PAR-NEG-ORD-1')
})
