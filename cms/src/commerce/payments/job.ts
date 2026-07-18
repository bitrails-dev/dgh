// Durable payment-event processing job. The webhook handler enqueues one job per freshly-inserted
// payment event on the `commerce` queue after the durable insert + ACK. The worker folds the event
// into the merchant-reference's payment state via processPaymentEvent (idempotent + out-of-order
// safe). Bounded retry on transient failure; a missed/dropped job is recoverable via
// reprocessUnprocessed (webhook.ts), which sweeps any event left unprocessed.
import type { TaskConfig } from 'payload'
import { processPaymentEvent } from './events'
import { commitOrderInventory, setOrderPaymentState } from '../checkout'

export const COMMERCE_QUEUE = 'commerce'
export const PROCESS_PAYMENT_EVENT_TASK = 'process-payment-event'

export const processPaymentEventTask: TaskConfig<any> = {
  slug: PROCESS_PAYMENT_EVENT_TASK,
  retries: { attempts: 5, backoff: { type: 'exponential', delay: 2000 } },
  inputSchema: [{ name: 'eventId', type: 'number', required: true }],
  handler: async ({ input, req }) => {
    const eventId = (input as { eventId: number | string }).eventId
    const result = await processPaymentEvent(req.payload, eventId)
    // On any state change, sync the order's paymentState (validated by the order collection's
    // transition hook); on capture, also commit the reserved stock. Both best-effort + recoverable.
    if (result.changed && result.merchantReference && result.tenantId != null) {
      await setOrderPaymentState({ payload: req.payload, tenantId: result.tenantId, orderNumber: result.merchantReference, state: result.foldedState }).catch(() => {})
      if (result.foldedState === 'captured') {
        await commitOrderInventory({ payload: req.payload, tenantId: result.tenantId, orderNumber: result.merchantReference }).catch(() => {})
      }
    }
    return { output: { processed: eventId, folded: result.foldedState } }
  },
}
