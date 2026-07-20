// store-orders collection override.
//
// Plan §3.8 + Wave-A correction #1. Spreads the plugin's default orders collection — preserving
// items, shipping address, customer/email, transactions, amount/currency and the plugin's
// administrative lifecycle status — and appends the retained commerce extension fields. The plugin
// status remains the administrative lifecycle; `paymentState` is the payment lifecycle; the two are
// NOT merged.
//
// Compound uniqueness for (tenant_id, order_number) and partial uniqueness for
// (tenant_id, checkout_key) WHERE checkout_key IS NOT NULL are enforced by the Wave C migration
// (C1); here we only mark the lookup fields as indexed.

import type { CollectionBeforeChangeHook, CollectionSlug, Field } from 'payload'
import { APIError } from 'payload'
import type { CollectionOverride } from '@payloadcms/plugin-ecommerce/types'

import { STORE_COLLECTION_SLUGS } from '../slugs'
import {
  transition as orderTransition,
  transitionFulfillment,
  type FulfillmentState,
  type OrderState,
} from '../../orders/state'

const fulfillmentStateOptions = [
  { value: 'unfulfilled', label: { en: 'Unfulfilled', ar: 'غير منفّذة' } },
  { value: 'processing', label: { en: 'Processing', ar: 'قيد المعالجة' } },
  { value: 'shipped', label: { en: 'Shipped', ar: 'تم الشحن' } },
  { value: 'delivered', label: { en: 'Delivered', ar: 'تم التسليم' } },
  { value: 'cancelled', label: { en: 'Cancelled', ar: 'ملغاة' } },
  { value: 'returned', label: { en: 'Returned', ar: 'مرتجعة' } },
]

const paymentStateOptions = [
  { value: 'pending', label: { en: 'Pending', ar: 'معلّقة' } },
  { value: 'authorized', label: { en: 'Authorized', ar: 'مصرّح بها' } },
  { value: 'captured', label: { en: 'Captured', ar: 'مُحصّلة' } },
  { value: 'partially_captured', label: { en: 'Partially captured', ar: 'مُحصّلة جزئياً' } },
  { value: 'partially_refunded', label: { en: 'Partially refunded', ar: 'مسترجعة جزئياً' } },
  { value: 'refunded', label: { en: 'Refunded', ar: 'مسترجعة' } },
  { value: 'failed', label: { en: 'Failed', ar: 'فاشلة' } },
  { value: 'cancelled', label: { en: 'Cancelled', ar: 'ملغاة' } },
]

/**
 * Extension fields appended to the plugin's default orders fields. Exported for tests.
 *
 * All money fields are integer minor units in the order's currency (EGP at launch). All timestamps
 * are UTC ISO strings stored as Payload `date` fields.
 */
export const orderExtensionFields: Field[] = [
  {
    name: 'orderNumber',
    type: 'text',
    required: true,
    index: true,
    label: { en: 'Order number', ar: 'رقم الطلب' },
  },
  {
    name: 'checkoutKey',
    type: 'text',
    index: true,
    label: { en: 'Checkout key', ar: 'مفتاح الدفع' },
    admin: {
      description:
        'Idempotency key for checkout. Partial-unique on (tenant_id, checkout_key) WHERE NOT NULL.',
    },
  },
  {
    name: 'checkoutFingerprint',
    type: 'text',
    label: { en: 'Checkout fingerprint', ar: 'بصمة الدفع' },
    admin: { hidden: true, readOnly: true },
  },
  {
    name: 'paymentState',
    type: 'select',
    options: paymentStateOptions,
    defaultValue: 'pending',
    label: { en: 'Payment state', ar: 'حالة الدفع' },
    admin: {
      description:
        'Payment lifecycle. Independent of the plugin administrative status; the two are not merged.',
    },
  },
  {
    name: 'fulfillmentState',
    type: 'select',
    options: fulfillmentStateOptions,
    defaultValue: 'unfulfilled',
    label: { en: 'Fulfillment state', ar: 'حالة التنفيذ' },
  },
  {
    name: 'customerPhone',
    type: 'text',
    label: { en: 'Customer phone', ar: 'هاتف العميل' },
  },
  {
    name: 'subtotal',
    type: 'number',
    label: { en: 'Subtotal (minor units)', ar: 'المجموع الفرعي' },
    admin: { description: 'Integer minor units in the order currency.' },
  },
  {
    name: 'totalDiscount',
    type: 'number',
    defaultValue: 0,
    label: { en: 'Total discount (minor units)', ar: 'إجمالي الخصم' },
  },
  {
    name: 'shippingPrice',
    type: 'number',
    defaultValue: 0,
    label: { en: 'Shipping price (minor units)', ar: 'سعر الشحن' },
  },
  {
    name: 'totalTax',
    type: 'number',
    defaultValue: 0,
    label: { en: 'Total tax (minor units)', ar: 'إجمالي الضريبة' },
  },
  {
    name: 'giftCardApplied',
    type: 'number',
    defaultValue: 0,
    label: { en: 'Gift card applied (minor units)', ar: 'قيمة بطاقة الهدية المطبّقة' },
  },
  {
    name: 'amountDue',
    type: 'number',
    label: { en: 'Amount due (minor units)', ar: 'المبلغ المستحق' },
    admin: { description: 'grandTotal − giftCardApplied, integer minor units.' },
  },
  {
    name: 'quoteHash',
    type: 'text',
    label: { en: 'Quote hash', ar: 'هاش التسعير' },
    admin: {
      readOnly: true,
      description: 'SHA-256 of the canonical quote snapshot (sorted keys, stable array order).',
    },
  },
  {
    name: 'quoteSnapshot',
    type: 'json',
    label: { en: 'Quote snapshot', ar: 'لقطة التسعير' },
    admin: {
      hidden: true,
      readOnly: true,
      description: 'Immutable canonical quote at order placement. Never trusted from the browser.',
    },
  },
  {
    name: 'billingAddress',
    type: 'relationship',
    relationTo: STORE_COLLECTION_SLUGS.addresses as CollectionSlug,
    label: { en: 'Billing address', ar: 'عنوان الفوترة' },
  },
  {
    name: 'placedAt',
    type: 'date',
    label: { en: 'Placed at', ar: 'تاريخ الطلب' },
    admin: { date: { pickerAppearance: 'dayAndTime' } },
  },
  {
    name: 'expiresAt',
    type: 'date',
    label: { en: 'Expires at', ar: 'ينتهي في' },
    admin: { date: { pickerAppearance: 'dayAndTime' } },
  },
  {
    name: 'providerReference',
    type: 'text',
    index: true,
    label: { en: 'Provider reference', ar: 'مرجع مزوّد الدفع' },
    admin: { readOnly: true },
  },
  {
    name: 'legacyOrderId',
    type: 'number',
    index: true,
    label: { en: 'Legacy order ID', ar: 'معرّف الطلب القديم' },
    admin: { hidden: true, readOnly: true },
  },
]

