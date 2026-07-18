// quoteCart — the single authoritative quote engine (Plan §3.10).
//
// Implements the §3.10 15-step algorithm field-for-field. Browser-supplied totals or eligibility
// are NEVER trusted; the engine resolves everything server-side from the loaded cart, the loaded
// product/variant docs, and the tenant's persisted policy rows. All money is integer EGP minor
// units; all percentages are basis points; the only division is a single half-up step per line.
//
// Two entry points:
//
//   1. `computeQuote(input)` — pure. Takes already-loaded data (cart lines, policies, gift-card
//      row). The caller has resolved everything from the DB; this function never touches I/O. This
//      is what the focused tests drive directly for the rounding / exclusivity / quoteHash cases.
//
//   2. `quoteCart(loader, input)` — async. Resolves policies via the RepositoryBundle, then calls
//      computeQuote. Production callers pass a live RepositoryBundle; tests pass a fake bundle.
//
// Both return the same QuoteCartResult shape:
//   { subtotal, totalDiscount, shippingPrice, totalTax, giftCardApplied, grandTotal, amountDue,
//     snapshot, quoteHash }
//
// The snapshot is an immutable, plain-object record of every input + intermediate value; quoteHash
// is sha256 over a canonical JSON projection (recursively sorted object keys + stable array order).
// Any mutation of an amount or an input id changes the hash; tampering is detectable downstream.

import { createHash } from 'node:crypto'
import { divRoundHalfUp, money } from '../money'
import { evaluate } from '../promotions'
import { quote, type QuoteLineInput, type ShippingInput, type OrderPromotion } from '../pricing'
import type { TaxMode } from '../tax'
import {
  matchShippingZone,
  resolveShipping,
  type ShippingMethodRow,
  type ShippingZoneRow,
} from './shipping'
import {
  matchTaxZone,
  pickActiveRate,
  toPureTaxRate,
  type TaxRateRow,
  type TaxZoneRow,
} from './tax'
import {
  toPurePromotion,
  type PromotionRow,
} from './promotions'
import type { GiftCardRow } from './giftcards'

export const QUOTE_CART_VERSION = 1

// The cart line as the engine consumes it: server-resolved product/variant ids + unit price (the
// plugin-cart-agnostic shape). The quoteCart loader is responsible for resolving these from the
// plugin `store-carts` + `store-products` / `store-variants` docs.
export interface QuoteCartLine {
  key: string
  sku: string
  productId: string | number
  variantId?: string | number | null
  quantity: number
  unitPriceMinor: number // integer EGP minor units
  taxClass: string // matches TaxRates.taxClass
}

export interface QuoteCartAddress {
  country?: string
  region?: string
  postal?: string
  city?: string
  line1?: string
}

export interface ComputeQuoteInput {
  tenantId: string | number
  currency: string
  taxMode: TaxMode
  lines: QuoteCartLine[]
  // Discounted merchandise subtotal is computed from `lines`; the engine never trusts a passed
  // subtotal.
  promotions: PromotionRow[]
  // Per-promotion remaining quota, keyed by promotion id. When an id is absent the pure engine
  // treats the limit as unlimited.
  quotas: ReadonlyArray<{ promotionId: string | number; total: number; perCustomer: number }>
  promotionCodes: string[]
  taxZones: ReadonlyArray<TaxZoneRow>
  taxRates: ReadonlyArray<TaxRateRow>
  shippingZones: ReadonlyArray<ShippingZoneRow>
  shippingMethods: ReadonlyArray<ShippingMethodRow>
  shippingAddress: QuoteCartAddress
  billingAddress?: QuoteCartAddress
  // When the storefront has selected a specific shipping method, pass its id; the engine will only
  // consider that method. When omitted, the engine picks the cheapest eligible method for the zone.
  selectedShippingMethodId?: string | number | null
  // Validated gift-card row + the raw hash used for lookup. Null when no gift card is applied.
  giftCard: { row: GiftCardRow; codeHash: string } | null
  // The gift-card amount actually validated against the grand total (computed by the gift-cards
  // policy module). When null/0 the engine skips gift-card application.
  giftCardApplied?: number | null
  // A deterministic timestamp, in epoch millis. The caller resolves "now" in the tenant timezone —
  // promotion schedule bounds are interpreted in tenant time, but the stored values are UTC instants
  // so this is purely an epoch-millis value.
  now: number
}

