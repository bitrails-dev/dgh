// Wave F1 — plugin-cutover parity (UNIT, pure-function). Proves the plugin-first quote engine
// (computeQuote, cms/src/commerce/policies/quote.ts) and the legacy quote engine (quote,
// cms/src/commerce/pricing) produce IDENTICAL money for comparable inputs, so Wave F2 can retire the
// legacy engine + its line-taxBps model without behavior change.
//
// The hard part (Plan §3.10 + the parity contract): the legacy engine is line-`taxBps` based; the
// plugin `computeQuote` engine is tax-class/zone based. They do NOT share internal field names. But
// they DO share the same arithmetic core — `computeQuote` resolves each line's effective bps from the
// tenant's tax policy, then delegates the actual money math to the SAME pure `quote()` the legacy
// path calls directly (see policies/quote.ts → `quote({ ... })`). So when the configured tax policy
// yields the same effective rate a legacy line carries directly, the two engines MUST agree to the
// last minor unit. This suite constructs that comparable policy and asserts the GRAND TOTAL,
// merchandise subtotal, total tax, shipping, discount, gift-card applied, amount due, and each
// line's post-tax net + tax — never the internal field names.
//
// Matrix (Plan §8 Commit F1): simple product · multi-line · promotion · gift-card · tax-inclusive ·
// tax-exclusive · zero-tax · shipping. Variant pricing + insufficient-stock are cart/checkout
// concerns covered by the integration parity suite (commerce-cutover-parity.integration.test.ts).
//
// All money is integer EGP minor units. Rates are integer basis points. STOP condition: if a case
// below reveals a real plugin-first discrepancy, the assertion fails here and the divergence is
// reported — the engine is NEVER patched to force green.

import assert from 'node:assert/strict'
import test from 'node:test'

import { quote, type QuoteSnapshot } from '../src/commerce/pricing'
import { money } from '../src/commerce/money'
import { computeQuote, type QuoteCartLine, type QuoteCartResult } from '../src/commerce/policies/quote'
import type { TaxZoneRow, TaxRateRow } from '../src/commerce/policies/tax'
import type { ShippingZoneRow, ShippingMethodRow } from '../src/commerce/policies/shipping'
import type { PromotionRow } from '../src/commerce/policies/promotions'

const TENANT = 1
const NOW = 1_700_000_000_000 // integer epoch ms (computeQuote validates this)
const CURRENCY = 'EGP'
const STANDARD = 'standard'
const ZERO = 'zero'

type TaxMode = 'inclusive' | 'exclusive'

// A line described once, in the currency-agnostic terms BOTH engines understand. `taxBps` is the
// EFFECTIVE rate the line must be taxed at; the legacy engine reads it directly, the plugin engine
// resolves it via the line's taxClass → tax-rate row.
interface LineSpec {
  sku: string
  productId: number | string
  unitPriceMinor: number
  quantity: number
  taxBps: number
}

interface Scenario {
  taxMode: TaxMode
  lines: LineSpec[]
  // The rate configured for taxClass 'standard'. Lines whose taxBps === standardTaxBps map to
  // 'standard'; lines whose taxBps === 0 map to 'zero'. (The matrix needs no third class.)
  standardTaxBps?: number
  // Order-scope percentage promotion (basis points off the merchandise subtotal), applied to both
  // engines through their respective promotion representations.
  orderPromoPercentBps?: number
  // A resolved shipping price; both engines add shipping taxed at the standard rate. No subtotal
  // gating on the fixture method so the discounted subtotal never changes eligibility.
  shippingPriceMinor?: number
  // A gift-card tender (minor units); both engines cap it at the grand total.
  giftCardMinor?: number
}

