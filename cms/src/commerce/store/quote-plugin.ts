// Plugin-first storefront quote helpers (Wave E3 continuation, plan §3.7). The legacy
// shared.quoteItems / resolvePricedLines read the legacy `products` collection and cannot price the
// ecommerce plugin's `store-products` / `store-variants`. These helpers are the plugin-first
// replacement used by the cart and quote endpoints:
//
//   - quoteStoreCart: the cart path. Runs the authoritative quoteCart engine over the C4
//     createPayloadQuoteCartLoader — the SAME loader processCheckout uses — so cart totals, checkout
//     totals, and order snapshots all agree. No shipping address / promo / gift card at cart-view
//     time (those are resolved at checkout); the engine returns merchandise + tax (a default tax zone
//     with no country filter still matches the empty address) and shipping 0.
//   - quoteStoreItems: the /quote preview path. The browser posts [{sku, quantity}]; the server
//     resolves each SKU to a priced QuoteCartLine via the plugin sellable docs + resolveSellableBySku,
//     then runs the pure computeQuote engine with the tenant's tax policy.
//
// Both are directly callable (hence directly testable) with injectable loader / resolver seams, and
// both return the storefront quote shape the Astro proxy forwards verbatim. Browser totals / prices
// are NEVER read — only SKUs and quantities cross the wire.
import type { Payload } from 'payload'

import {
  quoteCart,
  computeQuote,
  type QuoteCartLine,
  type QuoteCartLoader,
  type QuoteCartResult,
} from '../policies/quote'
import { createPayloadQuoteCartLoader } from '../policies/quote-loader'
import {
  resolveSellableBySku,
  normalizeSku,
  type ResolvedSellable,
} from '../inventory/sku-resolution'
import { STORE_COLLECTION_SLUGS } from '../plugin/slugs'
import { loadCommerceSettings } from './shared'

// The flat storefront quote shape (proxy forwards it verbatim; the browser reads these fields). All
// money is integer EGP minor units.
export interface StorefrontQuote {
  currency: string
  subtotal: number
  totalDiscount: number
  shippingPrice: number
  totalTax: number
  giftCardApplied: number
  grandTotal: number
  amountDue: number
  quoteHash: string
}

export type QuotePluginResult =
  | { ok: true; quote: StorefrontQuote; snapshot: QuoteCartResult['snapshot'] }
  | { ok: false; status: number; code: string; detail?: unknown }

function toStorefront(r: QuoteCartResult): StorefrontQuote {
  return {
    currency: r.snapshot.currency,
    subtotal: r.subtotal,
    totalDiscount: r.totalDiscount,
    shippingPrice: r.shippingPrice,
    totalTax: r.totalTax,
    giftCardApplied: r.giftCardApplied,
    grandTotal: r.grandTotal,
    amountDue: r.amountDue,
    quoteHash: r.quoteHash,
  }
}

export interface QuoteStoreCartOptions {
  /** Injectable loader (defaults to the Payload-backed loader); unit tests pass a fake. */
  loader?: QuoteCartLoader
}

/**
 * Authoritative cart quote — the cart endpoint's totals source. Runs the full quoteCart engine (the
 * same path checkout uses) with no shipping address / promos / gift card. `quoteCart` throws when the
 * cart is absent for the tenant → mapped to 404; any other failure → 500. An empty `cartId` (no
 * `store_cart_v2` cookie yet) short-circuits to 404 so the caller can shape an empty cart.
 */
