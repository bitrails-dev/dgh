// Wave F1 — plugin-cutover parity (INTEGRATION, DB-backed). Proves the plugin-first storefront
// path is a complete, correct replacement for the legacy path over the REAL Payload + migrated DB,
// so Wave F2 can retire the legacy runtime without behavior change. Nothing is removed here.
//
// Ground truth — legacy collection locations (for F2's removal; the Wave F prompt's
// `cms/src/collections/{Products,Carts,Orders,Transactions}.ts` path is slightly off — they live one
// dir deeper, under commerce/):
//   - cms/src/collections/commerce/Products.ts     → slug 'products'
//   - cms/src/collections/commerce/Carts.ts        → slug 'carts'
//   - cms/src/collections/commerce/Orders.ts       → slug 'orders'
//   - cms/src/collections/commerce/Transactions.ts → slug 'transactions'
// All four are still registered + writable today (the legacy store-cart/store-checkout suites write
// them). The negative-assertion section below proves the PLUGIN ops never touch them.
//
// Parity pairs driven directly over identical inputs (Plan §8 Commit F1 + the Wave F1 matrix):
//   - Quote:   legacy quoteItems (shared.ts, reads `products`) vs plugin quoteStoreItems
//              (quote-plugin.ts, reads `store-products` + the tax policy). The legacy engine is
//              line-taxBps based; the plugin engine is tax-class/zone based — we configure a
//              comparable tax policy (legacy product taxBps == plugin tax-rate rateBps for the
//              product's taxClass) and assert the GRAND TOTAL matches, not internal field names.
//   - Cart:    legacy upsertCart (cart.ts, writes `carts`) vs plugin pluginAddItem (cart-v2.ts,
//              writes `store-carts`). Assert the server-priced line total matches.
//   - Checkout: legacy placeOrder (store/checkout.ts → checkout(), writes `orders`) vs plugin
//              processCheckout (checkout/process.ts, writes `store-orders`). Assert amountDue +
//              reserved stock match; insufficient-stock rejected identically.
//   - Variant-in-cart: a self-contained plugin variant-type/options/variant seed → cart → quote →
//              checkout, so F2's removal doesn't lose variant coverage (the E3 cart suite covers
//              simple products only).
//   - Negative: after every plugin op (cart add/update/remove/clear, processCheckout cod+online,
//              the signed orders list/read), assert NO legacy products/carts/orders/transactions
//              doc was written — the contract that lets F2 remove legacy.
//
// All money is integer EGP minor units. STOP condition: if a parity assertion reveals a real
// plugin-first discrepancy, it fails here and the divergence is reported — no source is patched.

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

const { quoteItems } = await import('../src/commerce/store/shared')
const { quoteStoreItems, quoteStoreCart } = await import('../src/commerce/store/quote-plugin')
const { upsertCart } = await import('../src/commerce/store/cart')
const { pluginAddItem, pluginUpdateItem, pluginRemoveItem, pluginClearCart, readPluginCart } =
  await import('../src/commerce/store/cart-v2')
const { placeOrder } = await import('../src/commerce/store/checkout')
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
let taxTenantId: number | string // exclusive tenant WITH a 14% tax policy (isolated so tenantId stays tax-free)
let inclTenantId: number | string // inclusive tenant with its own 14% tax policy
let locationId: number | string
let taxLocationId: number | string
let inclLocationId: number | string
const PAST_ISO = new Date(Date.now() - 86_400_000).toISOString()

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

// Seed the SAME SKU into BOTH catalogs at the SAME price, so legacy quoteItems and plugin
// quoteStoreItems price it identically. legacyBps mirrors the plugin's tax-rate rateBps.
async function seedDualProduct(
  tid: number | string,
  sku: string,
  priceMinor: number,
  legacyBps: number,
): Promise<{ legacyId: number | string; storeProductId: number | string }> {
  const legacy = await payload.create({
    collection: 'products', overrideAccess: true,
    data: { tenant: tid, name: sku, sku, price: priceMinor, taxBps: legacyBps, status: 'active', productKind: 'physical', trackInventory: true } as any,
  })
  const store = await payload.create({
    collection: 'store-products', overrideAccess: true,
    data: { tenant: tid, slug: `slug-${sku.toLowerCase()}`, sku, priceInEGPEnabled: true, priceInEGP: priceMinor, taxClass: 'standard', trackInventory: true } as any,
  })
  return { legacyId: legacy.id, storeProductId: store.id }
}

