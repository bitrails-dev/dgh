// store-products collection override.
//
// Plan §3.4 + §3.5 + Wave-A correction #1/#5. Spreads the plugin's default products collection
// (preserving access, hooks, labels, admin config, versions/drafts, etc.), explicitly sets the
// permanent `store-products` slug (slugMap alone does NOT rename the collection), and appends the
// product extension fields. The multi-tenant plugin appends the `tenant` field AFTER this override
// at B4. Compound (tenant_id, sku) uniqueness is enforced via the migration lane (Wave C, C1) — here
// we only mark `sku` as indexed.
//
// IMPORTANT: this override MUST NOT add an `inventory` field. `inventory: false` is set by the
// integration owner at B4; Phase 1 owns stock via cms/src/commerce/inventory/**.

import type { CollectionSlug, Field } from 'payload'
import type { CollectionOverride } from '@payloadcms/plugin-ecommerce/types'

import { STORE_COLLECTION_SLUGS } from '../slugs'

const taxClassOptions = [
  { value: 'standard', label: { en: 'Standard', ar: 'قياسي' } },
  { value: 'reduced', label: { en: 'Reduced', ar: 'مخفّض' } },
  { value: 'zero', label: { en: 'Zero', ar: 'صفرية' } },
  { value: 'exempt', label: { en: 'Exempt', ar: 'معفاة' } },
]

/**
 * Extension fields appended to the plugin's default products fields. Exported for tests.
 *
 * - `name`: display name shown in the storefront catalog (parity with the legacy `products.name`;
 *   single string, bilingual admin label — the legacy commerce model stored one name, not a
 *   localized group; localizing product names is a later enhancement, out of Wave F2 scope).
 * - `slug`: required, indexed — storefront catalog handle.
 * - `description`: free-form textarea (the plugin has no default description; this is the
 *   "existing supported content field" form of §3.5, deferred from rich text for v1).
 * - `sku`: nullable, indexed — null on products that carry variants; the variant SKU is the
 *   allocation key. Compound uniqueness lives in the migration.
 * - `trackInventory`: checkbox, default true — reserves are honored only when this is true.
 * - `taxClass`: required select (standard/reduced/zero/exempt) — keys into `tax-rates`.
 * - `taxBps`: optional override in basis points 0..10000; null means "use the tax-class rate".
 * - `images`: relationship array to `media`.
 * - `legacyProductId`: nullable indexed integer, hidden and read-only in the admin — preserves the
 *   old product row ID for migration traceability.
 *
 * PRICE FIELDS (from the plugin — NOT re-declared here):
 * The plugin's `pricesField({ currenciesConfig })` adds an unnamed `group` per supported currency.
 * For EGP that group contains two sibling fields — `priceInEGPEnabled` (checkbox) and `priceInEGP`
 * (number, minor units). The amount input is conditionally hidden via
 * `admin.condition: (_, sibling) => Boolean(sibling?.priceInEGPEnabled)` until the checkbox is
 * ticked. WITHOUT intervention, the checkbox defaults to false, so the price input is invisible on
 * every new product and operators report "I can't add a price."
 *
 * Because the plugin wraps the checkbox inside an unnamed group whose fields flatten to the
 * top level, re-declaring `priceInEGPEnabled` in this array would produce a DuplicateFieldName
 * error at sanitize. Instead, `defaultPriceEnabledTrue()` below walks `defaultCollection.fields`
 * and mutates the plugin's existing `priceInEGPEnabled` field in place, setting `defaultValue: true`
 * so the price row is visible by default. The plugin's `admin.condition` on `priceInEGP` is
 * preserved (the row still hides when the checkbox is unticked).
 *
 * For variant parents the product-level price is intentionally absent (the variant price is
 * authoritative; see `quote-loader.ts` variant-first precedence).
 *
 * Tiered/volume pricing is NOT a feature of this codebase; the plugin does not provide it and no
 * stub exists. `priceInEGP` is a flat per-unit minor-unit amount.
 */
