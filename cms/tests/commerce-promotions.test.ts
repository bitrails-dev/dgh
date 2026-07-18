import assert from 'node:assert/strict'
import test from 'node:test'

import { applyBps, money } from '../src/commerce/money'
import { evaluate } from '../src/commerce/promotions'
import type { CartLine, EvaluateInput, Promotion } from '../src/commerce/promotions'
import { quote } from '../src/commerce/pricing'

const EGP = (amount: number) => money(amount, 'EGP')
const NOW = 1_000_000

function line(
  key: string,
  sku: string,
  unitPrice: number,
  quantity: number,
  categoryIds?: string[],
): CartLine {
  return { key, sku, unitPrice: EGP(unitPrice), quantity, categoryIds }
}

function subtotal(lines: CartLine[]): number {
  return lines.reduce((acc, l) => acc + l.unitPrice.amount * l.quantity, 0)
}

// --- schedule window --------------------------------------------------------

test('schedule window: promo is skipped before startsAt', () => {
  const p: Promotion = { id: 'p', kind: 'fixed', scope: 'order', value: 100, stacking: 'stackable', startsAt: NOW + 1000 }
  const r = evaluate({ currency: 'EGP', lines: [line('a', 'A', 1000, 1)], subtotal: 1000, now: NOW, promotions: [p] })
  assert.deepEqual(r.applied, [])
  assert.match(r.skipped[0].reason, /schedule window/)
})

test('schedule window: promo is skipped after endsAt', () => {
  const p: Promotion = { id: 'p', kind: 'fixed', scope: 'order', value: 100, stacking: 'stackable', endsAt: NOW - 1000 }
  const r = evaluate({ currency: 'EGP', lines: [line('a', 'A', 1000, 1)], subtotal: 1000, now: NOW, promotions: [p] })
  assert.deepEqual(r.applied, [])
  assert.match(r.skipped[0].reason, /schedule window/)
})

test('schedule window: promo applies within the window (inclusive bounds)', () => {
  const p: Promotion = { id: 'p', kind: 'fixed', scope: 'order', value: 100, stacking: 'stackable', startsAt: NOW, endsAt: NOW }
  const r = evaluate({ currency: 'EGP', lines: [line('a', 'A', 1000, 1)], subtotal: 1000, now: NOW, promotions: [p] })
  assert.equal(r.applied.length, 1)
  assert.deepEqual(r.orderDiscount, { kind: 'fixed', value: 100 })
})

// --- gates ------------------------------------------------------------------

test('minSubtotal gate: below threshold is skipped, at/above applies', () => {
  const p = (minSubtotal: number): Promotion => ({ id: 'p', kind: 'fixed', scope: 'order', value: 100, stacking: 'stackable', minSubtotal })
  const below = evaluate({ currency: 'EGP', lines: [line('a', 'A', 1000, 1)], subtotal: 500, now: NOW, promotions: [p(1000)] })
  assert.deepEqual(below.applied, [])
  assert.match(below.skipped[0].reason, /minSubtotal/)
  const at = evaluate({ currency: 'EGP', lines: [line('a', 'A', 1000, 1)], subtotal: 1000, now: NOW, promotions: [p(1000)] })
  assert.equal(at.applied.length, 1)
})

test('minQuantity gate: counted over the whole cart when untargeted', () => {
  const p: Promotion = { id: 'p', kind: 'percent', scope: 'line', value: 1000, stacking: 'stackable', minQuantity: 3 }
  const skip = evaluate({ currency: 'EGP', lines: [line('a', 'A', 1000, 2)], subtotal: 2000, now: NOW, promotions: [p] })
  assert.deepEqual(skip.applied, [])
  assert.match(skip.skipped[0].reason, /minQuantity/)
  const ok = evaluate({ currency: 'EGP', lines: [line('a', 'A', 1000, 3)], subtotal: 3000, now: NOW, promotions: [p] })
  assert.equal(ok.applied.length, 1)
})

test('minQuantity gate: counted over targeted lines only', () => {
  const p: Promotion = {
    id: 'p', kind: 'percent', scope: 'line', value: 1000, stacking: 'stackable', minQuantity: 2,
    appliesTo: { type: 'sku', values: ['A'] },
  }
  // Two units of A satisfy minQuantity=2 even though the cart also holds other skus.
  const ok = evaluate({
    currency: 'EGP',
    lines: [line('a', 'A', 1000, 2), line('b', 'B', 1000, 1)],
    subtotal: 3000, now: NOW, promotions: [p],
  })
  assert.equal(ok.applied.length, 1)
  assert.deepEqual(ok.lineDiscountBps, { a: 1000 })
})

