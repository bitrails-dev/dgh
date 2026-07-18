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
 */
export const productExtensionFields: Field[] = [
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

export const overrideStoreProducts: CollectionOverride = ({ defaultCollection }) => ({
  ...defaultCollection,
  slug: STORE_COLLECTION_SLUGS.products as CollectionSlug,
  fields: [...(defaultCollection.fields ?? []), ...productExtensionFields],
})