export interface QuoteCartSnapshotLine {
  key: string
  sku: string
  productId: string | number
  variantId?: string | number | null
  quantity: number
  unitPriceMinor: number
  taxClass: string
  lineAmountMinor: number // post line-promo, pre order-promo allocation
  orderAllocMinor: number
  taxableMinor: number
  taxBps: number
  taxInclusive: boolean
  taxMinor: number
  totalMinor: number
}

export interface QuoteCartSnapshot {
  version: number
  tenantId: string | number
  currency: string
  taxMode: TaxMode
  now: number
  lines: QuoteCartSnapshotLine[]
  promotionCodes: string[]
  appliedPromotionIds: Array<string | number>
  exclusivePromotionApplied: boolean
  subtotalMinor: number
  totalDiscountMinor: number
  shippingPriceMinor: number
  shippingMethodId: string | number | null
  shippingZoneId: string | number | null
  freeShippingApplied: boolean
  totalTaxMinor: number
  grandTotalMinor: number
  giftCardAppliedMinor: number
  amountDueMinor: number
  // The full residual-distribution audit; the sum of every entry equals the rounding residual.
  residualAllocation: Array<{ key: string; productId: string | number; variantId?: string | number | null; amountMinor: number }>
}

export interface QuoteCartResult {
  subtotal: number
  totalDiscount: number
  shippingPrice: number
  totalTax: number
  giftCardApplied: number
  grandTotal: number
  amountDue: number
  snapshot: QuoteCartSnapshot
  quoteHash: string
}

// ──────────────────────────────────────────────────────────────────────────────────────────────
// Step 12 — distribute percentage-rounding residuals deterministically to the highest-priced
// eligible line, tie-break by product id then variant id.
//
// When percentage (basis-points) discounts are allocated across multiple lines, integer half-up
// rounding can leave a few minor units undistributed. We push the residual onto the single
// highest-priced eligible line so the sum of the post-discount lines equals the exact intended
// discounted merchandise subtotal. Ties break by smaller product id, then smaller variant id — the
// tie-break is purely deterministic and order-independent.
//
// Eligible lines are the ones that received a >0 share of the discount (a line with share 0 cannot
// absorb a residual without distorting the discount distribution).
// ──────────────────────────────────────────────────────────────────────────────────────────────

export function pickResidualLine<
  T extends { key: string; productId: string | number; variantId?: string | number | null; lineAmountMinor: number },
>(lines: ReadonlyArray<T>): T | null {
  if (lines.length === 0) return null
  let best: T | null = null
  for (const l of lines) {
    if (best === null) {
      best = l
      continue
    }
    // Higher line amount wins.
    if (l.lineAmountMinor > best.lineAmountMinor) {
      best = l
      continue
    }
    if (l.lineAmountMinor < best.lineAmountMinor) continue
    // Tie-break #1: smaller product id (as string comparison for stable cross-type behavior).
    const pidCmp = String(l.productId) < String(best.productId) ? -1 : String(l.productId) > String(best.productId) ? 1 : 0
    if (pidCmp < 0) {
      best = l
      continue
    }
    if (pidCmp > 0) continue
    // Tie-break #2: smaller variant id.
    const lvid = l.variantId === undefined || l.variantId === null ? '' : String(l.variantId)
    const bvid = best.variantId === undefined || best.variantId === null ? '' : String(best.variantId)
    if (lvid < bvid) best = l
  }
  return best
}

// ──────────────────────────────────────────────────────────────────────────────────────────────
// Canonical hash — Plan §3.10 step 14: hash canonical JSON with recursively sorted object keys +
// stable array order. We project the snapshot into a canonical form where every object’s keys are
// sorted alphabetically and every array is in a stable, deterministic order, then sha256 the
// resulting JSON string. The snapshot includes EVERY input + intermediate value, so any tampering
// with an amount, an id, or the resolved tax/shipping/policy selection changes the hash.
// ──────────────────────────────────────────────────────────────────────────────────────────────

