// Promotions / pricing-modifier evaluation engine. Pure domain logic: given a cart snapshot, the
// current time, and a set of promotions, decide which promotions apply and express their effect as
// per-line discount bps (keyed by line.key) and/or a single order discount — the exact shapes that
// commerce/pricing consumes (QuoteLineInput.lineDiscountBps and orderPromotions[]).
//
// No DB, no Payload, no I/O. All time arrives via the `now` input (never Date.now) and there is no
// Math.random, so the result is a pure function of the input: the same input always yields the same
// output, which is what the quote snapshot (commerce/pricing) needs to stay reproducible.
//
// All money is integer minor units (see commerce/money.ts). Percent rates are basis points. We never
// use floats; the only divisions are the single half-up step inside divRoundHalfUp / applyBps.
//
// Output contract:
//   - lineDiscountBps: merged across every applied line-scope promo; values are bps off that line.
//   - orderDiscount: a single {kind,value} combining every applied order-scope promo (see combine
//     rule at the bottom). undefined when no order-scope promo applies.
//   - freeShipping: true if any applied promo grants it.
//   - applied/skipped: full audit of what ran and why each non-applied promo did not.

import { type Money, applyBps, divRoundHalfUp, money, scale } from '../money'

export interface CartLine {
  key: string
  sku: string
  categoryIds?: string[]
  quantity: number
  unitPrice: Money
}

export type PromotionKind = 'percent' | 'fixed' | 'free_shipping' | 'bxgy'

export interface PromotionAppliesTo {
  type: 'order' | 'category' | 'sku' | 'group'
  values: string[]
}

export interface BxGyRule {
  buySku: string
  buyQty: number
  getSku: string
  getQty: number
  maxSets?: number
}

export interface Promotion {
  id: string
  kind: PromotionKind
  scope: 'order' | 'line'
  appliesTo?: PromotionAppliesTo
  value?: number // bps for percent; minor units for fixed
  bxgy?: BxGyRule
  minSubtotal?: number
  minQuantity?: number
  startsAt?: number
  endsAt?: number
  priority?: number
  stacking: 'exclusive' | 'stackable'
  maxDiscount?: number
  usageRemaining?: number
  perCustomerUsageRemaining?: number
}

export interface EvaluateInput {
  currency: string
  lines: CartLine[]
  subtotal: number
  customerGroupIds?: string[]
  now: number
  promotions: Promotion[]
}

export interface OrderDiscount {
  kind: 'fixed' | 'percent'
  value: number
}

export interface AppliedPromotion {
  promotionId: string
  lineDiscountBps?: Record<string, number>
  orderDiscount?: OrderDiscount
  freeShipping: boolean
  reason?: string
}

export interface SkippedPromotion {
  promotionId: string
  reason: string
}

export interface EvaluateResult {
  applied: AppliedPromotion[]
  freeShipping: boolean
  lineDiscountBps: Record<string, number>
  orderDiscount?: OrderDiscount
  skipped: SkippedPromotion[]
}

// A line's pre-discount amount in minor units (unit price * integer quantity).
function lineAmount(line: CartLine): number {
  return scale(line.unitPrice, line.quantity).amount
}

// Does the line satisfy a category/sku target? (order/group targeting is resolved elsewhere.)
function lineMatchesTarget(line: CartLine, target: PromotionAppliesTo): boolean {
  if (target.type === 'category') {
    const cats = line.categoryIds ?? []
    return target.values.some((v) => cats.includes(v))
  }
  if (target.type === 'sku') return target.values.includes(line.sku)
  return false
}

// True when the promo narrows to specific lines (category/sku), so its discount must be computed
// against just those lines rather than the whole-cart subtotal.
function isLineTargeted(p: Promotion): boolean {
  return p.appliesTo?.type === 'category' || p.appliesTo?.type === 'sku'
}

// Lines a line-scope promo acts on: targeted lines, or every line when there is no category/sku target.
function targetedLines(p: Promotion, lines: CartLine[]): CartLine[] {
  if (isLineTargeted(p) && p.appliesTo) return lines.filter((l) => lineMatchesTarget(l, p.appliesTo!))
  return lines
}

