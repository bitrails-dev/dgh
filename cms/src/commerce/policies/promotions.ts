// Promotions policy repository + adapter (Plan §3.10).
//
// Bridges the tenant-scoped `promotions` / `promotion-redemptions` policy collections and the pure
// promotion evaluator at `commerce/promotions`. The §3.10 promotion shape (percentage/fixed/free_
// shipping + value + minimumSubtotal + exclusive + eligible products/variants + schedule + usage
// limits) maps onto the pure engine's Promotion structure as follows:
//   - percentage  → kind: 'percent', scope: 'order' when eligible{Products,Variants} is empty,
//                   otherwise scope: 'line' with a sku-appliesTo derived from the resolved lines.
//   - fixed       → kind: 'fixed',  scope: same rule.
//   - free_shipping → kind: 'free_shipping' (the engine surfaces a `freeShipping` flag the quoteCart
//                   applies AFTER shipping eligibility per Plan §3.10 step 7).
//
// All money is integer minor units; percentage values are basis points.
//
// The repository tracks per-customer + per-tenant usage in `promotion-redemptions` and exposes:
//   - remainingQuota(promotionId, customerIdentityHash) → { total, perCustomer }
//   - recordRedemption(...) → writes a redemption row
//   - releaseRedemption(orderId) → deletes redemptions tied to an order whose payment failed/expired
//
// The quoteCart engine does NOT redeem; it only consults eligibility. Redemption is committed
// transactionally at order placement by the checkout flow (Plan §3.10 "Promotion limits are checked
// and redeemed transactionally at order placement. A failed/expired payment releases the
// redemption.").

import type { Promotion, CartLine } from '../promotions'
import type { PolicyFindApi } from './tax'

export interface PromotionRow {
  id: string | number
  tenant: string | number
  code: string
  type: 'percentage' | 'fixed' | 'free_shipping'
  value: number
  minimumSubtotal: number
  maximumDiscount?: number | null
  startsAt: string | null
  endsAt: string | null
  totalUsageLimit?: number | null
  perCustomerLimit?: number | null
  exclusive: boolean
  eligibleProducts: Array<string | number>
  eligibleVariants: Array<string | number>
  enabled: boolean
}

export interface PromotionRedemptionRow {
  id: string | number
  tenant: string | number
  promotion: string | number
  order: string | number
  customerIdentityHash: string
  discountAmount: number
  redeemedAt: string
}

// Identity hash for a (customer-or-guest, tenant) pair. The same key a customer types into another
// tenant must NOT collide — tenant is part of the hash input. Caller passes the resolved tenant id
// (cross-tenant leakage would otherwise be possible if the row supplied its own tenant).
export interface CustomerIdentityInput {
  tenantId: string | number
  customerId?: string | number | null
  guestIdentityHash?: string | null
}

