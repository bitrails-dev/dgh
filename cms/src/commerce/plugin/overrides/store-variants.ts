// store-variants collection override.
//
// Plan §3.5 + Wave-A correction #1/#5. Spreads the plugin's default variants collection and sets
// the permanent `store-variants` slug. Variant SKU is the immutable inventory key (Phase 1 reserves
// by SKU, not by document ID); `index: true` lets the inventory layer look variants up by SKU, and
// compound (tenant_id, sku) uniqueness is enforced by the Wave C migration.
//
// MUST NOT add an `inventory` field — Phase 1 owns stock.

import type { CollectionSlug, Field } from 'payload'
import type { CollectionOverride } from '@payloadcms/plugin-ecommerce/types'

import { STORE_COLLECTION_SLUGS } from '../slugs'
import { defaultPriceEnabledTrue } from './store-products'

/**
 * Extension fields appended to the plugin's default variant fields. Exported for tests.
 *
 * - `sku`: required, indexed — the immutable inventory allocation key.
 * - `legacyVariantKey`: nullable, indexed, hidden and read-only in the admin — preserves the
 *   legacy JSON variant key for migration traceability.
 * - `images`: relationship array to `media` for variant-level imagery.
 *
 * PRICE FIELDS (from the plugin — NOT re-declared here): the plugin's `pricesField` adds the same
 * `priceInEGPEnabled`/`priceInEGP` checkbox-gated pair to variants as it does to products. Without
 * intervention the checkbox defaults false and the variant price input is hidden — operators cannot
 * see where to enter the variant price. The variant price is authoritative for variant-parent
 * products (see `quote-loader.ts`), so this matters more here than on simple products.
 *
 * `defaultPriceEnabledTrue` (imported from `store-products.ts`) mutates the plugin's existing
 * enable checkboxes in place to `defaultValue: true`, preserving the plugin's `admin.condition`.
 * Re-declaring the field here would collide (DuplicateFieldName) at sanitize.
 */
export const variantExtensionFields: Field[] = [
  {
    name: 'sku',
    type: 'text',
    required: true,
    index: true,
    label: { en: 'SKU', ar: 'رمز الصنف' },
  },
  {
    name: 'legacyVariantKey',
    type: 'text',
    index: true,
    label: { en: 'Legacy variant key', ar: 'مفتاح الصنف القديم' },
    admin: {
      hidden: true,
      readOnly: true,
    },
  },
  {
    name: 'images',
    type: 'relationship',
    relationTo: 'media',
    hasMany: true,
    label: { en: 'Images', ar: 'الصور' },
  },
]

export const overrideStoreVariants: CollectionOverride = ({ defaultCollection }) => ({
  ...defaultCollection,
  slug: STORE_COLLECTION_SLUGS.variants as CollectionSlug,
  fields: [
    ...defaultPriceEnabledTrue([...(defaultCollection.fields ?? [])]),
    ...variantExtensionFields,
  ],
})
