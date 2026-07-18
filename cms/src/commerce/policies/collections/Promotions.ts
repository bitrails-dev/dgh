// promotions policy collection (Plan §3.10).
//
// Tenant-scoped promotion definitions. The plan fixes the value semantics:
//   - type: 'percentage' → `value` is basis points off (1% = 100 bps)
//   - type: 'fixed'      → `value` is integer minor units off
//   - type: 'free_shipping' → `value` ignored; grants free shipping after eligibility (step 7)
//
// Eligibility narrowing uses two relationship arrays: `eligibleProducts` and `eligibleVariants`.
// Empty arrays mean the promotion is order-wide (applies to every line); non-empty narrows to lines
// whose product or variant is in the set. `exclusive` blocks stacking — when any applied promotion
// is exclusive, only the highest-priority exclusive promotion applies (Plan §3.10 step 5).
//
// `minimumSubtotal` and `maximumDiscount` are integer minor units. `totalUsageLimit` and
// `perCustomerLimit` are checked + redeemed transactionally at order placement by the promotions
// policy module; a failed/expired payment releases the redemption.

import type { CollectionBeforeChangeHook, CollectionConfig, CollectionSlug } from 'payload'

const SLUG = 'promotions' as const

export const promotionSlug = SLUG

const PROMOTION_TYPE_OPTIONS = [
  { value: 'percentage', label: { en: 'Percentage', ar: 'نسبة مئوية' } },
  { value: 'fixed', label: { en: 'Fixed', ar: 'مبلغ ثابت' } },
  { value: 'free_shipping', label: { en: 'Free shipping', ar: 'شحن مجاني' } },
]

export const promotionTypeOptions = PROMOTION_TYPE_OPTIONS

// Normalize the promotion code (uppercase + collapse whitespace) before change so the unique index
// on (tenant, code) is meaningful against typographic drift. This hook must run before the unique
// index check, so it is the first beforeChange hook.
const normalizeCode: CollectionBeforeChangeHook = ({ data, operation }) => {
  if (operation !== 'create' && operation !== 'update') return data
  const d = data as { code?: string }
  if (typeof d?.code === 'string') {
    d.code = d.code.trim().toUpperCase().replace(/\s+/g, '-')
  }
  return data
}

export const Promotions: CollectionConfig = {
  slug: SLUG as CollectionSlug,
  labels: {
    singular: { en: 'Promotion', ar: 'عرض' },
    plural: { en: 'Promotions', ar: 'العروض' },
  },
  admin: {
    group: { en: 'Commerce policies', ar: 'سياسات المتجر' },
    useAsTitle: 'code',
    defaultColumns: ['code', 'type', 'value', 'startsAt', 'endsAt', 'exclusive', 'enabled'],
  },
  hooks: {
    beforeChange: [normalizeCode],
  },
  indexes: [
    // normalized promotion code unique per tenant (Plan §3.10 DB constraints).
    { fields: ['tenant', 'code'], unique: true },
  ],
  fields: [
    {
      name: 'code',
      type: 'text',
      required: true,
      index: true,
      label: { en: 'Code', ar: 'الكود' },
      admin: {
        description: 'Customer-typed code. Normalized (trim, uppercase, collapse whitespace) on save.',
      },
    },
    {
      name: 'type',
      type: 'select',
      required: true,
      options: PROMOTION_TYPE_OPTIONS,
      label: { en: 'Type', ar: 'النوع' },
    },
    {
      name: 'value',
      type: 'number',
      required: true,
      min: 0,
      label: { en: 'Value', ar: 'القيمة' },
      admin: {
        description:
          'percentage: basis points (1% = 100). fixed: integer minor units. free_shipping: ignored.',
      },
    },
    {
      name: 'minimumSubtotal',
      type: 'number',
      required: true,
      min: 0,
      defaultValue: 0,
      label: { en: 'Minimum subtotal', ar: 'الحد الأدنى للإجمالي' },
      admin: { description: 'Integer minor units; 0 = no gate.' },
    },
    {
      name: 'maximumDiscount',
      type: 'number',
      min: 0,
      label: { en: 'Maximum discount', ar: 'أقصى خصم' },
      admin: {
        description:
          'Optional cap on the discount amount (minor units). Percentage/fixed only; ignored by free_shipping.',
      },
    },
    {
      name: 'startsAt',
      type: 'date',
      required: true,
      index: true,
      label: { en: 'Starts at', ar: 'يبدأ في' },
      admin: { date: { pickerAppearance: 'dayAndTime' }, description: 'Interpreted in the tenant timezone.' },
    },
    {
      name: 'endsAt',
      type: 'date',
      index: true,
      label: { en: 'Ends at', ar: 'ينتهي في' },
      admin: { date: { pickerAppearance: 'dayAndTime' }, description: 'Empty = open-ended. Tenant timezone.' },
    },
    {
      name: 'totalUsageLimit',
      type: 'number',
      min: 0,
      label: { en: 'Total usage limit', ar: 'حد الإجمالي' },
      admin: { description: 'Maximum lifetime redemptions across all customers. Empty = unlimited.' },
    },
    {
      name: 'perCustomerLimit',
      type: 'number',
      min: 0,
      label: { en: 'Per-customer limit', ar: 'حد لكل عميل' },
      admin: {
        description:
          'Maximum redemptions per customer identity. Empty = unlimited. Anonymous carts key on the customer identity hash.',
      },
    },
    {
      name: 'exclusive',
      type: 'checkbox',
      defaultValue: false,
      index: true,
      label: { en: 'Exclusive (blocks stacking)', ar: 'حصري (يمنع التراكم)' },
    },
    {
      name: 'eligibleProducts',
      type: 'relationship',
      relationTo: 'store-products',
      hasMany: true,
      label: { en: 'Eligible products', ar: 'المنتجات المؤهلة' },
      admin: {
        description:
          'When non-empty, the promotion only applies to lines whose product is in this list.',
      },
    },
    {
      name: 'eligibleVariants',
      type: 'relationship',
      relationTo: 'store-variants' as CollectionSlug,
      hasMany: true,
      label: { en: 'Eligible variants', ar: 'المتغيرات المؤهلة' },
      admin: {
        description: 'When non-empty, the promotion only applies to lines whose variant is in this list.',
      },
    },
    {
      name: 'enabled',
      type: 'checkbox',
      defaultValue: true,
      index: true,
      label: { en: 'Enabled', ar: 'مفعّل' },
    },
  ],
}