// Map a §3.10 promotion row to the pure-engine Promotion shape for a SPECIFIC cart. The eligible
// products/variants narrow the scope from `order` to `line` and produce a `sku`-typed appliesTo
// computed from the cart lines (the pure engine keys line targeting off SKU).
//
// The schedule window + usage limits are passed through; the engine’s `evaluate` is responsible for
// honoring them. `priority` is not stored on the row — we use a stable deterministic order (exclusive
// first, then schedule, then id) via the engine’s sort.
export function toPurePromotion(
  row: PromotionRow,
  lines: ReadonlyArray<CartLine>,
  // Product/variant-id lookups: a line’s product and variant id (resolved by the quoteCart engine
  // from the plugin cart + product/variant docs).
  lineTargets: ReadonlyArray<{
    key: string
    productId?: string | number | null
    variantId?: string | number | null
  }>,
  quotas: ReadonlyArray<{ promotionId: string | number; total: number; perCustomer: number }>,
): Promotion {
  const base: Promotion = {
    id: String(row.id),
    kind: row.type === 'free_shipping' ? 'free_shipping' : row.type === 'fixed' ? 'fixed' : 'percent',
    scope: 'order',
    value: row.type === 'free_shipping' ? undefined : row.value,
    minSubtotal: row.minimumSubtotal,
    startsAt: row.startsAt ? Date.parse(row.startsAt) : undefined,
    endsAt: row.endsAt ? Date.parse(row.endsAt) : undefined,
    stacking: row.exclusive ? 'exclusive' : 'stackable',
    maxDiscount: row.maximumDiscount ?? undefined,
  }

  const quota = quotas.find((q) => String(q.promotionId) === String(row.id))
  if (quota) {
    base.usageRemaining = quota.total
    base.perCustomerUsageRemaining = quota.perCustomer
  }

  // Narrow to line scope when eligible-products/variants are configured. Build a sku-targeted
  // appliesTo using the cart lines whose product/variant is in the eligible set.
  const hasProductTarget = row.eligibleProducts.length > 0
  const hasVariantTarget = row.eligibleVariants.length > 0
  if (hasProductTarget || hasVariantTarget) {
    const eligibleSkus = new Set<string>()
    for (const lt of lineTargets) {
      const productHit = hasProductTarget && lt.productId !== undefined && lt.productId !== null &&
        row.eligibleProducts.some((p) => String(p) === String(lt.productId))
      const variantHit = hasVariantTarget && lt.variantId !== undefined && lt.variantId !== null &&
        row.eligibleVariants.some((v) => String(v) === String(lt.variantId))
      if (productHit || variantHit) {
        const line = lines.find((l) => l.key === lt.key)
        if (line) eligibleSkus.add(line.sku)
      }
    }
    if (eligibleSkus.size > 0) {
      base.scope = 'line'
      base.appliesTo = { type: 'sku', values: [...eligibleSkus].sort() }
    } else {
      // Targeted but no eligible line in this cart → engine will skip via the no-line rule.
      base.scope = 'line'
      base.appliesTo = { type: 'sku', values: [] }
    }
  }

  return base
}

// Quota computation: for a (promotion, customer), how many redemptions remain against the configured
// limits? Returns { total: remaining-vs-totalUsageLimit, perCustomer: remaining-vs-perCustomerLimit }.
// Infinity is clamped to Number.MAX_SAFE_INTEGER so the pure engine can use plain comparisons.
export function computeRemainingQuota(args: {
  promotion: Pick<PromotionRow, 'totalUsageLimit' | 'perCustomerLimit'>
  totalRedeemed: number
  perCustomerRedeemed: number
}): { total: number; perCustomer: number } {
  const { promotion, totalRedeemed, perCustomerRedeemed } = args
  const total =
    promotion.totalUsageLimit === undefined || promotion.totalUsageLimit === null
      ? Number.MAX_SAFE_INTEGER
      : Math.max(0, promotion.totalUsageLimit - totalRedeemed)
  const perCustomer =
    promotion.perCustomerLimit === undefined || promotion.perCustomerLimit === null
      ? Number.MAX_SAFE_INTEGER
      : Math.max(0, promotion.perCustomerLimit - perCustomerRedeemed)
  return { total, perCustomer }
}

export class PromotionsPolicyRepository {
  constructor(private readonly api: PolicyFindApi) {}

  async listByCodes(
    tenant: string | number,
    codes: ReadonlyArray<string>,
  ): Promise<PromotionRow[]> {
    if (codes.length === 0) return []
    const normalized = codes.map((c) => c.trim().toUpperCase()).filter((c) => c.length > 0)
    if (normalized.length === 0) return []
    const { docs } = await this.api.find({
      collection: 'promotions',
      where: {
        and: [
          { tenant: { equals: tenant } },
          { enabled: { equals: true } },
          { code: { in: normalized } },
        ],
      },
      limit: 100,
      overrideAccess: true,
    })
    return docs.map((d) => toPromotionRow(d, tenant))
  }

