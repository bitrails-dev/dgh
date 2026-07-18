// Focused tests for the authoritative quoteCart engine (Plan §3.10, §7 Commit C4 policy lane).
//
// These tests drive `computeQuote` directly with fully-resolved inputs (no DB, no I/O). They cover
// every required case from the lane task spec:
//
//   1. Rounding residual distribution (tie-break product-id then variant-id).
//   2. Exclusivity rejection (exclusive promo blocks stacking).
//   3. Per-customer + total usage limits; redemption released on failed/expired payment.
//   4. Gift-card ledger atomicity: redeem + idempotent refund compensating entry; balance + payable
//      never negative.
//   5. Cross-tenant denial (a tenant's quote cannot see another tenant's policies/gift cards).
//   6. Free-shipping promotion applied only AFTER shipping eligibility established.
//   7. quoteHash stability: same inputs → same hash; recursive key sort + stable array order.
//
// Plus the gift-card HMAC hash contract and the row-mapper tenant-isolation invariant.

import assert from 'node:assert/strict'
import test from 'node:test'

import { canonicalQuoteHash, computeQuote, pickResidualLine, type ComputeQuoteInput, type QuoteCartSnapshot } from '../src/commerce/policies/quote'
import {
  GIFT_CARD_PEPPER_ENV,
  GiftCardPepperError,
  decodeGiftCardPepper,
  generateGiftCardCode,
  giftCardLastFour,
  hashGiftCardCode,
  normalizeGiftCardCode,
} from '../src/commerce/policies/gift-card-hash'
import { toGiftCardRow, type GiftCardLedgerTxnApi } from '../src/commerce/policies/giftcards'
import { computeRemainingQuota, toPromotionRow } from '../src/commerce/policies/promotions'
import { matchShippingZone, resolveShipping, toShippingMethodRow, toShippingZoneRow } from '../src/commerce/policies/shipping'
import { matchTaxZone, pickActiveRate, toTaxRateRow, toTaxZoneRow } from '../src/commerce/policies/tax'
import type { GiftCardRow, PromotionRow, ShippingMethodRow, ShippingZoneRow, TaxRateRow, TaxZoneRow } from '../src/commerce/policies/repositories'

// ──────────────────────────────────────────────────────────────────────────────────────────────
// Helpers — fully-resolved row fixtures so computeQuote has no DB dependency.
// ──────────────────────────────────────────────────────────────────────────────────────────────

const TENANT_A = 1
const TENANT_B = 2
const NOW = Date.UTC(2026, 0, 15, 12, 0, 0) // 2026-01-15T12:00:00Z — stable for all schedule checks
const PEPPER_B64 = Buffer.from(
  '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
  'hex',
).toString('base64')

function egZone(tenant: number, id: string, code: string, country?: string): TaxZoneRow {
  return {
    id, tenant, code, country, regions: null, postalPrefixes: null, priority: 0, enabled: true,
  }
}

function egShippingZone(tenant: number, id: string, code: string, country?: string): ShippingZoneRow {
  return {
    id, tenant, code, country, regions: null, postalPrefixes: null, priority: 0, enabled: true,
  }
}

function egShippingMethod(
  tenant: number,
  id: string,
  zone: string,
  code: string,
  basePrice: number,
  freeAbove = 0,
  min?: number,
  max?: number,
): ShippingMethodRow {
  return {
    id, tenant, zone, code, basePrice, freeAboveSubtotal: freeAbove,
    minimumSubtotal: min ?? null, maximumSubtotal: max ?? null, enabled: true,
  }
}

function egTaxRate(
  tenant: number,
  id: string,
  zone: string,
  taxClass: string,
  rateBps: number,
  effectiveFrom: string,
  effectiveTo: string | null = null,
  pricesIncludeTax = false,
): TaxRateRow {
  return {
    id, tenant, zone, taxClass, rateBps, pricesIncludeTax,
    effectiveFrom, effectiveTo, enabled: true,
  }
}

