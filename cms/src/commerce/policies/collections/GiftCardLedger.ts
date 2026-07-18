// gift-card-ledger policy collection (Plan §3.10).
//
// Append-only ledger of every gift-card balance change. The cached `balance` on `gift-cards` is the
// fold of this ledger; entries are never mutated or deleted. Plan §3.10: "Gift-card balances change
// only through append-only ledger entries in the same database transaction as the order/payment
// transition."
//
// `amount` is SIGNED integer minor units: issue/refund/adjustment-positive or redeem-negative; the
// gift-cards policy module computes the sign from the `kind` and writes a single row per atomic
// state transition. `idempotencyKey` is unique per tenant so a retried checkout cannot double-redeem
// or double-refund.
//
// System-managed: only the policy module writes rows (overrideAccess). Admins read for audit.

import type { CollectionConfig, CollectionSlug } from 'payload'

const SLUG = 'gift-card-ledger' as const

export const giftCardLedgerSlug = SLUG

const KIND_OPTIONS = [
  { value: 'issue', label: { en: 'Issue', ar: 'إصدار' } },
  { value: 'redeem', label: { en: 'Redeem', ar: 'استخدام' } },
  { value: 'refund', label: { en: 'Refund', ar: 'استرجاع' } },
  { value: 'adjustment', label: { en: 'Adjustment', ar: 'تسوية' } },
]

export const giftCardLedgerKindOptions = KIND_OPTIONS

const systemOnly = () => false

export const GiftCardLedger: CollectionConfig = {
  slug: SLUG as CollectionSlug,
  labels: {
    singular: { en: 'Gift-card ledger entry', ar: 'قيد بطاقة هدية' },
    plural: { en: 'Gift-card ledger', ar: 'سجل بطاقات الهدايا' },
  },
  admin: {
    group: { en: 'Commerce policies', ar: 'سياسات المتجر' },
    useAsTitle: 'idempotencyKey',
    defaultColumns: ['giftCard', 'kind', 'amount', 'order', 'createdAt'],
  },
  access: { create: systemOnly, update: systemOnly, delete: systemOnly },
  indexes: [
    // gift-card ledger idempotency key unique per tenant (Plan §3.10 DB constraints).
    { fields: ['tenant', 'idempotencyKey'], unique: true },
    // Replay order — rebuild cached balance from the ledger in created-at order.
    { fields: ['giftCard', 'createdAt'] },
  ],
  fields: [
    {
      name: 'giftCard',
      type: 'relationship',
      relationTo: 'gift-cards' as CollectionSlug,
      required: true,
      index: true,
      label: { en: 'Gift card', ar: 'بطاقة الهدية' },
    },
    {
      name: 'order',
      type: 'relationship',
      relationTo: 'store-orders',
      index: true,
      label: { en: 'Order', ar: 'الطلب' },
      admin: { description: 'Set on redeem/refund; empty on issue/adjustment.' },
    },
    {
      name: 'kind',
      type: 'select',
      required: true,
      options: KIND_OPTIONS,
      label: { en: 'Kind', ar: 'النوع' },
    },
    {
      name: 'amount',
      type: 'number',
      required: true,
      label: { en: 'Amount (signed)', ar: 'المبلغ (مُوقَّع)' },
      admin: {
        description:
          'Signed integer minor units. issue/refund/adjustment-positive or redeem-negative per `kind`.',
      },
    },
    {
      name: 'idempotencyKey',
      type: 'text',
      required: true,
      index: true,
      label: { en: 'Idempotency key', ar: 'مفتاح المعاملية' },
      admin: {
        description:
          'Stable key per state transition (e.g. checkout-key + step). Unique per tenant.',
        hidden: true,
      },
    },
    {
      name: 'createdAt',
      type: 'date',
      required: true,
      index: true,
      label: { en: 'Created at', ar: 'أنشئ في' },
      admin: { date: { pickerAppearance: 'dayAndTime' }, readOnly: true },
    },
  ],
}
