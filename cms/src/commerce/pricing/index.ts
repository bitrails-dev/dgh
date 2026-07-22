// Server-side pricing/quote engine. The single authoritative implementation of the calculation
// order; browsers submit only their intent (which items, which address, which promo code), and the
// server resolves prices, discounts, tax, and totals. The result is a frozen QuoteSnapshot persisted
// verbatim on the order so historical orders never recompute when products or rates later change.
//
// All money is integer minor units (see commerce/money.ts). Rates are basis points so every
// percentage stays in integers until a single half-up division per line (step 7).
//
// Calculation order (spec):
//   1. resolve active price          (caller passes the server-resolved unitPrice)
//   2. apply modifiers               (folded into unitPrice by the caller)
//   3. apply line promotions         (lineDiscountBps)
//   4. apply order promotions        (pro-rata across line amounts, penny residual on largest line)
//   5. discounted shipping           (caller passes the selected, already-discounted shipping rate)
//   6. inclusive/exclusive tax       (per line and per shipping)
//   7. half-up round per line        (divRoundHalfUp at each bps application)
//   8. gift-card tender              (capped at the grand total)
//   9. amount due

import { createHash } from 'node:crypto'
import { type Money, divRoundHalfUp, money, scale } from '../money'

export const QUOTE_VERSION = 1
export type TaxMode = 'inclusive' | 'exclusive'

export interface QuoteLineInput {
  key: string
  sku: string
  quantity: number
  unitPrice: Money // server-resolved active price; net for exclusive mode, gross for inclusive
  taxBps: number // 0 for exempt
  lineDiscountBps?: number // per-line percentage promotion
}

export interface OrderPromotion {
  kind: 'fixed' | 'percent' // fixed = minor units, percent = basis points
  value: number
}

export interface ShippingInput {
  price: Money
  taxBps?: number
}

export interface QuoteInput {
  currency: string
  taxMode: TaxMode
  lines: QuoteLineInput[]
  orderPromotions?: OrderPromotion[]
  shipping?: ShippingInput | null
  giftCardTenders?: Money[]
}

export interface QuoteLineSnapshot {
  key: string
  sku: string
  quantity: number
  unitPrice: Money
  lineAmount: number // post line-promo (before order-promo allocation)
  orderAlloc: number // share of the order discount allocated to this line
  taxable: number // lineAmount - orderAlloc
  tax: number
  total: number
}

export interface QuoteSnapshot {
  version: number
  hash: string
  currency: string
  taxMode: TaxMode
  lines: QuoteLineSnapshot[]
  merchandiseSubtotal: number // sum of post-line-promo line amounts (before order discount)
  orderDiscount: number
  shippingPrice: number
  shippingTax: number
  totalTax: number
  grandTotal: number
  giftCardApplied: number
  amountDue: number
}

const requirePositiveInt = (q: number, label: string): void => {
  if (!Number.isInteger(q) || q <= 0) throw new Error(`${label} must be a positive integer, got ${q}`)
}

// taxable → {tax, total} for the given mode. Exclusive: tax added on top. Inclusive: taxable is the
// gross and tax is the embedded portion extracted by net = gross * 10000 / (10000 + bps).
function computeTax(taxable: number, taxBps: number, mode: TaxMode): { tax: number; total: number } {
  if (taxBps <= 0) return { tax: 0, total: taxable }
  if (mode === 'exclusive') {
    const tax = divRoundHalfUp(taxable * taxBps, 10_000)
    return { tax, total: taxable + tax }
  }
  const net = divRoundHalfUp(taxable * 10_000, 10_000 + taxBps)
  return { tax: taxable - net, total: taxable }
}

// Allocate `discount` across `bases` pro-rata, half-up per line, with the rounding residual
// distributed across the lines so the allocations sum to exactly `discount` (no lost/gained cents)
// AND no line's allocation ever goes negative. Residual (positive or negative) is applied to lines
// from largest base to smallest, each line absorbing at most its current allocation in magnitude, so
// a large |diff| can never drive a single line below zero. If residual remains after every line the
// cap exceeded the total bases (shouldn't happen since cap = min(discount, total)) — leave it rather
// than fabricate negative allocations.
export function allocateProRata(bases: number[], discount: number): number[] {
  const total = bases.reduce((acc, b) => acc + b, 0)
  if (total <= 0 || discount <= 0) return bases.map(() => 0)
  const cap = Math.min(discount, total)
  const allocated = bases.map((b) => divRoundHalfUp(b * cap, total))
  const sum = allocated.reduce((acc, a) => acc + a, 0)
  let diff = cap - sum
  if (diff !== 0) {
    // Lines largest-base first; ties broken by original index for determinism.
    const order = bases
      .map((b, i) => ({ b, i }))
      .sort((x, y) => (y.b - x.b) || (x.i - y.i))
    for (const { i } of order) {
      if (diff === 0) break
      if (diff > 0) {
        // Under-allocation: bump this line up by as much of the residual as possible.
        const bump = diff
        allocated[i] += bump
        diff = 0
      } else {
        // Over-allocation: claw back from this line, clamped so the line never goes negative.
        const want = Math.min(-diff, allocated[i])
        allocated[i] -= want
        diff += want
        if (diff === 0) break
      }
    }
    // If diff !== 0 here, cap exceeded total bases (theoretically impossible given cap above).
    // We leave the residual un-applied rather than risk driving any line negative.
  }
  return allocated
}

