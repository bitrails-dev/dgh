// gift-cards policy collection (Plan §3.10).
//
// Lookup table for gift cards by HMAC-SHA256 of the raw code. The raw code is NEVER stored or
// logged; it is shown ONCE at issuance. `codeHash` is unique GLOBALLY (not per-tenant) because a
// gift-card code must not collide across tenants — a customer typing a code into the wrong tenant’s
// checkout should see “not found”, not silently redeem another tenant’s card.
//
// `balance` is a CACHED integer minor-units value kept in lock-step with the append-only ledger by
// the gift-cards policy module. Direct writes to `balance` are denied at the field-access level; the
// policy module writes via overrideAccess from inside the atomic ledger-entry flow.

import type { CollectionConfig, CollectionSlug, FieldAccess } from 'payload'

const SLUG = 'gift-cards' as const

export const giftCardSlug = SLUG

const STATUS_OPTIONS = [
  { value: 'active', label: { en: 'Active', ar: 'ساري' } },
  { value: 'redeemed', label: { en: 'Redeemed', ar: 'تم استخدامه' } },
  { value: 'expired', label: { en: 'Expired', ar: 'منتهي' } },
  { value: 'revoked', label: { en: 'Revoked', ar: 'ملغى' } },
]

export const giftCardStatusOptions = STATUS_OPTIONS

// System-managed counters — only the gift-cards policy module updates `balance` (via overrideAccess
// from inside the ledger-entry flow). The admin can change status and metadata, never the balance
// directly.
const balanceReadOnly: FieldAccess = () => false

export const GiftCards: CollectionConfig = {
  slug: SLUG as CollectionSlug,
  labels: {
    singular: { en: 'Gift card', ar: 'بطاقة هدية' },
    plural: { en: 'Gift cards', ar: 'بطاقات الهدايا' },
  },
  admin: {
    group: { en: 'Commerce policies', ar: 'سياسات المتجر' },
    useAsTitle: 'lastFour',
    defaultColumns: ['lastFour', 'currency', 'balance', 'status', 'expiresAt'],
  },
  // The policy module owns all writes; admins read tenant-scoped for support. (Direct create would
  // skip the ledger, so it is denied here — issuance is a single atomic policy-module flow.)
  access: { create: () => false, update: () => false, delete: () => false },
  indexes: [
    // gift-card codeHash unique GLOBALLY (Plan §3.10 DB constraints). No `tenant` prefix.
    { fields: ['codeHash'], unique: true },
    // Tenant-scoped listing for support / reports.
    { fields: ['tenant', 'status'] },
  ],
  fields: [
    {
      name: 'codeHash',
      type: 'text',
      required: true,
      index: true,
      label: { en: 'Code hash', ar: 'هاش الكود' },
      admin: {
        hidden: true,
        description: 'HMAC-SHA256(COMMERCE_GIFT_CARD_PEPPER, normalizedRawCode). Raw code is never stored.',
      },
    },
    {
      name: 'lastFour',
      type: 'text',
      required: true,
      index: true,
      label: { en: 'Last four', ar: 'آخر أربعة' },
      admin: { description: 'Last four characters of the raw code, for support identification only.' },
    },
    {
      name: 'currency',
      type: 'text',
      required: true,
      defaultValue: 'EGP',
      label: { en: 'Currency', ar: 'العملة' },
      validate: (v: unknown) => /^[A-Z]{3}$/.test(String(v)) || 'Enter a 3-letter ISO-4217 currency code.',
    },
    {
      name: 'initialBalance',
      type: 'number',
      required: true,
      min: 0,
      label: { en: 'Initial balance', ar: 'الرصيد المبدئي' },
      admin: { description: 'Integer minor units. Lifetime issued total; refunds never exceed this.' },
    },
    {
      name: 'balance',
      type: 'number',
      required: true,
      min: 0,
      defaultValue: 0,
      access: { update: balanceReadOnly },
      label: { en: 'Balance (cached)', ar: 'الرصيد (مخبأ)' },
      admin: {
        readOnly: true,
        description:
          'Cached live balance — kept in lock-step with the append-only ledger. Read-only through the API.',
      },
    },
    {
      name: 'status',
      type: 'select',
      required: true,
      defaultValue: 'active',
      options: STATUS_OPTIONS,
      index: true,
      label: { en: 'Status', ar: 'الحالة' },
    },
    {
      name: 'expiresAt',
      type: 'date',
      index: true,
      label: { en: 'Expires at', ar: 'ينتهي في' },
      admin: { date: { pickerAppearance: 'dayAndTime' } },
    },
  ],
}