// Subtotal an order-scope promo is computed against: matching lines when targeted, else the cart subtotal.
function orderBaseSubtotal(p: Promotion, input: EvaluateInput): number {
  if (isLineTargeted(p) && p.appliesTo) {
    return input.lines
      .filter((l) => lineMatchesTarget(l, p.appliesTo!))
      .reduce((acc, l) => acc + lineAmount(l), 0)
  }
  return input.subtotal
}

// Eligibility gate. Returns the skip reason, or null when the promo may apply. Schedule, usage, group
// membership, subtotal and quantity gates are evaluated here; the discount-yield check (e.g. a BXGY
// with no complete set) happens later in computeEffect.
function eligibilityReason(p: Promotion, input: EvaluateInput): string | null {
  // Schedule window — inclusive bounds; an unset bound is open-ended.
  if (p.startsAt !== undefined && input.now < p.startsAt) return 'outside schedule window (before startsAt)'
  if (p.endsAt !== undefined && input.now > p.endsAt) return 'outside schedule window (after endsAt)'

  // Usage gates: 0 = exhausted, undefined = unlimited.
  if (p.usageRemaining !== undefined && p.usageRemaining <= 0) return 'global usage exhausted'
  if (p.perCustomerUsageRemaining !== undefined && p.perCustomerUsageRemaining <= 0) {
    return 'per-customer usage exhausted'
  }

  // Customer-group targeting is a pure membership gate.
  if (p.appliesTo?.type === 'group') {
    const groups = input.customerGroupIds ?? []
    if (!p.appliesTo.values.some((v) => groups.includes(v))) return 'customer not in targeted group'
  }

  if (p.minSubtotal !== undefined && input.subtotal < p.minSubtotal) {
    return `subtotal ${input.subtotal} < minSubtotal ${p.minSubtotal}`
  }

  // Quantity gate: over targeted lines when category/sku-scoped, else over the whole cart.
  if (p.minQuantity !== undefined) {
    const base = isLineTargeted(p) ? targetedLines(p, input.lines) : input.lines
    const qty = base.reduce((acc, l) => acc + l.quantity, 0)
    if (qty < p.minQuantity) return `quantity ${qty} < minQuantity ${p.minQuantity}`
  }

  // Category/sku targeting must hit at least one line to be applicable at all.
  if (isLineTargeted(p) && targetedLines(p, input.lines).length === 0) {
    return `no line matches target ${p.appliesTo!.type}`
  }

  return null
}

type ApplyEffect = {
  lineDiscountBps?: Record<string, number>
  orderDiscount?: OrderDiscount
  freeShipping: boolean
}

// Discriminated by `kind` so computeEffect's result narrows cleanly in evaluate().
type Effect =
  | { kind: 'skip'; reason: string }
  | ({ kind: 'apply' } & ApplyEffect)

// Convert a minor-unit discount amount on a line into the equivalent bps off that line (half-up).
function amountToBps(amount: number, lineSubtotal: number): number {
  return divRoundHalfUp(amount * 10_000, lineSubtotal)
}

