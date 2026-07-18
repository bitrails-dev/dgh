import type { CollectionBeforeChangeHook, CollectionConfig } from 'payload'
import { APIError } from 'payload'
import { transition as paymentTransition } from '../../commerce/payments/state'

// A financial record per order+gateway (one or more per order). Aggregates the captured/refunded
// amounts; the authoritative event stream lives in payment-events (associated by merchantReference =
// orderNumber). Refunds are capped to captured via commerce/payments/state.applyRefund.
const PAYMENT_STATES = ['pending', 'authorized', 'partially_captured', 'captured', 'voided', 'failed', 'partially_refunded', 'refunded', 'disputed'] as const
const GATEWAYS = ['paymob', 'kashier', 'cod', 'bank_transfer'] as const

const opts = (vals: readonly string[]) => vals.map((v) => ({ value: v, label: { en: v, ar: v } }))

const systemOnly = () => false

// A transaction's `state` may only advance along the payment state machine.
const validateTransactionState: CollectionBeforeChangeHook = ({ data, originalDoc, operation }) => {
  if (operation !== 'update') return data
  const prev = (originalDoc as { state?: string } | undefined)?.state
  const next = (data as { state?: string }).state
  if (next && prev && next !== prev) {
    const t = paymentTransition(prev as never, next as never)
    if (!t.ok) throw new APIError(`Illegal transaction state transition: ${prev} → ${next}`, 400, null, true)
  }
  return data
}

export const Transactions: CollectionConfig = {
  slug: 'transactions',
  labels: {
    singular: { ar: 'معاملة', en: 'Transaction' },
    plural: { ar: 'المعاملات', en: 'Transactions' },
  },
  admin: {
    group: { ar: 'المتجر', en: 'Commerce' },
    useAsTitle: 'providerTransactionId',
    defaultColumns: ['order', 'gateway', 'state', 'amount', 'capturedAmount', 'refundedAmount'],
  },
  // System-managed via the order/payment orchestration (overrideAccess). Admin reads (tenant-scoped).
  access: { create: systemOnly, update: systemOnly, delete: systemOnly },
  hooks: { beforeChange: [validateTransactionState] },
  fields: [
    { name: 'order', type: 'relationship', relationTo: 'orders', required: true, label: { ar: 'الطلب', en: 'Order' } },
    { name: 'gateway', type: 'select', required: true, options: opts(GATEWAYS), label: { ar: 'البوابة', en: 'Gateway' } },
    { name: 'providerTransactionId', type: 'text', index: true, label: { ar: 'معرّف المعاملة', en: 'Provider transaction ID' } },
    { name: 'amount', type: 'number', required: true, label: { ar: 'المبلغ', en: 'Amount' } },
    { name: 'state', type: 'select', required: true, defaultValue: 'pending', options: opts(PAYMENT_STATES), label: { ar: 'الحالة', en: 'State' } },
    { name: 'capturedAmount', type: 'number', defaultValue: 0, label: { ar: 'المبلغ المأخوذ', en: 'Captured amount' } },
    { name: 'refundedAmount', type: 'number', defaultValue: 0, label: { ar: 'المبلغ المسترد', en: 'Refunded amount' } },
    { name: 'notes', type: 'text', label: { ar: 'ملاحظات', en: 'Notes' } },
  ],
}
