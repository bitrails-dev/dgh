// store-carts collection override.
//
// Plan §3.7 + Wave-A correction #1. Spreads the plugin's default carts collection, sets the
// permanent `store-carts` slug, AND WIPES THE COLLECTION HTTP ENDPOINTS ARRAY. The plugin's default
// carts collection registers HTTP endpoints for add/update/remove/clear/merge that bypass the
// commerce gateway; per §3.7 those server operations (`addItem`, `updateItem`, `removeItem`,
// `clearCart`, `mergeCart`) must only be invoked from signed CMS store endpoints, so we remove the
// generated HTTP surface here. The exported operations remain available for Local API use.
//
// Extension fields (§3.7):
//  - `selectedShippingMethod`: relationship to retained shipping-methods — DEFERRED to Wave C4 (see
//    inline note below; `shipping-methods` does not exist until the C4 policy lane lands).
//  - `promotionCodes`: normalized text array (max 10) — validated server-side against persisted
//    promotions; never trusted from the client totals.
//  - `giftCardTokenHash`: nullable text — HMAC of the applied gift-card code; the raw code is never
//    persisted.
//  - `quoteVersion`: integer, default 1 — bumped whenever the server recomputes the authoritative
//    quote so a stale browser quote can be detected.

import type { CollectionSlug, Field } from 'payload'
import type { CollectionOverride } from '@payloadcms/plugin-ecommerce/types'

import { STORE_COLLECTION_SLUGS } from '../slugs'

export const cartExtensionFields: Field[] = [
  // `selectedShippingMethod` (relationship → `shipping-methods`, Plan §3.7) is DEFERRED to Wave C4.
  // `shipping-methods` is a policy collection (Plan §3.10) created by the C4 policy lane, which runs
  // AFTER B4. Payload's config sanitizer rejects a `relationTo` whose target is not a registered
  // collection, so declaring the field here would break `generate:types` at B4. The C4 lane MUST
  // re-add this field here — `{ name: 'selectedShippingMethod', type: 'relationship',
  // relationTo: 'shipping-methods', label: { en: 'Selected shipping method', ar: 'طريقة الشحن المختارة' } }`
  // — once it registers the shipping-methods collection.
  {
    name: 'promotionCodes',
    type: 'array',
    labels: {
      singular: { en: 'Promotion code', ar: 'كود العرض' },
      plural: { en: 'Promotion codes', ar: 'أكواد العروض' },
    },
    defaultValue: [],
    fields: [
      {
        name: 'code',
        type: 'text',
        required: true,
        label: { en: 'Code', ar: 'الكود' },
      },
    ],
    maxRows: 10,
    admin: {
      description: 'Normalized promotion codes; at most 10. Server-authoritative.',
    },
  },
  {
    name: 'giftCardTokenHash',
    type: 'text',
    label: { en: 'Gift card token hash', ar: 'هاش بطاقة الهدية' },
    admin: {
      hidden: true,
      description: 'HMAC-SHA256 of the applied gift-card code. Raw codes are never stored.',
    },
  },
  {
    name: 'quoteVersion',
    type: 'number',
    defaultValue: 1,
    label: { en: 'Quote version', ar: 'إصدار التسعير' },
    admin: {
      readOnly: true,
      description: 'Bumped whenever the server recomputes the authoritative quote.',
    },
  },
]

export const overrideStoreCarts: CollectionOverride = ({ defaultCollection }) => ({
  ...defaultCollection,
  slug: STORE_COLLECTION_SLUGS.carts as CollectionSlug,
  // Wipe the plugin-generated HTTP endpoints per §3.7. The exported server operations
  // (addItem/updateItem/removeItem/clearCart/mergeCart) remain available for signed-store use.
  endpoints: [],
  fields: [...(defaultCollection.fields ?? []), ...cartExtensionFields],
})