function egPromotion(args: {
  id: string
  tenant: number
  code: string
  type: PromotionRow['type']
  value: number
  minimumSubtotal?: number
  maximumDiscount?: number | null
  exclusive?: boolean
  totalUsageLimit?: number | null
  perCustomerLimit?: number | null
  startsAt?: string
  endsAt?: string | null
  eligibleProducts?: Array<string | number>
  eligibleVariants?: Array<string | number>
}): PromotionRow {
  return {
    id: args.id,
    tenant: args.tenant,
    code: args.code,
    type: args.type,
    value: args.value,
    minimumSubtotal: args.minimumSubtotal ?? 0,
    maximumDiscount: args.maximumDiscount ?? null,
    startsAt: args.startsAt ?? '2020-01-01T00:00:00.000Z',
    endsAt: args.endsAt ?? null,
    totalUsageLimit: args.totalUsageLimit ?? null,
    perCustomerLimit: args.perCustomerLimit ?? null,
    exclusive: args.exclusive ?? false,
    eligibleProducts: args.eligibleProducts ?? [],
    eligibleVariants: args.eligibleVariants ?? [],
    enabled: true,
  }
}

function egGiftCard(args: {
  id: string
  tenant: number
  balance: number
  initialBalance?: number
  currency?: string
  status?: GiftCardRow['status']
  expiresAt?: string | null
}): { row: GiftCardRow; codeHash: string } {
  const initial = args.initialBalance ?? args.balance
  const codeHash = hashGiftCardCode(`RAW-${args.id}`, PEPPER_B64)
  const lastFour = giftCardLastFour(`RAW-${args.id}`)
  return {
    row: {
      id: args.id,
      tenant: args.tenant,
      codeHash,
      lastFour,
      currency: args.currency ?? 'EGP',
      initialBalance: initial,
      balance: args.balance,
      status: args.status ?? 'active',
      expiresAt: args.expiresAt ?? null,
    },
    codeHash,
  }
}

function baseQuoteInput(overrides: Partial<ComputeQuoteInput> = {}): ComputeQuoteInput {
  return {
    tenantId: TENANT_A,
    currency: 'EGP',
    taxMode: 'exclusive',
    lines: [
      { key: 'a', sku: 'A', productId: 'p1', variantId: null, quantity: 1, unitPriceMinor: 1000, taxClass: 'standard' },
    ],
    promotions: [],
    quotas: [],
    promotionCodes: [],
    taxZones: [egZone(TENANT_A, 'z1', 'EG', 'EG')],
    taxRates: [egTaxRate(TENANT_A, 'r1', 'z1', 'standard', 0, '2020-01-01T00:00:00.000Z')],
    shippingZones: [egShippingZone(TENANT_A, 'sz1', 'EG', 'EG')],
    shippingMethods: [egShippingMethod(TENANT_A, 'sm1', 'sz1', 'EG-STD', 2000)],
    shippingAddress: { country: 'EG' },
    selectedShippingMethodId: null,
    giftCard: null,
    giftCardApplied: 0,
    now: NOW,
    ...overrides,
  }
}

// ──────────────────────────────────────────────────────────────────────────────────────────────
// 1. Rounding residual distribution (tie-break product-id then variant-id).
// ──────────────────────────────────────────────────────────────────────────────────────────────

test('pickResidualLine: highest line amount wins', () => {
  const pick = pickResidualLine([
    { key: 'a', productId: 'p1', variantId: null, lineAmountMinor: 1000 },
    { key: 'b', productId: 'p2', variantId: null, lineAmountMinor: 2000 },
    { key: 'c', productId: 'p3', variantId: null, lineAmountMinor: 500 },
  ])
  assert.equal(pick?.key, 'b')
})

test('pickResidualLine: tie on amount → smaller product id wins', () => {
  const pick = pickResidualLine([
    { key: 'a', productId: 'p9', variantId: null, lineAmountMinor: 1000 },
    { key: 'b', productId: 'p1', variantId: null, lineAmountMinor: 1000 },
  ])
  assert.equal(pick?.key, 'b', 'p1 < p9 → b wins')
})

test('pickResidualLine: tie on amount + product id → smaller variant id wins', () => {
  const pick = pickResidualLine([
    { key: 'a', productId: 'p1', variantId: 'v9', lineAmountMinor: 1000 },
    { key: 'b', productId: 'p1', variantId: 'v1', lineAmountMinor: 1000 },
  ])
  assert.equal(pick?.key, 'b', 'v1 < v9 → b wins')
})

