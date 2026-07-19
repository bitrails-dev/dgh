// Focused unit tests for the plugin-first storefront quote helpers (Wave E3 continuation, §3.7).
// Drives quoteStoreCart / quoteStoreItems with a fake QuoteCartLoader + fake Payload — no DB. Covers
// the shape mapping, the empty-cart / not-found / failure error paths, and the items validation +
// product_not_found path. The authoritative engine (computeQuote) and the real Payload loader are
// exercised by their own suites; here we validate the helper wiring that turns a cartId / items list
// into the storefront quote shape the Astro proxy forwards.

import assert from 'node:assert/strict'
import test from 'node:test'

import type { Payload } from 'payload'
import type { QuoteCartLine, QuoteCartLoader } from '../src/commerce/policies/quote'
import type { ResolvedSellable } from '../src/commerce/inventory/sku-resolution'
import { quoteStoreCart, quoteStoreItems } from '../src/commerce/store/quote-plugin'

const TENANT = 1
const CART_ID = 'cart-1'

// A minimal fake loader: loadCartLines is configurable; every policy method returns empty / defaults
// so quoteCart + computeQuote run without a DB. loadTenantTaxSettings returns EGP/exclusive.
function fakeLoader(lines: QuoteCartLine[] | null): QuoteCartLoader {
  return {
    loadCartLines: async () => lines,
    loadTaxZones: async () => [],
    loadTaxRates: async () => [],
    loadShippingZones: async () => [],
    loadShippingMethods: async () => [],
    loadPromotions: async () => [],
    loadPromotionQuotas: async () => [],
    loadTenantTaxSettings: async () => ({ currency: 'EGP', taxMode: 'exclusive' as const }),
    loadGiftCard: async () => null,
    resolveCustomerIdentityHash: async () => 'identity-hash',
    resolveNow: async () => 1_700_000_000_000,
    hashGiftCardCode: async () => 'code-hash',
  }
}

// A fake Payload whose find() routes by collection: commerce-settings → settings doc; store-products
// → a priced product; store-variants → a priced variant. Used by loadCommerceSettings + readSellablePrice.
function fakePayload(overrides: {
  settings?: boolean
  product?: { id: number | string; priceInEGP?: number; taxClass?: string } | null
  variant?: { id: number | string; priceInEGP?: number; parent?: number | string } | null
} = {}): Payload {
  const settings = overrides.settings !== false
  return {
    find: async (args: { collection: string }) => {
      if (args.collection === 'commerce-settings') {
        return { docs: settings ? [{ currency: 'EGP', taxMode: 'exclusive' }] : [] } as never
      }
      if (args.collection === 'store-products') {
        return { docs: overrides.product == null ? [] : [overrides.product] } as never
      }
      if (args.collection === 'store-variants') {
        return { docs: overrides.variant == null ? [] : [overrides.variant] } as never
      }
      return { docs: [] } as never
    },
  } as unknown as Payload
}

const LINE: QuoteCartLine = {
  key: 'SKU-1',
  sku: 'SKU-1',
  productId: 100,
  variantId: null,
  quantity: 2,
  unitPriceMinor: 5000, // 50.00 EGP
  taxClass: 'standard',
}

// ── quoteStoreCart ────────────────────────────────────────────────────────────────────────────

test('quoteStoreCart: empty cartId → 404 cart_not_found', async () => {
  const r = await quoteStoreCart(fakePayload(), TENANT, undefined, { loader: fakeLoader([]) })
  assert.equal(r.ok, false)
  if (!r.ok) {
    assert.equal(r.status, 404)
    assert.equal(r.code, 'cart_not_found')
  }
})

test('quoteStoreCart: loader returns null (cart absent for tenant) → 404 cart_not_found', async () => {
  const r = await quoteStoreCart(fakePayload(), TENANT, CART_ID, { loader: fakeLoader(null) })
  assert.equal(r.ok, false)
  if (!r.ok) assert.equal(r.code, 'cart_not_found')
})