export async function quoteStoreCart(
  payload: Payload,
  tenantId: number | string,
  cartId: number | string | undefined | null,
  opts?: QuoteStoreCartOptions,
): Promise<QuotePluginResult> {
  if (cartId === undefined || cartId === null || cartId === '') {
    return { ok: false, status: 404, code: 'cart_not_found' }
  }
  const loader = opts?.loader ?? createPayloadQuoteCartLoader(payload)
  let result: QuoteCartResult
  try {
    result = await quoteCart(loader, {
      tenantId,
      cartId,
      shippingAddress: {},
      promotionCodes: [],
      giftCardCode: null,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (/not found/i.test(msg)) return { ok: false, status: 404, code: 'cart_not_found' }
    return { ok: false, status: 500, code: 'quote_failed', detail: msg }
  }
  return { ok: true, quote: toStorefront(result), snapshot: result.snapshot }
}

export type SellableResolver = (input: {
  payload: Payload
  tenantId: number | string
  sku: string
}) => Promise<{ ok: true; sellable: ResolvedSellable } | { ok: false; code: 'NOT_FOUND' | 'INVALID' }>

export interface QuoteStoreItemsOptions {
  loader?: QuoteCartLoader
  /** Injectable sellable resolver (defaults to resolveSellableBySku); unit tests pass a fake. */
  resolveSellable?: SellableResolver
}

/**
 * Items-based preview quote — the /quote endpoint. The browser posts [{sku, quantity}]; the server
 * resolves each SKU to a priced QuoteCartLine via the plugin sellable docs, then runs the pure
 * computeQuote engine with the tenant's tax policy (a default tax zone with no country filter still
 * matches the empty address). No shipping for a preview. Browser prices are never read.
 */
export async function quoteStoreItems(
  payload: Payload,
  tenantId: number | string,
  items: ReadonlyArray<{ sku: unknown; quantity: unknown }>,
  opts?: QuoteStoreItemsOptions,
): Promise<QuotePluginResult> {
  if (!Array.isArray(items) || items.length === 0) {
    return { ok: false, status: 400, code: 'invalid_items' }
  }
  const settings = await loadCommerceSettings(payload, tenantId)
  if (!settings) return { ok: false, status: 503, code: 'commerce_not_configured' }

  const resolve: SellableResolver = opts?.resolveSellable ?? (async (i) => resolveSellableBySku(i))
  const lines: QuoteCartLine[] = []
  for (const item of items) {
    const sku = normalizeSku((item as { sku?: unknown }).sku)
    const qty = Number((item as { quantity?: unknown }).quantity)
    if (!sku || !Number.isInteger(qty) || qty <= 0) {
      return {
        ok: false,
        status: 400,
        code: 'invalid_items',
        detail: { sku: (item as { sku?: unknown }).sku, quantity: (item as { quantity?: unknown }).quantity },
      }
    }
    const resolved = await resolve({ payload, tenantId, sku })
    if (!resolved.ok) return { ok: false, status: 422, code: 'product_not_found', detail: { sku } }
    const priced = await readSellablePrice(payload, tenantId, resolved.sellable)
    if (!priced) return { ok: false, status: 422, code: 'product_not_found', detail: { sku } }
    lines.push({
      key: sku,
      sku,
      productId: resolved.sellable.productId,
      variantId: resolved.sellable.variantId,
      quantity: qty,
      unitPriceMinor: priced.unitPriceMinor,
      taxClass: priced.taxClass,
    })
  }

  const loader = opts?.loader ?? createPayloadQuoteCartLoader(payload)
  const [taxZones, taxRates, now] = await Promise.all([
    loader.loadTaxZones(tenantId),
    loader.loadTaxRates(tenantId),
    loader.resolveNow(tenantId),
  ])
  const result = computeQuote({
    tenantId,
    currency: settings.currency,
    taxMode: settings.taxMode,
    lines,
    promotions: [],
    quotas: [],
    promotionCodes: [],
    taxZones,
    taxRates,
    shippingZones: [],
    shippingMethods: [],
    shippingAddress: {},
    giftCard: null,
    giftCardApplied: null,
    now,
  })
  return { ok: true, quote: toStorefront(result), snapshot: result.snapshot }
}

// Read unitPriceMinor (integer EGP) + taxClass from the sellable's product/variant doc. Variants
// carry their own price; the parent product supplies the tax class (and a fallback price). Mirrors
// the C4 loader's per-line resolution so the items path prices identically to the cart path. Returns
// null when the sellable doc is gone or unpriced (caller → 422 product_not_found).
async function readSellablePrice(
  payload: Payload,
  tenantId: number | string,
  sellable: ResolvedSellable,
): Promise<{ unitPriceMinor: number; taxClass: string } | null> {
  let unitPriceMinor: number | undefined
  let taxClass = 'standard'

  if (sellable.kind === 'variant' && sellable.variantId != null) {
    const vFind = await payload.find({
      collection: STORE_COLLECTION_SLUGS.variants,
      where: { and: [{ id: { equals: sellable.variantId } }, { tenant: { equals: tenantId } }] },
      overrideAccess: true,
      limit: 1,
    })
    const v = vFind.docs[0] as { priceInEGP?: number } | undefined
    if (!v) return null
    if (typeof v.priceInEGP === 'number') unitPriceMinor = v.priceInEGP
  }

  const pFind = await payload.find({
    collection: STORE_COLLECTION_SLUGS.products,
    where: { and: [{ id: { equals: sellable.productId } }, { tenant: { equals: tenantId } }] },
    overrideAccess: true,
    limit: 1,
  })
  const p = pFind.docs[0] as { priceInEGP?: number; taxClass?: string } | undefined
  if (!p) return null
  if (unitPriceMinor === undefined && typeof p.priceInEGP === 'number') unitPriceMinor = p.priceInEGP
  if (typeof p.taxClass === 'string' && p.taxClass) taxClass = p.taxClass
  if (unitPriceMinor === undefined || !Number.isInteger(unitPriceMinor) || unitPriceMinor < 0) {
    return null
  }
  return { unitPriceMinor, taxClass }
}