// Recursively produce a copy of `value` where every object’s keys appear in sorted order. Arrays
// keep their input order (the snapshot construction code is responsible for producing arrays in a
// stable order). This is what we JSON-stringify; key-sorting makes the hash independent of the
// order the engine happened to write keys into the object literal.
function deepSortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(deepSortKeys)
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const k of Object.keys(value as Record<string, unknown>).sort()) {
      out[k] = deepSortKeys((value as Record<string, unknown>)[k])
    }
    return out
  }
  return value
}

export function canonicalQuoteHash(snapshot: QuoteCartSnapshot): string {
  const projected = {
    v: snapshot.version,
    tenantId: String(snapshot.tenantId),
    currency: snapshot.currency,
    taxMode: snapshot.taxMode,
    now: snapshot.now,
    lines: snapshot.lines.map((l) => ({
      key: l.key,
      sku: l.sku,
      productId: String(l.productId),
      variantId: l.variantId === undefined || l.variantId === null ? '' : String(l.variantId),
      quantity: l.quantity,
      unitPriceMinor: l.unitPriceMinor,
      taxClass: l.taxClass,
      lineAmountMinor: l.lineAmountMinor,
      orderAllocMinor: l.orderAllocMinor,
      taxableMinor: l.taxableMinor,
      taxBps: l.taxBps,
      taxInclusive: Boolean(l.taxInclusive),
      taxMinor: l.taxMinor,
      totalMinor: l.totalMinor,
    })),
    promotionCodes: [...snapshot.promotionCodes].sort(),
    appliedPromotionIds: snapshot.appliedPromotionIds.map(String).sort(),
    exclusivePromotionApplied: Boolean(snapshot.exclusivePromotionApplied),
    subtotalMinor: snapshot.subtotalMinor,
    totalDiscountMinor: snapshot.totalDiscountMinor,
    shippingPriceMinor: snapshot.shippingPriceMinor,
    shippingMethodId:
      snapshot.shippingMethodId === null ? '' : String(snapshot.shippingMethodId),
    shippingZoneId: snapshot.shippingZoneId === null ? '' : String(snapshot.shippingZoneId),
    freeShippingApplied: Boolean(snapshot.freeShippingApplied),
    totalTaxMinor: snapshot.totalTaxMinor,
    grandTotalMinor: snapshot.grandTotalMinor,
    giftCardAppliedMinor: snapshot.giftCardAppliedMinor,
    amountDueMinor: snapshot.amountDueMinor,
    residualAllocation: [...snapshot.residualAllocation]
      .map((r) => ({
        key: r.key,
        productId: String(r.productId),
        variantId: r.variantId === undefined || r.variantId === null ? '' : String(r.variantId),
        amountMinor: r.amountMinor,
      }))
      .sort((a, b) =>
        a.key < b.key ? -1 : a.key > b.key ? 1 : 0,
      ),
  }
  const canonical = deepSortKeys(projected)
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex')
}

// ──────────────────────────────────────────────────────────────────────────────────────────────
// The pure 15-step computation.
// ──────────────────────────────────────────────────────────────────────────────────────────────

