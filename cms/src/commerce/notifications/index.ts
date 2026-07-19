// Durable commerce notifications (Plan §7 E1) — public surface.
//
// The integration owner imports `sendCommerceNotificationTask` from here and registers it in
// cms/src/payload.config.ts `jobs.tasks`. The slug reuses `SEND_COMMERCE_NOTIFICATION_TASK` already
// defined at cms/src/commerce/payments/job.ts (re-exported below for callers that build the enqueue
// input, e.g. checkout / customer-auth flows).

export { sendCommerceNotificationTask } from './task'
export {
  executeSendCommerceNotification,
  deriveIdempotencyKey,
  type NotificationDeps,
  type SendCommerceNotificationOutput,
} from './engine'
export { renderNotification, paymentStateTemplate, type RenderOutcome } from './content'
export {
  createSmtpTransport,
  readSmtpConfigFromEnv,
  type SmtpTransportConfig,
} from './transport'
export {
  NOTIFICATION_TRIGGERS,
  type NotificationTrigger,
  type NotificationTemplate,
  type NotificationTaskInput,
  type NotificationMessage,
  type NotificationSendResult,
  type NotificationTransport,
} from './types'
export { SEND_COMMERCE_NOTIFICATION_TASK } from '../payments/job'
