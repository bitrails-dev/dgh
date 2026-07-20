// Wave F3 — fake-adapter end-to-end RELEASE test. Drives the full plugin-first commerce flow with
// NO network, proving sandbox release readiness on top of the F2 runtime. The real online Paymob/
// Kashier sandbox capture stays the operator's manual gate; this is the closest autonomous analog —
// a fake adapter whose createHostedCheckout returns a sandbox-style URL, and a simulated provider
// webhook capture folded through the D3 process-payment-event task with production side-effects.
//
// Flow:
//   browse (listProducts · published-only, tenant-scoped)
//   → signed add-to-cart (pluginAddItem · simple + variant SKU) → quote (quoteStoreCart)
//   → COD checkout (processCheckout)            → store-orders pending, stock RESERVED, no legacy
//   → admin-confirm offline (commitOrderInventory) → stock COMMITTED (onHand ↓, reserved → 0)
//   → online checkout (processCheckout · fake adapter) → hosted URL, store-transactions, RESERVED
//   → mocked capture (insertPaymentEvent + processPaymentEvent · buildProductionSideEffects)
//                                                  → order paid, §3.9 txn fields, COMMITTED, no legacy
//
// Throughout: no document is written to legacy products/carts/orders/transactions (counts before/
// after). Mirrors the fake-adapter injection from commerce-store-checkout-plugin.test.ts + the D3
// capture→commit pattern from commerce-capture-commit.test.ts. All money is integer EGP minor units.
import assert from 'node:assert/strict'
import { rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import type { Payload } from 'payload'

const TEMP_DB = join(tmpdir(), `commerce-release-flow-itest-${process.pid}-${Date.now()}.db`)
process.env.DATABASE_URI = `file:${TEMP_DB}`
process.env.PAYLOAD_SECRET = process.env.PAYLOAD_SECRET || 'commerce-release-flow-itest-secret'
process.env.PAYLOAD_PUBLIC_SERVER_URL = process.env.PAYLOAD_PUBLIC_SERVER_URL || 'http://localhost:3001'

const { default: config } = await import('../src/payload.config')
const { getPayload } = await import('payload')
const { seedTenant, seedLocation, seedLevel } = await import('./helpers/commerce')
const payload = (await getPayload({ config })) as unknown as Payload
await payload.db.migrate()

const { listProducts } = await import('../src/commerce/store/catalog')
const { quoteStoreCart } = await import('../src/commerce/store/quote-plugin')
const { pluginAddItem } = await import('../src/commerce/store/cart-v2')
const { processCheckout } = await import('../src/commerce/checkout/process')
const { commitOrderInventory } = await import('../src/commerce/checkout')
const { insertPaymentEvent, processPaymentEvent } = await import('../src/commerce/payments/events')
const { buildProductionSideEffects } = await import('../src/commerce/payments/job')
import type { SideEffectResult } from '../src/commerce/payments/events'
const { getLevel } = await import('../src/commerce/inventory')
import type { PaymentAdapter } from '../src/commerce/payments/types'
import type { AdapterBuilder } from '../src/commerce/payments/adapters/registry'

// Fake gateway adapter (no network) — mirrors commerce-store-checkout-plugin / commerce-capture-commit.
// createHostedCheckout returns a sandbox-style URL + a provider session id; the capture is driven
// later through the D3 job, not the adapter.
const fakeBuilder: AdapterBuilder = () =>
  ({
    provider: 'paymob',
    capabilities: () => ({
      hostedCheckout: true, authorization: true, refunds: true, partialRefunds: true,
      voiding: true, recurring: false, webhookSignature: 'hmac',
    }),
    createHostedCheckout: async () => ({ checkoutUrl: 'https://sandbox.paymob.example/iframes/1?payment_token=rel', providerSessionId: 'po-release' }),
    refund: async () => ({ ok: true }),
    verifyWebhook: async () => ({ accepted: false, reason: 'no_verifying_in_release_flow_test' }),
    lookup: async () => ({ state: 'pending' }),
  }) as PaymentAdapter

// Production side-effects with a no-op notification so the event completes without the jobs runtime.
function captureSideEffects() {
  return {
    ...buildProductionSideEffects(payload),
    notification: async (): Promise<SideEffectResult> => ({ ok: true, effect: 'test-noop' }),
  }
}

let tenantId: number | string
let otherTenantId: number | string
let locationId: number | string

// ── product seeding (plugin shapes) ───────────────────────────────────────────────────────────

// A published, priced simple product. `_status: 'published'` so the catalog list surfaces it
// (drafts default); `name` drives the storefront projection + q search.
async function seedSimpleProduct(tid: number | string, sku: string, priceMinor: number, name: string, status: 'published' | 'draft' = 'published'): Promise<number | string> {
  const p = await payload.create({
    collection: 'store-products', overrideAccess: true,
    data: {
      tenant: tid, name, slug: `slug-${sku.toLowerCase()}`, sku,
      priceInEGPEnabled: true, priceInEGP: priceMinor, taxClass: 'standard', trackInventory: true,
      _status: status,
    } as any,
  })
  return p.id
}

// The plugin variant shape: variant-type + option + a variant-bearing parent + a priced variant.
async function seedVariantSet(tid: number | string, variantSku: string, priceMinor: number): Promise<{ variantId: number | string; sku: string }> {
  const type = await payload.create({
    collection: 'store-variant-types', overrideAccess: true,
    data: { tenant: tid, label: 'Size', name: 'size' } as any,
  })
  const option = await payload.create({
    collection: 'store-variant-options', overrideAccess: true,
    data: { tenant: tid, variantType: type.id, label: 'Large', value: 'L' } as any,
  })
  const product = await payload.create({
    collection: 'store-products', overrideAccess: true,
    data: {
      tenant: tid, name: 'Variant Product', slug: `slug-${variantSku.toLowerCase()}-parent`, sku: null,
      enableVariants: true, variantTypes: [type.id], taxClass: 'standard', trackInventory: true,
      _status: 'published',
    } as any,
  })
  const variant = await payload.create({
    collection: 'store-variants', overrideAccess: true,
    data: { tenant: tid, product: product.id, options: [option.id], sku: variantSku, priceInEGPEnabled: true, priceInEGP: priceMinor } as any,
  })
  return { variantId: variant.id, sku: variantSku }
}

// Count legacy commerce docs for the primary tenant — the no-legacy probe.
async function countLegacy(slug: string): Promise<number> {
  const { totalDocs } = await payload.count({ collection: slug as never, where: { tenant: { equals: tenantId } }, overrideAccess: true })
  return totalDocs
}

// A direct store-carts doc (the proven online-checkout cart shape from commerce-store-checkout-plugin
// + commerce-capture-commit). Used for the online leg; the signed add-to-cart leg uses pluginAddItem.
async function seedCart(productId: number | string, quantity: number): Promise<number | string> {
  const c = await payload.create({
    collection: 'store-carts', overrideAccess: true,
    data: { tenant: tenantId, currency: 'EGP', items: [{ product: productId, quantity }] } as any,
  })
  return c.id
}

// Assert all four legacy collections are empty for the tenant (fresh tenant → always 0).
async function assertNoLegacy(): Promise<void> {
  for (const slug of ['products', 'carts', 'orders', 'transactions']) {
    assert.equal(await countLegacy(slug), 0, `plugin path wrote a legacy ${slug} doc`)
  }
}

test.before(async () => {
  ;({ tenantId } = await seedTenant(payload, { features: ['commerce'] }))
  otherTenantId = (await seedTenant(payload, { features: ['commerce'] })).tenantId
  await payload.create({
    collection: 'commerce-settings', overrideAccess: true,
    data: {
      tenant: tenantId, status: 'live', currency: 'EGP', taxMode: 'exclusive', sandbox: true,
      paymob: { enabled: true, apiKey: 'k', hmacSecret: 'h', iframeId: '1', integrationId: '2' },
    } as any,
  })
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

// ── the release flow ──────────────────────────────────────────────────────────────────────────

test('release flow · browse → cart → COD checkout → admin confirm → online capture (no legacy writes)', async () => {
  const SIMPLE_SKU = 'REL-SIMPLE'
  const VARIANT_SKU = 'REL-VAR-L'
  const ONLINE_SKU = 'REL-ONLINE'
  const DRAFT_SKU = 'REL-DRAFT'

  // Stock the sellable SKUs.
  await seedLevel(payload, tenantId, locationId, SIMPLE_SKU, 10)   // 10 on hand
  await seedLevel(payload, tenantId, locationId, VARIANT_SKU, 10)  // 10 on hand
  await seedLevel(payload, tenantId, locationId, ONLINE_SKU, 5)    // 5 on hand

  // Products: a published simple (browsed + COD), a variant set, a draft (browse-excluded), and the
  // online simple. Plus another tenant's published product (tenant-isolation probe).
  await seedSimpleProduct(tenantId, SIMPLE_SKU, 5000, 'Releasable T-Shirt')      // 50.00 EGP
  const onlinePid = await seedSimpleProduct(tenantId, ONLINE_SKU, 3000, 'Online Only Mug') // 30.00 EGP
  await seedSimpleProduct(tenantId, DRAFT_SKU, 1000, 'Draft Hoodie', 'draft')
  await seedVariantSet(tenantId, VARIANT_SKU, 7500)                                // 75.00 EGP variant
  await seedSimpleProduct(otherTenantId, 'REL-OTHER-TENANT', 2000, 'Other Tenant')

  // 1. BROWSE — listProducts returns ONLY published products for THIS tenant (drafts + other
  //    tenants excluded). The catalog reads store-products; client prices are never trusted. The
  //    variant parent (sku: null) is listed and surfaces its priced variant child via `variants`.
  const { products, total } = await listProducts(payload, tenantId)
  const productSlugs = products.map((p) => p.slug)
  assert.ok(productSlugs.includes(`slug-${SIMPLE_SKU.toLowerCase()}`), 'published simple product is listed')
  assert.ok(productSlugs.includes(`slug-${VARIANT_SKU.toLowerCase()}-parent`), 'variant parent product is listed')
  assert.ok(!productSlugs.includes(`slug-${DRAFT_SKU.toLowerCase()}`), 'draft product is excluded (published only)')
  assert.ok(!productSlugs.includes('slug-rel-other-tenant'), 'other-tenant product is excluded (tenant-scoped)')
  // The variant child's SKU is surfaced on the parent's `variants` array.
  const variantParent = products.find((p) => p.slug === `slug-${VARIANT_SKU.toLowerCase()}-parent`)
  assert.ok(
    Array.isArray(variantParent?.variants) &&
      (variantParent!.variants as Array<{ sku?: string }>).some((v) => v.sku === VARIANT_SKU),
    'priced variant child surfaced under the parent',
  )
  assert.ok(total >= 3, `expected at least 3 published products, got ${total}`)
  await assertNoLegacy()

  // 2. SIGNED ADD-TO-CART (simple + variant SKU) → QUOTE. pluginAddItem mints/resolves the cart by
  //    normalized SKU; the simple line + the variant line both carry the server-resolved price.
  const addSimple = (await pluginAddItem(payload, tenantId, { sku: SIMPLE_SKU, quantity: 2 })) as { status: number; body: { cartId: string; items: Array<{ sku: string; quantity: number }>; quote: { grandTotal: number } | null } }
  assert.equal(addSimple.status, 200, `add simple: ${JSON.stringify(addSimple.body)}`)
  const cartId = addSimple.body.cartId
  const addVariant = await pluginAddItem(payload, tenantId, { sku: VARIANT_SKU, quantity: 1, cartId })
  assert.equal(addVariant.status, 200, `add variant: ${JSON.stringify(addVariant.body)}`)

  const quote = await quoteStoreCart(payload, tenantId, cartId)
  assert.equal(quote.ok, true)
  if (quote.ok) assert.equal(quote.quote.grandTotal, 17500, '2×5000 + 1×7500, exclusive tax, no policy rows → flat')
  await assertNoLegacy()

  // 3. COD CHECKOUT — store-orders created (pending paymentState), stock RESERVED by SKU, no legacy.
  const cod = await processCheckout(payload, { tenantId }, {
    cartId, paymentMethod: 'cod', shippingAddress: { country: 'EG' }, customerEmail: 'release@dgh.test',
  })
  assert.equal(cod.status, 200, `cod checkout: ${JSON.stringify(cod.body)}`)
  assert.equal(cod.body.paymentState, 'pending')
  assert.equal(cod.body.paymentMethod, 'cod')
  const codOrderNumber = cod.body.orderNumber as string
  assert.equal((await getLevel({ payload, tenantId, locationId, sku: SIMPLE_SKU }))?.reserved, 2, 'simple reserved at checkout')
  assert.equal((await getLevel({ payload, tenantId, locationId, sku: VARIANT_SKU }))?.reserved, 1, 'variant reserved at checkout')
  await assertNoLegacy()

  // 4. ADMIN-CONFIRM the offline order — commitOrderInventory (repointed to store-orders) commits
  //    the reservation: onHand decremented, reserved released, idempotent.
  const commit = await commitOrderInventory({ payload, tenantId, orderNumber: codOrderNumber })
  assert.equal(commit.found, true, 'found the store-order by orderNumber')
  assert.ok(commit.committed >= 1, `order reservations committed (got ${commit.committed})`)
  const lvlSimple = await getLevel({ payload, tenantId, locationId, sku: SIMPLE_SKU })
  const lvlVariant = await getLevel({ payload, tenantId, locationId, sku: VARIANT_SKU })
  assert.equal(lvlSimple?.onHand, 8, 'simple onHand dropped by 2 (10 - 2)')
  assert.equal(lvlSimple?.reserved, 0, 'simple reservation fulfilled')
  assert.equal(lvlVariant?.onHand, 9, 'variant onHand dropped by 1 (10 - 1)')
  assert.equal(lvlVariant?.reserved, 0, 'variant reservation fulfilled')
  // Idempotent re-confirm commits nothing.
  const again = await commitOrderInventory({ payload, tenantId, orderNumber: codOrderNumber })
  assert.equal(again.committed, 0, 'already committed — no double-consume')
  await assertNoLegacy()

  // 5. ONLINE CHECKOUT — a second cart (separate SKU) with the fake adapter. Returns a hosted
  //    checkout URL + a store-transactions row; stock RESERVED; a pending payment event is enqueued.
  //    The online cart uses the proven seedCart shape (matches commerce-store-checkout-plugin /
  //    commerce-capture-commit) — see the handoff note on the pluginAddItem→online combination.
  const onlineCartId = await seedCart(onlinePid, 1)
  const online = await processCheckout(
    payload, { tenantId },
    { cartId: onlineCartId, paymentMethod: 'paymob', shippingAddress: { country: 'EG' }, customerEmail: 'release@dgh.test', returnUrl: 'https://shop/return' },
    { buildAdapter: fakeBuilder },
  )
  assert.equal(online.status, 200, `online checkout: ${JSON.stringify(online.body)}`)
  assert.equal(online.body.paymentMethod, 'paymob')
  assert.equal(online.body.checkoutUrl, 'https://sandbox.paymob.example/iframes/1?payment_token=rel', 'hosted sandbox URL from the fake adapter')
  assert.ok(online.body.transactionId !== undefined, 'store-transactions row created at checkout')
  const onlineOrderNumber = online.body.orderNumber as string
  const txnId = (online.body as { transactionId?: number | string }).transactionId as number | string
  assert.equal((await getLevel({ payload, tenantId, locationId, sku: ONLINE_SKU }))?.reserved, 1, 'online SKU reserved at checkout')
  await assertNoLegacy()

  // 6. MOCKED CAPTURE — simulate the provider webhook capture event folded through the D3 job with
  //    production side-effects. The order reaches `captured` (paid); the §3.9 transaction fields are
  //    written; the reservation is committed (onHand ↓, reserved → 0); no legacy write.
  const ev = await insertPaymentEvent({ payload, tenantId, gateway: 'paymob', providerEventId: 'rel-online-capture', merchantReference: onlineOrderNumber, targetState: 'captured', amount: online.body.amountDue as number })
  assert.ok(ev.id !== undefined, 'capture event inserted')
  const fold = await processPaymentEvent(payload, ev.id as number, { sideEffects: captureSideEffects() })
  assert.equal(fold.foldedState, 'captured', 'event folded to captured')
  assert.equal(fold.merchantReference, onlineOrderNumber, 'fold carries the online order ref')
  assert.equal(fold.completed, true, 'every checkpoint succeeded')

  const lvlOnline = await getLevel({ payload, tenantId, locationId, sku: ONLINE_SKU })
  assert.equal(lvlOnline?.onHand, 4, 'online onHand dropped by 1 (5 - 1) — reservation committed by the D3 job')
  assert.equal(lvlOnline?.reserved, 0, 'online reservation fulfilled by the capture')

  // The store-order paymentState synced to captured (paid).
  const order = (await payload.find({ collection: 'store-orders', where: { and: [{ tenant: { equals: tenantId } }, { orderNumber: { equals: onlineOrderNumber } }] }, overrideAccess: true, limit: 1 })).docs[0] as { paymentState?: string; status?: string } | undefined
  assert.equal(order?.paymentState, 'captured', 'store-order paymentState synced to captured (paid)')

  // The §3.9 transaction fields reflect the authoritative provider state (hash, never raw).
  const txn = (await payload.find({ collection: 'store-transactions', where: { and: [{ tenant: { equals: tenantId } }, { id: { equals: txnId } }] }, overrideAccess: true, limit: 1 })).docs[0] as {
    status?: string; paymentMethod?: string; lastProviderStatus?: string; reconciliationStatus?: string; rawPayloadHash?: string; capturedAmount?: number
  } | undefined
  assert.equal(txn?.paymentMethod, 'paymob')
  assert.equal(txn?.status, 'succeeded', 'transaction status succeeded after capture')
  assert.equal(txn?.lastProviderStatus, 'captured')
  assert.equal(txn?.reconciliationStatus, 'matched')
  assert.equal(txn?.capturedAmount, online.body.amountDue, 'capturedAmount is the authoritative amount')
  assert.ok(typeof txn?.rawPayloadHash === 'string' && (txn.rawPayloadHash as string).length > 0, 'rawPayloadHash written (hash, never raw)')

  // FINAL: no legacy commerce collection was ever written by any step of the flow.
  await assertNoLegacy()
})