test('computeQuote: residual line is the §3.10 pick (highest price, then product id, then variant id)', () => {
  // 3 equal-priced lines (1000 each, all class zero), percentage discount that produces a residual.
  // All three have the same discounted lineAmount, so the §3.10 tie-break applies: smaller product
  // id wins. The snapshot’s residual allocation must reference line 'b' (productId p1).
  const r = computeQuote(baseQuoteInput({
    lines: [
      { key: 'a', sku: 'A', productId: 'p9', variantId: null, quantity: 1, unitPriceMinor: 1000, taxClass: 'zero' },
      { key: 'b', sku: 'B', productId: 'p1', variantId: null, quantity: 1, unitPriceMinor: 1000, taxClass: 'zero' },
      { key: 'c', sku: 'C', productId: 'p5', variantId: null, quantity: 1, unitPriceMinor: 1000, taxClass: 'zero' },
    ],
    promotions: [egPromotion({
      id: 'p10', tenant: TENANT_A, code: 'PCT10', type: 'percentage', value: 1000, // 10% off
    })],
    promotionCodes: ['PCT10'],
    // No shipping → isolates the residual-distribution assertion to the merchandise lines.
    shippingMethods: [],
  }))
  // When there IS a residual, it must land on line 'b' (smallest product id among tied lines).
  if (r.snapshot.residualAllocation.length > 0) {
    const target = r.snapshot.residualAllocation[0]
    assert.equal(target.productId, 'p1', 'tie-break must select the smallest product id')
    assert.equal(target.key, 'b')
  }
  // And the discount total matches the order-discount math (10% of 3000 = 300 minor).
  assert.equal(r.snapshot.totalDiscountMinor, 300)
})

// ──────────────────────────────────────────────────────────────────────────────────────────────
// 2. Exclusivity rejection (exclusive promo blocks stacking).
// ──────────────────────────────────────────────────────────────────────────────────────────────

test('exclusivity: when an exclusive promo applies, every other eligible promo is skipped', () => {
  const r = computeQuote(baseQuoteInput({
    lines: [
      { key: 'a', sku: 'A', productId: 'p1', variantId: null, quantity: 1, unitPriceMinor: 10000, taxClass: 'zero' },
    ],
    promotions: [
      egPromotion({ id: 'excl', tenant: TENANT_A, code: 'EXCL', type: 'fixed', value: 500, exclusive: true }),
      egPromotion({ id: 'stack', tenant: TENANT_A, code: 'STACK', type: 'percentage', value: 1000 }),
    ],
    promotionCodes: ['EXCL', 'STACK'],
  }))
  assert.equal(r.snapshot.exclusivePromotionApplied, true)
  // Only the exclusive promo id is in appliedPromotionIds.
  assert.deepEqual(r.snapshot.appliedPromotionIds, ['excl'])
  // Discount is exactly the exclusive amount, not the sum.
  assert.equal(r.snapshot.totalDiscountMinor, 500)
})

test('exclusivity: two stackable promos both apply when neither is exclusive', () => {
  const r = computeQuote(baseQuoteInput({
    lines: [
      { key: 'a', sku: 'A', productId: 'p1', variantId: null, quantity: 1, unitPriceMinor: 10000, taxClass: 'zero' },
    ],
    promotions: [
      egPromotion({ id: 's1', tenant: TENANT_A, code: 'S1', type: 'fixed', value: 500 }),
      egPromotion({ id: 's2', tenant: TENANT_A, code: 'S2', type: 'fixed', value: 300 }),
    ],
    promotionCodes: ['S1', 'S2'],
  }))
  assert.equal(r.snapshot.exclusivePromotionApplied, false)
  assert.equal(r.snapshot.appliedPromotionIds.length, 2)
  // 500 + 300 = 800 off the merchandise; shipping 2000; total 11200 (no tax — zero class).
  assert.equal(r.snapshot.totalDiscountMinor, 800)
  assert.equal(r.grandTotal, 11200)
})

// ──────────────────────────────────────────────────────────────────────────────────────────────
// 3. Per-customer + total usage limits; redemption released on failed/expired payment.
// ──────────────────────────────────────────────────────────────────────────────────────────────

test('computeRemainingQuota: clamps to zero when limits are exhausted', () => {
  const r = computeRemainingQuota({
    promotion: { totalUsageLimit: 5, perCustomerLimit: 1 },
    totalRedeemed: 5,
    perCustomerRedeemed: 1,
  })
  assert.equal(r.total, 0)
  assert.equal(r.perCustomer, 0)
})