// --- targeting --------------------------------------------------------------

test('category targeting: only matching lines receive the discount', () => {
  const p: Promotion = {
    id: 'p', kind: 'percent', scope: 'line', value: 1000, stacking: 'stackable',
    appliesTo: { type: 'category', values: ['drugs'] },
  }
  const r = evaluate({
    currency: 'EGP',
    lines: [line('a', 'A', 1000, 1, ['drugs']), line('b', 'B', 1000, 1, ['supplies'])],
    subtotal: 2000, now: NOW, promotions: [p],
  })
  assert.deepEqual(r.lineDiscountBps, { a: 1000 })
})

test('sku targeting: discount lands on the named sku only', () => {
  const p: Promotion = {
    id: 'p', kind: 'percent', scope: 'line', value: 500, stacking: 'stackable',
    appliesTo: { type: 'sku', values: ['A'] },
  }
  const r = evaluate({
    currency: 'EGP',
    lines: [line('a', 'A', 2000, 1), line('b', 'B', 2000, 1)],
    subtotal: 4000, now: NOW, promotions: [p],
  })
  assert.deepEqual(r.lineDiscountBps, { a: 500 })
})

test('targeting with no matching line skips the promo', () => {
  const p: Promotion = {
    id: 'p', kind: 'percent', scope: 'line', value: 1000, stacking: 'stackable',
    appliesTo: { type: 'sku', values: ['Z'] },
  }
  const r = evaluate({ currency: 'EGP', lines: [line('a', 'A', 1000, 1)], subtotal: 1000, now: NOW, promotions: [p] })
  assert.deepEqual(r.applied, [])
  assert.match(r.skipped[0].reason, /no line matches/)
})

test('group targeting: membership gate', () => {
  const p: Promotion = {
    id: 'p', kind: 'fixed', scope: 'order', value: 100, stacking: 'stackable',
    appliesTo: { type: 'group', values: ['vip'] },
  }
  const base: EvaluateInput = { currency: 'EGP', lines: [line('a', 'A', 1000, 1)], subtotal: 1000, now: NOW, promotions: [p] }
  const member = evaluate({ ...base, customerGroupIds: ['vip'] })
  assert.equal(member.applied.length, 1)
  const outsider = evaluate({ ...base, customerGroupIds: ['standard'] })
  assert.deepEqual(outsider.applied, [])
  assert.match(outsider.skipped[0].reason, /group/)
})

// --- discount kinds & shapes ------------------------------------------------

test('percent line promo yields the correct bps (10% off)', () => {
  const p: Promotion = { id: 'p', kind: 'percent', scope: 'line', value: 1000, stacking: 'stackable' }
  const r = evaluate({ currency: 'EGP', lines: [line('a', 'A', 1000, 1)], subtotal: 1000, now: NOW, promotions: [p] })
  assert.deepEqual(r.lineDiscountBps, { a: 1000 })
  assert.equal(r.orderDiscount, undefined)
})

test('fixed order promo becomes an order discount in minor units', () => {
  const p: Promotion = { id: 'p', kind: 'fixed', scope: 'order', value: 500, stacking: 'stackable' }
  const r = evaluate({ currency: 'EGP', lines: [line('a', 'A', 1000, 2)], subtotal: 2000, now: NOW, promotions: [p] })
  assert.deepEqual(r.orderDiscount, { kind: 'fixed', value: 500 })
  assert.deepEqual(r.lineDiscountBps, {})
})

test('percent order promo (untargeted) stays a percent', () => {
  const p: Promotion = { id: 'p', kind: 'percent', scope: 'order', value: 1000, stacking: 'stackable' }
  const r = evaluate({ currency: 'EGP', lines: [line('a', 'A', 1000, 2)], subtotal: 2000, now: NOW, promotions: [p] })
  assert.deepEqual(r.orderDiscount, { kind: 'percent', value: 1000 })
})

