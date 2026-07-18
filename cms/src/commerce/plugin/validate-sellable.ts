// Sellable validation for store-* products/variants.
//
// Plan §3.4 + §3.2 (`products.validation`). This replaces the plugin's default
// `defaultProductsValidation`, which checks `product.inventory` / `variant.inventory` — fields that
// don't exist when `inventory: false` is set (see Plan §3.4 and Wave-A correction #6). Inventory,
// reservations and the order-scoped non-negative invariant remain owned by Phase 1
// (cms/src/commerce/inventory/**), so this validator intentionally does NOT consult stock levels.
//
// What this validator DOES enforce:
//  - the operating currency was supplied;
//  - the quantity is a positive integer;
//  - the selected variant or, when no variant applies, the product itself has a price field
//    (`priceInEGP`) for the operating currency.
//
// The plugin invokes this before a transaction is created or a payment is confirmed, so a missing
// price or a malformed quantity is rejected before any write.

import type { ProductsValidation } from '@payloadcms/plugin-ecommerce/types'

export const validateStoreSellable: ProductsValidation = ({
  currency,
  product,
  quantity,
  variant,
}) => {
  if (!currency) {
    throw new Error('Currency must be provided for store sellable validation.')
  }
  if (!product) {
    throw new Error('Product must be provided for store sellable validation.')
  }
  if (!Number.isInteger(quantity) || quantity <= 0) {
    throw new Error(`Quantity must be a positive integer; received ${String(quantity)}.`)
  }

  const priceField = `priceIn${currency.toUpperCase()}`

  if (variant) {
    const v = variant as unknown as Record<string, unknown>
    if (!v[priceField]) {
      throw new Error(`Variant ${String(v.id ?? '?')} has no price in ${currency}.`)
    }
  } else {
    const p = product as unknown as Record<string, unknown>
    if (!p[priceField]) {
      throw new Error(`Product ${String(p.id ?? '?')} has no price in ${currency}.`)
    }
  }
}
