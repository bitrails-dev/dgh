import type { CollectionBeforeChangeHook, CollectionConfig } from 'payload'
import { APIError } from 'payload'
import { transition as orderTransition, transitionFulfillment } from '../../commerce/orders/state'
import { transition as paymentTransition } from '../../commerce/payments/state'

// Tenant-scoped commerce order. Totals and line items are stored as an immutable snapshot taken at
// creation (from the server-side QuoteSnapshot) so a historical order never changes when products or
// rates later change. Order/payment/fulfillment are INDEPENDENT state dimensions (commerce/orders/
// state + commerce/payments/state). Guest checkout stores customerEmail/Phone; an account link is
// added when the customers collection lands. orderNumber is unique per tenant (compound index).
const ORDER_STATES = ['draft', 'pending', 'confirmed', 'processing', 'completed', 'cancelled', 'refunded', 'failed'] as const
const PAYMENT_STATES = ['pending', 'authorized', 'partially_captured', 'captured', 'voided', 'failed', 'partially_refunded', 'refunded', 'disputed'] as const
const FULFILLMENT_STATES = ['unfulfilled', 'partial', 'fulfilled', 'shipped', 'delivered', 'returned'] as const

const opts = (vals: readonly string[]) => vals.map((v) => ({ value: v, label: { en: v, ar: v } }))

// Centralize every transition: an update may only move status/paymentState/fulfillmentState along a
// legal edge of the pure state machines. createOrder sets the initial states (create op is skipped),
// and the payment job syncs paymentState through setOrderPaymentState (which this hook validates).
const rejectTransition = (dimension: string, from: string, to: string): never => {
  throw new APIError(`Illegal ${dimension} transition: ${from} → ${to}`, 400, null, true)
}

const validateOrderTransitions: CollectionBeforeChangeHook = ({ data, originalDoc, operation }) => {
  if (operation !== 'update') return data
  const prev = originalDoc as { status?: string; paymentState?: string; fulfillmentState?: string } | undefined
  const next = data as { status?: string; paymentState?: string; fulfillmentState?: string }

  if (next.status && prev?.status && next.status !== prev.status) {
    const t = orderTransition(prev.status as never, next.status as never)
    if (!t.ok) rejectTransition('order status', prev.status, next.status)
  }
  if (next.paymentState && prev?.paymentState && next.paymentState !== prev.paymentState) {
    const t = paymentTransition(prev.paymentState as never, next.paymentState as never)
    if (!t.ok) rejectTransition('payment state', prev.paymentState, next.paymentState)
  }
  if (next.fulfillmentState && prev?.fulfillmentState && next.fulfillmentState !== prev.fulfillmentState) {
    const t = transitionFulfillment(prev.fulfillmentState as never, next.fulfillmentState as never)
    if (!t.ok) rejectTransition('fulfillment', prev.fulfillmentState, next.fulfillmentState)
  }
  return data
}

export const Orders: CollectionConfig = {
  slug: 'orders',
  labels: {
    singular: { ar: 'طلب', en: 'Order' },
    plural: { ar: 'الطلبات', en: 'Orders' },
  },
  admin: {
    group: { ar: 'المتجر', en: 'Commerce' },
    useAsTitle: 'orderNumber',
    defaultColumns: ['orderNumber', 'status', 'paymentState', 'grandTotal', 'currency', 'placedAt'],
  },
  hooks: { beforeChange: [validateOrderTransitions] },
  fields: [
    { name: 'orderNumber', type: 'text', required: true, index: true, label: { ar: 'رقم الطلب', en: 'Order number' } },
    { name: 'cartToken', type: 'text', index: true, label: { ar: 'رمز السلة', en: 'Cart token' }, admin: { description: 'Links the order to its stock reservation; committed on payment capture.' } },
    { name: 'checkoutKey', type: 'text', index: true, label: { ar: 'مفتاح المعاملة', en: 'Checkout key' }, admin: { description: 'Idempotency key (RFC 4122 UUID v4). Unique per tenant (partial unique index) — a replay returns the same order.' } },
    { name: 'checkoutFingerprint', type: 'text', label: { ar: 'بصمة المعاملة', en: 'Checkout fingerprint' }, admin: { description: 'SHA-256 of the normalized checkout payload — a replay must match or the API returns 409.' } },
    { name: 'customerEmail', type: 'text', index: true, label: { ar: 'بريد العميل', en: 'Customer email' } },
    { name: 'customerPhone', type: 'text', label: { ar: 'هاتف العميل', en: 'Customer phone' } },
    { name: 'status', type: 'select', required: true, defaultValue: 'pending', options: opts(ORDER_STATES), label: { ar: 'حالة الطلب', en: 'Order status' } },
    { name: 'paymentState', type: 'select', required: true, defaultValue: 'pending', options: opts(PAYMENT_STATES), label: { ar: 'حالة الدفع', en: 'Payment state' } },
    { name: 'fulfillmentState', type: 'select', required: true, defaultValue: 'unfulfilled', options: opts(FULFILLMENT_STATES), label: { ar: 'حالة الشحن', en: 'Fulfillment state' } },
    { name: 'currency', type: 'text', required: true, label: { ar: 'العملة', en: 'Currency' } },
    { name: 'subtotal', type: 'number', label: { ar: 'المجموع الفرعي', en: 'Subtotal' } },
    { name: 'totalDiscount', type: 'number', defaultValue: 0, label: { ar: 'إجمالي الخصم', en: 'Total discount' } },
    { name: 'shippingPrice', type: 'number', defaultValue: 0, label: { ar: 'الشحن', en: 'Shipping' } },
    { name: 'totalTax', type: 'number', defaultValue: 0, label: { ar: 'إجمالي الضريبة', en: 'Total tax' } },
    { name: 'grandTotal', type: 'number', required: true, label: { ar: 'الإجمالي', en: 'Grand total' } },
    { name: 'giftCardApplied', type: 'number', defaultValue: 0, label: { ar: 'بطاقة هدية', en: 'Gift card applied' } },
    { name: 'amountDue', type: 'number', required: true, label: { ar: 'المبلغ المستحق', en: 'Amount due' } },
    { name: 'quoteHash', type: 'text', label: { ar: 'بصمة عرض السعر', en: 'Quote hash' }, admin: { description: 'SHA-256 of the frozen quote snapshot — tamper check.' } },
    // Immutable snapshots (JSON). Stored as text; never recomputed from current catalog/rates.
    { name: 'quoteSnapshot', type: 'json', label: { ar: 'لقطة عرض السعر', en: 'Quote snapshot' } },
    { name: 'items', type: 'json', label: { ar: 'البنود', en: 'Items' } },
    { name: 'shippingAddress', type: 'json', label: { ar: 'عنوان الشحن', en: 'Shipping address' } },
    { name: 'billingAddress', type: 'json', label: { ar: 'عنوان الفوترة', en: 'Billing address' } },
    { name: 'placedAt', type: 'date', label: { ar: 'تاريخ الطلب', en: 'Placed at' } },
    { name: 'notes', type: 'textarea', label: { ar: 'ملاحظات', en: 'Notes' } },
  ],
}