// The tax policy both engines share: one catch-all zone (no country filter → matches the empty
// address) + a 'standard' rate at `standardBps` + a 'zero' rate at 0. `pickActiveRate` selects the
// row matching each line's taxClass, so the resolved bps equals the legacy line's direct taxBps.
function taxPolicy(standardBps: number): { zones: TaxZoneRow[]; rates: TaxRateRow[] } {
  const from = new Date(NOW - 86_400_000).toISOString()
  const zone: TaxZoneRow = {
    id: 'tz-1', tenant: TENANT, code: 'CATCHALL',
    country: null, regions: null, postalPrefixes: null, priority: 0, enabled: true,
  }
  const rates: TaxRateRow[] = [
    { id: 'tr-std', tenant: TENANT, zone: zone.id, taxClass: STANDARD, rateBps: standardBps, pricesIncludeTax: false, effectiveFrom: from, effectiveTo: null, enabled: true },
    { id: 'tr-zero', tenant: TENANT, zone: zone.id, taxClass: ZERO, rateBps: 0, pricesIncludeTax: false, effectiveFrom: from, effectiveTo: null, enabled: true },
  ]
  return { zones: [zone], rates }
}

// Map a line's effective taxBps to the taxClass whose configured rate reproduces it.
function classFor(taxBps: number, standardBps: number): string {
  if (taxBps === standardBps) return STANDARD
  if (taxBps === 0) return ZERO
  throw new Error(`parity fixture: taxBps ${taxBps} has no matching tax class (standard=${standardBps})`)
}

// Run the SAME cart through both engines and return both snapshots.
function runParity(s: Scenario): { legacy: QuoteSnapshot; plugin: QuoteCartResult } {
  const standardBps = s.standardTaxBps ?? 0
  const { zones, rates } = taxPolicy(standardBps)
  const hasShipping = s.shippingPriceMinor !== undefined && s.shippingPriceMinor !== null

  const legacy = quote({
    currency: CURRENCY,
    taxMode: s.taxMode,
    lines: s.lines.map((l) => ({
      key: l.sku, sku: l.sku, quantity: l.quantity,
      unitPrice: money(l.unitPriceMinor, CURRENCY), taxBps: l.taxBps,
    })),
    orderPromotions: s.orderPromoPercentBps ? [{ kind: 'percent', value: s.orderPromoPercentBps }] : [],
    shipping: hasShipping ? { price: money(s.shippingPriceMinor as number, CURRENCY), taxBps: standardBps } : null,
    giftCardTenders: s.giftCardMinor ? [money(s.giftCardMinor, CURRENCY)] : [],
  })

  const pluginLines: QuoteCartLine[] = s.lines.map((l) => ({
    key: l.sku, sku: l.sku, productId: l.productId, variantId: null,
    quantity: l.quantity, unitPriceMinor: l.unitPriceMinor, taxClass: classFor(l.taxBps, standardBps),
  }))

  const shippingZones: ShippingZoneRow[] = hasShipping
    ? [{ id: 'sz-1', tenant: TENANT, code: 'SHIP', country: null, regions: null, postalPrefixes: null, priority: 0, enabled: true }]
    : []
  const shippingMethods: ShippingMethodRow[] = hasShipping
    ? [{
        id: 'sm-1', tenant: TENANT, zone: 'sz-1', code: 'STD',
        basePrice: s.shippingPriceMinor as number,
        // freeAboveSubtotal huge → free shipping never triggers; no min/max → never gated out.
        freeAboveSubtotal: Number.MAX_SAFE_INTEGER, minimumSubtotal: null, maximumSubtotal: null, enabled: true,
      }]
    : []

  const promoRow: PromotionRow | null = s.orderPromoPercentBps
    ? {
        id: 'p10', tenant: TENANT, code: 'P10', type: 'percentage', value: s.orderPromoPercentBps,
        minimumSubtotal: 0, maximumDiscount: null, startsAt: null, endsAt: null,
        totalUsageLimit: null, perCustomerLimit: null, exclusive: false,
        eligibleProducts: [], eligibleVariants: [], enabled: true,
      }
    : null

  const plugin = computeQuote({
    tenantId: TENANT, currency: CURRENCY, taxMode: s.taxMode, lines: pluginLines,
    promotions: promoRow ? [promoRow] : [], quotas: [], promotionCodes: promoRow ? ['P10'] : [],
    taxZones: zones, taxRates: rates, shippingZones, shippingMethods,
    shippingAddress: {}, billingAddress: undefined, selectedShippingMethodId: null,
    giftCard: null, giftCardApplied: s.giftCardMinor ?? null, now: NOW,
  })

  return { legacy, plugin }
}

