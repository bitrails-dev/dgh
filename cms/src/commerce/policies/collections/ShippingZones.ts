// shipping-zones policy collection (Plan §3.10).
//
// Mirrors tax-zones in shape: a tenant-scoped jurisdiction definition that the shipping-methods
// collection references. The multi-tenant plugin injects `tenant` after registration; the unique
// constraint on (tenant, code) is enforced via the index below.

import type { CollectionConfig, CollectionSlug, Field } from 'payload'

const SLUG = 'shipping-zones' as const

export const shippingZoneSlug = SLUG

const localizedNameField: Field = {
  name: 'name',
  type: 'group',
  label: { en: 'Name', ar: 'الاسم' },
  fields: [
    { name: 'en', type: 'text', required: true, label: { en: 'English', ar: 'إنجليزي' } },
    { name: 'ar', type: 'text', required: true, label: { en: 'Arabic', ar: 'عربي' } },
  ],
}

export const ShippingZones: CollectionConfig = {
  slug: SLUG as CollectionSlug,
  labels: {
    singular: { en: 'Shipping zone', ar: 'منطقة شحن' },
    plural: { en: 'Shipping zones', ar: 'مناطق الشحن' },
  },
  admin: {
    group: { en: 'Commerce policies', ar: 'سياسات المتجر' },
    useAsTitle: 'code',
    defaultColumns: ['code', 'country', 'priority', 'enabled'],
  },
  indexes: [
    // shipping-zone code unique per tenant (Plan §3.10 DB constraints).
    { fields: ['tenant', 'code'], unique: true },
  ],
  fields: [
    {
      name: 'code',
      type: 'text',
      required: true,
      index: true,
      label: { en: 'Code', ar: 'الرمز' },
      admin: { description: 'Stable tenant-unique code, e.g. EG-CAIRO.' },
    },
    localizedNameField,
    {
      name: 'country',
      type: 'text',
      index: true,
      label: { en: 'Country (ISO-3166 alpha-2)', ar: 'الدولة' },
      admin: { description: 'Empty = catch-all zone.' },
    },
    {
      name: 'regions',
      type: 'array',
      label: { en: 'Regions', ar: 'المناطق' },
      fields: [
        {
          name: 'code',
          type: 'text',
          required: true,
          label: { en: 'Region code', ar: 'رمز المنطقة' },
        },
      ],
    },
    {
      name: 'postalPrefixes',
      type: 'array',
      label: { en: 'Postal prefixes', ar: 'بادئات الرمز البريدي' },
      fields: [
        {
          name: 'prefix',
          type: 'text',
          required: true,
          label: { en: 'Prefix', ar: 'البادئة' },
        },
      ],
    },
    {
      name: 'priority',
      type: 'number',
      defaultValue: 0,
      index: true,
      label: { en: 'Priority', ar: 'الأولوية' },
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
