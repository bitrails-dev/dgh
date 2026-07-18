import assert from 'node:assert/strict'
import test from 'node:test'

import { applyRefund, canTransition, foldEvent, transition } from '../src/commerce/payments/state'

test('legal payment transitions are allowed; regressions are rejected', () => {
  assert.deepEqual(transition('pending', 'authorized'), { ok: true, state: 'authorized' })
  assert.deepEqual(transition('authorized', 'captured'), { ok: true, state: 'captured' })
  assert.deepEqual(transition('captured', 'partially_refunded'), { ok: true, state: 'partially_refunded' })
  assert.deepEqual(transition('partially_refunded', 'refunded'), { ok: true, state: 'refunded' })

  assert.equal(canTransition('captured', 'pending'), false, 'cannot regress to pending')
  assert.equal(canTransition('refunded', 'captured'), false, 'terminal refunded blocks capture')
  assert.equal(canTransition('voided', 'captured'), false, 'terminal voided blocks capture')
})

test('same-state transition is a legal no-op', () => {
  assert.deepEqual(transition('captured', 'captured'), { ok: true, state: 'captured' })
})

test('a refund may never exceed the captured value', () => {
  const acct = { capturedAmount: 1000, refundedAmount: 0 }
  const r1 = applyRefund(acct, 600)
  assert.ok(r1.ok && !r1.fullyRefunded && r1.refundedAmount === 600)
  const over = applyRefund({ ...acct, refundedAmount: 600 }, 500)
  assert.ok(!over.ok && over.code === 'OVER_REFUND', '600 + 500 > 1000 captured')
  const finish = applyRefund({ ...acct, refundedAmount: 600 }, 400)
  assert.ok(finish.ok && finish.fullyRefunded && finish.refundedAmount === 1000)
})

test('refund rejects non-positive or non-integer amounts', () => {
  const acct = { capturedAmount: 1000, refundedAmount: 0 }
  assert.equal((applyRefund(acct, 0) as { code: string }).code, 'INVALID')
  assert.equal((applyRefund(acct, -5) as { code: string }).code, 'INVALID')
  assert.equal((applyRefund(acct, 5.5) as { code: string }).code, 'INVALID')
})

test('a duplicate provider event is a no-op (idempotent)', () => {
  const first = foldEvent('pending', [], { providerEventId: 'evt-1', targetState: 'authorized' })
  assert.equal(first.state, 'authorized')
  assert.equal(first.changed, true)
  const second = foldEvent('authorized', ['evt-1'], { providerEventId: 'evt-1', targetState: 'authorized' })
  assert.equal(second.duplicate, true)
  assert.equal(second.changed, false)
  assert.equal(second.state, 'authorized')
})

test('an out-of-order (stale) event does not regress state', () => {
  // evt-cap was already applied earlier (state is now 'captured', event recorded as seen).
  const stale = foldEvent('captured', ['evt-cap'], { providerEventId: 'evt-late', targetState: 'pending' })
  assert.equal(stale.ignoredOutOfOrder, true)
  assert.equal(stale.changed, false)
  assert.equal(stale.state, 'captured', 'state never regresses')
})

test('a terminal state absorbs further events as out-of-order no-ops', () => {
  const after = foldEvent('refunded', ['evt-r'], { providerEventId: 'evt-x', targetState: 'captured' })
  assert.equal(after.ignoredOutOfOrder, true)
  assert.equal(after.state, 'refunded')
})
