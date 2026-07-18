import assert from 'node:assert/strict'
import test from 'node:test'

import {
  applyEntry,
  canRedeem,
  createAccount,
  issue,
  redeem,
  reconstructBalance,
  refund,
  toMoney,
  type LedgerEntry,
} from '../src/commerce/giftcards'

// Pull the balance off an ok result, failing loud if it is not ok (keeps narrowing simple in tests).
function balanceOf(r: { ok: true; balance: number } | { ok: false; code: string }): number {
  if (!r.ok) throw new Error(`expected ok, got ${r.code}`)
  return r.balance
}

test('issue and redeem happy paths, including partial redemption', () => {
  let acct = createAccount('gc-1', 'EGP')
  const issued = issue(acct, 1000)
  assert.ok(issued.ok && issued.balance === 1000)
  acct = { ...acct, balanceMinor: issued.balance, issuedMinor: issued.balance }

  const partial = redeem(acct, 250, 0)
  assert.ok(partial.ok && partial.balance === 750, 'partial redemption leaves the remainder')
  acct = { ...acct, balanceMinor: partial.balance }

  const exhausted = redeem(acct, 750, 0)
  assert.ok(exhausted.ok && exhausted.balance === 0, 'redeeming the exact remainder is allowed')
})

test('redeem more than balance is rejected as INSUFFICIENT', () => {
  const acct = { ...createAccount('gc-1', 'EGP'), balanceMinor: 500, issuedMinor: 500 }
  assert.deepEqual(redeem(acct, 501, 0), { ok: false, code: 'INSUFFICIENT' })
  assert.equal(canRedeem(acct, 501, 0), false)
  // exact balance is allowed
  assert.ok(canRedeem(acct, 500, 0))
})

test('an inactive card blocks redeem', () => {
  const acct = { ...createAccount('gc-1', 'EGP'), balanceMinor: 1000, issuedMinor: 1000, active: false }
  assert.deepEqual(redeem(acct, 100, 0), { ok: false, code: 'INACTIVE' })
  assert.equal(canRedeem(acct, 100, 0), false)
})

test('an expired card blocks redeem; one instant before expiry is still redeemable', () => {
  const acct = {
    ...createAccount('gc-1', 'EGP'),
    balanceMinor: 1000,
    issuedMinor: 1000,
    expiresAtMs: 5000,
  }
  // now >= expiresAtMs is expired.
  assert.deepEqual(redeem(acct, 100, 5000), { ok: false, code: 'EXPIRED' })
  assert.equal(canRedeem(acct, 100, 5000), false)
  // strictly before expiry still works.
  const ok = redeem(acct, 100, 4999)
  assert.ok(ok.ok && ok.balance === 900)
  assert.equal(canRedeem(acct, 100, 4999), true)
})

test('refund adds back and is capped at the lifetime issued total', () => {
  let acct = createAccount('gc-1', 'EGP')
  acct = { ...acct, balanceMinor: balanceOf(issue(acct, 1000)), issuedMinor: 1000 }
  acct = { ...acct, balanceMinor: balanceOf(redeem(acct, 600, 0)) } // balance 400

  // 400 + 800 = 1200 requested, but issued is 1000 → clipped, capped.
  const over = refund(acct, 800)
  assert.ok(over.ok && over.balance === 1000 && over.capped === true, 'never exceeds issued total')

  // within headroom (issued - balance = 600) is not capped.
  const within = refund(acct, 500)
  assert.ok(within.ok && within.balance === 900 && within.capped === false)
})

test('non-positive or non-integer amounts are rejected as INVALID across all ops', () => {
  const acct = { ...createAccount('gc-1', 'EGP'), balanceMinor: 1000, issuedMinor: 1000 }
  for (const bad of [0, -5, 5.5]) {
    assert.equal((issue(acct, bad) as { code: string }).code, 'INVALID')
    assert.equal((redeem(acct, bad, 0) as { code: string }).code, 'INVALID')
    assert.equal((refund(acct, bad) as { code: string }).code, 'INVALID')
    assert.equal(canRedeem(acct, bad, 0), false)
  }
})

test('reconstructBalance equals the live balance across a mixed issue/redeem/refund/adjust sequence', () => {
  let acct = createAccount('gc-1', 'EGP')
  const entries: LedgerEntry[] = []
  const t0 = 1000

  const e1: LedgerEntry = {
    id: 'e1',
    type: 'issue',
    amountMinor: 1000,
    resultingBalanceMinor: balanceOf(issue(acct, 1000)),
    at: t0,
  }
  entries.push(e1)
  acct = applyEntry(acct, e1)

  const e2: LedgerEntry = {
    id: 'e2',
    type: 'redeem',
    amountMinor: -300,
    resultingBalanceMinor: balanceOf(redeem(acct, 300, t0 + 1)),
    at: t0 + 1,
  }
  entries.push(e2)
  acct = applyEntry(acct, e2)

  const e3: LedgerEntry = {
    id: 'e3',
    type: 'refund',
    amountMinor: 100,
    resultingBalanceMinor: balanceOf(refund(acct, 100)),
    at: t0 + 2,
  }
  entries.push(e3)
  acct = applyEntry(acct, e3)

  // manual adjustment (e.g. a goodwill credit correction)
  const e4: LedgerEntry = {
    id: 'e4',
    type: 'adjust',
    amountMinor: -50,
    resultingBalanceMinor: acct.balanceMinor - 50,
    at: t0 + 3,
  }
  entries.push(e4)
  acct = applyEntry(acct, e4)

  assert.equal(reconstructBalance(entries), acct.balanceMinor, 'fold equals live balance')
  assert.equal(acct.balanceMinor, 750)
  assert.equal(acct.issuedMinor, 1000, 'only issue grows the lifetime issued total')
  // each stored resultingBalanceMinor agrees with the running fold.
  assert.deepEqual(
    entries.map((e) => e.resultingBalanceMinor),
    [1000, 700, 800, 750],
  )
})

test('applyEntry replays a ledger and rebuilds both balance and issued total', () => {
  let acct = createAccount('gc-1', 'EGP')
  const entries: LedgerEntry[] = [
    { id: 'e1', type: 'issue', amountMinor: 1000, resultingBalanceMinor: 1000, at: 1 },
    { id: 'e2', type: 'redeem', amountMinor: -400, resultingBalanceMinor: 600, at: 2 },
    { id: 'e3', type: 'refund', amountMinor: 100, resultingBalanceMinor: 700, at: 3 },
  ]
  for (const e of entries) acct = applyEntry(acct, e)
  assert.equal(acct.balanceMinor, 700)
  assert.equal(acct.issuedMinor, 1000, 'refund does not grow the issued total')
  assert.equal(reconstructBalance(entries), 700)
})

test('functions are pure and deterministic — same inputs yield same outputs, no mutation', () => {
  const acct = { ...createAccount('gc-1', 'EGP'), balanceMinor: 1000, issuedMinor: 1000 }
  assert.deepEqual(redeem(acct, 100, 123), redeem(acct, 100, 123))
  assert.deepEqual(issue(acct, 100), issue(acct, 100))
  assert.deepEqual(refund(acct, 100), refund(acct, 100))
  // inputs are never mutated.
  assert.equal(acct.balanceMinor, 1000)
  assert.equal(acct.issuedMinor, 1000)
})

test('toMoney returns the balance as a typed Money in the account currency', () => {
  const acct = { ...createAccount('gc-1', 'EGP'), balanceMinor: 1250, issuedMinor: 1250 }
  assert.deepEqual(toMoney(acct), { amount: 1250, currency: 'EGP' })
})