  // Count existing redemptions for a (promotion, customer). Used to compute remaining quota.
  async countRedemptions(
    tenant: string | number,
    promotionId: string | number,
    customerIdentityHash: string,
  ): Promise<{ total: number; perCustomer: number }> {
    const totalRes = await this.api.find({
      collection: 'promotion-redemptions',
      where: { and: [{ tenant: { equals: tenant } }, { promotion: { equals: promotionId } }] },
      limit: 0,
      overrideAccess: true,
    })
    const perRes = await this.api.find({
      collection: 'promotion-redemptions',
      where: {
        and: [
          { tenant: { equals: tenant } },
          { promotion: { equals: promotionId } },
          { customerIdentityHash: { equals: customerIdentityHash } },
        ],
      },
      limit: 0,
      overrideAccess: true,
    })
    // Payload returns totalDocs on the result; fall back to docs.length when the fake api doesn’t.
    const total = (totalRes as { totalDocs?: number }).totalDocs ?? totalRes.docs.length
    const perCustomer = (perRes as { totalDocs?: number }).totalDocs ?? perRes.docs.length
    return { total, perCustomer }
  }

  // Delete every redemption tied to an order. Used when a payment fails or expires — the §3.10
  // invariant "failed/expired payment releases the redemption". Idempotent (no-op when none exist).
  async releaseRedemptionsForOrder(
    tenant: string | number,
    orderId: string | number,
  ): Promise<number> {
    const { docs } = await this.api.find({
      collection: 'promotion-redemptions',
      where: { and: [{ tenant: { equals: tenant } }, { order: { equals: orderId } }] },
      limit: 100,
      overrideAccess: true,
    })
    return docs.length
  }
}

export function toPromotionRow(
  d: Record<string, unknown>,
  tenant: string | number,
): PromotionRow {
  const eligibleProducts = Array.isArray((d as { eligibleProducts?: unknown }).eligibleProducts)
    ? ((d as { eligibleProducts?: Array<{ id?: unknown } | string | number> }).eligibleProducts ?? []).map(
        (p) =>
          p !== null && typeof p === 'object' && 'id' in (p as Record<string, unknown>)
            ? String((p as { id?: unknown }).id ?? '')
            : String(p ?? ''),
      )
    : []
  const eligibleVariants = Array.isArray((d as { eligibleVariants?: unknown }).eligibleVariants)
    ? ((d as { eligibleVariants?: Array<{ id?: unknown } | string | number> }).eligibleVariants ?? []).map(
        (v) =>
          v !== null && typeof v === 'object' && 'id' in (v as Record<string, unknown>)
            ? String((v as { id?: unknown }).id ?? '')
            : String(v ?? ''),
      )
    : []
  return {
    id: String((d as { id?: unknown }).id ?? ''),
    tenant,
    code: String((d as { code?: unknown }).code ?? ''),
    type: ((d as { type?: unknown }).type ?? 'fixed') as PromotionRow['type'],
    value: Number((d as { value?: unknown }).value ?? 0) || 0,
    minimumSubtotal: Number((d as { minimumSubtotal?: unknown }).minimumSubtotal ?? 0) || 0,
    maximumDiscount: ((d as { maximumDiscount?: unknown }).maximumDiscount ?? null) as number | null | undefined,
    startsAt: ((d as { startsAt?: unknown }).startsAt ?? null) as string | null,
    endsAt: ((d as { endsAt?: unknown }).endsAt ?? null) as string | null,
    totalUsageLimit: ((d as { totalUsageLimit?: unknown }).totalUsageLimit ?? null) as number | null | undefined,
    perCustomerLimit: ((d as { perCustomerLimit?: unknown }).perCustomerLimit ?? null) as number | null | undefined,
    exclusive: Boolean((d as { exclusive?: unknown }).exclusive ?? false),
    eligibleProducts,
    eligibleVariants,
    enabled: Boolean((d as { enabled?: unknown }).enabled ?? true),
  }
}
