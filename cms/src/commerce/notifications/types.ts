// Durable commerce notifications — shared types (Plan §7 E1).
//
// The `send-commerce-notification` task is the single durable boundary for every outbound commerce
// message. It owns (a) idempotency under re-delivery, via the deterministic `idempotencyKey` in its
// input, and (b) out-of-band dispatch through a swappable transport. The transport is NEVER invoked
// inside the payment database transaction — the payment side-effect bundle only ENQUEUES this task
// (see cms/src/commerce/payments/job.ts `notification` handler); the actual send happens here, after
// the event's `processed` flag is independent of it.
//
// All money values carried in inputs are integer minor units (EGP). Tokens (account verification,
// password reset) are opaque strings forwarded to the transport; they are never logged or persisted
// raw outside the short-lived job input.

import type { PaymentState } from '../payments/state'

/**
 * Notification trigger discriminators. The payment path uses `payment_event` (enqueued by the D3
 * side-effect bundle with the folded `state`); the task maps that to a concrete content template. The
 * other triggers are enqueued by checkout / customer-auth flows and carry their own fields.
 */
export type NotificationTrigger =
  | 'payment_event'
  | 'account_verification'
  | 'password_reset'
  | 'order_placed'
  | 'order_cancelled'

export const NOTIFICATION_TRIGGERS: readonly NotificationTrigger[] = [
  'payment_event',
  'account_verification',
  'password_reset',
  'order_placed',
  'order_cancelled',
]

/**
 * Concrete content templates. `payment_event` + folded state resolves to one of the payment-family
 * templates (captured / failed / refund-completed); the order and auth triggers map 1:1.
 */
export type NotificationTemplate =
  | 'account_verification'
  | 'password_reset'
  | 'order_placed'
  | 'payment_captured'
  | 'payment_failed'
  | 'refund_completed'
  | 'order_cancelled'

/**
 * Flat task input shape. This is deliberately a flat object (not a discriminated union) because
 * Payload task `inputSchema` is a flat field list; the handler narrows on `trigger`.
 *
 * The `payment_event` fields EXACTLY match the D3 enqueue contract:
 *   { idempotencyKey, tenantId, orderNumber, trigger: 'payment_event', state, gateway,
 *     providerEventId, amount }
 * Never change those names without updating cms/src/commerce/payments/job.ts in lock-step.
 */
export interface NotificationTaskInput {
  idempotencyKey: string
  tenantId: number | string
  trigger: NotificationTrigger
  // payment_event
  orderNumber?: string
  state?: PaymentState
  gateway?: 'paymob' | 'kashier'
  providerEventId?: string
  amount?: number | null
  // order_placed / order_cancelled (integer minor units)
  amountDue?: number
  // recipient for non-payment triggers (payment path resolves recipient from the order)
  customerEmail?: string
  // account_verification / password_reset — opaque token, forwarded to the transport, never logged raw
  token?: string
}

/**
 * A rendered, transport-ready message. Content is bilingual (ar default / en). `meta` carries the
 * stable identifiers operators need for support lookups (order number, gateway, etc.) — never
 * secrets or raw tokens.
 */
export interface NotificationMessage {
  to: string
  tenantId: number | string
  trigger: NotificationTrigger
  template: NotificationTemplate
  subject: { ar: string; en: string }
  body: { ar: string; en: string }
  meta: {
    orderNumber?: string
    amount?: number | null
    gateway?: string
    providerEventId?: string
  }
}

/**
 * Result of one transport dispatch. `transport: 'unconfigured'` is a SUCCESS outcome (the task
 * completes with `transport=unconfigured`) so payment events can reach `processed=1` before SMTP is
 * wired by the operator. `retryable` distinguishes transient transport failures (network, SMTP
 * timeout — the handler throws so Payload's bounded retry re-runs the task) from permanent ones
 * (rejected recipient — the handler records a structured skip instead of burning retries).
 */
export interface NotificationSendResult {
  ok: boolean
  transport: 'smtp' | 'unconfigured'
  messageId?: string
  reason?: string
  retryable: boolean
}

/**
 * Swappable transport. The default implementation (createSmtpTransport) no-ops when SMTP env is
 * absent; the operator wires real SMTP later via env (see transport.ts for the variable names). Tests
 * inject a fake.
 */
export interface NotificationTransport {
  readonly name: string
  send(message: NotificationMessage): Promise<NotificationSendResult>
}
