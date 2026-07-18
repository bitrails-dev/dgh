// shipping-methods policy collection (Plan §3.10).
//
// Tenant-scoped shipping methods scoped to a shipping-zone. All money fields are integer EGP minor
// units (the launch currency). `basePrice` is the flat rate; `freeAboveSubtotal` grants free
// shipping once the discounted merchandise subtotal reaches this threshold (inclusive); the optional
// minimum/maximum subtotal gates hide or cap the method outside its band.
//
// The quoteCart engine picks the cheapest eligible method for the resolved zone + subtotal +
// currency. Free-shipping promotions (Plan §3.10 step 7) are applied AFTER shipping eligibility is
// established — they zero the price of the method that would have applied, they do not change the
// method selection.

import type { CollectionConfig, CollectionSlug } from 'payload'

const SLUG = 'shipping-methods' as const

export const shippingMethodSlug = SLUG

export const ShippingMethods: CollectionConfig = {
  slug: SLUG as CollectionSlug,
  labels: {
    singular: { en: 'Shipping method', ar: 'طريقة شحن' },
    plural: { en: 'Shipping methods', ar: 'طرق الشحن' },
  },
  admin: {
    group: { en: 'Commerce policies', ar: 'سياسات المتجر' },
    useAsTitle: 'code',
    defaultColumns: ['zone', 'code', 'basePrice', 'freeAboveSubtotal', 'enabled'],
  },
  indexes: [
    // shipping-method code unique per tenant (Plan §3.10 DB constraints).
    { fields: ['tenant', 'code'], unique: true },
    // Resolution lookup index.
    { fields: ['tenant', 'zone', 'enabled'] },
  ],
  fields: [
    {
      name: 'zone',
      type: 'relationship',
      relationTo: 'shipping-zones' as CollectionSlug,
      required: true,
      index: true,
      label: { en: 'Shipping zone', ar: 'منطقة الشحن' },
    },
    {
      name: 'code',
      type: 'text',
      required: true,
      index: true,
      label: { en: 'Code', ar: 'الرمز' },
      admin: { description: 'Stable tenant-unique code, e.g. EG-CAIRO-STD.' },
    },
    {
      name: 'name',
      type: 'group',
      label: { en: 'Name', ar: 'الاسم' },
      fields: [
        { name: 'en', type: 'text', required: true, label: { en: 'English', ar: 'إنجليزي' } },
        { name: 'ar', type: 'text', required: true, label: { en: 'Arabic', ar: 'عربي' } },
      ],
    },
    {
      name: 'basePrice',
      type: 'number',
      required: true,
      min: 0,
      label: { en: 'Base price (minor)', ar: 'السعر الأساسي' },
      admin: { description: 'Integer EGP minor units.' },
    },
    {
      name: 'freeAboveSubtotal',
      type: 'number',
      required: true,
      min: 0,
      defaultValue: 0,
      label: { en: 'Free above subtotal', ar: 'مجاني فوق الإجمالي' },
      admin: {
        description:
          'Discounted merchandise subtotal (inclusive) at which shipping becomes free. 0 = never free.',
      },
    },
    {
      name: 'minimumSubtotal',
      type: 'number',
      min: 0,
      label: { en: 'Minimum subtotal', ar: 'الحد الأدنى للإجمالي' },
      admin: { description: 'Optional gate; method hidden below this subtotal.' },
    },
    {
      name: 'maximumSubtotal',
      type: 'number',
      min: 0,
      label: { en: 'Maximum subtotal', ar: 'الحد الأقصى للإجمالي' },
      admin: { description: 'Optional cap; method hidden above this subtotal.' },
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