// Assert the comparable business outcomes match to the minor unit. The message names the failing
// field + both values so a real divergence is self-documenting.
function assertParity(label: string, s: Scenario): void {
  const { legacy, plugin } = runParity(s)
  const eq = (name: string, actual: number, expected: number): void => {
    assert.equal(
      actual, expected,
      `[${label}] ${name}: plugin ${actual} vs legacy ${expected}`,
    )
  }
  eq('grandTotal', plugin.grandTotal, legacy.grandTotal)
  eq('totalTax', plugin.totalTax, legacy.totalTax)
  eq('shippingPrice', plugin.shippingPrice, legacy.shippingPrice)
  eq('merchandiseSubtotal', plugin.subtotal, legacy.merchandiseSubtotal)
  eq('orderDiscount', plugin.totalDiscount, legacy.orderDiscount)
  eq('giftCardApplied', plugin.giftCardApplied, legacy.giftCardApplied)
  eq('amountDue', plugin.amountDue, legacy.amountDue)
  // Per-line post-tax net + tax (index-aligned; both engines preserve the input line order).
  assert.equal(plugin.snapshot.lines.length, legacy.lines.length, `[${label}] line count`)
  for (let i = 0; i < legacy.lines.length; i++) {
    const l = legacy.lines[i]
    const p = plugin.snapshot.lines[i]
    eq(`line[${i}](${l.sku}).total`, p.totalMinor, l.total)
    eq(`line[${i}](${l.sku}).tax`, p.taxMinor, l.tax)
    eq(`line[${i}](${l.sku}).taxable`, p.taxableMinor, l.taxable)
  }
}

// ─── matrix ──────────────────────────────────────────────────────────────────────────────────

test('simple product · tax-exclusive · 14% — grand total + per-line net match', () => {
  assertParity('simple-exclusive-14', {
    taxMode: 'exclusive', standardTaxBps: 1400,
    lines: [{ sku: 'A', productId: 1, unitPriceMinor: 5000, quantity: 2, taxBps: 1400 }],
  })
})

test('simple product · tax-inclusive · 14% — grand total + per-line net match', () => {
  assertParity('simple-inclusive-14', {
    taxMode: 'inclusive', standardTaxBps: 1400,
    lines: [{ sku: 'A', productId: 1, unitPriceMinor: 5000, quantity: 2, taxBps: 1400 }],
  })
})

test('zero-tax · exclusive — engines converge at 0 tax (no rate configured)', () => {
  assertParity('zero-tax', {
    taxMode: 'exclusive', standardTaxBps: 0,
    lines: [{ sku: 'A', productId: 1, unitPriceMinor: 5000, quantity: 2, taxBps: 0 }],
  })
})

test('multi-line · mixed tax (standard 14% + zero) · exclusive — per-line nets match independently', () => {
  assertParity('multiline-mixed-exclusive', {
    taxMode: 'exclusive', standardTaxBps: 1400,
    lines: [
      { sku: 'A', productId: 1, unitPriceMinor: 5000, quantity: 2, taxBps: 1400 },
      { sku: 'B', productId: 2, unitPriceMinor: 3000, quantity: 1, taxBps: 0 },
    ],
  })
})

test('multi-line · inclusive · 14% — pro-rata + inclusive extraction match', () => {
  assertParity('multiline-inclusive-14', {
    taxMode: 'inclusive', standardTaxBps: 1400,
    lines: [
      { sku: 'A', productId: 1, unitPriceMinor: 5000, quantity: 2, taxBps: 1400 },
      { sku: 'C', productId: 3, unitPriceMinor: 7500, quantity: 3, taxBps: 1400 },
    ],
  })
})

