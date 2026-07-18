// Order and fulfillment state machines — pure domain logic, provider- and persistence-agnostic. This
// is the single authoritative source for which order/fulfillment transitions are legal and when an
// order may be cancelled. The order lifecycle job and any fulfillment hooks call into these pure
// functions; callers never encode transition logic.
//
// Order, payment, and fulfillment states are independent (spec): an order can be completed while a
// payment is still partially captured, and fulfillment may progress on its own track. This module
// owns only the order and fulfillment dimensions plus the cancellation guard that spans them.

export type OrderState =
  | 'draft'
  | 'pending'
  | 'confirmed'
  | 'processing'
  | 'completed'
  | 'cancelled'
  | 'refunded'
  | 'failed'

// Legal forward transitions. Terminal states (completed, cancelled, refunded, failed) allow nothing
// further — except completed→refunded, the only post-completion move.
const ORDER_TRANSITIONS: Record<OrderState, readonly OrderState[]> = {
  draft: ['pending', 'confirmed', 'cancelled'],
  pending: ['confirmed', 'cancelled', 'failed'],
  confirmed: ['processing', 'cancelled', 'completed'],
  processing: ['completed', 'cancelled'],
  completed: ['refunded'],
  cancelled: [],
  refunded: [],
  failed: [],
}

export function canTransition(from: OrderState, to: OrderState): boolean {
  if (from === to) return true
  return ORDER_TRANSITIONS[from]?.includes(to) ?? false
}

export type OrderTransitionResult =
  | { ok: true; state: OrderState }
  | { ok: false; code: 'ILLEGAL_TRANSITION' }

export function transition(from: OrderState, to: OrderState): OrderTransitionResult {
  if (from === to) return { ok: true, state: from }
  return canTransition(from, to) ? { ok: true, state: to } : { ok: false, code: 'ILLEGAL_TRANSITION' }
}

export type FulfillmentState =
  | 'unfulfilled'
  | 'partial'
  | 'fulfilled'
  | 'shipped'
  | 'delivered'
  | 'returned'

// Legal forward transitions. 'returned' is the sole terminal state.
const FULFILLMENT_TRANSITIONS: Record<FulfillmentState, readonly FulfillmentState[]> = {
  unfulfilled: ['partial', 'fulfilled', 'returned'],
  partial: ['fulfilled', 'returned'],
  fulfilled: ['shipped', 'returned'],
  shipped: ['delivered', 'returned'],
  delivered: ['returned'],
  returned: [],
}

export function canTransitionFulfillment(from: FulfillmentState, to: FulfillmentState): boolean {
  if (from === to) return true
  return FULFILLMENT_TRANSITIONS[from]?.includes(to) ?? false
}

export type FulfillmentTransitionResult =
  | { ok: true; state: FulfillmentState }
  | { ok: false; code: 'ILLEGAL_TRANSITION' }

export function transitionFulfillment(
  from: FulfillmentState,
  to: FulfillmentState,
): FulfillmentTransitionResult {
  if (from === to) return { ok: true, state: from }
  return canTransitionFulfillment(from, to)
    ? { ok: true, state: to }
    : { ok: false, code: 'ILLEGAL_TRANSITION' }
}

// Cancellation guard. Cancellation is only a plain cancel when nothing has shipped and nothing has
// been captured. Once the order is on its fulfillment track past fulfilment, or already returned, it
// cannot be cancelled (code FULFILLED). Once payment is captured, cancelling must route through a
// refund rather than a plain cancel (code PAYMENT_CAPTURED). Terminal order states cannot be touched
// (code TERMINAL).
export type CancellationCode = 'FULFILLED' | 'PAYMENT_CAPTURED' | 'TERMINAL'

export type CancellationResult = { allowed: true } | { allowed: false; code: CancellationCode }

const TERMINAL_ORDER_STATES: readonly OrderState[] = ['cancelled', 'refunded', 'failed']
const PAST_FULFILLMENT_STATES: readonly FulfillmentState[] = ['shipped', 'delivered', 'returned']

export function canCancel(
  orderState: OrderState,
  fulfillmentState: FulfillmentState,
  paymentCaptured: boolean,
): CancellationResult {
  if (TERMINAL_ORDER_STATES.includes(orderState)) return { allowed: false, code: 'TERMINAL' }
  if (PAST_FULFILLMENT_STATES.includes(fulfillmentState)) return { allowed: false, code: 'FULFILLED' }
  if (paymentCaptured) return { allowed: false, code: 'PAYMENT_CAPTURED' }
  return { allowed: true }
}

// Backwards-compatible alias: the brief names this CancellationGuard. It is a function over the same
// inputs; expose it under both names so callers can reach it either way.
export const CancellationGuard = canCancel
export type CancellationGuard = typeof canCancel
