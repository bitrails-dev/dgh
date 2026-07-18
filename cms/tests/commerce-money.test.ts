import assert from 'node:assert/strict'
import test from 'node:test'

import {
  add,
  applyBps,
  divRoundHalfUp,
  money,
  scale,
  subtract,
  sum,
} from '../src/commerce/money'

test('money rejects non-integer amounts and bad currency codes', () => {
  assert.deepEqual(money(1050, 'egp'), { amount: 1050, currency: 'EGP' })
  assert.throws(() => money(10.5, 'EGP'), /safe integer/)
  assert.throws(() => money(100, 'DOLLAR'), /ISO-4217/)
  assert.throws(() => money(NaN, 'EGP'), /safe integer/)
})

test('add/subtract/scale/sum keep money in exact integer minor units', () => {
  assert.deepEqual(add(money(100, 'EGP'), money(50, 'EGP')), { amount: 150, currency: 'EGP' })
  assert.deepEqual(subtract(money(100, 'EGP'), money(30, 'EGP')), { amount: 70, currency: 'EGP' })
  assert.deepEqual(scale(money(1050, 'EGP'), 3), { amount: 3150, currency: 'EGP' })
  assert.deepEqual(sum([money(10, 'EGP'), money(20, 'EGP'), money(5, 'EGP')], 'EGP'), {
    amount: 35,
    currency: 'EGP',
  })
  assert.throws(() => scale(money(100, 'EGP'), 2.5), /non-negative integer/)
})

test('currency mismatch is rejected', () => {
  assert.throws(() => add(money(100, 'EGP'), money(100, 'USD')), /Currency mismatch/)
  assert.throws(() => sum([money(10, 'EGP'), money(10, 'USD')], 'EGP'), /Currency mismatch/)
})

test('divRoundHalfUp rounds half away from zero with exact integer math', () => {
  assert.equal(divRoundHalfUp(4, 2), 2)
  assert.equal(divRoundHalfUp(5, 2), 3) // 2.5 -> 3
  assert.equal(divRoundHalfUp(7, 2), 4) // 3.5 -> 4
  assert.equal(divRoundHalfUp(262500, 10000), 26) // 26.25 -> 26
  assert.equal(divRoundHalfUp(55000, 10000), 6) // 5.5 -> 6
  assert.throws(() => divRoundHalfUp(1, 0), /positive integer/)
})

test('applyBps applies a basis-point rate with half-up rounding (no floats)', () => {
  assert.equal(applyBps(money(1050, 'EGP'), 250).amount, 26) // 2.5% of 10.50 -> 0.26
  assert.equal(applyBps(money(220, 'EGP'), 250).amount, 6) // 2.5% of 2.20 -> 0.06 (half up)
  assert.equal(applyBps(money(200, 'EGP'), 250).amount, 5) // 2.5% of 2.00 -> 0.05 exact
  assert.equal(applyBps(money(1000, 'EGP'), 1400).amount, 140) // 14% of 10.00 -> 1.40
  assert.throws(() => applyBps(money(100, 'EGP'), 2.5), /non-negative integer/)
})