test('maxDiscount caps a percent line promo to the equivalent bps', () => {
  // 50% off a 10.00 line would be 5.00; capped at 2.00 → 2000 bps (20%).
  const p: Promotion = { id: 'p', kind: 'percent', scope: 'line', value: 5000, stacking: 'stackable', maxDiscount: 200 }
  const r = evaluate({ currency: 'EGP', lines: [line('a', 'A', 1000, 1)], subtotal: 1000, now: NOW, promotions: [p] })
  assert.deepEqual(r.lineDiscountBps, { a: 2000 })
})

test('maxDiscount caps a fixed order promo', () => {
  const p: Promotion = { id: 'p', kind: 'fixed', scope: 'order', value: 1000, stacking: 'stackable', maxDiscount: 300 }
  const r = evaluate({ currency: 'EGP', lines: [line('a', 'A', 1000, 2)], subtotal: 2000, now: NOW, promotions: [p] })
  assert.deepEqual(r.orderDiscount, { kind: 'fixed', value: 300 })
})

test('maxDiscount converts a percent order promo into a fixed amount', () => {
  // 50% of 100.00 = 50.00, capped at 20.00 → fixed 2000.
  const p: Promotion = { id: 'p', kind: 'percent', scope: 'order', value: 5000, stacking: 'stackable', maxDiscount: 2000 }
  const r = evaluate({ currency: 'EGP', lines: [line('a', 'A', 10000, 1)], subtotal: 10000, now: NOW, promotions: [p] })
  assert.deepEqual(r.orderDiscount, { kind: 'fixed', value: 2000 })
})

// --- stacking & priority ----------------------------------------------------

test('exclusive promo discards a higher-priority stackable promo', () => {
  const exclusive: Promotion = { id: 'ex', kind: 'percent', scope: 'line', value: 1000, stacking: 'exclusive', priority: 5 }
  const stackable: Promotion = { id: 'st', kind: 'fixed', scope: 'order', value: 500, stacking: 'stackable', priority: 10 }
  const r = evaluate({ currency: 'EGP', lines: [line('a', 'A', 1000, 1)], subtotal: 1000, now: NOW, promotions: [exclusive, stackable] })
  assert.equal(r.applied.length, 1)
  assert.equal(r.applied[0].promotionId, 'ex')
  assert.equal(r.orderDiscount, undefined) // the stackable order promo was discarded
  assert.ok(r.skipped.some((s) => s.promotionId === 'st' && /takes precedence/.test(s.reason)))
})

test('among exclusives, the highest priority wins', () => {
  const lo: Promotion = { id: 'lo', kind: 'fixed', scope: 'order', value: 100, stacking: 'exclusive', priority: 5 }
  const hi: Promotion = { id: 'hi', kind: 'fixed', scope: 'order', value: 200, stacking: 'exclusive', priority: 10 }
  const r = evaluate({ currency: 'EGP', lines: [line('a', 'A', 1000, 1)], subtotal: 1000, now: NOW, promotions: [lo, hi] })
  assert.equal(r.applied[0].promotionId, 'hi')
  assert.deepEqual(r.orderDiscount, { kind: 'fixed', value: 200 })
  assert.ok(r.skipped.some((s) => s.promotionId === 'lo'))
})

test('stackable line promos accumulate bps on the same line', () => {
  const a: Promotion = { id: 'a', kind: 'percent', scope: 'line', value: 1000, stacking: 'stackable' }
  const b: Promotion = { id: 'b', kind: 'percent', scope: 'line', value: 500, stacking: 'stackable' }
  const r = evaluate({ currency: 'EGP', lines: [line('x', 'A', 1000, 1)], subtotal: 1000, now: NOW, promotions: [a, b] })
  assert.deepEqual(r.lineDiscountBps, { x: 1500 })
  assert.equal(r.applied.length, 2)
})

test('stackable order promos: same-kind sums stay in that kind', () => {
  const a: Promotion = { id: 'a', kind: 'percent', scope: 'order', value: 1000, stacking: 'stackable' }
  const b: Promotion = { id: 'b', kind: 'percent', scope: 'order', value: 500, stacking: 'stackable' }
  const r = evaluate({ currency: 'EGP', lines: [line('x', 'A', 1000, 1)], subtotal: 1000, now: NOW, promotions: [a, b] })
  assert.deepEqual(r.orderDiscount, { kind: 'percent', value: 1500 })
})