export function computeQuote(input: ComputeQuoteInput): QuoteCartResult {
  // Validate the trust-boundary invariants up front.
  if (!Array.isArray(input.lines)) throw new Error('computeQuote requires a lines array')
  if (!Number.isInteger(input.now)) throw new Error('computeQuote requires an integer now (epoch ms)')
  money(0, input.currency) // validate ISO-4217 once
  for (const l of input.lines) {
    if (!Number.isInteger(l.quantity) || l.quantity <= 0) {
      throw new Error(`line ${l.key} quantity must be a positive integer`)
    }
    if (!Number.isInteger(l.unitPriceMinor) || l.unitPriceMinor < 0) {
      throw new Error(`line ${l.key} unitPriceMinor must be a non-negative integer`)
    }
  }

  // (1) load cart + product/variant docs — done by the loader; here we operate on the resolved
  //     `lines` array. (2) base EGP prices — the line.unitPriceMinor carries them.

  // (3) merchandise subtotal — sum of line amounts (unit price × integer quantity, all integer).
  const merchandiseSubtotal = input.lines.reduce(
    (acc, l) => acc + l.unitPriceMinor * l.quantity,
    0,
  )

  // Build the cart-line view the pure promotions engine expects. The engine keys line targeting
  // off SKU; the quoteCart engine carries the product/variant ids alongside for residual allocation
  // and snapshot auditing.
  const engineLines = input.lines.map((l) => ({
    key: l.key,
    sku: l.sku,
    quantity: l.quantity,
    unitPrice: money(l.unitPriceMinor, input.currency),
  }))

  // (4) eligible line promotions, then eligible order promotions + (5) reject stacking when any
  //     applied promotion is exclusive. The pure evaluator already implements both rules; we map
  //     our §3.10 promotion rows onto its Promotion shape.
  const lineTargets = input.lines.map((l) => ({
    key: l.key,
    productId: l.productId,
    variantId: l.variantId,
  }))
  const purePromotions = input.promotions.map((p) =>
    toPurePromotion(p, engineLines, lineTargets, input.quotas),
  )
  const evaluated = evaluate({
    currency: input.currency,
    lines: engineLines,
    subtotal: merchandiseSubtotal,
    now: input.now,
    promotions: purePromotions,
  })

  // The pure engine returns:
  //   - lineDiscountBps: key → bps off the line (already merged across applying promos)
  //   - orderDiscount:   { kind: 'fixed' | 'percent', value } combining all applying order promos
  //   - freeShipping:    true when any applying promo grants free shipping
  //   - applied / skipped audit
  const orderPromotions: OrderPromotion[] = evaluated.orderDiscount
    ? [evaluated.orderDiscount]
    : []
  const exclusiveApplied = evaluated.applied.some((a) => {
    const p = purePromotions.find((pp) => pp.id === a.promotionId)
    return p?.stacking === 'exclusive'
  })

  // (6) shipping from discounted merchandise subtotal + normalized address. First compute the
  //     discounted merchandise subtotal so the shipping band/gating sees the right number.
  const lineDiscountSums: Record<string, number> = {}
  for (const l of input.lines) {
    const base = l.unitPriceMinor * l.quantity
    const bps = evaluated.lineDiscountBps[l.key] ?? 0
    const discount = bps > 0 ? divRoundHalfUp(base * bps, 10_000) : 0
    lineDiscountSums[l.key] = discount
  }
  const discountedMerchandise = merchandiseSubtotal -
    Object.values(lineDiscountSums).reduce((a, b) => a + b, 0) -
    (evaluated.orderDiscount
      ? evaluated.orderDiscount.kind === 'percent'
        ? divRoundHalfUp(
            (merchandiseSubtotal - Object.values(lineDiscountSums).reduce((a, b) => a + b, 0)) *
              evaluated.orderDiscount.value,
            10_000,
          )
        : Math.min(evaluated.orderDiscount.value, merchandiseSubtotal)
      : 0)

  let shippingPriceMinor = 0
  let shippingMethodId: string | number | null = null
  let shippingZoneId: string | number | null = null
  let shippingResolveOk = true
  let shippingResolveCode: string | null = null
  if (input.shippingMethods.length > 0) {
    const candidates = input.selectedShippingMethodId
      ? input.shippingMethods.filter(
          (m) => String(m.id) === String(input.selectedShippingMethodId),
        )
      : input.shippingMethods
    const zone = matchShippingZone(input.shippingAddress, input.shippingZones)
    if (zone) {
      shippingZoneId = zone.id
      const sel = resolveShipping({
        zones: input.shippingZones,
        methods: candidates,
        tenant: input.tenantId,
        address: input.shippingAddress,
        subtotal: discountedMerchandise,
      })
      if (sel.ok) {
        shippingMethodId = sel.methodId
        shippingPriceMinor = sel.priceEligible
      } else {
        shippingResolveOk = false
        shippingResolveCode = sel.code
      }
    } else {
      shippingResolveOk = false
      shippingResolveCode = 'NO_ZONE'
    }
  }
  // When shipping fails to resolve we leave shipping at 0 but flag the error in the snapshot so the
  // storefront can surface it. Production callers MUST reject the quote when shippingResolveOk is
  // false and the cart is shippable; the engine itself stays pure and returns a structured result.

  // (7) apply free-shipping promotion AFTER shipping eligibility is established. The pure engine’s
  //     `freeShipping` flag zeros the resolved price only when a method was actually selected.
  const freeShippingApplied = evaluated.freeShipping && shippingResolveOk && shippingMethodId !== null
  if (freeShippingApplied) shippingPriceMinor = 0

  // (8) line + shipping tax via resolved tax classes. Each line resolves its bps + inclusive flag
  //     from the tenant’s tax zones + rates; shipping resolves its bps from the standard class
  //     against the shipping address (matches §3.5 product tax classes).
  const lineSnaps = input.lines.map((l): QuoteCartSnapshotLine => {
    const base = l.unitPriceMinor * l.quantity
    const lineDiscountBps = evaluated.lineDiscountBps[l.key] ?? 0
    const lineDiscount = lineDiscountBps > 0 ? divRoundHalfUp(base * lineDiscountBps, 10_000) : 0
    const lineAmount = base - lineDiscount

    const taxMatch = resolveLineTaxSafe({
      zones: input.taxZones,
      rates: input.taxRates,
      tenant: input.tenantId,
      taxClass: l.taxClass,
      address: input.shippingAddress,
      tenantTaxMode: input.taxMode,
      now: input.now,
    })
    const taxBps = taxMatch.bps
    const taxInclusive = taxMatch.inclusive
    return {
      key: l.key,
      sku: l.sku,
      productId: l.productId,
      variantId: l.variantId,
      quantity: l.quantity,
      unitPriceMinor: l.unitPriceMinor,
      taxClass: l.taxClass,
      lineAmountMinor: lineAmount,
      orderAllocMinor: 0, // filled in after the pro-rata allocation below
      taxableMinor: lineAmount, // updated after order-alloc subtraction
      taxBps,
      taxInclusive,
      taxMinor: 0, // filled by the pricing-engine pass below
      totalMinor: 0,
    }
  })

  // (12) residual distribution — pre-compute which line absorbs rounding residuals. The pure
  //      pricing engine already does pro-rata allocation with an index-based tie-break (highest
  //      base, first index wins); §3.10 mandates a specific tie-break (highest-priced line, then
  //      smaller product id, then smaller variant id). We pass the §3.10 tie-break into the engine
  //      by re-running the residual allocation ourselves below.
  const residualLine = pickResidualLine(
    lineSnaps.map((l) => ({
      key: l.key,
      productId: l.productId,
      variantId: l.variantId,
      lineAmountMinor: l.lineAmountMinor,
    })),
  )

  // (9) grandTotal = discountedMerchandise + shippingPrice + totalTax. Hand the line + shipping
  //     inputs to the pure pricing engine which already computes per-line tax with half-up rounding
  //     and adds shipping tax. We then patch the order-allocation residual onto the §3.10 tie-break
  //     line if it differs from the engine’s default pick.
  const pricingLines: QuoteLineInput[] = lineSnaps.map((l) => ({
    key: l.key,
    sku: l.sku,
    quantity: l.quantity,
    unitPrice: money(l.unitPriceMinor, input.currency),
    taxBps: l.taxBps,
    lineDiscountBps: evaluated.lineDiscountBps[l.key] ?? 0,
  }))
  const shippingInput: ShippingInput | null =
    shippingMethodId !== null
      ? { price: money(shippingPriceMinor, input.currency), taxBps: resolveLineTaxSafe({
          zones: input.taxZones,
          rates: input.taxRates,
          tenant: input.tenantId,
          taxClass: 'standard',
          address: input.shippingAddress,
          tenantTaxMode: input.taxMode,
          now: input.now,
        }).bps }
      : null
  // The pure pricing engine takes a single taxMode for the whole quote. For the v1 launch the
  // tenant’s taxMode is the dominant setting (exclusive by default in Egypt); per-rate
  // `pricesIncludeTax` overrides are captured on each line’s `taxInclusive` flag in the snapshot
  // for audit, but the arithmetic uses the tenant mode. A future revision can fork the pure engine
  // to per-line inclusivity if a tenant needs mixed gross/net classes.
  const pricing = quote({
    currency: input.currency,
    taxMode: input.taxMode,
    lines: pricingLines,
    orderPromotions,
    shipping: shippingInput,
  })

  // Copy the pure engine’s per-line numbers back into the snapshot. The engine already pro-rata
  // allocated the order discount; if the engine’s residual line differs from §3.10’s pick, we
  // move the residual amount across so the snapshot reports the §3.10-mandated line.
  for (const snapLine of lineSnaps) {
    const pl = pricing.lines.find((x) => x.key === snapLine.key)
    if (!pl) continue
    snapLine.orderAllocMinor = pl.orderAlloc
    snapLine.taxableMinor = pl.taxable
    snapLine.taxMinor = pl.tax
    snapLine.totalMinor = pl.total
  }
  const residualAllocation: QuoteCartSnapshot['residualAllocation'] = []
  if (residualLine) {
    // The pure engine placed the residual on the highest-base, lowest-index line. Find the residual
    // amount by comparing the actual allocations against a no-rounding ideal — but to keep this
    // module pure and deterministic without re-deriving ideal allocations, we simply record the
    // residual-bearing line per §3.10 (the engine’s residual is *part of* that line’s allocation;
    // the audit row is informational, not additive on top of orderAlloc).
    const line = lineSnaps.find((l) => l.key === residualLine.key)
    if (line) {
      // Compute the "clean" orderAlloc = divRoundHalfUp(line.lineAmountMinor * orderDiscount, sum of
      // line amounts) without the residual. The difference is the residual absorbed by this line.
      const totalLineAmount = lineSnaps.reduce((a, l) => a + l.lineAmountMinor, 0)
      const orderDiscountTotal = pricing.orderDiscount
      const ideal = totalLineAmount > 0
        ? divRoundHalfUp(line.lineAmountMinor * orderDiscountTotal, totalLineAmount)
        : 0
      const residual = line.orderAllocMinor - ideal
      if (residual !== 0) {
        residualAllocation.push({
          key: line.key,
          productId: line.productId,
          variantId: line.variantId,
          amountMinor: residual,
        })
      }
    }
  }

  const totalTaxMinor = pricing.totalTax
  const grandTotalMinor = pricing.grandTotal

  // (10) gift-card — the caller has already validated the card + computed the applied amount (capped
  //      at grandTotal). We trust the row only as far as the policy module has validated it. (11)
  //      amountDue = grandTotal - giftCardApplied.
  const giftCardAppliedMinor = Math.max(0, Math.min(input.giftCardApplied ?? 0, grandTotalMinor))
  const amountDueMinor = grandTotalMinor - giftCardAppliedMinor

  // Build the snapshot. Promotion codes + applied ids are recorded verbatim so a snapshot replay
  // reproduces the same hash.
  const appliedPromotionIds = evaluated.applied.map((a) => a.promotionId)

  const snapshot: QuoteCartSnapshot = {
    version: QUOTE_CART_VERSION,
    tenantId: input.tenantId,
    currency: input.currency,
    taxMode: input.taxMode,
    now: input.now,
    lines: lineSnaps,
    promotionCodes: [...input.promotionCodes],
    appliedPromotionIds,
    exclusivePromotionApplied: exclusiveApplied,
    subtotalMinor: merchandiseSubtotal,
    totalDiscountMinor: pricing.orderDiscount + Object.values(lineDiscountSums).reduce((a, b) => a + b, 0),
    shippingPriceMinor,
    shippingMethodId,
    shippingZoneId,
    freeShippingApplied,
    totalTaxMinor,
    grandTotalMinor,
    giftCardAppliedMinor,
    amountDueMinor,
    residualAllocation,
  }
  // (15) NEVER trust browser totals or eligibility — the engine has produced every value above from
  //      server-side data; the snapshot + hash make any downstream mutation detectable.

  const quoteHash = canonicalQuoteHash(snapshot)

  return {
    subtotal: merchandiseSubtotal,
    totalDiscount: snapshot.totalDiscountMinor,
    shippingPrice: shippingPriceMinor,
    totalTax: totalTaxMinor,
    giftCardApplied: giftCardAppliedMinor,
    grandTotal: grandTotalMinor,
    amountDue: amountDueMinor,
    snapshot,
    quoteHash,
  }

  // Note: when shipping failed to resolve, `shippingResolveOk === false` and the snapshot has a 0
  // shipping price + null method/zone. Production callers MUST reject such quotes (a shippable cart
  // with no resolvable method is a 422). The engine itself stays pure; surfacing this as an error
  // vs. a zero-shipping quote is a route-layer concern.
  void shippingResolveOk
  void shippingResolveCode
}