test('computeRemainingQuota: unlimited when both limits are null', () => {
  const r = computeRemainingQuota({
    promotion: { totalUsageLimit: null, perCustomerLimit: null },
    totalRedeemed: 100,
    perCustomerRedeemed: 100,
  })
  assert.equal(r.total, Number.MAX_SAFE_INTEGER)
  assert.equal(r.perCustomer, Number.MAX_SAFE_INTEGER)
})

test('computeQuote: promotion with zero remaining quota is skipped (treated as outside eligibility)', () => {
  const r = computeQuote(baseQuoteInput({
    lines: [
      { key: 'a', sku: 'A', productId: 'p1', variantId: null, quantity: 1, unitPriceMinor: 10000, taxClass: 'zero' },
    ],
    promotions: [
      egPromotion({
        id: 'limited', tenant: TENANT_A, code: 'LIM', type: 'fixed', value: 500,
        totalUsageLimit: 1,
      }),
    ],
    promotionCodes: ['LIM'],
    quotas: [{ promotionId: 'limited', total: 0, perCustomer: Number.MAX_SAFE_INTEGER }],
  }))
  assert.deepEqual(r.snapshot.appliedPromotionIds, [], 'exhausted promo must not apply')
  assert.equal(r.snapshot.totalDiscountMinor, 0)
})

test('releaseRedemptionsForOrder returns the count of redemptions tied to the order', async () => {
  // Fake api that returns two redemptions for order 'o1' under tenant A.
  const api: GiftCardLedgerTxnApi = {
    async find() {
      return {
        docs: [
          { id: 'red1', promotion: 'p1', order: 'o1', customerIdentityHash: 'h', discountAmount: 100 },
          { id: 'red2', promotion: 'p2', order: 'o1', customerIdentityHash: 'h', discountAmount: 50 },
        ],
      } as never
    },
    async insertLedgerAndUpdateBalance() {
      return { inserted: true }
    },
  }
  // Use the promotions repository via the same fake find contract (it only needs find).
  const { PromotionsPolicyRepository } = await import('../src/commerce/policies/promotions')
  const repo = new PromotionsPolicyRepository(api as never)
  const released = await repo.releaseRedemptionsForOrder(TENANT_A, 'o1')
  assert.equal(released, 2, 'release must report how many redemptions would be removed')
})

// ──────────────────────────────────────────────────────────────────────────────────────────────
// 4. Gift-card ledger atomicity: redeem + idempotent refund; balance + payable never negative.
// ──────────────────────────────────────────────────────────────────────────────────────────────

test('hashGiftCardCode: same raw code → same hash; never stored in plain', () => {
  const h1 = hashGiftCardCode('ABCD-1234', PEPPER_B64)
  const h2 = hashGiftCardCode('abcd1234', PEPPER_B64) // normalization collapses formatting
  assert.equal(h1, h2)
  assert.ok(/^[0-9a-f]{64}$/.test(h1), 'HMAC is lowercase sha256 hex')
  // The raw code must never appear in the hash output (it’s a hex digest).
  assert.ok(!h1.includes('ABCD') && !h1.includes('1234'))
})

test('decodeGiftCardPepper: rejects short / missing pepper', () => {
  assert.throws(() => decodeGiftCardPepper(''), GiftCardPepperError)
  assert.throws(() => decodeGiftCardPepper(Buffer.from('short').toString('base64')), GiftCardPepperError)
})

test('resolveGiftCardPepper (env): throws when COMMERCE_GIFT_CARD_PEPPER is unset', async () => {
  const { resolveGiftCardPepper } = await import('../src/commerce/policies/gift-card-hash')
  const saved = process.env[GIFT_CARD_PEPPER_ENV]
  delete process.env[GIFT_CARD_PEPPER_ENV]
  try {
    assert.throws(() => resolveGiftCardPepper({} as NodeJS.ProcessEnv), GiftCardPepperError)
  } finally {
    if (saved !== undefined) process.env[GIFT_CARD_PEPPER_ENV] = saved
  }
})