test('stackable order promos: a percent+fixed mix collapses to fixed at the current subtotal', () => {
  const a: Promotion = { id: 'a', kind: 'percent', scope: 'order', value: 1000, stacking: 'stackable' } // 10% of 1000 = 100
  const b: Promotion = { id: 'b', kind: 'fixed', scope: 'order', value: 200, stacking: 'stackable' }
  const r = evaluate({ currency: 'EGP', lines: [line('x', 'A', 1000, 1)], subtotal: 1000, now: NOW, promotions: [a, b] })
  assert.deepEqual(r.orderDiscount, { kind: 'fixed', value: 300 })
})

test('priority orders the applied list for stackable promos', () => {
  const lo: Promotion = { id: 'lo', kind: 'fixed', scope: 'order', value: 100, stacking: 'stackable', priority: 1 }
  const hi: Promotion = { id: 'hi', kind: 'fixed', scope: 'order', value: 200, stacking: 'stackable', priority: 9 }
  const r = evaluate({ currency: 'EGP', lines: [line('x', 'A', 1000, 1)], subtotal: 1000, now: NOW, promotions: [lo, hi] })
  assert.equal(r.applied[0].promotionId, 'hi')
  assert.equal(r.applied[1].promotionId, 'lo')
})

// --- BXGY -------------------------------------------------------------------

test('BXGY: buy 2 get 1 free discounts the get-sku line by the free units value', () => {
  // Buy 4 of A → 2 sets → 2 free units of B. B line is 3 x 5.00 = 15.00; 2 free = 10.00 → bps.
  const p: Promotion = {
    id: 'bxgy', kind: 'bxgy', scope: 'line', stacking: 'stackable',
    bxgy: { buySku: 'A', buyQty: 2, getSku: 'B', getQty: 1 },
  }
  const lines = [line('a', 'A', 1000, 4), line('b', 'B', 500, 3)]
  const r = evaluate({ currency: 'EGP', lines, subtotal: subtotal(lines), now: NOW, promotions: [p] })
  const bps = r.lineDiscountBps['b']!
  // The bps, applied to the B line, must equal exactly the 2 free units (10.00).
  assert.equal(applyBps(EGP(1500), bps).amount, 1000)
})

test('BXGY: maxSets caps the number of earned sets', () => {
  const mk = (maxSets?: number): Promotion => ({
    id: 'bxgy', kind: 'bxgy', scope: 'line', stacking: 'stackable',
    bxgy: { buySku: 'A', buyQty: 2, getSku: 'B', getQty: 1, maxSets },
  })
  const lines = [line('a', 'A', 1000, 6), line('b', 'B', 500, 3)] // up to 3 sets possible
  const capped = evaluate({ currency: 'EGP', lines, subtotal: subtotal(lines), now: NOW, promotions: [mk(1)] })
  // maxSets=1 → 1 free B unit (5.00) off a 15.00 line.
  assert.equal(applyBps(EGP(1500), capped.lineDiscountBps['b']!).amount, 500)
  const full = evaluate({ currency: 'EGP', lines, subtotal: subtotal(lines), now: NOW, promotions: [mk()] })
  // no cap → 3 free units = the whole B line (100% / 10000 bps).
  assert.equal(full.lineDiscountBps['b'], 10000)
})

test('BXGY: no complete buy-set is skipped', () => {
  const p: Promotion = {
    id: 'bxgy', kind: 'bxgy', scope: 'line', stacking: 'stackable',
    bxgy: { buySku: 'A', buyQty: 2, getSku: 'B', getQty: 1 },
  }
  const r = evaluate({ currency: 'EGP', lines: [line('a', 'A', 1000, 1), line('b', 'B', 500, 1)], subtotal: 1500, now: NOW, promotions: [p] })
  assert.deepEqual(r.applied, [])
  assert.match(r.skipped[0].reason, /buy-set/)
})

// --- free shipping ----------------------------------------------------------

test('free_shipping sets the flag and is reflected on the result', () => {
  const p: Promotion = { id: 'fs', kind: 'free_shipping', scope: 'order', stacking: 'stackable' }
  const r = evaluate({ currency: 'EGP', lines: [line('a', 'A', 1000, 1)], subtotal: 1000, now: NOW, promotions: [p] })
  assert.equal(r.freeShipping, true)
  assert.equal(r.applied[0].freeShipping, true)
})

