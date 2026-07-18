// tax-rates policy collection (Plan §3.10).
//
// One row per (tenant, zone, taxClass, effective interval). The §3.10 DB constraint "one active tax
// rate per tenant/zone/class/effective interval (reject overlaps)" is enforced by the
// `rejectOverlappingRates` beforeChange hook below — interval-overlap cannot be expressed as a
// Postgres/SQLite unique index. A non-unique index on the resolution keys speeds up the lookup the
// resolver does at quote time.
//
// `rateBps` is an integer basis-points rate (1% = 100 bps). `pricesIncludeTax` reflects whether the
// product/variant prices for this rate's class already include the tax (overriding the tenant's
// default tax mode for the matched line). `effectiveFrom` / `effectiveTo` are the inclusive validity
// window; an absent `effectiveTo` is open-ended.

import type { CollectionBeforeChangeHook, CollectionConfig, CollectionSlug, Field } from 'payload'

const SLUG = 'tax-rates' as const

export const taxRateSlug = SLUG

const TAX_CLASS_OPTIONS = [
  { value: 'standard', label: { en: 'Standard', ar: 'قياسي' } },
  { value: 'reduced', label: { en: 'Reduced', ar: 'مخفّض' } },
  { value: 'zero', label: { en: 'Zero', ar: 'صفرية' } },
  { value: 'exempt', label: { en: 'Exempt', ar: 'معفاة' } },
]

export const taxClassOptions = TAX_CLASS_OPTIONS

// Plan §3.10 — "one active tax rate per tenant/zone/class/effective interval (reject overlaps)".
// Two active rates for the same (tenant, zone, class) overlap when their [effectiveFrom,
// effectiveTo] intervals intersect (treating null effectiveTo as +∞). Disabled rates are exempt
// (only `enabled: true` rates are considered active). Hook runs server-side via Local API.
const rejectOverlappingRates: CollectionBeforeChangeHook = async ({ data, operation, req }) => {
  if (operation !== 'create' && operation !== 'update') return data
  const d = data as {
    tenant?: { id?: string | number } | string | number
    zone?: { id?: string | number } | string | number
    taxClass?: string
    rateBps?: number
    effectiveFrom?: string | null
    effectiveTo?: string | null
    enabled?: boolean
  }
  if (d?.enabled === false) return data

  const tenantId = d?.tenant && typeof d?.tenant === 'object' ? d.tenant.id : d?.tenant
  const zoneId = d?.zone && typeof d?.zone === 'object' ? d.zone.id : d?.zone
  if (tenantId === undefined || tenantId === null || zoneId === undefined || zoneId === null) {
    return data
  }
  if (!Number.isInteger(d?.rateBps) || (d?.rateBps as number) < 0) {
    const { APIError } = await import('payload')
    throw new APIError('rateBps must be a non-negative integer basis-points value.', 400, null, true)
  }

  const fromA = d?.effectiveFrom ? Date.parse(String(d.effectiveFrom)) : -Infinity
  const toA = d?.effectiveTo ? Date.parse(String(d.effectiveTo)) : Infinity
  if (Number.isNaN(fromA) || Number.isNaN(toA)) {
    const { APIError } = await import('payload')
    throw new APIError('Invalid effectiveFrom / effectiveTo date.', 400, null, true)
  }
  if (fromA > toA) {
    const { APIError } = await import('payload')
    throw new APIError('effectiveFrom cannot be after effectiveTo.', 400, null, true)
  }

  // Existing enabled rates for the same tenant/zone/class. We purposefully pass overrideAccess:
  // this hook runs server-side as part of a staff write and the cross-tenant isolation is enforced
  // by the multi-tenant plugin's access layer at the request boundary, not by this query.
  const existing = await req.payload.find({
    collection: SLUG as CollectionSlug,
    overrideAccess: true,
    where: {
      and: [
        { tenant: { equals: tenantId } },
        { zone: { equals: zoneId } },
        { taxClass: { equals: d?.taxClass ?? null } },
        { enabled: { equals: true } },
      ],
    },
    limit: 100,
    req,
  })

  for (const row of existing.docs as Array<{
    id?: string | number
    effectiveFrom?: string | null
    effectiveTo?: string | null
  }>) {
    // Skip self on update.
    if (
      operation === 'update' &&
      (data as { id?: string | number })?.id !== undefined &&
      row.id !== undefined &&
      String(row.id) === String((data as { id?: string | number }).id)
    ) {
      continue
    }
    const fromB = row.effectiveFrom ? Date.parse(row.effectiveFrom) : -Infinity
    const toB = row.effectiveTo ? Date.parse(row.effectiveTo) : Infinity
    if (Number.isNaN(fromB) || Number.isNaN(toB)) continue
    // Overlap iff fromA <= toB && fromB <= toA (inclusive bounds).
    if (fromA <= toB && fromB <= toA) {
      const { APIError } = await import('payload')
      throw new APIError(
        'An enabled tax rate already covers this effective interval for the same zone and tax class.',
        409,
        null,
        true,
      )
    }
  }
  return data
}

export const TaxRates: CollectionConfig = {
  slug: SLUG as CollectionSlug,
  labels: {
    singular: { en: 'Tax rate', ar: 'سعر ضريبي' },
    plural: { en: 'Tax rates', ar: 'أسعار ضريبية' },
  },
  admin: {
    group: { en: 'Commerce policies', ar: 'سياسات المتجر' },
    useAsTitle: 'taxClass',
    defaultColumns: ['zone', 'taxClass', 'rateBps', 'effectiveFrom', 'enabled'],
  },
  hooks: {
    beforeChange: [rejectOverlappingRates],
  },
  indexes: [
    // Speeds up the resolver's lookup-by-tenant/zone. The interval-overlap invariant is enforced by
    // the rejectOverlappingRates hook (cannot be expressed as a unique index in SQLite).
    { fields: ['tenant', 'zone', 'taxClass', 'enabled'] },
  ],
  fields: [
    {
      name: 'zone',
      type: 'relationship',
      relationTo: 'tax-zones' as CollectionSlug,
      required: true,
      index: true,
      label: { en: 'Tax zone', ar: 'منطقة ضريبية' },
    },
    {
      name: 'taxClass',
      type: 'select',
      required: true,
      defaultValue: 'standard',
      options: TAX_CLASS_OPTIONS,
      index: true,
      label: { en: 'Tax class', ar: 'فئة الضريبة' },
    },
    {
      name: 'rateBps',
      type: 'number',
      required: true,
      min: 0,
      max: 10000,
      label: { en: 'Rate (bps)', ar: 'السعر (نقطة أساس)' },
      admin: {
        description: 'Integer basis points (1% = 100 bps). Capped at 10000 (100%).',
      },
    },
    {
      name: 'pricesIncludeTax',
      type: 'checkbox',
      defaultValue: false,
      label: { en: 'Prices include tax', ar: 'الأسعار شاملة الضريبة' },
      admin: {
        description:
          'When set, prices for this rate’s class are treated as gross for the matched line.',
      },
    },
    {
      name: 'effectiveFrom',
      type: 'date',
      required: true,
      index: true,
      label: { en: 'Effective from', ar: 'ساري من' },
      admin: { date: { pickerAppearance: 'dayAndTime' } },
    },
    {
      name: 'effectiveTo',
      type: 'date',
      index: true,
      label: { en: 'Effective to', ar: 'ساري حتى' },
      admin: { date: { pickerAppearance: 'dayAndTime' }, description: 'Empty = open-ended.' },
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
