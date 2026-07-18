// store-variant-types collection override.
//
// Plan §3.1 + Wave-A correction #1. Variant types have no extension fields in §3.5; this override
// only re-slugs the collection to `store-variant-types` while preserving every default field, hook,
// access function and label from the plugin.

import type { CollectionSlug } from 'payload'
import type { CollectionOverride } from '@payloadcms/plugin-ecommerce/types'

import { STORE_COLLECTION_SLUGS } from '../slugs'

export const overrideStoreVariantTypes: CollectionOverride = ({ defaultCollection }) => ({
  ...defaultCollection,
  slug: STORE_COLLECTION_SLUGS.variantTypes as CollectionSlug,
})