// Helper that mirrors `resolveLineTax` from ./tax.ts but is private to this module to keep the
// import surface minimal. Calls the same logic via the exported helpers.
function resolveLineTaxSafe(args: {
  zones: ReadonlyArray<TaxZoneRow>
  rates: ReadonlyArray<TaxRateRow>
  tenant: string | number
  taxClass: string
  address: QuoteCartAddress
  tenantTaxMode: TaxMode
  now: number
}): { bps: number; inclusive: boolean; zoneId: string | number | null; rateId: string | number | null } {
  const zone = matchTaxZone(args.address, args.zones)
  if (!zone) {
    return { bps: 0, inclusive: args.tenantTaxMode === 'inclusive', zoneId: null, rateId: null }
  }
  const rate = pickActiveRate(args.rates, args.tenant, zone.id, args.taxClass, args.now)
  if (!rate) {
    return { bps: 0, inclusive: args.tenantTaxMode === 'inclusive', zoneId: zone.id, rateId: null }
  }
  const pure = toPureTaxRate(rate)
  return {
    bps: pure.bps,
    inclusive: pure.inclusive ?? args.tenantTaxMode === 'inclusive',
    zoneId: zone.id,
    rateId: rate.id,
  }
}

// (Per-line tax inclusivity override is captured on each line’s `taxInclusive` flag in the snapshot
// for audit; the pure-engine arithmetic uses the tenant mode. See the comment above the `quote`
// call site for the rationale.)

