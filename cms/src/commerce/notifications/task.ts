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
 * NC7: scrub the raw `token` field from a `payload-jobs` row's JSON input after a successful send.
 * Re-reads the input (defensive against any concurrent mutation), deletes the `token` key, and
 * writes the scrubbed envelope back via the Local API. Idempotent: a second scrub on an already-
 * scrubbed row is a no-op. The `taskSlug` guard ensures we never touch a row that has been
 * repurposed to a different task between the read and the write.
 */
async function scrubTokenFromJobInput(
  payload: Payload,
  jobId: number | string,
  expectedTaskSlug: string,
): Promise<void> {
  const doc = (await payload.findByID({
    collection: 'payload-jobs',
    id: jobId,
    overrideAccess: true,
    showHiddenFields: true,
  })) as { taskSlug?: string; input?: Record<string, unknown> | null } | null
  if (!doc) return
  if (doc.taskSlug !== expectedTaskSlug) return
  if (!doc.input || typeof doc.input !== 'object') return
  if (!('token' in doc.input) || doc.input.token === undefined || doc.input.token === null) return
  const scrubbed: Record<string, unknown> = { ...doc.input }
  delete scrubbed.token
  await payload.update({
    collection: 'payload-jobs',
    id: jobId,
    overrideAccess: true,
    data: { input: scrubbed } as never,
  })
}

/**
 * Dedupe against the durable `payload-jobs` store. A prior SUCCEEDED `send-commerce-notification`
 * job for the same idempotencyKey means a re-delivered/duplicate enqueue is a structured no-op.
 *
 * `payload-jobs` is a system collection (NOT tenant-scoped by the multi-tenant plugin), so the
 * idempotencyKey itself carries the tenant-scoped prefix (see `deriveIdempotencyKey` and the
 * payment enqueue key `payment:<tenantId>:<eventId>:<state>`). Querying the JSON `input` field by
 * the idempotencyKey directly is O(1) on the indexed path vs. the old O(n) scan that loaded up to
 * 100 rows and JS-filtered them; it also removes the silent 100-row cap that could miss a prior
 * success past the limit and double-send.
 */
function createPayloadJobsDedupe(payload: Payload): NotificationDeps['hasAlreadySucceeded'] {
  return async (idempotencyKey) => {
    const { docs } = await payload.find({
      collection: 'payload-jobs',
      where: {
        and: [
          { taskSlug: { equals: SEND_COMMERCE_NOTIFICATION_TASK } },
          { hasError: { equals: false } },
          { 'input.idempotencyKey': { equals: idempotencyKey } },
        ],
      },
      overrideAccess: true,
      limit: 1,
      pagination: false,
    })
    const d = docs[0] as { completedAt?: string | null } | undefined
    // Finished without error (completedAt set, not still processing).
    return Boolean(d?.completedAt)
  }
}

/**
 * Resolve the recipient email. Non-payment triggers carry `customerEmail` in the input; the payment
 * path carries only `orderNumber` + `tenantId`, so the customer email is re-read from the
 * tenant-scoped `store-orders` row (the source of truth — never trusted from the job input alone).
 *
 * The resolved address is validated against a simple RFC-ish shape. Without this check, any enqueue
 * path (or a future admin script) could send mail to arbitrary/invalid addresses — the validator is
 * a soft failure: the task SUCCEEDS with `no_recipient` rather than transmitting.
 */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function createRecipientResolver(payload: Payload): NotificationDeps['resolveRecipient'] {
  return async (input) => {
    const direct = (input.customerEmail ?? '').trim()
    if (direct) {
      // Unvalidated email would let any enqueue path send mail to arbitrary addresses — validate the
      // shape before returning; on mismatch, log + skip the send (treated as no_recipient).
      if (!EMAIL_RE.test(direct)) {
        console.warn(
          `[commerce-notify] customerEmail failed validation (trigger ${input.trigger}, tenant ${input.tenantId}); skipping send`,
        )
        return null
      }
      return direct
    }
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
    const fromOrder = (order?.customerEmail ?? '').trim()
    if (fromOrder && !EMAIL_RE.test(fromOrder)) {
      console.warn(
        `[commerce-notify] store-orders.customerEmail failed validation (order ${input.orderNumber}, tenant ${input.tenantId}); skipping send`,
      )
      return null
    }
    return fromOrder || null
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
  handler: async ({ input, req, job }) => {
    const taskInput = (input ?? {}) as NotificationTaskInput
    const deps: NotificationDeps = {
      transport: sharedTransport,
      hasAlreadySucceeded: createPayloadJobsDedupe(req.payload),
      resolveRecipient: createRecipientResolver(req.payload),
    }
    const output = await executeSendCommerceNotification(taskInput, deps)

    // NC7 (default): after a successful send, scrub the raw token from the durable job row. The
    // task input is the only place the raw reset/verification token persists outside the customer
    // row; nulling it on send means the token is only present in `payload-jobs.input` for the brief
    // window between enqueue and dispatch (typically seconds). Admins reading the job row after send
    // see no token. This is the cleanest mitigation without a separate token-store table (a hash-
    // only approach would require a new collection — documented as a follow-up in
    // commerce/customers/payload-auth.ts requestPasswordReset). Best-effort: a scrub failure MUST NOT
    // fail the task — the email already went out, and the next reconciliation would re-scrub.
    if (output.sent && taskInput.token) {
      try {
        await scrubTokenFromJobInput(req.payload, job.id, SEND_COMMERCE_NOTIFICATION_TASK)
      } catch (err) {
        // Log + swallow: the send succeeded, the customer got their email, and the residual token
        // in the job row expires (per the token's own TTL) anyway. Surfacing this as a task failure
        // would burn retries on a send that already succeeded.
        console.warn(
          `[commerce-notify] failed to scrub token from job ${String(job.id)} after successful send: ${
            err instanceof Error ? err.message : String(err)
          }`,
        )
      }
    }
    // Always returns a structured output. The task SUCCEEDS on dedupe / skip / sent — only the
    // engine's thrown transient-failure path triggers Payload's bounded retry.
    return { output }
  },
}