export const productExtensionFields: Field[] = [
  {
    name: 'name',
    type: 'text',
    label: { en: 'Name', ar: 'الاسم' },
    admin: {
      description: 'Shown in the storefront catalog and order line items.',
    },
  },
  {
    name: 'slug',
    type: 'text',
    required: true,
    index: true,
    label: { en: 'Slug', ar: 'المعرّف' },
  },
  {
    name: 'description',
    type: 'textarea',
    label: { en: 'Description', ar: 'الوصف' },
  },
  {
    name: 'sku',
    type: 'text',
    index: true,
    label: { en: 'SKU', ar: 'رمز الصنف' },
    admin: {
      description:
        'Null for products that carry variants; the per-variant SKU is the inventory key.',
    },
  },
  {
    name: 'trackInventory',
    type: 'checkbox',
    defaultValue: true,
    label: { en: 'Track inventory', ar: 'تتبّع المخزون' },
  },
  {
    name: 'taxClass',
    type: 'select',
    required: true,
    defaultValue: 'standard',
    options: taxClassOptions,
    label: { en: 'Tax class', ar: 'فئة الضريبة' },
  },
  {
    name: 'taxBps',
    type: 'number',
    min: 0,
    max: 10000,
    label: { en: 'Tax override (bps)', ar: 'تجاوز الضريبة (نقطة أساس)' },
    admin: {
      description:
        'Optional per-product override, basis points 0..10000. Null uses the tax-class rate.',
    },
  },
  {
    name: 'images',
    type: 'relationship',
    relationTo: 'media',
    hasMany: true,
    label: { en: 'Images', ar: 'الصور' },
  },
  {
    name: 'legacyProductId',
    type: 'number',
    index: true,
    label: { en: 'Legacy product ID', ar: 'معرّف المنتج القديم' },
    admin: {
      hidden: true,
      readOnly: true,
    },
  },
]

/**
 * Walk the plugin's default product fields and set `defaultValue: true` on the
 * `priceInEGPEnabled` checkbox (and any other `priceIn<CODE>Enabled` checkbox the plugin emits for
 * a supported currency). The plugin wraps each currency's enable checkbox inside an unnamed
 * `group` whose `fields` flatten to the top level at sanitize, so we recurse through nested
 * `row`/`group` containers to find them. Mutates in place; returns the same array for chaining.
 *
 * Rationale: without `defaultValue: true`, the checkbox defaults to false and the plugin's
 * `admin.condition` on the sibling `priceInEGP` amount field hides the price input on every new
 * product — operators see no visible "Price" field. Re-declaring the field by name in
 * `productExtensionFields` collides (DuplicateFieldName) because the plugin's copy already exists,
 * so in-place mutation is the only merge path that preserves the plugin's `admin.condition`.
 */
export function defaultPriceEnabledTrue(fields: Field[]): Field[] {
  for (const f of fields) {
    if (
      f &&
      typeof f === 'object' &&
      'name' in f &&
      typeof (f as { name?: unknown }).name === 'string' &&
      // Match the plugin's enable-checkbox pattern: `priceIn<CURRENCY_CODE>Enabled` where
      // <CURRENCY_CODE> is 2+ uppercase letters (e.g. EGP, USD, SAR). The trailing `Enabled`
      // is mixed-case, so we anchor it literally rather than as part of the [A-Z]+ class.
      /^priceIn[A-Z]{2,}Enabled$/.test((f as { name: string }).name) &&
      (f as { type?: string }).type === 'checkbox'
    ) {
      ;(f as { defaultValue?: unknown }).defaultValue = true
    }
    // Recurse into containers (unnamed group, named group, row, tabs, collapsible).
    const nested = (f as { fields?: unknown[] }).fields
    if (Array.isArray(nested)) defaultPriceEnabledTrue(nested as Field[])
  }
  return fields
}

export const overrideStoreProducts: CollectionOverride = ({ defaultCollection }) => ({
  ...defaultCollection,
  slug: STORE_COLLECTION_SLUGS.products as CollectionSlug,
  fields: [
    ...defaultPriceEnabledTrue([...(defaultCollection.fields ?? [])]),
    ...productExtensionFields,
  ],
})