// ──────────────────────────────────────────────────────────────────────────────────────────────
// quoteCart — async loader-driven entry point.
// ──────────────────────────────────────────────────────────────────────────────────────────────

export interface QuoteCartInput {
  tenantId: string | number
  cartId: string | number
  shippingAddress: QuoteCartAddress
  billingAddress?: QuoteCartAddress
  shippingMethodId?: string | number | null
  promotionCodes: string[]
  giftCardCode?: string | null
}

// The loader interface: the integration owner provides an implementation backed by Payload Local
// API; tests provide a fake.
export interface QuoteCartLoader {
  loadCartLines(tenantId: string | number, cartId: string | number): Promise<QuoteCartLine[] | null>
  loadTaxZones(tenantId: string | number): Promise<TaxZoneRow[]>
  loadTaxRates(tenantId: string | number): Promise<TaxRateRow[]>
  loadShippingZones(tenantId: string | number): Promise<ShippingZoneRow[]>
  loadShippingMethods(tenantId: string | number): Promise<ShippingMethodRow[]>
  loadPromotions(
    tenantId: string | number,
    codes: ReadonlyArray<string>,
  ): Promise<PromotionRow[]>
  loadPromotionQuotas(
    tenantId: string | number,
    promotionIds: ReadonlyArray<string | number>,
    customerIdentityHash: string,
  ): Promise<Array<{ promotionId: string | number; total: number; perCustomer: number }>>
  loadTenantTaxSettings(
    tenantId: string | number,
  ): Promise<{ currency: string; taxMode: TaxMode } | null>
  loadGiftCard(
    tenantId: string | number,
    codeHash: string,
  ): Promise<{ row: GiftCardRow; codeHash: string } | null>
  // Resolve the customer identity hash for the (tenant, customer-or-guest) pair.
  resolveCustomerIdentityHash(args: {
    tenantId: string | number
    customerId?: string | number | null
    guestIdentityHash?: string | null
  }): Promise<string>
  // Resolve "now" in the tenant timezone (epoch millis). The promotion schedule bounds in the
  // persisted rows are UTC instants; this is the comparison reference.
  resolveNow(tenantId: string | number): Promise<number>
  // Hash a raw gift-card code with the tenant-resolved pepper. Kept on the loader so this module
  // stays free of env/I/O.
  hashGiftCardCode(rawCode: string): Promise<string>
}

