import assert from 'node:assert/strict'
import test from 'node:test'

import {
  CancellationGuard,
  canCancel,
  canTransition,
  canTransitionFulfillment,
  transition,
  transitionFulfillment,
} from '../src/commerce/orders/state'

test('legal order transitions are allowed; regressions and terminal blocks are rejected', () => {
  assert.deepEqual(transition('draft', 'pending'), { ok: true, state: 'pending' })
  assert.deepEqual(transition('pending', 'confirmed'), { ok: true, state: 'confirmed' })
  assert.deepEqual(transition('confirmed', 'processing'), { ok: true, state: 'processing' })
  assert.deepEqual(transition('processing', 'completed'), { ok: true, state: 'completed' })
  assert.deepEqual(transition('completed', 'refunded'), { ok: true, state: 'refunded' })
  assert.deepEqual(transition('draft', 'cancelled'), { ok: true, state: 'cancelled' })

  assert.equal(canTransition('completed', 'pending'), false, 'cannot regress from completed')
  assert.equal(canTransition('cancelled', 'pending'), false, 'terminal cancelled blocks move')
  assert.equal(canTransition('refunded', 'completed'), false, 'terminal refunded blocks move')
  assert.equal(canTransition('failed', 'pending'), false, 'terminal failed blocks move')
  assert.equal(canTransition('refunded', 'cancelled'), false, 'refunded is terminal, no further moves')
})

test('same-state transition is a legal no-op', () => {
  assert.deepEqual(transition('processing', 'processing'), { ok: true, state: 'processing' })
  assert.deepEqual(transition('draft', 'draft'), { ok: true, state: 'draft' })
})

test('illegal order transition returns the ILLEGAL_TRANSITION code shape', () => {
  const r = transition('completed', 'processing')
  assert.equal(r.ok, false)
  assert.equal((r as { code: string }).code, 'ILLEGAL_TRANSITION')
})

test('legal fulfillment transitions are allowed; returned is terminal', () => {
  assert.deepEqual(transitionFulfillment('unfulfilled', 'partial'), { ok: true, state: 'partial' })
  assert.deepEqual(transitionFulfillment('partial', 'fulfilled'), { ok: true, state: 'fulfilled' })
  assert.deepEqual(transitionFulfillment('fulfilled', 'shipped'), { ok: true, state: 'shipped' })
  assert.deepEqual(transitionFulfillment('shipped', 'delivered'), { ok: true, state: 'delivered' })
  assert.deepEqual(transitionFulfillment('delivered', 'returned'), { ok: true, state: 'returned' })

  assert.equal(canTransitionFulfillment('returned', 'delivered'), false, 'returned is terminal')
  assert.equal(canTransitionFulfillment('shipped', 'partial'), false, 'cannot regress fulfillment')
})

test('same-state fulfillment transition is a legal no-op', () => {
  assert.deepEqual(transitionFulfillment('shipped', 'shipped'), { ok: true, state: 'shipped' })
})

test('illegal fulfillment transition returns the ILLEGAL_TRANSITION code shape', () => {
  const r = transitionFulfillment('delivered', 'shipped')
  assert.equal(r.ok, false)
  assert.equal((r as { code: string }).code, 'ILLEGAL_TRANSITION')
})

test('cancellation is allowed pre-fulfillment and pre-capture', () => {
  assert.deepEqual(canCancel('pending', 'unfulfilled', false), { allowed: true })
  assert.deepEqual(canCancel('confirmed', 'partial', false), { allowed: true })
  assert.deepEqual(CancellationGuard('draft', 'unfulfilled', false), { allowed: true })
})

test('cancellation blocks delivered/returned orders with FULFILLED', () => {
  assert.deepEqual(canCancel('processing', 'delivered', false), { allowed: false, code: 'FULFILLED' })
  assert.deepEqual(canCancel('processing', 'returned', false), { allowed: false, code: 'FULFILLED' })
  assert.deepEqual(canCancel('processing', 'shipped', false), { allowed: false, code: 'FULFILLED' })
})

test('cancellation after capture flags PAYMENT_CAPTURED rather than a plain cancel', () => {
  assert.deepEqual(canCancel('confirmed', 'fulfilled', true), {
    allowed: false,
    code: 'PAYMENT_CAPTURED',
  })
  assert.deepEqual(canCancel('pending', 'unfulfilled', true), {
    allowed: false,
    code: 'PAYMENT_CAPTURED',
  })
})

test('cancellation of a terminal order state returns TERMINAL', () => {
  assert.deepEqual(canCancel('cancelled', 'unfulfilled', false), { allowed: false, code: 'TERMINAL' })
  assert.deepEqual(canCancel('refunded', 'unfulfilled', false), { allowed: false, code: 'TERMINAL' })
  assert.deepEqual(canCancel('failed', 'unfulfilled', false), { allowed: false, code: 'TERMINAL' })
})

test('terminal order state short-circuits before fulfillment/payment checks', () => {
  // Even with capture and delivery, a terminal order reports TERMINAL first.
  assert.deepEqual(canCancel('refunded', 'delivered', true), { allowed: false, code: 'TERMINAL' })
})