// Runbook §7 item 2 — collection-level guard against illegal order/fulfillment transitions on UPDATE.
// Mirrors the retired legacy Orders.ts beforeChange hook for the dimensions whose value spaces match
// their state machines: `status` (orders/state.ts) and `fulfillmentState` (orders/state.ts) are real
// admin-edit surfaces, so each UPDATE is validated against its machine. CREATE is skipped
// (processCheckout sets the initial states).
//
// `paymentState` is intentionally NOT guarded here. It is a singly-written denormalized projection of
// the authoritative payment-events ledger: only `setStoreOrderPaymentState` (payments/job.ts) updates
// it, deriving the value from the folded ledger state via `mapPaymentStateForOrder`. Its value space
// (plugin order-doc values: includes 'cancelled', omits 'voided'/'disputed'/'partially_*') does NOT
// match the payments state machine in payments/state.ts, so validating that field against that machine
// is a category error that would reject legitimate ledger-driven updates (e.g. voided → 'cancelled').
// ponytail: if a second writer or direct admin editing of paymentState ever becomes a real risk,
// introduce a purpose-built order-paymentState transition table here — do NOT reuse payments/state.ts.
const validateStoreOrderTransitions: CollectionBeforeChangeHook = ({ data, originalDoc, operation }) => {
  if (operation !== 'update') return data
  const prev = originalDoc as
    | { status?: string; fulfillmentState?: string }
    | undefined
  const next = data as { status?: string; fulfillmentState?: string }

  if (next.status && prev?.status && next.status !== prev.status) {
    const t = orderTransition(prev.status as OrderState, next.status as OrderState)
    if (!t.ok) {
      throw new APIError(
        `Illegal order status transition: ${prev.status} → ${next.status}`,
        400,
        null,
        true,
      )
    }
  }
  if (
    next.fulfillmentState &&
    prev?.fulfillmentState &&
    next.fulfillmentState !== prev.fulfillmentState
  ) {
    const t = transitionFulfillment(
      prev.fulfillmentState as FulfillmentState,
      next.fulfillmentState as FulfillmentState,
    )
    if (!t.ok) {
      throw new APIError(
        `Illegal fulfillment transition: ${prev.fulfillmentState} → ${next.fulfillmentState}`,
        400,
        null,
        true,
      )
    }
  }
  return data
}

export const overrideStoreOrders: CollectionOverride = ({ defaultCollection }) => ({
  ...defaultCollection,
  slug: STORE_COLLECTION_SLUGS.orders as CollectionSlug,
  fields: [...(defaultCollection.fields ?? []), ...orderExtensionFields],
  hooks: {
    ...defaultCollection.hooks,
    beforeChange: [
      ...((defaultCollection.hooks?.beforeChange as CollectionBeforeChangeHook[] | undefined) ?? []),
      validateStoreOrderTransitions,
    ],
  },
})