test('quoteStoreCart: priced cart → ok with the storefront shape + EGP currency', async () => {
  const r = await quoteStoreCart(fakePayload(), TENANT, CART_ID, { loader: fakeLoader([LINE]) })
  assert.equal(r.ok, true)
  if (r.ok) {
    assert.equal(r.quote.currency, 'EGP')
    // 2 × 5000 minor = 10000 minor merchandise subtotal (no tax zone → 0 tax; no shipping).
    assert.equal(r.quote.subtotal, 10000)
    assert.equal(r.quote.amountDue, 10000)
    assert.equal(typeof r.quote.quoteHash, 'string')
    assert.equal(r.snapshot.lines.length, 1)
  }
})

test('quoteStoreCart: a non-not-found loader error → 500 quote_failed', async () => {
  const loader = fakeLoader([LINE])
  loader.loadCartLines = async () => {
    throw new Error('database exploded')
  }
  const r = await quoteStoreCart(fakePayload(), TENANT, CART_ID, { loader })
  assert.equal(r.ok, false)
  if (!r.ok) {
    assert.equal(r.status, 500)
    assert.equal(r.code, 'quote_failed')
  }
})

// ── quoteStoreItems ───────────────────────────────────────────────────────────────────────────

const SELLABLE: ResolvedSellable = { kind: 'product', sku: 'SKU-1', productId: 100, variantId: null, trackInventory: true }

test('quoteStoreItems: empty items → 400 invalid_items', async () => {
  const r = await quoteStoreItems(fakePayload(), TENANT, [], {
    loader: fakeLoader([]),
    resolveSellable: async () => ({ ok: true, sellable: SELLABLE }),
  })
  assert.equal(r.ok, false)
  if (!r.ok) {
    assert.equal(r.status, 400)
    assert.equal(r.code, 'invalid_items')
  }
})

test('quoteStoreItems: unresolved SKU → 422 product_not_found', async () => {
  const r = await quoteStoreItems(fakePayload(), TENANT, [{ sku: 'NOPE', quantity: 1 }], {
    loader: fakeLoader([]),
    resolveSellable: async () => ({ ok: false, code: 'NOT_FOUND' }),
  })
  assert.equal(r.ok, false)
  if (!r.ok) {
    assert.equal(r.status, 422)
    assert.equal(r.code, 'product_not_found')
  }
})

test('quoteStoreItems: no commerce-settings → 503 commerce_not_configured', async () => {
  const r = await quoteStoreItems(fakePayload({ settings: false }), TENANT, [{ sku: 'SKU-1', quantity: 1 }], {
    loader: fakeLoader([]),
    resolveSellable: async () => ({ ok: true, sellable: SELLABLE }),
  })
  assert.equal(r.ok, false)
  if (!r.ok) assert.equal(r.code, 'commerce_not_configured')
})

test('quoteStoreItems: priced items → ok with the storefront shape', async () => {
  const r = await quoteStoreItems(fakePayload({ product: { id: 100, priceInEGP: 5000, taxClass: 'standard' } }), TENANT, [
    { sku: 'sku-1', quantity: 3 }, // lowercase + qty 3 exercises normalization
  ], {
    loader: fakeLoader([]),
    resolveSellable: async () => ({ ok: true, sellable: SELLABLE }),
  })
  assert.equal(r.ok, true)
  if (r.ok) {
    assert.equal(r.quote.currency, 'EGP')
    assert.equal(r.quote.subtotal, 15000) // 3 × 5000
    assert.equal(r.quote.amountDue, 15000)
    assert.equal(r.snapshot.lines.length, 1)
    assert.equal(r.snapshot.lines[0].quantity, 3)
  }
})

test('quoteStoreItems: unpriced product doc → 422 product_not_found', async () => {
  const r = await quoteStoreItems(fakePayload({ product: { id: 100 } }), TENANT, [{ sku: 'SKU-1', quantity: 1 }], {
    loader: fakeLoader([]),
    resolveSellable: async () => ({ ok: true, sellable: SELLABLE }),
  })
  assert.equal(r.ok, false)
  if (!r.ok) assert.equal(r.code, 'product_not_found')
})