test('percentage order promotion · exclusive · 14% — discount + post-discount tax match', () => {
  assertParity('promo-percent-exclusive', {
    taxMode: 'exclusive', standardTaxBps: 1400, orderPromoPercentBps: 1000, // 10% off merchandise
    lines: [
      { sku: 'A', productId: 1, unitPriceMinor: 5000, quantity: 2, taxBps: 1400 },
      { sku: 'C', productId: 3, unitPriceMinor: 7500, quantity: 1, taxBps: 1400 },
    ],
  })
})

test('percentage order promotion · inclusive · 14% — discount converges under inclusive tax', () => {
  assertParity('promo-percent-inclusive', {
    taxMode: 'inclusive', standardTaxBps: 1400, orderPromoPercentBps: 1500, // 15% off
    lines: [
      { sku: 'A', productId: 1, unitPriceMinor: 5000, quantity: 1, taxBps: 1400 },
      { sku: 'C', productId: 3, unitPriceMinor: 3333, quantity: 3, taxBps: 1400 },
    ],
  })
})

test('shipping · exclusive · 14% · shipping 2000 — shipping + shipping tax + grand total match', () => {
  assertParity('shipping-exclusive', {
    taxMode: 'exclusive', standardTaxBps: 1400, shippingPriceMinor: 2000,
    lines: [{ sku: 'A', productId: 1, unitPriceMinor: 5000, quantity: 2, taxBps: 1400 }],
  })
})

test('shipping · inclusive · 14% — shipping tax extraction matches', () => {
  assertParity('shipping-inclusive', {
    taxMode: 'inclusive', standardTaxBps: 1400, shippingPriceMinor: 1140,
    lines: [{ sku: 'A', productId: 1, unitPriceMinor: 5000, quantity: 1, taxBps: 1400 }],
  })
})

test('gift-card tender · exclusive · 14% — giftCardApplied (capped) + amountDue match', () => {
  assertParity('giftcard-partial', {
    taxMode: 'exclusive', standardTaxBps: 1400, giftCardMinor: 3000, // less than grand total
    lines: [{ sku: 'A', productId: 1, unitPriceMinor: 5000, quantity: 2, taxBps: 1400 }],
  })
})

test('gift-card tender exceeds grand total — cap + amountDue 0 match', () => {
  assertParity('giftcard-overpay', {
    taxMode: 'exclusive', standardTaxBps: 1400, giftCardMinor: 1_000_000, // larger than the grand total
    lines: [{ sku: 'A', productId: 1, unitPriceMinor: 5000, quantity: 2, taxBps: 1400 }],
  })
})

test('promotion + shipping composed · exclusive · 14% — every total still matches', () => {
  assertParity('promo-plus-shipping', {
    taxMode: 'exclusive', standardTaxBps: 1400, orderPromoPercentBps: 1000, shippingPriceMinor: 2000,
    lines: [
      { sku: 'A', productId: 1, unitPriceMinor: 5000, quantity: 2, taxBps: 1400 },
      { sku: 'C', productId: 3, unitPriceMinor: 7500, quantity: 1, taxBps: 1400 },
    ],
  })
})

// The structural reason parity holds: computeQuote resolves the per-line bps, then calls the pure
// quote() the legacy path uses. Pin that contract so a future refactor that breaks the delegation
// surfaces here, not in production totals.
test('structural: computeQuote delegates tax arithmetic to the same pure quote() the legacy uses', () => {
  const { legacy, plugin } = runParity({
    taxMode: 'exclusive', standardTaxBps: 1400,
    lines: [{ sku: 'A', productId: 1, unitPriceMinor: 5000, quantity: 2, taxBps: 1400 }],
  })
  // If the delegation ever breaks, the plugin's per-line tax/total diverge from the legacy's.
  assert.equal(plugin.snapshot.lines[0].taxMinor, legacy.lines[0].tax)
  assert.equal(plugin.snapshot.lines[0].totalMinor, legacy.lines[0].total)
  assert.equal(plugin.grandTotal, legacy.grandTotal)
})