// --- usage gates ------------------------------------------------------------

test('usageRemaining = 0 skips with an exhausted reason', () => {
  const p: Promotion = { id: 'p', kind: 'fixed', scope: 'order', value: 100, stacking: 'stackable', usageRemaining: 0 }
  const r = evaluate({ currency: 'EGP', lines: [line('a', 'A', 1000, 1)], subtotal: 1000, now: NOW, promotions: [p] })
  assert.deepEqual(r.applied, [])
  assert.match(r.skipped[0].reason, /global usage exhausted/)
})

test('usageRemaining > 0 applies', () => {
  const p: Promotion = { id: 'p', kind: 'fixed', scope: 'order', value: 100, stacking: 'stackable', usageRemaining: 5 }
  const r = evaluate({ currency: 'EGP', lines: [line('a', 'A', 1000, 1)], subtotal: 1000, now: NOW, promotions: [p] })
  assert.equal(r.applied.length, 1)
})

test('per-customer usage exhausted skips; a positive balance applies', () => {
  const mk = (per: number | undefined): Promotion => ({ id: 'p', kind: 'fixed', scope: 'order', value: 100, stacking: 'stackable', perCustomerUsageRemaining: per })
  const base: Omit<EvaluateInput, 'promotions'> = { currency: 'EGP', lines: [line('a', 'A', 1000, 1)], subtotal: 1000, now: NOW }
  assert.match(evaluate({ ...base, promotions: [mk(0)] }).skipped[0].reason, /per-customer usage exhausted/)
  assert.equal(evaluate({ ...base, promotions: [mk(3)] }).applied.length, 1)
})

// --- determinism ------------------------------------------------------------

test('snapshot determinism: identical input yields identical output', () => {
  const promotions: Promotion[] = [
    { id: 'a', kind: 'percent', scope: 'line', value: 1000, stacking: 'stackable', priority: 2, appliesTo: { type: 'category', values: ['c1'] } },
    { id: 'b', kind: 'fixed', scope: 'order', value: 150, stacking: 'stackable', priority: 1 },
    { id: 'c', kind: 'bxgy', scope: 'line', stacking: 'stackable', bxgy: { buySku: 'A', buyQty: 2, getSku: 'B', getQty: 1 } },
  ]
  const input = {
    currency: 'EGP',
    lines: [line('a', 'A', 1000, 4, ['c1']), line('b', 'B', 500, 2, ['c2'])],
    subtotal: 5000, now: NOW, promotions,
  }
  const r1 = evaluate(input)
  const r2 = evaluate(structuredClone(input))
  assert.deepStrictEqual(r1, r2)
})

// --- contract with commerce/pricing -----------------------------------------

test('evaluate output feeds quote correctly (percent line promo reduces the grand total)', () => {
  const p: Promotion = { id: 'p', kind: 'percent', scope: 'line', value: 1000, stacking: 'stackable' }
  const lines = [line('a', 'A', 1000, 1)]
  const r = evaluate({ currency: 'EGP', lines, subtotal: subtotal(lines), now: NOW, promotions: [p] })
  const s = quote({
    currency: 'EGP', taxMode: 'exclusive',
    lines: [{ key: 'a', sku: 'A', quantity: 1, unitPrice: EGP(1000), taxBps: 0, lineDiscountBps: r.lineDiscountBps['a'] }],
  })
  assert.equal(s.grandTotal, 900) // 10% off 10.00
})

test('evaluate output feeds quote correctly (fixed order promo)', () => {
  const p: Promotion = { id: 'p', kind: 'fixed', scope: 'order', value: 500, stacking: 'stackable' }
  const lines = [line('a', 'A', 1000, 1), line('b', 'B', 1000, 1)]
  const r = evaluate({ currency: 'EGP', lines, subtotal: subtotal(lines), now: NOW, promotions: [p] })
  const s = quote({
    currency: 'EGP', taxMode: 'exclusive',
    lines: [
      { key: 'a', sku: 'A', quantity: 1, unitPrice: EGP(1000), taxBps: 0 },
      { key: 'b', sku: 'B', quantity: 1, unitPrice: EGP(1000), taxBps: 0 },
    ],
    orderPromotions: r.orderDiscount ? [r.orderDiscount] : [],
  })
  assert.equal(s.grandTotal, 1500) // 20.00 - 5.00
})
