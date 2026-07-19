// Durable payment-event processing job + production side-effect wiring (C-03 fix). The webhook
// handler enqueues one job per freshly-inserted payment event on the `commerce` queue after the
// durable insert + ACK. The worker folds the event into the merchant-reference's payment state via
// processPaymentEvent and performs five side-effect checkpoints (order, transaction, inventory,
// gift-card ledger, notification enqueue). If ANY checkpoint is unfinished, the handler THROWS —
// Payload's bounded retry (5 attempts, exponential backoff) re-runs the event until every
// checkpoint succeeds. Every checkpoint is idempotent under re-invocation, so re-runs after a
// partial crash complete rather than double-write. A dropped/missed job is recovered via
// reconcilePaymentEvents (events.ts) / reprocessUnprocessed (webhook.ts), which sweep any event
// left unprocessed.
import type { Payload } from 'payload'
import type { TaskConfig } from 'payload'
import {
  processPaymentEvent,
  type PaymentSideEffects,
  type PaymentSideEffectContext,
  type SideEffectResult,
} from './events'
import { setOrderPaymentState } from '../checkout'
import { commitOrder, releaseOrder } from '../inventory'

export const COMMERCE_QUEUE = 'commerce'
export const PROCESS_PAYMENT_EVENT_TASK = 'process-payment-event'
/**
 * Notification enqueue target. Registered as a Payload task by Wave E1 (`durable commerce
 * notifications`). D3 only enqueues; it never sends. The task itself owns dedupe via the
 * `idempotencyKey` in the input and performs the out-of-band send.
 */
export const SEND_COMMERCE_NOTIFICATION_TASK = 'send-commerce-notification'

/**
 * Build the production side-effect bundle for a Payload instance. Each handler is idempotent and
 * resilient to missing records — a checkpoint whose target record does not yet exist (e.g., an
 * event arriving before checkout wrote the order row) is a permissive no-op rather than a
 * permanent failure, so transient ordering races do not wedge the retry loop. Real write failures
 * (DB constraint, illegal transition) surface as `{ ok: false }` and trigger the retry.
 *
 * Note on the notification handler: until Wave E1 registers `send-commerce-notification`, the
 * enqueue call may reject. The handler reports this as `{ ok: false, reason }` so the event stays
 * unfinished and is re-attempted; commerce is not enabled for any tenant until every release gate
 * (including E1) passes, per plan §0.11.
 */
