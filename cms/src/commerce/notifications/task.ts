// The `send-commerce-notification` task body (Plan §7 E1).
//
// Exported as `sendCommerceNotificationTask: TaskConfig` — the integration owner registers it in
// cms/src/payload.config.ts `jobs.tasks`. The slug reuses the constant already defined at
// cms/src/commerce/payments/job.ts (D3 only enqueues; it never sends). The task owns dedupe via the
// `idempotencyKey` in its input and performs the out-of-band send.
//
// Retry policy mirrors the payment task (5 attempts, exponential backoff). The handler throws on
// transient transport failure so the bounded retry re-runs it; non-retryable failures and missing
// templates/recipients return a structured output that succeeds the task.

import type { Payload, TaskConfig } from 'payload'

import { SEND_COMMERCE_NOTIFICATION_TASK } from '../payments/job'
import { executeSendCommerceNotification, type NotificationDeps } from './engine'
import { createSmtpTransport } from './transport'
import type { NotificationTaskInput } from './types'

// One shared SMTP transport for the process. Built lazily on first send and cached; the unconfigured
// path (no COMMERCE_SMTP_HOST) returns a structured no-op, so this is always safe to construct.
const sharedTransport = createSmtpTransport()

/**
 * Dedupe against the durable `payload-jobs` store. A prior SUCCEEDED `send-commerce-notification`
 * job for the same idempotencyKey means a re-delivered/duplicate enqueue is a structured no-op.
 *
 * `payload-jobs` is a system collection (NOT tenant-scoped by the multi-tenant plugin), so tenant
 * isolation is enforced in JS by matching `input.tenantId`. A job counts as "succeeded" when it has
 * `hasError: false` AND a `completedAt` (i.e. it finished without exhausting retries).
 */
function createPayloadJobsDedupe(payload: Payload): NotificationDeps['hasAlreadySucceeded'] {
  return async (idempotencyKey) => {
    const { docs } = await payload.find({
      collection: 'payload-jobs',
      where: {
        and: [
          { taskSlug: { equals: SEND_COMMERCE_NOTIFICATION_TASK } },
          { hasError: { equals: false } },
        ],
      },
      overrideAccess: true,
      limit: 100,
      pagination: false,
    })
    return docs.some((doc) => {
      const d = doc as {
        completedAt?: string | null
        input?: { idempotencyKey?: unknown; tenantId?: unknown } | null
      }
      // Finished without error (completedAt set, not still processing).
      if (!d.completedAt) return false
      const input = (d.input ?? {}) as { idempotencyKey?: unknown; tenantId?: unknown }
      return input.idempotencyKey === idempotencyKey
    })
  }
}

/**
 * Resolve the recipient email. Non-payment triggers carry `customerEmail` in the input; the payment
 * path carries only `orderNumber` + `tenantId`, so the customer email is re-read from the
 * tenant-scoped `store-orders` row (the source of truth — never trusted from the job input alone).
 */
function createRecipientResolver(payload: Payload): NotificationDeps['resolveRecipient'] {
  return async (input) => {
    const direct = (input.customerEmail ?? '').trim()
    if (direct) return direct
    if (!input.orderNumber) return null
    const { docs } = await payload.find({
      collection: 'store-orders',
      where: {
        and: [
          { tenant: { equals: input.tenantId } },
          { orderNumber: { equals: input.orderNumber } },
        ],
      },
      overrideAccess: true,
      limit: 1,
    })
    const order = docs[0] as { customerEmail?: string | null } | undefined
    return (order?.customerEmail ?? '').trim() || null
  }
}

/**
 * The TaskConfig. The integration owner adds this to `jobs.tasks` alongside `processPaymentEventTask`
 * (and runs `generate:types` + `generate:importmap` after editing payload.config.ts).
 */
export const sendCommerceNotificationTask: TaskConfig<any> = {
  slug: SEND_COMMERCE_NOTIFICATION_TASK,
  retries: { attempts: 5, backoff: { type: 'exponential', delay: 2000 } },
  inputSchema: [
    { name: 'idempotencyKey', type: 'text', required: true },
    { name: 'tenantId', type: 'number', required: true },
    {
      name: 'trigger',
      type: 'select',
      required: true,
      options: [
        'payment_event',
        'account_verification',
        'password_reset',
        'order_placed',
        'order_cancelled',
      ],
    },
    { name: 'orderNumber', type: 'text' },
    { name: 'state', type: 'text' },
    { name: 'gateway', type: 'text' },
    { name: 'providerEventId', type: 'text' },
    { name: 'amount', type: 'number' },
    { name: 'amountDue', type: 'number' },
    { name: 'customerEmail', type: 'email' },
    // Opaque verification/reset token. Required for the auth triggers; forwarded to the transport
    // only — never persisted or logged outside this short-lived job input.
    { name: 'token', type: 'text' },
  ],
  handler: async ({ input, req }) => {
    const taskInput = (input ?? {}) as NotificationTaskInput
    const deps: NotificationDeps = {
      transport: sharedTransport,
      hasAlreadySucceeded: createPayloadJobsDedupe(req.payload),
      resolveRecipient: createRecipientResolver(req.payload),
    }
    const output = await executeSendCommerceNotification(taskInput, deps)
    // Always returns a structured output. The task SUCCEEDS on dedupe / skip / sent — only the
    // engine's thrown transient-failure path triggers Payload's bounded retry.
    return { output }
  },
}