export function quote(input: QuoteInput): QuoteSnapshot {
  const { currency, taxMode, lines } = input
  money(0, currency) // validate ISO-4217 once
  if (!Array.isArray(lines)) throw new Error('quote requires a lines array')

  // 1-3. resolve price + line promotions → post-line-promo line amount.
  const computed = lines.map((l) => {
    if (l.unitPrice.currency !== currency) {
      throw new Error(`line ${l.key} currency ${l.unitPrice.currency} != quote ${currency}`)
    }
    requirePositiveInt(l.quantity, `line ${l.key} quantity`)
    const base = scale(l.unitPrice, l.quantity).amount
    const lineDiscount = l.lineDiscountBps ? divRoundHalfUp(base * l.lineDiscountBps, 10_000) : 0
    return { line: l, lineAmount: base - lineDiscount }
  })

  // 4. order promotions, summed and capped at the merchandise subtotal, then pro-rata allocated.
  const merchandiseSubtotal = computed.reduce((acc, c) => acc + c.lineAmount, 0)
  let orderDiscount = 0
  for (const p of input.orderPromotions ?? []) {
    orderDiscount += p.kind === 'percent'
      ? divRoundHalfUp(merchandiseSubtotal * p.value, 10_000)
      : Math.max(0, Math.trunc(p.value))
  }
  orderDiscount = Math.min(orderDiscount, merchandiseSubtotal)
  const allocs = allocateProRata(computed.map((c) => c.lineAmount), orderDiscount)

  // 6-7. per-line tax on the post-allocation taxable amount; half-up rounding happens inside computeTax.
  const lineSnaps: QuoteLineSnapshot[] = computed.map((c, i) => {
    const taxable = c.lineAmount - allocs[i]
    const { tax, total } = computeTax(taxable, c.line.taxBps, taxMode)
    return {
      key: c.line.key,
      sku: c.line.sku,
      quantity: c.line.quantity,
      unitPrice: c.line.unitPrice,
      lineAmount: c.lineAmount,
      orderAlloc: allocs[i],
      taxable,
      tax,
      total,
    }
  })

  const merchandiseTotal = lineSnaps.reduce((acc, l) => acc + l.total, 0)
  let totalTax = lineSnaps.reduce((acc, l) => acc + l.tax, 0)

  // 5. shipping + shipping tax.
  let shippingPrice = 0
  let shippingTax = 0
  if (input.shipping) {
    if (input.shipping.price.currency !== currency) {
      throw new Error(`shipping currency ${input.shipping.price.currency} != quote ${currency}`)
    }
    shippingPrice = input.shipping.price.amount
    const s = computeTax(shippingPrice, input.shipping.taxBps ?? 0, taxMode)
    shippingTax = s.tax
    totalTax += s.tax
  }

  const grandTotal = merchandiseTotal + shippingPrice + shippingTax

  // 8. gift-card tender, capped at the grand total so amountDue never goes negative.
  const tenders = (input.giftCardTenders ?? []).reduce((acc, m) => acc + Math.max(0, m.amount), 0)
  const giftCardApplied = Math.min(tenders, grandTotal)

  // 9. amount due.
  const amountDue = grandTotal - giftCardApplied

  const snapshot: QuoteSnapshot = {
    version: QUOTE_VERSION,
    hash: '',
    currency,
    taxMode,
    lines: lineSnaps,
    merchandiseSubtotal,
    orderDiscount,
    shippingPrice,
    shippingTax,
    totalTax,
    grandTotal,
    giftCardApplied,
    amountDue,
  }
  snapshot.hash = hashSnapshot(snapshot)
  return snapshot
}

// SHA-256 over a canonical, key-ordered projection of the snapshot (hash field excluded). Any
// tampering with an amount changes the hash; verifySnapshot catches it. Lines are sorted by a stable
// key (the line's SKU-based `key`, falling back to `sku:quantity`) before serialization, so the hash
// is order-independent: callers that submit the same lines in a different order produce the same
// hash, and any single-line mutation still changes it.
export function hashSnapshot(s: Omit<QuoteSnapshot, 'hash'>): string {
  const lineKey = (x: QuoteLineSnapshot): string =>
    typeof x.key === 'string' && x.key.length > 0 ? x.key : `${x.sku}:${x.quantity}`
  const sortedLines = [...s.lines].sort((a, b) => {
    const ka = lineKey(a)
    const kb = lineKey(b)
    return ka < kb ? -1 : ka > kb ? 1 : 0
  })
  const canonical = {
    v: s.version,
    c: s.currency,
    m: s.taxMode,
    l: sortedLines.map((x) => [
      x.key, x.sku, x.quantity, x.unitPrice.amount, x.lineAmount, x.orderAlloc, x.taxable, x.tax, x.total,
    ]),
    ms: s.merchandiseSubtotal,
    od: s.orderDiscount,
    sp: s.shippingPrice,
    st: s.shippingTax,
    tt: s.totalTax,
    gt: s.grandTotal,
    gc: s.giftCardApplied,
    ad: s.amountDue,
  }
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex')
}

export function verifySnapshot(s: QuoteSnapshot): boolean {
  const { hash, ...rest } = s
  return hash === hashSnapshot(rest)
}
