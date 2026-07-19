// Payload-backed QuoteCartLoader — the DB glue that feeds the authoritative quoteCart engine
// (Plan §3.10, §7 D4 step 3). C4 shipped the quoteCart engine + policy repositories; this module is
// the integration-owner wiring that turns a (tenant, cartId) into the resolved inputs the pure engine
// consumes, reading everything server-side. Browser totals are never consulted.
//
// Policy rows (tax / shipping / promotions / gift-cards) are loaded through C4's RepositoryBundle so
// the row-mapping lives in one place; the cart, catalog docs, commerce-settings and per-id promotion
// lookups are read directly through the Local API. The bundle is constructed over a read-only
// PolicyFindApi (the loader never redeems — redemption is committed by checkout at order placement).
//
// All money is integer EGP minor units; product/variant base prices are read from the plugin
// `priceInEGP` field. SKUs are normalized (trim + uppercase) so the immutable SKU is the single key
// into pricing, inventory reservation, and the snapshot.

import { createHash } from 'node:crypto'
import type { Payload } from 'payload'

import { STORE_COLLECTION_SLUGS } from '../plugin/slugs'
import { normalizeSku } from '../inventory/sku-resolution'
import {
  makeRepositoryBundle,
  computeRemainingQuota,
  hashGiftCardCode,
  resolveGiftCardPepper,
  type RepositoryBundle,
} from './repositories'
import type { QuoteCartLoader, QuoteCartLine } from './quote'
import type { TaxMode } from '../tax'

// Payload Local API shaped as the repositories' read surface. The bundle type also demands the
// ledger-txn method (redeem); the loader never calls it, so the cast is read-only safe.
interface PayloadFindArgs {
  collection: string
  where: Record<string, unknown>
  limit?: number
  overrideAccess?: boolean
  sort?: string | string[]
}
type PolicyFindApi = { find: (a: PayloadFindArgs) => Promise<{ docs: ReadonlyArray<Record<string, unknown>>; totalDocs?: number }> }

function payloadFindApi(payload: Payload): PolicyFindApi {
  return {
    find: async (a) => {
      const res = await payload.find({
        collection: a.collection as never,
        where: a.where as never,
        limit: a.limit ?? 100,
        overrideAccess: true,
        sort: a.sort as never,
      })
      return {
        docs: res.docs as unknown as ReadonlyArray<Record<string, unknown>>,
        totalDocs: res.totalDocs,
      }
    },
  }
}

// Read a plugin cart line's product/variant reference as a doc id, whether the relationship stored a
// populated doc (depth > 0) or a bare id.
function relId(v: unknown): number | string | undefined {
  if (v === null || v === undefined) return undefined
  if (typeof v === 'object') {
    const id = (v as { id?: unknown }).id
    return id === undefined ? undefined : (id as number | string)
  }
  return v as number | string
}

// Commerce settings per tenant: currency + tax mode. Quote/checkout resolve these server-side.
async function loadTenantSettings(
  payload: Payload,
  tenantId: string | number,
): Promise<{ currency: string; taxMode: TaxMode } | null> {
  const { docs } = await payload.find({
    collection: 'commerce-settings',
    where: { tenant: { equals: tenantId } },
    overrideAccess: true,
    limit: 1,
  })
  const s = docs[0] as { currency?: string; taxMode?: string } | undefined
  if (!s) return null
  return {
    currency: s.currency ?? 'EGP',
    taxMode: s.taxMode === 'inclusive' ? 'inclusive' : 'exclusive',
  }
}

/**
 * Construct a QuoteCartLoader backed by the live Payload instance. One loader per request; the
 * RepositoryBundle is built once and shared across every load method.
 */
