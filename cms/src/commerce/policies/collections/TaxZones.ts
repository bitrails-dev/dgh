// tax-zones policy collection (Plan §3.10).
//
// Tenant-scoped jurisdiction definition used by the tax-rate resolver
// (cms/src/commerce/policies/tax.ts). One row per (tenant, code); the multi-tenant plugin injects
// the required `tenant` relationship AFTER this collection is registered, so the unique constraint
// is expressed as (tenant, code) — matching the field name the multi-tenant plugin uses.
//
// The matching tax rate is selected by the resolver from `tax-rates` rows that reference this zone.
// A zone with no `country` matches any address (catch-all); a configured country narrows the match;
// `regions` and `postalPrefixes` narrow it further. Higher `priority` wins on overlap (deterministic
// tie-break is the input-order-stable sort inside the resolver).

import type { CollectionConfig, CollectionSlug, Field } from 'payload'

const SLUG = 'tax-zones' as const

export const taxZoneSlug = SLUG

// Localized name — admin-managed; group with en/ar so the admin UI can render both at edit time.
const localizedNameField: Field = {
  name: 'name',
  type: 'group',
  label: { en: 'Name', ar: 'الاسم' },
  fields: [
    { name: 'en', type: 'text', required: true, label: { en: 'English', ar: 'إنجليزي' } },
    { name: 'ar', type: 'text', required: true, label: { en: 'Arabic', ar: 'عربي' } },
  ],
}

export const TaxZones: CollectionConfig = {
  slug: SLUG as CollectionSlug,
  labels: {
    singular: { en: 'Tax zone', ar: 'منطقة ضريبية' },
    plural: { en: 'Tax zones', ar: 'المناطق الضريبية' },
  },
  admin: {
    group: { en: 'Commerce policies', ar: 'سياسات المتجر' },
    useAsTitle: 'code',
    defaultColumns: ['code', 'country', 'priority', 'enabled'],
  },
  indexes: [
    // tax-zone code unique per tenant (Plan §3.10 DB constraints).
    { fields: ['tenant', 'code'], unique: true },
  ],
  fields: [
    {
      name: 'code',
      type: 'text',
      required: true,
      index: true,
      label: { en: 'Code', ar: 'الرمز' },
      admin: { description: 'Stable tenant-unique code, e.g. EG-STD. Uppercased on save.' },
    },
    localizedNameField,
    {
      name: 'country',
      type: 'text',
      index: true,
      label: { en: 'Country (ISO-3166 alpha-2)', ar: 'الدولة' },
      admin: {
        description:
          'Normalized ISO-3166 alpha-2 (e.g. EG). Empty matches any country (catch-all zone).',
      },
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
      admin: {
        description:
          'Optional subdivision codes (ISO 3166-2, e.g. EG-C). Empty = whole country matches.',
      },
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
      admin: {
        description: 'Optional postal-code prefixes; a postal code matches when it starts with one.',
      },
    },
    {
      name: 'priority',
      type: 'number',
      defaultValue: 0,
      index: true,
      label: { en: 'Priority', ar: 'الأولوية' },
      admin: { description: 'Higher priority wins on jurisdiction overlap.' },
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