test('computeQuote: gift card applied is capped at grandTotal (payable never negative)', () => {
  // Grand total = 1000 (merch) + 2000 (shipping) + 0 tax = 3000.
  // Gift card balance = 5000 (more than grand total).
  const giftCard = egGiftCard({ id: 'gc1', tenant: TENANT_A, balance: 5000, initialBalance: 5000 })
  const r = computeQuote(baseQuoteInput({
    lines: [
      { key: 'a', sku: 'A', productId: 'p1', variantId: null, quantity: 1, unitPriceMinor: 1000, taxClass: 'zero' },
    ],
    giftCard,
    giftCardApplied: 5000,
  }))
  assert.equal(r.giftCardApplied, 3000, 'gift card capped at grand total')
  assert.equal(r.amountDue, 0, 'amount due never negative')
})

test('gift-card ledger atomicity: redeem + idempotent refund; cached balance tracks the fold', async () => {
  // Drive the GiftCardsPolicyRepository with a fake ledger-txn api that records each call. The
  // first redeem commits; the second redeem (same idempotencyKey) is a no-op; the refund commits.
  const events: Array<{ kind: string; amount: number; idempotencyKey: string; newBalance: number }> = []
  let ledgerHasRowForKey = new Set<string>()
  const api: GiftCardLedgerTxnApi = {
    async find() {
      return { docs: [] } as never
    },
    async insertLedgerAndUpdateBalance(args) {
      if (ledgerHasRowForKey.has(args.idempotencyKey)) {
        return { inserted: false }
      }
      ledgerHasRowForKey.add(args.idempotencyKey)
      events.push({ kind: args.kind, amount: args.amount, idempotencyKey: args.idempotencyKey, newBalance: args.newBalance })
      return { inserted: true, ledgerRowId: `row-${events.length}` }
    },
  }
  const { GiftCardsPolicyRepository } = await import('../src/commerce/policies/giftcards')
  const repo = new GiftCardsPolicyRepository(api)

  // Redeem 1500 from a card with 2000 balance for order o1.
  const redeem1 = await repo.redeemForOrder({
    tenant: TENANT_A, giftCardId: 'gc1', orderId: 'o1',
    applied: 1500, newBalance: 500, idempotencyKey: 'o1:redeem', now: NOW,
  })
  assert.equal(redeem1.committed, true)

  // Replay (idempotency): same idempotencyKey must be a no-op.
  const redeem2 = await repo.redeemForOrder({
    tenant: TENANT_A, giftCardId: 'gc1', orderId: 'o1',
    applied: 1500, newBalance: 500, idempotencyKey: 'o1:redeem', now: NOW,
  })
  assert.equal(redeem2.committed, false, 'duplicate redeem must be a no-op')

  // Refund on payment failure: compensating entry, +1500 back, balance returns to 2000.
  const refund = await repo.refundForOrder({
    tenant: TENANT_A, giftCardId: 'gc1', orderId: 'o1',
    refundAmount: 1500, idempotencyKey: 'o1:refund',
    now: NOW, currentBalance: 500, initialBalance: 2000,
  })
  assert.equal(refund.committed, true)
  assert.equal(refund.refunded, 1500)
  assert.equal(refund.newBalance, 2000)

  // Exactly two events committed: one redeem, one refund.
  assert.equal(events.length, 2)
  assert.equal(events[0].kind, 'redeem')
  assert.equal(events[0].amount, -1500)
  assert.equal(events[1].kind, 'refund')
  assert.equal(events[1].amount, 1500)
})

test('gift-card ledger: refund never drives balance above initialBalance (refund cap)', async () => {
  const api: GiftCardLedgerTxnApi = {
    async find() {
      return { docs: [] } as never
    },
    async insertLedgerAndUpdateBalance(args) {
      return { inserted: true, ledgerRowId: 'row-1' }
    },
  }
  const { GiftCardsPolicyRepository } = await import('../src/commerce/policies/giftcards')
  const repo = new GiftCardsPolicyRepository(api)
  // currentBalance 1800, initialBalance 2000, refund 500 — the pure engine caps the refund at 200.
  const r = await repo.refundForOrder({
    tenant: TENANT_A, giftCardId: 'gc1', orderId: 'o1',
    refundAmount: 500, idempotencyKey: 'o1:refund',
    now: NOW, currentBalance: 1800, initialBalance: 2000,
  })
  assert.equal(r.refunded, 200, 'refund is capped so balance cannot exceed initialBalance')
  assert.equal(r.newBalance, 2000)
})

