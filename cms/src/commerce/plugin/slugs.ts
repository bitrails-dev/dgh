// Permanent collision-free slugs for the Payload ecommerce plugin collections.
//
// Plan §3.1 + Wave-A correction #2. These slugs are additive to the legacy commerce tables, so the
// cutover can run side-by-side and parity checks can compare old vs. new without ambiguity.
//
// IMPORTANT: setting these in `slugMap` alone does NOT rename the generated collections — every
// override module under `overrides/` also sets `slug: 'store-<x>'` on its returned CollectionConfig.
// `slugMap` is what the plugin uses internally to rewire relationship targets between collections;
// the explicit `slug` on each CollectionConfig is what the schema actually publishes as.
//
// `customers` is the existing application collection (converted to Payload auth by Wave B2); the
// plugin only needs to know its slug so carts/orders/transactions can reference it.

export const STORE_COLLECTION_SLUGS = {
  addresses: 'store-addresses',
  carts: 'store-carts',
  customers: 'customers',
  orders: 'store-orders',
  products: 'store-products',
  transactions: 'store-transactions',
  variants: 'store-variants',
  variantTypes: 'store-variant-types',
  variantOptions: 'store-variant-options',
} as const

export type StoreCollectionSlug = (typeof STORE_COLLECTION_SLUGS)[keyof typeof STORE_COLLECTION_SLUGS]
