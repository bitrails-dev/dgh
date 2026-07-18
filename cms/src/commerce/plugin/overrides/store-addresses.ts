// store-addresses collection override.
//
// Plan §3.1 + Wave-A correction #1. Addresses have no per-collection extension fields in §3.7–§3.9;
// the only addresses-level configuration is `supportedCountries` (Plan §3.2), which is a plugin
// config concern wired by the integration owner at B4, not a CollectionConfig concern. This override
// preserves every default field/hook/access function and only re-slugs the collection to
// `store-addresses`.

import type { CollectionSlug } from 'payload'
import type { CollectionOverride } from '@payloadcms/plugin-ecommerce/types'

import { STORE_COLLECTION_SLUGS } from '../slugs'

export const overrideStoreAddresses: CollectionOverride = ({ defaultCollection }) => ({
  ...defaultCollection,
  slug: STORE_COLLECTION_SLUGS.addresses as CollectionSlug,
})