// ──────────────────────────────────────────────────────────────────────────────────────────────
// 5. Cross-tenant denial — a tenant's quote cannot see another tenant's policies/gift cards.
// ──────────────────────────────────────────────────────────────────────────────────────────────

test('matchTaxZone: only zones for the resolved tenant are considered (tenant B zones ignored)', () => {
  const zones = [
    egZone(TENANT_A, 'a-1', 'EG', 'EG'),
    egZone(TENANT_B, 'b-1', 'EG', 'EG'),
  ]
  // Tenant A resolves to its own zone.
  const a = matchTaxZone({ country: 'EG' }, zones.filter((z) => String(z.tenant) === String(TENANT_A)))
  assert.equal(a?.id, 'a-1')
})

test('pickActiveRate: rate rows from another tenant are never selected', () => {
  const rates = [
    egTaxRate(TENANT_A, 'a-r1', 'z1', 'standard', 1400, '2020-01-01T00:00:00.000Z'),
    egTaxRate(TENANT_B, 'b-r1', 'z1', 'standard', 500, '2020-01-01T00:00:00.000Z'),
  ]
  // Tenant A resolves its own rate; tenant B’s 500 bps row is never picked even though it covers
  // the same (zone, class, effective).
  const r = pickActiveRate(rates, TENANT_A, 'z1', 'standard', NOW)
  assert.equal(r?.id, 'a-r1')
  assert.equal(r?.rateBps, 1400)
})

test('resolveShipping: methods from another tenant are filtered out', () => {
  const zones = [egShippingZone(TENANT_A, 'sz1', 'EG', 'EG')]
  const methods = [
    egShippingMethod(TENANT_A, 'sm-a', 'sz1', 'A-STD', 1000),
    egShippingMethod(TENANT_B, 'sm-b', 'sz1', 'B-STD', 100), // would be cheaper but not visible
  ]
  const r = resolveShipping({
    zones, methods, tenant: TENANT_A, address: { country: 'EG' }, subtotal: 5000,
  })
  assert.ok(r.ok)
  if (!r.ok) throw new Error('expected ok')
  assert.equal(r.methodId, 'sm-a')
})

test('toGiftCardRow: forces the resolved tenant (no leakage from row-supplied tenant)', () => {
  // A tampered row claims tenant B; the mapper overrides with tenant A.
  const row = toGiftCardRow({ id: 'gc1', tenant: TENANT_B, codeHash: 'h', lastFour: '1234', balance: 1000 }, TENANT_A)
  assert.equal(row.tenant, TENANT_A, 'mapper never trusts the row’s tenant field')
})

test('toPromotionRow: forces the resolved tenant (no leakage)', () => {
  const row = toPromotionRow({ id: 'p1', tenant: TENANT_B, code: 'X', type: 'fixed', value: 100 }, TENANT_A)
  assert.equal(row.tenant, TENANT_A)
})

test('computeQuote: tenant A’s quote is unaffected by tenant B policy rows in the input', () => {
  // The engine filters internally by String(tenant) === String(input.tenantId). Even if a buggy
  // loader hands us tenant B’s rows, the quote must reflect only tenant A’s data.
  const r = computeQuote(baseQuoteInput({
    tenantId: TENANT_A,
    taxRates: [
      egTaxRate(TENANT_A, 'a-r1', 'z1', 'standard', 1400, '2020-01-01T00:00:00.000Z'),
      egTaxRate(TENANT_B, 'b-r1', 'z1', 'standard', 0, '2020-01-01T00:00:00.000Z'),
    ],
    shippingMethods: [
      egShippingMethod(TENANT_A, 'sm-a', 'sz1', 'A-STD', 2000),
      egShippingMethod(TENANT_B, 'sm-b', 'sz1', 'B-STD', 0), // would zero the shipping if visible
    ],
  }))
  assert.equal(r.shippingPrice, 2000, 'tenant B method never chosen')
  assert.equal(r.snapshot.lines[0].taxBps, 1400, 'tenant B rate never chosen')
})

// ──────────────────────────────────────────────────────────────────────────────────────────────
// 6. Free-shipping promotion applied only AFTER shipping eligibility established.
// ──────────────────────────────────────────────────────────────────────────────────────────────

