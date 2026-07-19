// send-commerce-notification engine: dedupe + render + dispatch (Plan §7 E1).
//
// This is the testable core of the task body. It is "pure-ish": every external touch (transport
// send, dedupe lookup, recipient resolution) is an injected dependency, so the unit tests drive it
// with fakes and assert dedupe / skip / throw behavior without booting Payload. The TaskConfig in
// task.ts is a thin wrapper that wires these dependencies to the real Payload instance.
//
// Contracts (plan §7 E1):
//   - The task is the dedupe boundary. A prior SUCCEEDED send for the same `idempotencyKey` is a
//     structured no-op (returns `deduped: true`) — re-delivery and retries never double-send.
//   - The send NEVER happens inside the payment database transaction (the enqueue does; this runs
//     later, out of band).
//   - Retry by THROWING on transient transport failure — Payload's bounded retry re-runs the task.
//     Non-retryable failures (rejected recipient, misconfiguration) are recorded as a structured
//     skip so they do not burn the retry budget; they are surfaced separately by the operator.

import { renderNotification } from './content'
import type {
  NotificationMessage,
  NotificationTaskInput,
  NotificationTransport,
} from './types'

export interface NotificationDeps {
  transport: NotificationTransport
  /** True if a prior send for this idempotencyKey already succeeded (the durable dedupe signal). */
  hasAlreadySucceeded: (idempotencyKey: string) => Promise<boolean>
  /** Resolve the recipient email for the input. Null/empty → the task skips with `no_recipient`. */
  resolveRecipient: (input: NotificationTaskInput) => Promise<string | null>
}

export type SendCommerceNotificationOutput =
  | { sent: true; transport: string; template: NotificationMessage['template']; to: string; deduped: false }
  | { sent: false; deduped: true; transport: 'dedupe' }
  | { sent: false; skipped: true; reason: string; transport: 'skip' }

/**
 * Derive a deterministic idempotency key for the non-payment triggers. The payment path's key is
 * already set by the D3 enqueue (`payment:<tenantId>:<eventId>:<foldedState>`); callers enqueuing
 * the other triggers should use this helper so retries dedupe rather than double-send.
 */
export function deriveIdempotencyKey(
  trigger: NotificationTaskInput['trigger'],
  tenantId: number | string,
  entityId: string | number,
): string {
  return `${trigger}:${tenantId}:${entityId}`
}

/**
 * Execute one send-commerce-notification. Idempotent under re-invocation: a prior success for the
 * same idempotencyKey short-circuits; a transient transport failure THROWS so Payload retries; a
 * non-retryable failure or a missing template/recipient is a structured skip that succeeds the task.
 */
export async function executeSendCommerceNotification(
  input: NotificationTaskInput,
  deps: NotificationDeps,
): Promise<SendCommerceNotificationOutput> {
  // 1. Dedupe boundary: a prior successful send means this re-delivery is a no-op.
  if (!input.idempotencyKey) {
    // Defensive: every trigger must supply a deterministic key. Treat absence as a non-retryable
    // skip rather than sending without dedupe protection.
    return { sent: false, skipped: true, reason: 'missing_idempotency_key', transport: 'skip' }
  }
  if (await deps.hasAlreadySucceeded(input.idempotencyKey)) {
    return { sent: false, deduped: true, transport: 'dedupe' }
  }

  // 2. Resolve recipient + render content.
  const recipientEmail = await deps.resolveRecipient(input)
  const rendered = renderNotification(input, recipientEmail)
  if (!rendered.ok) {
    // No template for the folded state, or no recipient. Either way the task SUCCEEDS — the
    // notification checkpoint returned ok at enqueue time; these are not retryable failures.
    return { sent: false, skipped: true, reason: rendered.reason, transport: 'skip' }
  }

  // 3. Dispatch via the swappable transport.
  const result = await deps.transport.send(rendered.message)
  if (result.ok) {
    return {
      sent: true,
      transport: result.transport,
      template: rendered.message.template,
      to: rendered.recipientEmail,
      deduped: false,
    }
  }

  // 4. Failure handling. Transient → THROW (bounded retry). Permanent → structured skip.
  if (result.retryable) {
    throw new Error(
      `send-commerce-notification failed (retryable) for key ${input.idempotencyKey}: ${result.reason ?? 'unknown'}`,
    )
  }
  return {
    sent: false,
    skipped: true,
    reason: `non_retryable:${result.reason ?? 'unknown'}`,
    transport: 'skip',
  }
}