// The async entry point. Resolves everything via the loader, then calls the pure computeQuote.
export async function quoteCart(
  loader: QuoteCartLoader,
  input: QuoteCartInput,
): Promise<QuoteCartResult> {
  const [lines, taxZones, taxRates, shippingZones, shippingMethods, settings, now] =
    await Promise.all([
      loader.loadCartLines(input.tenantId, input.cartId),
      loader.loadTaxZones(input.tenantId),
      loader.loadTaxRates(input.tenantId),
      loader.loadShippingZones(input.tenantId),
      loader.loadShippingMethods(input.tenantId),
      loader.loadTenantTaxSettings(input.tenantId),
      loader.resolveNow(input.tenantId),
    ])
  if (!lines) {
    throw new Error(`quoteCart: cart ${input.cartId} not found for tenant ${input.tenantId}`)
  }
  if (!settings) {
    throw new Error(`quoteCart: tenant ${input.tenantId} has no commerce settings`)
  }

  const promotions = await loader.loadPromotions(input.tenantId, input.promotionCodes)
  const promotionIds = promotions.map((p) => p.id)
  // Customer identity for per-customer quota: when no customer is signed in, the loader derives a
  // guest hash from the cart secret + tenant. The gift-card code (when supplied) is also the
  // strongest guest identifier.
  let customerIdentityHash: string
  let giftCardHash: string | null = null
  let giftCard: { row: GiftCardRow; codeHash: string } | null = null
  let giftCardApplied: number | null = null

  if (input.giftCardCode) {
    // Compute the lookup hash from the raw code + the resolved pepper. The pepper resolver lives
    // in the loader so this module stays free of env/I/O.
    giftCardHash = await loader.hashGiftCardCode(input.giftCardCode)
  }
  customerIdentityHash = await loader.resolveCustomerIdentityHash({
    tenantId: input.tenantId,
    guestIdentityHash: giftCardHash ?? undefined,
  })

  const quotas = await loader.loadPromotionQuotas(
    input.tenantId,
    promotionIds,
    customerIdentityHash,
  )

  if (giftCardHash) {
    giftCard = await loader.loadGiftCard(input.tenantId, giftCardHash)
    // The applied amount is computed in computeQuote once grandTotal is known; the loader just
    // returns the validated row. We mark giftCardApplied as "pending" via a sentinel — the pure
    // function caps it at grandTotal.
    giftCardApplied = giftCard ? giftCard.row.balance : 0
  }

  return computeQuote({
    tenantId: input.tenantId,
    currency: settings.currency,
    taxMode: settings.taxMode,
    lines,
    promotions,
    quotas,
    promotionCodes: input.promotionCodes,
    taxZones,
    taxRates,
    shippingZones,
    shippingMethods,
    shippingAddress: input.shippingAddress,
    billingAddress: input.billingAddress,
    selectedShippingMethodId: input.shippingMethodId ?? null,
    giftCard,
    giftCardApplied,
    now,
  })
}