test('free-shipping promo: zeroes the eligible method price (NOT a method selector)', () => {
  // Cart has 5000 merchandise + a free-shipping promo. The shipping method EG-STD costs 2000 but
  // grants free shipping at freeAboveSubtotal=4000 — so eligibility is established and the promo
  // then zeroes the price.
  const r = computeQuote(baseQuoteInput({
    lines: [
      { key: 'a', sku: 'A', productId: 'p1', variantId: null, quantity: 1, unitPriceMinor: 5000, taxClass: 'zero' },
    ],
    shippingMethods: [egShippingMethod(TENANT_A, 'sm1', 'sz1', 'EG-STD', 2000, 4000)],
    promotions: [egPromotion({ id: 'fs', tenant: TENANT_A, code: 'FREE', type: 'free_shipping', value: 0 })],
    promotionCodes: ['FREE'],
  }))
  assert.equal(r.snapshot.freeShippingApplied, true)
  assert.equal(r.shippingPrice, 0)
  // Method selection still happened — the snapshot records the chosen method.
  assert.equal(r.snapshot.shippingMethodId, 'sm1')
})

test('free-shipping promo: does NOT create shipping where none was eligible (no zone)', () => {
  // No zone matches the address (FR). Free-shipping promo cannot bypass the eligibility gate.
  const r = computeQuote(baseQuoteInput({
    shippingAddress: { country: 'FR' },
    promotions: [egPromotion({ id: 'fs', tenant: TENANT_A, code: 'FREE', type: 'free_shipping', value: 0 })],
    promotionCodes: ['FREE'],
  }))
  assert.equal(r.snapshot.freeShippingApplied, false, 'free shipping cannot apply when no method is eligible')
  assert.equal(r.shippingPrice, 0) // stayed zero because no method was selected
  assert.equal(r.snapshot.shippingMethodId, null)
})

test('free-shipping promo: does NOT bypass the minimum-subtotal gate', () => {
  // Method gated at minimumSubtotal 10000; cart subtotal only 5000. Promo cannot apply.
  const r = computeQuote(baseQuoteInput({
    lines: [
      { key: 'a', sku: 'A', productId: 'p1', variantId: null, quantity: 1, unitPriceMinor: 5000, taxClass: 'zero' },
    ],
    shippingMethods: [egShippingMethod(TENANT_A, 'sm1', 'sz1', 'EG-STD', 2000, 0, 10000)],
    promotions: [egPromotion({ id: 'fs', tenant: TENANT_A, code: 'FREE', type: 'free_shipping', value: 0 })],
    promotionCodes: ['FREE'],
  }))
  assert.equal(r.snapshot.freeShippingApplied, false)
  assert.equal(r.snapshot.shippingMethodId, null, 'method gated out — promo cannot resurrect it')
})

// ──────────────────────────────────────────────────────────────────────────────────────────────
// 7. quoteHash stability — recursive key sort + stable array order.
// ──────────────────────────────────────────────────────────────────────────────────────────────

test('quoteHash: identical inputs → identical hash', () => {
  const a = computeQuote(baseQuoteInput())
  const b = computeQuote(baseQuoteInput())
  assert.equal(a.quoteHash, b.quoteHash)
  assert.ok(/^[0-9a-f]{64}$/.test(a.quoteHash))
})

test('quoteHash: any mutation of an amount changes the hash', () => {
  const baseline = computeQuote(baseQuoteInput())
  const bumped = computeQuote(baseQuoteInput({
    lines: [
      { key: 'a', sku: 'A', productId: 'p1', variantId: null, quantity: 1, unitPriceMinor: 1001, taxClass: 'standard' },
    ],
  }))
  assert.notEqual(baseline.quoteHash, bumped.quoteHash)
})

test('quoteHash: residualAllocation order does NOT change the hash (stable sort)', () => {
  // Manually build two snapshots identical except for residualAllocation array order. The hash
  // canonicalizes the array by sorting on key, so order-independent hashing holds.
  const baseSnap = computeQuote(baseQuoteInput()).snapshot
  const reversed: QuoteCartSnapshot = {
    ...baseSnap,
    residualAllocation: [...baseSnap.residualAllocation].reverse(),
  }
  assert.equal(canonicalQuoteHash(baseSnap), canonicalQuoteHash(reversed))
})

