// store-transactions collection override.
//
// Plan §3.9 + Wave-A correction #1. Spreads the plugin's default transactions collection —
// preserving items, payment method, billing address, customer/email, order, cart, amount, currency
// and status — and appends the Paymob/Kashier adapter-group extension fields. The retained
// `payment-events` collection remains the append-only signed-event and retry ledger; it is NOT
// replaced by these fields.

import type { CollectionSlug, Field } from 'payload'
import type { CollectionOverride } from '@payloadcms/plugin-ecommerce/types'

import { STORE_COLLECTION_SLUGS } from '../slugs'

const reconciliationStatusOptions = [
  { value: 'pending', label: { en: 'Pending', ar: 'معلّقة' } },
  { value: 'matched', label: { en: 'Matched', ar: 'مطابَقة' } },
  { value: 'exception', label: { en: 'Exception', ar: 'استثناء' } },
]

/**
 * Extension fields appended to the plugin's default transactions fields. Exported for tests.
 *
 * Sensitive raw provider payloads are NEVER persisted — only their SHA-256 hash, so the audit trail
 * can deduplicate events without retaining secrets. Captured/refunded amounts are integer minor
 * units in the transaction currency.
 */
export const transactionExtensionFields: Field[] = [
  {
    name: 'providerTransactionId',
    type: 'text',
    index: true,
    label: { en: 'Provider transaction ID', ar: 'معرّف معاملة المزوّد' },
    admin: { readOnly: true },
  },
  {
    name: 'providerOrderReference',
    type: 'text',
    index: true,
    label: { en: 'Provider order reference', ar: 'مرجع طلب المزوّد' },
    admin: { readOnly: true },
  },
  {
    name: 'capturedAmount',
    type: 'number',
    defaultValue: 0,
    label: { en: 'Captured amount (minor units)', ar: 'المبلغ المحصّل' },
  },
  {
    name: 'refundedAmount',
    type: 'number',
    defaultValue: 0,
    label: { en: 'Refunded amount (minor units)', ar: 'المبلغ المسترجع' },
  },
  {
    name: 'lastProviderStatus',
    type: 'text',
    label: { en: 'Last provider status', ar: 'آخر حالة من المزوّد' },
    admin: { readOnly: true },
  },
  {
    name: 'lastProviderEventTimestamp',
    type: 'date',
    label: { en: 'Last provider event at', ar: 'تاريخ آخر حدث من المزوّد' },
    admin: { date: { pickerAppearance: 'dayAndTime' }, readOnly: true },
  },
  {
    name: 'reconciliationStatus',
    type: 'select',
    options: reconciliationStatusOptions,
    defaultValue: 'pending',
    label: { en: 'Reconciliation status', ar: 'حالة المطابقة' },
  },
  {
    name: 'rawPayloadHash',
    type: 'text',
    label: { en: 'Raw payload hash', ar: 'هاش الحمولة الأصلية' },
    admin: {
      readOnly: true,
      hidden: true,
      description: 'SHA-256 of the raw provider payload. Raw payloads are never persisted.',
    },
  },
  {
    name: 'legacyTransactionId',
    type: 'number',
    index: true,
    label: { en: 'Legacy transaction ID', ar: 'معرّف المعاملة القديم' },
    admin: { hidden: true, readOnly: true },
  },
]

export const overrideStoreTransactions: CollectionOverride = ({ defaultCollection }) => ({
  ...defaultCollection,
  slug: STORE_COLLECTION_SLUGS.transactions as CollectionSlug,
  fields: [...(defaultCollection.fields ?? []), ...transactionExtensionFields],
})
