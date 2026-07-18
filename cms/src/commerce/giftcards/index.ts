// Gift-card balance ledger — pure domain logic. An immutable, append-only ledger of every balance
// change on a gift card; the live balance is always the fold of that ledger. issue / redeem / refund
// validate and return the next balance (or a typed failure); the DB layer turns each success into a
// LedgerEntry row and replays them through applyEntry to rebuild state. This module owns no I/O,
// knows nothing about Payload or the DB, and never reads the clock — `now` is always an input, so
// every function is deterministic and trivially testable.
//
// Concurrency: redeem is the only balance-decreasing op, and concurrent redeems could overspend.
// canRedeem() is the pure predicate the DB layer puts inside an atomic conditional UPDATE (the same
// pattern used for inventory reservations): the row updates only if canRedeem() still holds at
// commit, so two concurrent redeems of a card with a single balance cannot drive it below zero.
// The ledger is the audit source of truth — entries are never mutated or deleted.

import { money, type Money } from '../money'

export type LedgerEntryType = 'issue' | 'redeem' | 'refund' | 'adjust'

export interface LedgerEntry {
  id: string
  type: LedgerEntryType
  // Signed integer minor units. issue/refund are positive, redeem is negative, adjust is either.
  amountMinor: number
  // Balance immediately after this entry was applied. Stored for audit; reconstructBalance re-derives
  // the balance from the signed amounts rather than trusting this field.
  resultingBalanceMinor: number
  ref?: string
  // Epoch millis. Always an input — never Date.now().
  at: number
}

export interface GiftCardAccount {
  id: string
  currency: string
  balanceMinor: number
  // Total ever issued to the card. refund is capped so balance can never exceed this.
  issuedMinor: number
  expiresAtMs?: number
  active: boolean
}

export function createAccount(
  id: string,
  currency: string,
  opts: { expiresAtMs?: number; active?: boolean } = {},
): GiftCardAccount {
  return {
    id,
    currency,
    balanceMinor: 0,
    issuedMinor: 0,
    expiresAtMs: opts.expiresAtMs,
    active: opts.active ?? true,
  }
}

// Bridge to the money core: the spendable balance as a typed Money in the account's currency.
export function toMoney(account: GiftCardAccount): Money {
  return money(account.balanceMinor, account.currency)
}

export type IssueResult = { ok: true; balance: number } | { ok: false; code: 'INVALID' }

// Issue (top-up) grows both the spendable balance and the lifetime issued total.
export function issue(account: GiftCardAccount, amountMinor: number): IssueResult {
  if (!Number.isInteger(amountMinor) || amountMinor <= 0) return { ok: false, code: 'INVALID' }
  return { ok: true, balance: account.balanceMinor + amountMinor }
}

export type RedeemFailureCode = 'INSUFFICIENT' | 'INACTIVE' | 'EXPIRED' | 'INVALID'
export type RedeemResult = { ok: true; balance: number } | { ok: false; code: RedeemFailureCode }

// Pure predicate the DB layer inlines in an atomic conditional UPDATE. True iff the amount is a
// positive integer, the card is active, not expired (now < expiresAtMs when an expiry is set), and
// the balance can cover it. See the concurrency note at the top of this file.
export function canRedeem(account: GiftCardAccount, amountMinor: number, now: number): boolean {
  if (!Number.isInteger(amountMinor) || amountMinor <= 0) return false
  if (!account.active) return false
  if (account.expiresAtMs !== undefined && now >= account.expiresAtMs) return false
  return amountMinor <= account.balanceMinor
}

export function redeem(account: GiftCardAccount, amountMinor: number, now: number): RedeemResult {
  if (!Number.isInteger(amountMinor) || amountMinor <= 0) return { ok: false, code: 'INVALID' }
  if (!account.active) return { ok: false, code: 'INACTIVE' }
  if (account.expiresAtMs !== undefined && now >= account.expiresAtMs) return { ok: false, code: 'EXPIRED' }
  if (amountMinor > account.balanceMinor) return { ok: false, code: 'INSUFFICIENT' }
  return { ok: true, balance: account.balanceMinor - amountMinor }
}

export type RefundResult =
  | { ok: true; balance: number; capped: boolean }
  | { ok: false; code: 'INVALID' }

// Refund adds value back, but the balance can never exceed the lifetime issued total. `capped` is
// true when the requested amount was partly clipped to honor that ceiling.
export function refund(account: GiftCardAccount, amountMinor: number): RefundResult {
  if (!Number.isInteger(amountMinor) || amountMinor <= 0) return { ok: false, code: 'INVALID' }
  const requested = account.balanceMinor + amountMinor
  const balance = Math.min(requested, account.issuedMinor)
  return { ok: true, balance, capped: requested > account.issuedMinor }
}

// Pure reducer: replay one ledger entry onto an account (used to rebuild state from the persisted
// ledger). amountMinor is signed, so every type folds by addition; only 'issue' also grows the
// lifetime issued total.
export function applyEntry(account: GiftCardAccount, entry: LedgerEntry): GiftCardAccount {
  const balanceMinor = account.balanceMinor + entry.amountMinor
  const issuedMinor =
    entry.type === 'issue' ? account.issuedMinor + entry.amountMinor : account.issuedMinor
  return { ...account, balanceMinor, issuedMinor }
}

// Fold the whole ledger back to a balance. For an internally consistent ledger this equals the live
// balance and each entry's resultingBalanceMinor at its position.
export function reconstructBalance(entries: readonly LedgerEntry[]): number {
  let total = 0
  for (const entry of entries) total += entry.amountMinor
  return total
}
