import assert from 'node:assert/strict'
import test from 'node:test'

import { money } from '../src/commerce/money'
import {
  allocateProRata,
  quote,
  verifySnapshot,
} from '../src/commerce/pricing'

const EGP = (amount: number) => money(amount, 'EGP')

test('exclusive tax: 14% on a 2-unit line is exact integer math', () => {
  const s = quote({
    currency: 'EGP', taxMode: 'exclusive',
    lines: [{ key: 'a', sku: 'A', quantity: 2, unitPrice: EGP(1050), taxBps: 1400 }],
  })
  assert.equal(s.lines[0].taxable, 2100)
  assert.equal(s.lines[0].tax, 294) // 14% of 21.00
  assert.equal(s.grandTotal, 2394)
  assert.equal(s.amountDue, 2394)
})

test('inclusive tax: the embedded tax is extracted from the gross price', () => {
  const s = quote({
    currency: 'EGP', taxMode: 'inclusive',
    lines: [{ key: 'a', sku: 'A', quantity: 1, unitPrice: EGP(1000), taxBps: 1400 }],
  })
  assert.equal(s.lines[0].total, 1000) // gross unchanged
  assert.equal(s.lines[0].tax, 123) // 1.23 of the 10.00 is 14% tax
  assert.equal(s.grandTotal, 1000)
})

test('inclusive and exclusive converge: a 14% gross price totals the same as its net + tax', () => {
  const inclusive = quote({ currency: 'EGP', taxMode: 'inclusive', lines: [{ key: 'a', sku: 'A', quantity: 1, unitPrice: EGP(1000), taxBps: 1400 }] })
  const exclusive = quote({ currency: 'EGP', taxMode: 'exclusive', lines: [{ key: 'a', sku: 'A', quantity: 1, unitPrice: EGP(877), taxBps: 1400 }] })
  assert.equal(inclusive.grandTotal, 1000)
  assert.equal(exclusive.grandTotal, 1000) // 8.77 net + 1.23 tax (rounds up) = 10.00
})

test('line promotion reduces the line amount before tax', () => {
  const s = quote({
    currency: 'EGP', taxMode: 'exclusive',
    lines: [{ key: 'a', sku: 'A', quantity: 1, unitPrice: EGP(1000), taxBps: 0, lineDiscountBps: 1000 }],
  })
  assert.equal(s.lines[0].lineAmount, 900) // 10% off 10.00
  assert.equal(s.grandTotal, 900)
})

test('order promotion is allocated pro-rata with no lost pennies (residual on a line)', () => {
  const s = quote({
    currency: 'EGP', taxMode: 'exclusive',
    lines: [
      { key: 'a', sku: 'A', quantity: 1, unitPrice: EGP(1000), taxBps: 0 },
      { key: 'b', sku: 'B', quantity: 1, unitPrice: EGP(1000), taxBps: 0 },
    ],
    orderPromotions: [{ kind: 'fixed', value: 5 }],
  })
  const allocSum = s.lines.reduce((acc, l) => acc + l.orderAlloc, 0)
  assert.equal(allocSum, s.orderDiscount, 'allocations must sum to exactly the order discount')
  assert.equal(s.orderDiscount, 5)
  assert.equal(s.grandTotal, 1995) // 2000 - 5
  // every line stays non-negative and taxable equals lineAmount minus its allocation
  for (const l of s.lines) assert.ok(l.taxable >= 0 && l.taxable === l.lineAmount - l.orderAlloc)
})

test('allocateProRata: residual lands so allocations sum exactly to the discount', () => {
  const a = allocateProRata([1000, 1000, 1000], 10)
  assert.equal(a.reduce((x, y) => x + y, 0), 10)
  const b = allocateProRata([333, 333, 334], 1)
  assert.equal(b.reduce((x, y) => x + y, 0), 1)
})

test('gift-card tender is capped at the grand total; amount due never goes negative', () => {
  const over = quote({ currency: 'EGP', taxMode: 'exclusive', lines: [{ key: 'a', sku: 'A', quantity: 1, unitPrice: EGP(5000), taxBps: 0 }], giftCardTenders: [EGP(6000)] })
  assert.equal(over.giftCardApplied, 5000)
  assert.equal(over.amountDue, 0)
  const partial = quote({ currency: 'EGP', taxMode: 'exclusive', lines: [{ key: 'a', sku: 'A', quantity: 1, unitPrice: EGP(5000), taxBps: 0 }], giftCardTenders: [EGP(2000)] })
  assert.equal(partial.giftCardApplied, 2000)
  assert.equal(partial.amountDue, 3000)
})

test('shipping is taxed and added to the grand total', () => {
  const s = quote({
    currency: 'EGP', taxMode: 'exclusive',
    lines: [{ key: 'a', sku: 'A', quantity: 1, unitPrice: EGP(1000), taxBps: 0 }],
    shipping: { price: EGP(2000), taxBps: 1400 },
  })
  assert.equal(s.shippingTax, 280) // 14% of 20.00
  assert.equal(s.grandTotal, 3280) // 10.00 + 20.00 + 2.80
})

test('per-line half-up rounding (2.5% of 10.50 -> 0.26, no float drift)', () => {
  const s = quote({ currency: 'EGP', taxMode: 'exclusive', lines: [{ key: 'a', sku: 'A', quantity: 1, unitPrice: EGP(1050), taxBps: 250 }] })
  assert.equal(s.lines[0].tax, 26)
})

test('snapshot hash is tamper-evident and deterministic', () => {
  const s = quote({ currency: 'EGP', taxMode: 'exclusive', lines: [{ key: 'a', sku: 'A', quantity: 1, unitPrice: EGP(1050), taxBps: 1400 }] })
  assert.ok(verifySnapshot(s), 'fresh snapshot verifies')
  const again = quote({ currency: 'EGP', taxMode: 'exclusive', lines: [{ key: 'a', sku: 'A', quantity: 1, unitPrice: EGP(1050), taxBps: 1400 }] })
  assert.equal(again.hash, s.hash, 'same input -> same hash')
  const tampered = { ...s, grandTotal: s.grandTotal + 1 }
  assert.equal(verifySnapshot(tampered), false, 'mutated total breaks the hash')
})

test('currency mismatch and bad quantity are rejected', () => {
  assert.throws(() => quote({ currency: 'EGP', taxMode: 'exclusive', lines: [{ key: 'a', sku: 'A', quantity: 1, unitPrice: money(1000, 'USD'), taxBps: 0 }] }), /currency/)
  assert.throws(() => quote({ currency: 'EGP', taxMode: 'exclusive', lines: [{ key: 'a', sku: 'A', quantity: 0, unitPrice: EGP(1000), taxBps: 0 }] }), /positive integer/)
})
