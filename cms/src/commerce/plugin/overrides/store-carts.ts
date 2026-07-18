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
//  - `selectedShippingMethod`: relationship to retained shipping-methods.
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
  {
    name: 'selectedShippingMethod',
    type: 'relationship',
    // `shipping-methods` is created by the policy lane (Plan §3.10, Wave C4). It is not registered
    // in the type union until that lane lands, so cast to CollectionSlug here; the integration owner
    // regenerates Payload types at B4 once all lanes are wired.
    relationTo: 'shipping-methods' as CollectionSlug,
    label: { en: 'Selected shipping method', ar: 'طريقة الشحن المختارة' },
  },
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