function computeBxGyEffect(p: Promotion, input: EvaluateInput): Effect {
  const rule = p.bxgy
  if (!rule) return { kind: 'skip', reason: 'bxgy promotion missing bxgy rule' }

  const buyLine = input.lines.find((l) => l.sku === rule.buySku)
  const getLine = input.lines.find((l) => l.sku === rule.getSku)
  if (!buyLine || rule.buyQty <= 0 || buyLine.quantity < rule.buyQty) {
    return { kind: 'skip', reason: 'no complete buy-set' }
  }
  const setsByBuy = Math.floor(buyLine.quantity / rule.buyQty)
  const sets = rule.maxSets !== undefined ? Math.min(setsByBuy, rule.maxSets) : setsByBuy
  if (sets <= 0) return { kind: 'skip', reason: 'no complete buy-set' }
  if (!getLine || getLine.quantity <= 0) return { kind: 'skip', reason: 'get-sku not in cart' }

  // Free units granted are bounded by both the earned sets and the get-sku quantity present.
  const freeUnits = Math.min(sets * rule.getQty, getLine.quantity)
  const getSub = lineAmount(getLine)
  if (getSub <= 0) return { kind: 'skip', reason: 'get-sku line subtotal is zero' }

  // The free units' value becomes a discount on the get-sku line, expressed as bps. maxDiscount caps
  // the free value; bps is then floored at 10000 (the whole line) so we never discount below free.
  const freeValue = freeUnits * getLine.unitPrice.amount
  const cappedValue = p.maxDiscount !== undefined ? Math.min(freeValue, p.maxDiscount) : freeValue
  const bps = Math.min(amountToBps(cappedValue, getSub), 10_000)
  if (bps <= 0) return { kind: 'skip', reason: 'bxgy yields no discount' }
  const lbps: Record<string, number> = { [getLine.key]: bps }
  return { kind: 'apply', lineDiscountBps: lbps, freeShipping: false }
}

// Turn an eligible promo into its concrete effect, or a skip reason when it yields nothing.
function computeEffect(p: Promotion, input: EvaluateInput): Effect {
  if (p.kind === 'free_shipping') return { kind: 'apply', freeShipping: true }
  if (p.kind === 'bxgy') return computeBxGyEffect(p, input)

  const value = p.value ?? 0

  if (p.kind === 'percent') {
    if (value <= 0) return { kind: 'skip', reason: 'percent value <= 0' }
    if (p.scope === 'line') {
      const lbps: Record<string, number> = {}
      for (const l of targetedLines(p, input.lines)) {
        const sub = lineAmount(l)
        if (sub <= 0) continue
        const amount = applyBps(money(sub, input.currency), value).amount
        const capped = p.maxDiscount !== undefined ? Math.min(amount, p.maxDiscount) : amount
        const bps = amountToBps(capped, sub)
        if (bps > 0) lbps[l.key] = (lbps[l.key] ?? 0) + bps
      }
      if (Object.keys(lbps).length === 0) return { kind: 'skip', reason: 'no eligible line for percent discount' }
      return { kind: 'apply', lineDiscountBps: lbps, freeShipping: false }
    }
    // order scope: percent off the relevant base. When targeted, the base is only the matching lines,
    // so the discount cannot be expressed as an order-wide percent — emit it as the exact fixed amount.
    const base = orderBaseSubtotal(p, input)
    const amount = applyBps(money(base, input.currency), value).amount
    const capped = p.maxDiscount !== undefined ? Math.min(amount, p.maxDiscount) : amount
    if (isLineTargeted(p) || capped < amount) {
      return { kind: 'apply', orderDiscount: { kind: 'fixed', value: capped }, freeShipping: false }
    }
    return { kind: 'apply', orderDiscount: { kind: 'percent', value }, freeShipping: false }
  }

  // fixed kind (minor units off).
  if (value <= 0) return { kind: 'skip', reason: 'fixed value <= 0' }
  const cap = p.maxDiscount !== undefined ? Math.min(value, p.maxDiscount) : value
  if (p.scope === 'line') {
    // A fixed line promo is "X off each matching line", never below zero on that line.
    const lbps: Record<string, number> = {}
    for (const l of targetedLines(p, input.lines)) {
      const sub = lineAmount(l)
      if (sub <= 0) continue
      const amt = Math.min(cap, sub)
      const bps = amountToBps(amt, sub)
      if (bps > 0) lbps[l.key] = (lbps[l.key] ?? 0) + bps
    }
    if (Object.keys(lbps).length === 0) return { kind: 'skip', reason: 'no eligible line for fixed discount' }
    return { kind: 'apply', lineDiscountBps: lbps, freeShipping: false }
  }
  return { kind: 'apply', orderDiscount: { kind: 'fixed', value: cap }, freeShipping: false }
}