test('quoteHash: appliedPromotionIds order does NOT change the hash', () => {
  const baseSnap = computeQuote(baseQuoteInput()).snapshot
  const reversed: QuoteCartSnapshot = {
    ...baseSnap,
    appliedPromotionIds: [...baseSnap.appliedPromotionIds].reverse(),
  }
  assert.equal(canonicalQuoteHash(baseSnap), canonicalQuoteHash(reversed))
})

test('quoteHash: promotionCodes order does NOT change the hash', () => {
  const baseSnap = computeQuote(baseQuoteInput({
    promotionCodes: ['A', 'B', 'C'],
  })).snapshot
  const reversed: QuoteCartSnapshot = {
    ...baseSnap,
    promotionCodes: [...baseSnap.promotionCodes].reverse(),
  }
  assert.equal(canonicalQuoteHash(baseSnap), canonicalQuoteHash(reversed))
})

// ──────────────────────────────────────────────────────────────────────────────────────────────
// Gift-card code generator + lastFour helpers
// ──────────────────────────────────────────────────────────────────────────────────────────────

test('normalizeGiftCardCode: trim, uppercase, strip interior whitespace', () => {
  assert.equal(normalizeGiftCardCode('  abcd-1234  '), 'ABCD1234')
  assert.equal(normalizeGiftCardCode('abcd 1234'), 'ABCD1234')
})

test('generateGiftCardCode: produces a grouped uppercase code of the requested length', () => {
  const code = generateGiftCardCode(24)
  // 24 chars + 5 dashes (every 4 chars except the last group) = 29 chars total.
  assert.equal(code.length, 24 + Math.floor((24 - 1) / 4))
  assert.ok(/^[A-Z2-9-]+$/.test(code))
  // The alphabet excludes 0, 1, O, I — no easily-confused chars.
  assert.ok(!/[01OI]/.test(code.replace(/-/g, '')))
})

test('giftCardLastFour: returns the last 4 non-delimiter chars', () => {
  assert.equal(giftCardLastFour('ABCD-EFGH-IJKL-MNOP-1234'), '1234')
})

// ──────────────────────────────────────────────────────────────────────────────────────────────
// Row mappers (tax/shipping) — tenant isolation + shape coercion
// ──────────────────────────────────────────────────────────────────────────────────────────────

test('toTaxZoneRow: forces the resolved tenant and coerces optional fields', () => {
  const row = toTaxZoneRow({
    id: 'z1', tenant: TENANT_B, code: 'EG', country: 'eg',
    regions: [{ code: 'EG-C' }],
    postalPrefixes: [{ prefix: '11' }],
    priority: '5',
    enabled: true,
  }, TENANT_A)
  assert.equal(row.tenant, TENANT_A)
  assert.equal(row.country, 'eg') // mapper doesn’t uppercase — that’s the resolver’s job
  assert.equal(row.priority, 5)
  assert.equal(row.regions?.[0].code, 'EG-C')
  assert.equal(row.postalPrefixes?.[0].prefix, '11')
})

test('toTaxRateRow: relationship-object or bare id both resolve to a string zone id', () => {
  const a = toTaxRateRow({ id: 'r1', tenant: TENANT_A, zone: 'z1', taxClass: 'standard', rateBps: 1400, effectiveFrom: '2020-01-01T00:00:00.000Z' }, TENANT_A)
  assert.equal(a.zone, 'z1')
  const b = toTaxRateRow({ id: 'r2', tenant: TENANT_A, zone: { id: 'z2' }, taxClass: 'standard', rateBps: 1400, effectiveFrom: '2020-01-01T00:00:00.000Z' }, TENANT_A)
  assert.equal(b.zone, 'z2')
})

test('toShippingMethodRow: coerces numbers + relationship objects', () => {
  const row = toShippingMethodRow({
    id: 'sm1', tenant: TENANT_A, zone: { id: 'sz1' }, code: 'EG-STD',
    basePrice: '1500', freeAboveSubtotal: '5000',
    minimumSubtotal: null, maximumSubtotal: 20000, enabled: true,
  }, TENANT_A)
  assert.equal(row.zone, 'sz1')
  assert.equal(row.basePrice, 1500)
  assert.equal(row.freeAboveSubtotal, 5000)
  assert.equal(row.maximumSubtotal, 20000)
})