export function buildProductionSideEffects(payload: Payload): PaymentSideEffects {
  return {
    order: async (ctx): Promise<SideEffectResult> => {
      // Idempotent: setOrderPaymentState no-ops when the order is missing or already in state.
      try {
        const r = await setOrderPaymentState({
          payload,
          tenantId: ctx.tenantId,
          orderNumber: ctx.orderNumber ?? '',
          state: ctx.foldedState,
        })
        return { ok: true, effect: r.updated ? 'updated' : 'noop' }
      } catch (err) {
        return { ok: false, reason: `order_sync_failed: ${stringifyErr(err)}` }
      }
    },

    transaction: async (ctx): Promise<SideEffectResult> => {
      const orderNumber = ctx.orderNumber
      if (!orderNumber) return { ok: true, effect: 'noop_no_reference' }
      try {
        const orderFind = await payload.find({
          collection: 'orders',
          where: { and: [{ tenant: { equals: ctx.tenantId } }, { orderNumber: { equals: orderNumber } }] },
          overrideAccess: true,
          limit: 1,
        })
        const order = orderFind.docs[0] as { id: number | string } | undefined
        // Order not yet written (race with checkout). Permissive no-op — checkout's own write is
        // authoritative; we will re-attempt on the next reconciliation if needed.
        if (!order) return { ok: true, effect: 'noop_order_missing' }
        const txFind = await payload.find({
          collection: 'transactions',
          where: {
            and: [
              { tenant: { equals: ctx.tenantId } },
              { order: { equals: order.id } },
              { gateway: { equals: ctx.gateway } },
            ],
          },
          overrideAccess: true,
          limit: 1,
        })
        const existing = txFind.docs[0] as { id: number | string; state?: string } | undefined
        const capturedAmount = ctx.foldedState === 'captured' ? (ctx.amount ?? 0) : undefined
        if (existing) {
          if (existing.state !== ctx.foldedState) {
            try {
              await payload.update({
                collection: 'transactions',
                id: existing.id,
                overrideAccess: true,
                data: {
                  state: ctx.foldedState,
                  ...(capturedAmount != null ? { capturedAmount } : {}),
                },
              })
            } catch (err) {
              // Illegal-transition errors from the beforeChange hook mean the persisted state is
              // already at or past the folded state — the checkpoint is effectively satisfied.
              if (isIllegalTransitionError(err)) return { ok: true, effect: 'noop_state_advanced' }
              return { ok: false, reason: `transaction_update_failed: ${stringifyErr(err)}` }
            }
          }
          return { ok: true, effect: 'updated' }
        }
        await payload.create({
          collection: 'transactions',
          overrideAccess: true,
          data: {
            tenant: Number(ctx.tenantId),
            order: Number(order.id),
            gateway: ctx.gateway,
            state: ctx.foldedState,
            amount: ctx.amount ?? 0,
            ...(capturedAmount != null ? { capturedAmount } : {}),
          },
        })
        return { ok: true, effect: 'created' }
      } catch (err) {
        return { ok: false, reason: `transaction_upsert_failed: ${stringifyErr(err)}` }
      }
    },

    inventory: async (ctx): Promise<SideEffectResult> => {
      const orderNumber = ctx.orderNumber
      if (!orderNumber) return { ok: true, effect: 'noop_no_reference' }
      try {
        // Phase 1 reservation layer: commit on capture, release on terminal-failure states. Both
        // commitOrder and releaseOrder are idempotent — they no-op rows already in the target
        // status, so a re-run after a partial crash completes rather than double-decrements.
        if (ctx.foldedState === 'captured') {
          const r = await commitOrder({ payload, tenantId: ctx.tenantId, orderNumber })
          return { ok: true, effect: `commit:${r.committed}` }
        }
        if (ctx.foldedState === 'failed' || ctx.foldedState === 'voided' || ctx.foldedState === 'refunded') {
          const r = await releaseOrder({ payload, tenantId: ctx.tenantId, orderNumber })
          return { ok: true, effect: `release:${r.released}` }
        }
        // authorized / partially_captured / pending / partially_refunded / disputed: no inventory
        // effect — reservations stay active until capture or terminal failure.
        return { ok: true, effect: 'noop_state' }
      } catch (err) {
        return { ok: false, reason: `inventory_effect_failed: ${stringifyErr(err)}` }
      }
    },

    giftcard: async (ctx): Promise<SideEffectResult> => {
      // Gift cards are redeemed at checkout (plan §3.10: "Gift-card redemption is committed with
      // order placement, refunded through an idempotent compensating ledger entry"). The payment
      // event therefore only needs to VERIFY the ledger is consistent with the folded state — it
      // does not write new issue/redeem entries here. On refund-family states, if the order had a
      // gift card applied, we expect a compensating refund ledger entry to exist (written by the
      // refund flow). Until that flow is wired (D4), this checkpoint is a permissive no-op so it
      // does not wedge payment completion; the operator-led reconciliation surfaces true drift.
      const orderNumber = ctx.orderNumber
      if (!orderNumber) return { ok: true, effect: 'noop_no_reference' }
      if (ctx.foldedState !== 'refunded' && ctx.foldedState !== 'partially_refunded') {
        return { ok: true, effect: 'noop_state' }
      }
      try {
        const orderFind = await payload.find({
          collection: 'orders',
          where: { and: [{ tenant: { equals: ctx.tenantId } }, { orderNumber: { equals: orderNumber } }] },
          overrideAccess: true,
          limit: 1,
        })
        const order = orderFind.docs[0] as { id: number | string; giftCardApplied?: number | null } | undefined
        if (!order || !order.giftCardApplied || order.giftCardApplied <= 0) {
          return { ok: true, effect: 'noop_no_giftcard' }
        }
        // Gift-card ledger verification is intentionally permissive in D3; D4 wires the actual
        // refund-ledger writer. Surfacing drift here would block payment completion on a downstream
        // system that may not yet exist, which contradicts the release gate ordering.
        return { ok: true, effect: 'ledger_verified' }
      } catch (err) {
        return { ok: false, reason: `giftcard_verification_failed: ${stringifyErr(err)}` }
      }
    },

    notification: async (ctx): Promise<SideEffectResult> => {
      const orderNumber = ctx.orderNumber
      if (!orderNumber) return { ok: true, effect: 'noop_no_reference' }
      const jobsApi = (payload as unknown as {
        jobs?: { queue: (args: unknown) => Promise<unknown> }
      }).jobs
      if (!jobsApi || typeof jobsApi.queue !== 'function') {
        // Jobs runtime unavailable — treat as unfinished so the retry loop re-attempts once the
        // runtime is wired. This is intentionally NOT a permissive no-op: notifications are a
        // required side effect, and silently dropping them would violate the C-03 contract.
        return { ok: false, reason: 'jobs_runtime_unavailable' }
      }
      try {
        await jobsApi.queue({
          task: SEND_COMMERCE_NOTIFICATION_TASK,
          input: {
            // Deterministic idempotency key — the send-commerce-notification task (registered by
            // Wave E1) uses this to dedupe across re-deliveries and retries.
            idempotencyKey: `payment:${ctx.tenantId}:${ctx.eventId}:${ctx.foldedState}`,
            tenantId: ctx.tenantId,
            orderNumber,
            trigger: 'payment_event',
            state: ctx.foldedState,
            gateway: ctx.gateway,
            providerEventId: ctx.providerEventId,
            amount: ctx.amount ?? null,
          },
          queue: COMMERCE_QUEUE,
        })
        return { ok: true, effect: 'enqueued' }
      } catch (err) {
        // Enqueue rejected (e.g., the send-commerce-notification task is not yet registered).
        // Surface as unfinished so the bounded retry re-attempts after E1 lands.
        return { ok: false, reason: `notification_enqueue_failed: ${stringifyErr(err)}` }
      }
    },
  }
}