// Seed a catch-all tax zone + a 'standard' rate at `bps`. The empty shipping address matches the
// catch-all zone, so quoteStoreItems resolves `bps` for every standard-class line.
async function seedTaxPolicy(tid: number | string, code: string, bps: number): Promise<void> {
  const zone = await payload.create({
    collection: 'tax-zones', overrideAccess: true,
    data: { tenant: tid, code, name: { en: code, ar: code }, country: null, priority: 0, enabled: true } as any,
  })
  await payload.create({
    collection: 'tax-rates', overrideAccess: true,
    data: { tenant: tid, zone: zone.id, taxClass: 'standard', rateBps: bps, pricesIncludeTax: false, effectiveFrom: PAST_ISO, effectiveTo: null, enabled: true } as any,
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
  // Tenant A: exclusive EGP, NO tax policy (0% everywhere) — the primary parity tenant for all
  // cart/checkout/variant/negative cases. Keeping it tax-free means the plugin (which reads the
  // tenant's tax policy) and the legacy (which reads product.taxBps) always agree at 0%.
  ;({ tenantId } = await seedTenant(payload, { features: ['commerce'] }))
  await seedSettings(tenantId, 'exclusive')
  locationId = await seedLocation(payload, tenantId)

  // Tenant B: exclusive EGP WITH a 14% tax policy — isolated to its own tenant so the policy can
  // never leak into the 0-tax assertions on tenant A. (Tax policies are tenant-scoped and persist
  // for the life of the DB, so a policy seeded on tenant A would poison every later subtest.)
  ;({ tenantId: taxTenantId } = await seedTenant(payload, { features: ['commerce'] }))
  await seedSettings(taxTenantId, 'exclusive')
  taxLocationId = await seedLocation(payload, taxTenantId)
  await seedTaxPolicy(taxTenantId, 'EG-STD', 1400)

  // Tenant C: inclusive EGP with its own 14% tax policy (tax-inclusive parity).
  ;({ tenantId: inclTenantId } = await seedTenant(payload, { features: ['commerce'] }))
  await seedSettings(inclTenantId, 'inclusive')
  inclLocationId = await seedLocation(payload, inclTenantId)
  await seedTaxPolicy(inclTenantId, 'INCL-STD', 1400)
})
test.after(async () => {
  try {
    try { await (payload.db as any).drizzle?.session?.client?.close?.() } catch { /* Windows libsql native teardown */ }
    await payload.destroy()
  } finally {
    try { rmSync(TEMP_DB, { force: true }) } catch { /* */ }
  }
})

// ── Section A — quote parity: legacy quoteItems vs plugin quoteStoreItems ──────────────────────

test('quote parity · exclusive · 0-tax baseline — same grandTotal/subtotal/amountDue', async () => {
  const sku = 'PAR-Q-BASE'
  await seedDualProduct(tenantId, sku, 5000, 0) // 50.00 EGP, no tax either side
  const items = [{ sku, quantity: 2 }]
  const legacy = await quoteItems(payload, tenantId, items)
  const plugin = await quoteStoreItems(payload, tenantId, items)
  assert.equal(legacy.ok, true)
  assert.equal(plugin.ok, true)
  if (!legacy.ok || !plugin.ok) throw new Error('expected both ok')
  // legacy snapshot.grandTotal vs plugin storefront quote.grandTotal — comparable business outcome.
  assert.equal(plugin.quote.grandTotal, legacy.snapshot.grandTotal)
  assert.equal(plugin.quote.subtotal, legacy.snapshot.merchandiseSubtotal)
  assert.equal(plugin.quote.amountDue, legacy.snapshot.amountDue)
  assert.equal(plugin.quote.totalTax, legacy.snapshot.totalTax)
})

test('quote parity · exclusive · 14% tax (legacy taxBps == plugin tax-rate rateBps) — grandTotal matches', async () => {
  const sku = 'PAR-Q-TAX'
  // Uses the dedicated taxTenantId (14% standard policy seeded in before) so the policy never
  // leaks into tenantId's 0-tax cases. legacy product taxBps mirrors the plugin tax-rate rateBps.
  await seedDualProduct(taxTenantId, sku, 5000, 1400)
  const items = [{ sku, quantity: 2 }]
  const legacy = await quoteItems(payload, taxTenantId, items)
  const plugin = await quoteStoreItems(payload, taxTenantId, items)
  assert.equal(legacy.ok, true)
  assert.equal(plugin.ok, true)
  if (!legacy.ok || !plugin.ok) throw new Error('expected both ok')
  assert.equal(plugin.quote.totalTax, legacy.snapshot.totalTax, 'tax converges: 14% of 10000')
  assert.equal(plugin.quote.grandTotal, legacy.snapshot.grandTotal, 'grandTotal converges')
  assert.equal(plugin.quote.amountDue, legacy.snapshot.amountDue)
  assert.ok(plugin.quote.totalTax > 0, 'tax is actually applied (not silently 0)')
})

test('quote parity · tax-inclusive · 14% — both engines extract the same net from the gross', async () => {
  const sku = 'PAR-Q-INCL'
  await seedDualProduct(inclTenantId, sku, 5700, 1400) // gross 57.00 inclusive
  // The 14% inclusive tax policy for inclTenantId is seeded once in before().
  const items = [{ sku, quantity: 1 }]
  const legacy = await quoteItems(payload, inclTenantId, items)
  const plugin = await quoteStoreItems(payload, inclTenantId, items)
  // Both engines read taxMode from the SAME commerce-settings doc (inclusive), so the inclusive
  // extraction converges (the unit suite pins the arithmetic; this pins the DB-path wiring).
  assert.equal(legacy.ok, true)
  assert.equal(plugin.ok, true)
  if (!legacy.ok || !plugin.ok) throw new Error('expected both ok')
  assert.equal(plugin.quote.grandTotal, legacy.snapshot.grandTotal)
  assert.equal(plugin.quote.totalTax, legacy.snapshot.totalTax)
})

test('quote parity · unknown sku — both reject with the same 422 product_not_found', async () => {
  const legacy = await quoteItems(payload, tenantId, [{ sku: 'PAR-NOPE', quantity: 1 }])
  const plugin = await quoteStoreItems(payload, tenantId, [{ sku: 'PAR-NOPE', quantity: 1 }])
  assert.equal(legacy.ok, false)
  assert.equal(plugin.ok, false)
  if (legacy.ok || !plugin.ok) {
    if (!legacy.ok) assert.equal(legacy.status, 422)
    assert.equal(plugin.status, 422)
    assert.equal(plugin.code, 'product_not_found')
  }
})

// ── Section B — cart parity: legacy upsertCart vs plugin pluginAddItem ─────────────────────────

test('cart parity · same sku/price/qty — both resolve the same server-priced line total', async () => {
  const sku = 'PAR-C-1'
  await seedDualProduct(tenantId, sku, 5000, 0)
  const legacy = await upsertCart(payload, tenantId, { cartToken: 'parity-c1', items: [{ sku, quantity: 3 }] })
  const plugin = await pluginAddItem(payload, tenantId, { sku, quantity: 3 })
  assert.equal(legacy.status, 200)
  assert.equal(plugin.status, 200, `plugin add: ${JSON.stringify((plugin as { body: unknown }).body)}`)
  const legacyTotal = (legacy.body as { quote?: { grandTotal: number } }).quote?.grandTotal
  const pluginTotal = ((plugin as { body: { quote: { grandTotal: number } | null } }).body.quote)?.grandTotal
  assert.equal(pluginTotal, legacyTotal, '3 × 5000 = 15000 either path')
  assert.equal(pluginTotal, 15000)
})

test('plugin cart ops · update merges, remove drops, clear empties (line shapes stable)', async () => {
  const sku = 'PAR-C-OPS'
  await seedDualProduct(tenantId, sku, 1000, 0)
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

// ── Section D — checkout parity: legacy placeOrder vs plugin processCheckout ──────────────────

test('checkout parity · cod · same sku/price/qty — amountDue + reserved stock match', async () => {
  const sku = 'PAR-CO-COD'
  await seedDualProduct(tenantId, sku, 5000, 0)
  await seedLevel(payload, tenantId, locationId, sku, 100) // plenty for both reservations

  const legacy = await placeOrder(payload, tenantId, {
    cartToken: 'parity-co', items: [{ sku, quantity: 2 }], customerEmail: 'l@dgh.test', paymentMethod: 'cod',
  })
  assert.equal(legacy.status, 200, `legacy placeOrder: ${JSON.stringify(legacy.body)}`)

  const pid = ((await payload.find({ collection: 'store-products', where: { and: [{ tenant: { equals: tenantId } }, { sku: { equals: sku } }] }, overrideAccess: true, limit: 1 })).docs[0] as { id: number | string }).id
  const cartId = await seedCart(pid, 2)
  const plugin = await processCheckout(payload, { tenantId }, {
    cartId, paymentMethod: 'cod', shippingAddress: { country: 'EG' }, customerEmail: 'p@dgh.test',
  })
  assert.equal(plugin.status, 200, `plugin processCheckout: ${JSON.stringify(plugin.body)}`)

  assert.equal(plugin.body.amountDue, legacy.body.amountDue, 'amountDue converges (2 × 5000 = 10000)')
  assert.equal(plugin.body.amountDue, 10000)
  assert.equal(plugin.body.paymentState, 'pending')
  assert.equal(plugin.body.paymentMethod, 'cod')

  // Both paths reserve by the same normalized SKU from the shared stock level: 2 + 2 = 4 reserved.
  const lvl = await getLevel({ payload, tenantId, locationId, sku })
  assert.equal(lvl?.reserved, 4, 'legacy + plugin each reserved 2')
  assert.equal(lvl?.onHand, 100, 'on-hand unchanged by reservation')
})

test('checkout parity · insufficient stock — both reject identically (409, no order, no reservation leak)', async () => {
  const sku = 'PAR-CO-SHORT'
  await seedDualProduct(tenantId, sku, 5000, 0)
  await seedLevel(payload, tenantId, locationId, sku, 5) // only 5 on hand

  const legacyOrdersBefore = await countLegacy('orders')
  const legacy = await placeOrder(payload, tenantId, {
    cartToken: 'parity-short', items: [{ sku, quantity: 99 }], customerEmail: 's@dgh.test', paymentMethod: 'cod',
  })
  assert.equal(legacy.status, 409)
  assert.equal(legacy.body.error, 'INSUFFICIENT_STOCK')
  assert.equal(await countLegacy('orders'), legacyOrdersBefore, 'legacy path created no order on shortage')

  const pid = ((await payload.find({ collection: 'store-products', where: { and: [{ tenant: { equals: tenantId } }, { sku: { equals: sku } }] }, overrideAccess: true, limit: 1 })).docs[0] as { id: number | string }).id
  const cartId = await seedCart(pid, 99)
  const storeOrdersBefore = (await payload.count({ collection: 'store-orders', where: { tenant: { equals: tenantId } }, overrideAccess: true })).totalDocs
  const plugin = await processCheckout(payload, { tenantId }, {
    cartId, paymentMethod: 'cod', shippingAddress: { country: 'EG' }, customerEmail: 's2@dgh.test',
  })
  assert.equal(plugin.status, 409, `plugin shortage: ${JSON.stringify(plugin.body)}`)
  assert.equal(plugin.body.error, 'INSUFFICIENT_STOCK')
  const storeOrdersAfter = (await payload.count({ collection: 'store-orders', where: { tenant: { equals: tenantId } }, overrideAccess: true })).totalDocs
  assert.equal(storeOrdersAfter, storeOrdersBefore, 'plugin path created no store-order on shortage')

  // Neither path leaked a reservation.
  const lvl = await getLevel({ payload, tenantId, locationId, sku })
  assert.equal(lvl?.reserved, 0, 'no reservation leaked on shortage')
})

test('checkout parity · cod · 14% tax (dedicated tax tenant) — amountDue+tax converge through the checkout DB-path', async () => {
  const sku = 'PAR-CO-TAX'
  await seedDualProduct(taxTenantId, sku, 5000, 1400) // legacy taxBps mirrors the tenant's 14% policy
  await seedLevel(payload, taxTenantId, taxLocationId, sku, 100)

  const legacy = await placeOrder(payload, taxTenantId, {
    cartToken: 'parity-co-tax', items: [{ sku, quantity: 2 }], customerEmail: 'lt@dgh.test', paymentMethod: 'cod',
  })
  assert.equal(legacy.status, 200, `legacy placeOrder(tax): ${JSON.stringify(legacy.body)}`)

  const pid = ((await payload.find({ collection: 'store-products', where: { and: [{ tenant: { equals: taxTenantId } }, { sku: { equals: sku } }] }, overrideAccess: true, limit: 1 })).docs[0] as { id: number | string }).id
  const cartId = await seedCart(pid, 2, undefined, taxTenantId)
  const plugin = await processCheckout(payload, { tenantId: taxTenantId }, {
    cartId, paymentMethod: 'cod', shippingAddress: { country: 'EG' }, customerEmail: 'pt@dgh.test',
  })
  assert.equal(plugin.status, 200, `plugin processCheckout(tax): ${JSON.stringify(plugin.body)}`)
  assert.equal(plugin.body.amountDue, legacy.body.amountDue, 'amountDue converges with 14% tax applied')
  assert.ok((plugin.body.amountDue as number) > 10000, 'tax actually applied (10000 + 14%)')
})

// ── Section E — negative assertions: plugin ops write NO legacy collection doc ─────────────────

test('negative · pluginAddItem writes store-carts, not legacy carts/products/orders/transactions', async () => {
  const sku = 'PAR-NEG-ADD'
  await payload.create({
    collection: 'store-products', overrideAccess: true,
    data: { tenant: tenantId, slug: `slug-${sku.toLowerCase()}`, sku, priceInEGPEnabled: true, priceInEGP: 1000, taxClass: 'standard', trackInventory: true } as any,
  })
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
  await payload.create({
    collection: 'store-products', overrideAccess: true,
    data: { tenant: tenantId, slug: `slug-${sku.toLowerCase()}`, sku, priceInEGPEnabled: true, priceInEGP: 1000, taxClass: 'standard', trackInventory: true } as any,
  })
  const add = (await pluginAddItem(payload, tenantId, { sku, quantity: 2 })) as { body: { cartId: string } }
  const cartId = add.body.cartId
  await assertNoLegacyWrites('pluginUpdateItem', () => pluginUpdateItem(payload, tenantId, { cartId, sku, quantity: 5 }))
  await assertNoLegacyWrites('pluginRemoveItem', () => pluginRemoveItem(payload, tenantId, { cartId, sku }))
  await assertNoLegacyWrites('pluginClearCart', () => pluginClearCart(payload, tenantId, cartId))
})

test('negative · processCheckout (cod) writes store-orders, not legacy orders/transactions', async () => {
  const sku = 'PAR-NEG-COD'
  await payload.create({
    collection: 'store-products', overrideAccess: true,
    data: { tenant: tenantId, slug: `slug-${sku.toLowerCase()}`, sku, priceInEGPEnabled: true, priceInEGP: 2000, taxClass: 'standard', trackInventory: true } as any,
  })
  await seedLevel(payload, tenantId, locationId, sku, 50)
  const pid = ((await payload.find({ collection: 'store-products', where: { and: [{ tenant: { equals: tenantId } }, { sku: { equals: sku } }] }, overrideAccess: true, limit: 1 })).docs[0] as { id: number | string }).id
  const cartId = await seedCart(pid, 2)
  await assertNoLegacyWrites('processCheckout(cod)', () => processCheckout(payload, { tenantId }, { cartId, paymentMethod: 'cod', shippingAddress: { country: 'EG' }, customerEmail: 'n@dgh.test' }))
  const { totalDocs: storeOrders } = await payload.count({ collection: 'store-orders', where: { tenant: { equals: tenantId } }, overrideAccess: true })
  assert.ok(storeOrders > 0, 'store-orders doc written by the plugin checkout')
})

test('negative · processCheckout (online) writes store-orders + store-transactions, not legacy', async () => {
  const sku = 'PAR-NEG-GW'
  await payload.create({
    collection: 'store-products', overrideAccess: true,
    data: { tenant: tenantId, slug: `slug-${sku.toLowerCase()}`, sku, priceInEGPEnabled: true, priceInEGP: 3000, taxClass: 'standard', trackInventory: true } as any,
  })
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
