import type { CollectionConfig } from 'payload'
import type { PaymentState } from '../../commerce/payments/state'

// Normalized, idempotent record of every gateway webhook event. A compound unique index on
// (tenant, gateway, providerEventId) — created in the migration — makes the insert idempotent: a
// duplicate delivery of the same event is rejected at the DB layer and treated as a successful
// no-op. The webhook endpoint acknowledges ONLY after a durable insert here. The commerce job folds
// each event into `foldedState` via the payment state machine; the order-side transition is wired
// once the ecommerce-plugin order/transaction collections exist.
const STATES: PaymentState[] = [
  'pending', 'authorized', 'partially_captured', 'captured',
  'voided', 'failed', 'partially_refunded', 'refunded', 'disputed',
]
const stateOptions = STATES.map((s) => ({ value: s, label: { en: s, ar: s } }))

const systemOnly = () => false

export const PaymentEvents: CollectionConfig = {
  slug: 'payment-events',
  labels: {
    singular: { ar: 'حدث دفع', en: 'Payment event' },
    plural: { ar: 'أحداث الدفع', en: 'Payment events' },
  },
  admin: {
    group: { ar: 'المتجر', en: 'Commerce' },
    useAsTitle: 'providerEventId',
    defaultColumns: ['gateway', 'providerEventId', 'merchantReference', 'foldedState', 'processed', 'receivedAt'],
  },
  // System-managed: only the webhook/job write rows (overrideAccess). Admin can read (tenant-scoped).
  access: { create: systemOnly, update: systemOnly, delete: systemOnly },
  fields: [
    { name: 'gateway', type: 'select', required: true, options: ['paymob', 'kashier'].map((v) => ({ value: v, label: { en: v, ar: v } })), label: { ar: 'البوابة', en: 'Gateway' } },
    { name: 'providerEventId', type: 'text', required: true, index: true, label: { ar: 'معرّف الحدث', en: 'Provider event ID' } },
    { name: 'merchantReference', type: 'text', index: true, label: { ar: 'مرجع الطلب', en: 'Merchant reference' } },
    { name: 'targetState', type: 'select', options: stateOptions, label: { ar: 'الحالة المستهدفة', en: 'Target state' } },
    { name: 'amount', type: 'number', label: { ar: 'المبلغ', en: 'Amount' }, admin: { description: 'Minor units, when reported by the gateway.' } },
    { name: 'foldedState', type: 'select', options: stateOptions, label: { ar: 'الحالة بعد المعالجة', en: 'Folded state' } },
    { name: 'processed', type: 'checkbox', defaultValue: false, label: { ar: 'تمت المعالجة', en: 'Processed' } },
    { name: 'rawRedacted', type: 'text', label: { ar: 'الحمولة (منقحة)', en: 'Raw payload (redacted)' }, admin: { description: 'Sanitized gateway payload — no card data, no secrets.' } },
    { name: 'receivedAt', type: 'date', required: true, label: { ar: 'تاريخ الاستلام', en: 'Received at' } },
  ],
}