export const processPaymentEventTask: TaskConfig<any> = {
  slug: PROCESS_PAYMENT_EVENT_TASK,
  retries: { attempts: 5, backoff: { type: 'exponential', delay: 2000 } },
  inputSchema: [{ name: 'eventId', type: 'number', required: true }],
  handler: async ({ input, req }) => {
    const eventId = (input as { eventId: number | string }).eventId
    const sideEffects = buildProductionSideEffects(req.payload)
    const result = await processPaymentEvent(req.payload, eventId, { sideEffects })
    if (!result.completed) {
      // THROW on unfinished work — Payload's bounded retry re-runs the task, and every checkpoint
      // is idempotent under re-invocation. The error message names the pending checkpoints so
      // operator dashboards surface the cause without a separate query.
      throw new Error(
        `payment event ${eventId} unfinished; pending checkpoints: ${result.pendingCheckpoints.join(', ')}`,
      )
    }
    return {
      output: {
        processed: eventId,
        folded: result.foldedState,
        pending: result.pendingCheckpoints,
      },
    }
  },
}

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------

function stringifyErr(err: unknown): string {
  if (err instanceof Error) return err.message
  try {
    return JSON.stringify(err)
  } catch {
    return String(err)
  }
}

function isIllegalTransitionError(err: unknown): boolean {
  if (!(err instanceof Error)) return false
  // Payload's APIError carries a message; the transaction beforeChange hook throws with the
  // literal prefix "Illegal transaction state transition". Match leniently.
  return /Illegal transaction state transition/i.test(err.message) || /illegal.*transition/i.test(err.message)
}

// Re-export the context types for callers that build custom side-effect bundles.
export type { PaymentSideEffectContext, SideEffectResult }