export function createPayloadQuoteCartLoader(payload: Payload): QuoteCartLoader {
  const api = payloadFindApi(payload)
  const bundle: RepositoryBundle = makeRepositoryBundle(api as never)

  return {
    async loadCartLines(tenantId, cartId): Promise<QuoteCartLine[] | null> {
      // Load the plugin cart tenant-scoped; a cart id that does not belong to this tenant is simply
      // absent — ownership enforced by the scoped read.
      const cartFind = await payload.find({
        collection: STORE_COLLECTION_SLUGS.carts,
        where: { and: [{ id: { equals: cartId } }, { tenant: { equals: tenantId } }] },
        overrideAccess: true,
        limit: 1,
      })
      const cart = cartFind.docs[0] as { items?: Array<Record<string, unknown>> } | undefined
      if (!cart) return null
      const items = Array.isArray(cart.items) ? cart.items : []
      if (items.length === 0) return []

      const lines: QuoteCartLine[] = []
      for (const item of items) {
        const quantity = Number(item.quantity ?? 0)
        if (!Number.isInteger(quantity) || quantity <= 0) {
          throw new Error(`quoteCart loader: item quantity must be a positive integer, got ${item.quantity}`)
        }
        const variantId = relId(item.variant)
        const productId = relId(item.product)
        let skuRaw: string | undefined
        let unitPriceMinor: number | undefined
        let taxClass = 'standard'
        let resolvedProductId: string | number | undefined
        let resolvedVariantId: string | number | null = null

        if (variantId !== undefined) {
          // Variant line: authoritative sku + price from the variant doc; taxClass from the parent.
          const vFind = await payload.find({
            collection: STORE_COLLECTION_SLUGS.variants,
            where: { and: [{ id: { equals: variantId } }, { tenant: { equals: tenantId } }] },
            overrideAccess: true,
            limit: 1,
          })
          const v = vFind.docs[0] as { sku?: string; priceInEGP?: number; parent?: unknown } | undefined
          if (!v) throw new Error(`quoteCart loader: variant ${variantId} not found in tenant`)
          skuRaw = typeof v.sku === 'string' ? v.sku : undefined
          if (typeof v.priceInEGP === 'number') unitPriceMinor = v.priceInEGP
          const parentId = relId(v.parent) ?? productId
          if (parentId !== undefined) {
            const pFind = await payload.find({
              collection: STORE_COLLECTION_SLUGS.products,
              where: { and: [{ id: { equals: parentId } }, { tenant: { equals: tenantId } }] },
              overrideAccess: true,
              limit: 1,
            })
            const p = pFind.docs[0] as { priceInEGP?: number; taxClass?: string } | undefined
            if (p) {
              if (unitPriceMinor === undefined && typeof p.priceInEGP === 'number') unitPriceMinor = p.priceInEGP
              if (typeof p.taxClass === 'string' && p.taxClass) taxClass = p.taxClass
            }
            resolvedProductId = parentId
          }
          resolvedVariantId = variantId
        } else if (productId !== undefined) {
          // Simple-product line: sku + price + taxClass all on the product doc.
          const pFind = await payload.find({
            collection: STORE_COLLECTION_SLUGS.products,
            where: { and: [{ id: { equals: productId } }, { tenant: { equals: tenantId } }] },
            overrideAccess: true,
            limit: 1,
          })
          const p = pFind.docs[0] as { sku?: string; priceInEGP?: number; taxClass?: string } | undefined
          if (!p) throw new Error(`quoteCart loader: product ${productId} not found in tenant`)
          skuRaw = typeof p.sku === 'string' ? p.sku : undefined
          if (typeof p.priceInEGP === 'number') unitPriceMinor = p.priceInEGP
          if (typeof p.taxClass === 'string' && p.taxClass) taxClass = p.taxClass
          resolvedProductId = productId
        } else {
          throw new Error('quoteCart loader: cart item has neither product nor variant')
        }

        if (!skuRaw) throw new Error('quoteCart loader: cart item sku missing on its sellable doc')
        const sku = normalizeSku(skuRaw)
        if (sku.length === 0) throw new Error('quoteCart loader: cart item sku normalizes to empty')
        if (unitPriceMinor === undefined || !Number.isInteger(unitPriceMinor) || unitPriceMinor < 0) {
          throw new Error(`quoteCart loader: sellable ${sku} has no integer priceInEGP`)
        }
        if (resolvedProductId === undefined) throw new Error(`quoteCart loader: sellable ${sku} has no product id`)

        lines.push({
          key: sku,
          sku,
          productId: resolvedProductId,
          variantId: resolvedVariantId,
          quantity,
          unitPriceMinor,
          taxClass,
        })
      }
      return lines
    },

    loadTaxZones: (tenantId) => bundle.tax.listZones(tenantId),
    loadTaxRates: (tenantId) => bundle.tax.listRates(tenantId),
    loadShippingZones: (tenantId) => bundle.shipping.listZones(tenantId),
    loadShippingMethods: (tenantId) => bundle.shipping.listMethods(tenantId),
    loadPromotions: (tenantId, codes) => bundle.promotions.listByCodes(tenantId, codes),

    async loadPromotionQuotas(tenantId, promotionIds, customerIdentityHash) {
      const out: Array<{ promotionId: string | number; total: number; perCustomer: number }> = []
      for (const id of promotionIds) {
        // Fetch the row for its limits (the quota API takes ids, not rows), then count redemptions
        // and compute the remaining quota via the pure helper. N is tiny (≤ promo codes per cart).
        const { docs } = await payload.find({
          collection: 'promotions',
          where: { and: [{ tenant: { equals: tenantId } }, { id: { equals: id } }] },
          overrideAccess: true,
          limit: 1,
        })
        const used = await bundle.promotions.countRedemptions(tenantId, id, customerIdentityHash)
        // No row (deleted mid-check) → treat as unlimited so a stale code never blocks checkout.
        if (docs.length === 0) {
          out.push({ promotionId: id, total: Number.MAX_SAFE_INTEGER, perCustomer: Number.MAX_SAFE_INTEGER })
          continue
        }
        const remaining = computeRemainingQuota({
          promotion: {
            totalUsageLimit: (docs[0] as { totalUsageLimit?: number | null }).totalUsageLimit,
            perCustomerLimit: (docs[0] as { perCustomerLimit?: number | null }).perCustomerLimit,
          },
          totalRedeemed: used.total,
          perCustomerRedeemed: used.perCustomer,
        })
        out.push({ promotionId: id, total: remaining.total, perCustomer: remaining.perCustomer })
      }
      return out
    },

    async loadTenantTaxSettings(tenantId) {
      return loadTenantSettings(payload, tenantId)
    },

    async loadGiftCard(tenantId, codeHash) {
      const row = await bundle.giftCards.findByCodeHash(tenantId, codeHash)
      return row ? { row, codeHash } : null
    },

    async resolveCustomerIdentityHash({ tenantId, customerId, guestIdentityHash }) {
      // Stable per-tenant identity for promotion per-customer limits. A signed-in customer is their
      // own bucket; guests share a per-tenant bucket unless a gift-card hash (the strongest guest
      // identifier) is present. ponytail: guests-without-giftcard share a bucket — per-customer
      // limits for anonymous guests are inherently weak; the plan's per-customer enforcement targets
      // signed-in customers. Tighten with a cart-secret-derived hash if guest abuse surfaces.
      const material = customerId !== undefined && customerId !== null
        ? `${tenantId}|customer:${customerId}`
        : `${tenantId}|guest:${guestIdentityHash ?? 'anon'}`
      return createHash('sha256').update(material, 'utf8').digest('hex')
    },

    async resolveNow() {
      // Epoch millis. Promotion schedule bounds are persisted as UTC instants; a per-tenant timezone
      // offset is a future refinement (the engine compares against these UTC instants).
      return Date.now()
    },

    async hashGiftCardCode(rawCode) {
      return hashGiftCardCode(rawCode, resolveGiftCardPepper())
    },
  }
}
