// Payment state machine, refund accounting, and idempotent event folding — provider-agnostic. This
// is the single authoritative source for which transitions are legal, how refunds are capped, and
// how duplicate/out-of-order gateway events are absorbed as no-ops. The webhook job and order state
// machine call into these pure functions; providers never encode transition logic.
//
// Order, payment, and fulfillment states are independent (spec): an order can be fulfilled while a
// payment is still partially captured, etc. This module owns only the payment dimension.

export type PaymentState =
  | 'pending'
  | 'authorized'
  | 'partially_captured'
  | 'captured'
  | 'voided'
  | 'failed'
  | 'partially_refunded'
  | 'refunded'
  | 'disputed'

// Legal forward transitions. Terminal states (voided, failed, refunded) allow nothing further.
const TRANSITIONS: Record<PaymentState, readonly PaymentState[]> = {
  pending: ['authorized', 'captured', 'failed'],
  authorized: ['captured', 'partially_captured', 'voided', 'failed', 'disputed'],
  partially_captured: ['captured', 'partially_refunded', 'refunded', 'disputed'],
  captured: ['partially_refunded', 'refunded', 'disputed'],
  disputed: ['partially_refunded', 'refunded'],
  partially_refunded: ['partially_refunded', 'refunded', 'disputed'],
  voided: [],
  failed: [],
  refunded: [],
}

export function canTransition(from: PaymentState, to: PaymentState): boolean {
  if (from === to) return true
  return TRANSITIONS[from]?.includes(to) ?? false
}

export type TransitionResult = { ok: true; state: PaymentState } | { ok: false; code: 'ILLEGAL_TRANSITION' }

export function transition(from: PaymentState, to: PaymentState): TransitionResult {
  if (from === to) return { ok: true, state: from }
  return canTransition(from, to) ? { ok: true, state: to } : { ok: false, code: 'ILLEGAL_TRANSITION' }
}

// Refund accounting: a refund may never exceed captured value minus already-refunded. Partial refunds
// land in partially_refunded; a refund that exhausts captured is fully_refunded.
export interface RefundAccount {
  capturedAmount: number
  refundedAmount: number
}

export type RefundResult =
  | { ok: true; refundedAmount: number; fullyRefunded: boolean }
  | { ok: false; code: 'OVER_REFUND' | 'INVALID' }

export function applyRefund(account: RefundAccount, amount: number): RefundResult {
  if (!Number.isInteger(amount) || amount <= 0) return { ok: false, code: 'INVALID' }
  const next = account.refundedAmount + amount
  if (next > account.capturedAmount) return { ok: false, code: 'OVER_REFUND' }
  return { ok: true, refundedAmount: next, fullyRefunded: next === account.capturedAmount }
}

// Idempotent event folding. A repeated providerEventId is a duplicate → no-op. A legal transition is
// applied. An illegal transition (a stale or out-of-order event, e.g. a late "pending" after
// "captured") is absorbed as a successful no-op rather than regressing state — per spec, duplicates
// and out-of-order events are treated as successful no-ops.
export interface EventFold {
  state: PaymentState
  changed: boolean
  duplicate: boolean
  ignoredOutOfOrder: boolean
}

export function foldEvent(
  state: PaymentState,
  seenProviderEventIds: readonly string[],
  event: { providerEventId: string; targetState: PaymentState },
): EventFold {
  if (seenProviderEventIds.includes(event.providerEventId)) {
    return { state, changed: false, duplicate: true, ignoredOutOfOrder: false }
  }
  const t = transition(state, event.targetState)
  if (t.ok) return { state: t.state, changed: state !== t.state, duplicate: false, ignoredOutOfOrder: false }
  return { state, changed: false, duplicate: false, ignoredOutOfOrder: true }
}