export function evaluate(input: EvaluateInput): EvaluateResult {
  money(0, input.currency) // validate the ISO-4217 currency once at the trust boundary

  // 1. Resolve eligibility + effect per promo.
  type Resolved = { p: Promotion; skip?: string; effect?: ApplyEffect }
  const resolved: Resolved[] = input.promotions.map((p) => {
    const reason = eligibilityReason(p, input)
    if (reason) return { p, skip: reason }
    const effect = computeEffect(p, input)
    // Tagged union narrows here: the apply variant is structurally an ApplyEffect.
    return effect.kind === 'skip' ? { p, skip: effect.reason } : { p, effect }
  })

  const eligible = resolved.filter(
    (r): r is Resolved & { effect: ApplyEffect } => r.effect !== undefined && r.skip === undefined,
  )
  const skipped: SkippedPromotion[] = resolved
    .filter((r) => r.skip !== undefined)
    .map((r) => ({ promotionId: r.p.id, reason: r.skip! }))

  // 2. Priority desc, then id asc — a deterministic total order so equal-priority promos never depend
  //    on input array order (keeps the output snapshot-stable).
  const sorted = [...eligible].sort((a, b) => {
    const pa = a.p.priority ?? 0
    const pb = b.p.priority ?? 0
    if (pb !== pa) return pb - pa
    return a.p.id < b.p.id ? -1 : a.p.id > b.p.id ? 1 : 0
  })

  // 3. Stacking — "exclusive wins, applied first". If any eligible promo is exclusive, only the
  //    highest-priority eligible exclusive is applied and every other eligible promo is skipped
  //    (regardless of its own priority). Otherwise all eligible stackable promos accumulate.
  let appliedRes: Resolved[]
  const firstExclusive = sorted.find((r) => r.p.stacking === 'exclusive')
  if (firstExclusive) {
    appliedRes = [firstExclusive]
    for (const r of sorted) {
      if (r === firstExclusive) continue
      skipped.push({ promotionId: r.p.id, reason: `exclusive promotion ${firstExclusive.p.id} takes precedence` })
    }
  } else {
    appliedRes = sorted
  }

  // 4. Build the per-promotion applied entries and aggregate the outputs.
  const applied: AppliedPromotion[] = []
  const lineDiscountBps: Record<string, number> = {}
  let freeShipping = false
  let orderPercentBps = 0
  let orderFixedAmount = 0

  for (const r of appliedRes) {
    const eff = r.effect!
    const entry: AppliedPromotion = { promotionId: r.p.id, freeShipping: eff.freeShipping ?? false }
    if (eff.freeShipping) freeShipping = true
    if (eff.lineDiscountBps) {
      entry.lineDiscountBps = eff.lineDiscountBps
      for (const [k, v] of Object.entries(eff.lineDiscountBps)) {
        lineDiscountBps[k] = (lineDiscountBps[k] ?? 0) + v
      }
    }
    if (eff.orderDiscount) {
      entry.orderDiscount = eff.orderDiscount
      if (eff.orderDiscount.kind === 'percent') orderPercentBps += eff.orderDiscount.value
      else orderFixedAmount += eff.orderDiscount.value
    }
    applied.push(entry)
  }

  // 5. Combine the order-scope discounts into one {kind,value}. Same-kind sums stay in that kind; a
  //    mix collapses to fixed (percent converted at the current subtotal) so the total is exact and
  //    independent of how commerce/pricing pro-rata-allocates a single order discount.
  let orderDiscount: OrderDiscount | undefined
  if (orderPercentBps > 0 && orderFixedAmount === 0) {
    orderDiscount = { kind: 'percent', value: orderPercentBps }
  } else if (orderFixedAmount > 0 && orderPercentBps === 0) {
    orderDiscount = { kind: 'fixed', value: orderFixedAmount }
  } else if (orderPercentBps > 0 && orderFixedAmount > 0) {
    const percentAsFixed = applyBps(money(input.subtotal, input.currency), orderPercentBps).amount
    orderDiscount = { kind: 'fixed', value: orderFixedAmount + percentAsFixed }
  }

  return { applied, freeShipping, lineDiscountBps, orderDiscount, skipped }
}
