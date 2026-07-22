// Constructed-config tests for the ecommerce plugin collection overrides (Wave B1, Plan §3.1–§3.9,
// §6.2 plugin-schema lane, §7 Commit B1).
//
// These tests DO NOT boot Payload. They build a synthetic `defaultCollection` for each override,
// invoke the override, and assert the returned CollectionConfig satisfies the plan's contracts:
//
//  - every override preserves default plugin fields AND hooks (asserts we spread
//    `defaultCollection.fields` and `defaultCollection.hooks`);
//  - each extension field appears EXACTLY once;
//  - every resulting slug equals its `store-*` value (and customers stays `customers`);
//  - no override re-adds an `inventory` field (the full `inventory: false` is wired by the
//    integration owner at B4);
//  - the carts override wipes the plugin's HTTP `endpoints` array per §3.7;
//  - `STORE_COLLECTION_SLUGS` and `EGP` match the plan exactly;
//  - the seven `commercePluginAccess` functions behave per §3.2 (admin gates, customer gate,
//    published-status filter, public deny for anonymous);
//  - `validateStoreSellable` enforces currency/quantity/price and skips stock (Phase 1 owns stock).

import assert from 'node:assert/strict'
import test from 'node:test'

import type { CollectionConfig, Field } from 'payload'

import { EGP } from '../src/commerce/plugin/currency'
import { STORE_COLLECTION_SLUGS } from '../src/commerce/plugin/slugs'
import {
  adminOnlyFieldAccess,
  adminOrPublishedStatus,
  commercePluginAccess,
  isCommerceAdminForTenant,
  isCustomer,
  isDocumentOwner,
  isAuthenticated,
  isAdmin,
  publicAccess,
} from '../src/commerce/plugin/access'
import { validateStoreSellable } from '../src/commerce/plugin/validate-sellable'
import { overrideStoreProducts, productExtensionFields, defaultPriceEnabledTrue } from '../src/commerce/plugin/overrides/store-products'
import { overrideStoreVariants, variantExtensionFields } from '../src/commerce/plugin/overrides/store-variants'
import { overrideStoreVariantTypes } from '../src/commerce/plugin/overrides/store-variant-types'
import { overrideStoreVariantOptions } from '../src/commerce/plugin/overrides/store-variant-options'
import { overrideStoreCarts, cartExtensionFields } from '../src/commerce/plugin/overrides/store-carts'
import { overrideStoreAddresses } from '../src/commerce/plugin/overrides/store-addresses'
import { overrideStoreOrders, orderExtensionFields } from '../src/commerce/plugin/overrides/store-orders'
import { overrideStoreTransactions, transactionExtensionFields } from '../src/commerce/plugin/overrides/store-transactions'

// ──────────────────────────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────────────────────────

const DEFAULT_MARKER_FIELD = 'pluginDefaultMarker'
const DEFAULT_INVENTORY_FIELD = 'inventory' // simulates inventory:true (B4 sets it to false)

function makeDefaultCollection(slug: string, extra: Partial<CollectionConfig> = {}): CollectionConfig {
  return {
    slug,
    fields: [
      { name: DEFAULT_MARKER_FIELD, type: 'text' } as Field,
      { name: DEFAULT_INVENTORY_FIELD, type: 'number' } as Field,
    ],
    hooks: {
      beforeChange: [(): void => undefined],
      afterRead: [(): void => undefined],
    },
    endpoints: [
      {
        path: '/plugin-default',
        method: 'post',
        handler: (() => new Response('ok')) as never,
      },
    ],
    access: {
      create: () => true,
      read: () => true,
      update: () => true,
      delete: () => true,
    },
    ...extra,
  } as CollectionConfig
}

function fieldNames(fields: Field[] | undefined): string[] {
  return (fields ?? [])
    .map((f) => ('name' in f && typeof f.name === 'string' ? f.name : ''))
    .filter((n) => n !== '')
}

function countName(fields: Field[] | undefined, name: string): number {
  return fieldNames(fields).filter((n) => n === name).length
}

// Field names contributed by the override's extension list (i.e. NOT present on the default).
function extensionNames(result: CollectionConfig, defaultFields: Field[]): string[] {
  const defaults = new Set(fieldNames(defaultFields))
  return fieldNames(result.fields).filter((n) => !defaults.has(n))
}

// ──────────────────────────────────────────────────────────────────────────────────────────────
// 1. Permanent slug map + EGP currency (Plan §3.1, §3.3)
// ──────────────────────────────────────────────────────────────────────────────────────────────

test('STORE_COLLECTION_SLUGS pins every permanent slug per §3.1, including customers', () => {
  assert.equal(STORE_COLLECTION_SLUGS.products, 'store-products')
  assert.equal(STORE_COLLECTION_SLUGS.variants, 'store-variants')
  assert.equal(STORE_COLLECTION_SLUGS.variantTypes, 'store-variant-types')
  assert.equal(STORE_COLLECTION_SLUGS.variantOptions, 'store-variant-options')
  assert.equal(STORE_COLLECTION_SLUGS.carts, 'store-carts')
  assert.equal(STORE_COLLECTION_SLUGS.addresses, 'store-addresses')
  assert.equal(STORE_COLLECTION_SLUGS.orders, 'store-orders')
  assert.equal(STORE_COLLECTION_SLUGS.transactions, 'store-transactions')
  // customers stays on the existing application slug (the plugin only needs to reference it).
  assert.equal(STORE_COLLECTION_SLUGS.customers, 'customers')
})

test('EGP currency matches the Plan §3.3 object exactly', () => {
  assert.deepEqual(EGP, {
    code: 'EGP',
    decimals: 2,
    label: 'Egyptian Pound',
    symbol: 'E£',
    symbolDisplay: 'symbol',
  })
})

// ──────────────────────────────────────────────────────────────────────────────────────────────
// 2. Every override: preserves defaults, sets slug, appends each extension field exactly once,
//    and does NOT re-add an inventory field.
// ──────────────────────────────────────────────────────────────────────────────────────────────

type OverrideFn = (args: { defaultCollection: CollectionConfig }) => CollectionConfig

function runOverride(fn: OverrideFn, defaults: CollectionConfig): CollectionConfig {
  // The plugin's `CollectionOverride` type is `(args) => CollectionConfig | Promise<CollectionConfig>`.
  // Every override in this lane is synchronous, so we cast the union to the sync branch.
  return fn({ defaultCollection: defaults }) as CollectionConfig
}

function assertOverrideContract(
  name: string,
  overrideFn: OverrideFn,
  expectedSlug: string,
  extensionFields: Field[],
): void {
  const defaults = makeDefaultCollection('plugin-default-slug')
  const result = runOverride(overrideFn, defaults)

  test(`${name}: returns the permanent slug ${expectedSlug}`, () => {
    assert.equal(result.slug, expectedSlug)
  })

  test(`${name}: preserves ALL default fields (spread)`, () => {
    for (const def of defaults.fields ?? []) {
      const defName = 'name' in def && typeof def.name === 'string' ? def.name : null
      if (defName === null) continue
      assert.equal(
        countName(result.fields, defName),
        countName(defaults.fields, defName),
        `default field ${defName} must be preserved`,
      )
    }
  })

  test(`${name}: preserves default hooks (spread; overrides may append)`, () => {
    // Defaults must be preserved (not dropped) by the spread. An override may legitimately APPEND its
    // own hook (e.g. store-orders' transition guard), so deepEqual against defaults would be too strict.
    const d = (defaults.hooks ?? {}) as Record<string, unknown>
    const r = (result.hooks ?? {}) as Record<string, unknown>
    for (const key of Object.keys(d)) {
      const defArr = d[key]
      const resArr = r[key]
      if (Array.isArray(defArr)) {
        for (const h of defArr) {
          assert.ok(Array.isArray(resArr) && resArr.includes(h), `default ${key} hook must be preserved`)
        }
      }
    }
  })

  test(`${name}: preserves default access (spread)`, () => {
    assert.ok(result.access, 'access block must be present')
    // access functions are preserved by reference
    assert.equal(result.access, defaults.access)
  })

  test(`${name}: appends each extension field EXACTLY once`, () => {
    for (const ext of extensionFields) {
      const extName = 'name' in ext && typeof ext.name === 'string' ? ext.name : null
      if (extName === null) continue
      assert.equal(countName(result.fields, extName), 1, `extension ${extName} must appear exactly once`)
    }
  })

  test(`${name}: extension list contains NO inventory field (B4 sets inventory:false)`, () => {
    const ext = extensionNames(result, defaults.fields ?? [])
    assert.ok(!ext.includes('inventory'), `extension must not add an inventory field; got: ${ext.join(', ')}`)
  })

  test(`${name}: total field count = default count + extension count (no duplicates, no drops)`, () => {
    const expected = (defaults.fields ?? []).length + extensionFields.length
    assert.equal((result.fields ?? []).length, expected)
  })
}

assertOverrideContract(
  'store-products',
  overrideStoreProducts as OverrideFn,
  'store-products',
  productExtensionFields,
)
assertOverrideContract(
  'store-variants',
  overrideStoreVariants as OverrideFn,
  'store-variants',
  variantExtensionFields,
)
assertOverrideContract('store-variant-types', overrideStoreVariantTypes as OverrideFn, 'store-variant-types', [])
assertOverrideContract('store-variant-options', overrideStoreVariantOptions as OverrideFn, 'store-variant-options', [])
assertOverrideContract(
  'store-carts',
  overrideStoreCarts as OverrideFn,
  'store-carts',
  cartExtensionFields,
)
assertOverrideContract('store-addresses', overrideStoreAddresses as OverrideFn, 'store-addresses', [])
assertOverrideContract(
  'store-orders',
  overrideStoreOrders as OverrideFn,
  'store-orders',
  orderExtensionFields,
)
assertOverrideContract(
  'store-transactions',
  overrideStoreTransactions as OverrideFn,
  'store-transactions',
  transactionExtensionFields,
)

// ──────────────────────────────────────────────────────────────────────────────────────────────
// 3. Carts override wipes the plugin-generated HTTP endpoints array (Plan §3.7).
// ──────────────────────────────────────────────────────────────────────────────────────────────

test('store-carts override sets endpoints to an empty array per §3.7', () => {
  const defaults = makeDefaultCollection('carts', {
    endpoints: [
      { path: '/add-item', method: 'post', handler: (() => new Response('ok')) as never },
      { path: '/update-item', method: 'patch', handler: (() => new Response('ok')) as never },
      { path: '/remove-item', method: 'delete', handler: (() => new Response('ok')) as never },
      { path: '/clear', method: 'post', handler: (() => new Response('ok')) as never },
      { path: '/merge', method: 'post', handler: (() => new Response('ok')) as never },
    ],
  })
  const result = runOverride(overrideStoreCarts as OverrideFn, defaults)
  assert.deepEqual(result.endpoints, [])
})

test('store-carts wipe does not strip endpoints from other overrides (orders keeps default endpoints)', () => {
  const ordersDefault = makeDefaultCollection('orders', {
    endpoints: [{ path: '/orders-default', method: 'get', handler: (() => new Response('ok')) as never }],
  })
  const result = runOverride(overrideStoreOrders as OverrideFn, ordersDefault)
  const endpoints = (result.endpoints ?? []) as unknown[]
  assert.equal(endpoints.length, 1)
})

// ──────────────────────────────────────────────────────────────────────────────────────────────
// 4. commercePluginAccess — Plan §3.2.
//    Anonymous users never get `true`; admins do; customer/published-status gates work.
// ──────────────────────────────────────────────────────────────────────────────────────────────

const anonReq = { user: null } as unknown as Parameters<typeof publicAccess>[0]['req']
const superAdminReq = {
  user: { id: 1, roles: ['super-admin'], tenants: [] },
} as unknown as Parameters<typeof publicAccess>[0]['req']

const tenantEditor = {
  id: 10,
  roles: ['editor'],
  tenants: [{ tenant: 5, commercePermissions: ['orders.read'] }],
}

const tenantAdmin = {
  id: 11,
  roles: ['admin'],
  tenants: [{ tenant: 5, commercePermissions: ['catalog.manage'] }],
}

test('isCommerceAdminForTenant: null user → false', () => {
  assert.equal(isCommerceAdminForTenant(null, 5), false)
})

test('isCommerceAdminForTenant: super-admin → true regardless of tenant', () => {
  assert.equal(isCommerceAdminForTenant({ roles: ['super-admin'], tenants: [] }, 5), true)
})

test('isCommerceAdminForTenant: editor with no manage permission → false', () => {
  assert.equal(isCommerceAdminForTenant(tenantEditor, 5), false)
})

test('isCommerceAdminForTenant: tenant admin with a manage permission → true', () => {
  assert.equal(isCommerceAdminForTenant(tenantAdmin, 5), true)
})

test('isCommerceAdminForTenant: wrong tenant → false', () => {
  assert.equal(isCommerceAdminForTenant(tenantAdmin, 999), false)
})

test('isCommerceAdminForTenant: null tenant → false for non-super-admin', () => {
  assert.equal(isCommerceAdminForTenant(tenantAdmin, null), false)
})

test('adminOnlyFieldAccess: anonymous → false', () => {
  assert.equal(adminOnlyFieldAccess({ req: anonReq } as never), false)
})

test('adminOnlyFieldAccess: super-admin → true', () => {
  assert.equal(adminOnlyFieldAccess({ req: superAdminReq } as never), true)
})

test('isAdmin: anonymous → false; super-admin → true', () => {
  assert.equal(isAdmin({ req: anonReq } as never), false)
  assert.equal(isAdmin({ req: superAdminReq } as never), true)
})

test('adminOrPublishedStatus: super-admin → true (bypasses published filter)', () => {
  assert.equal(adminOrPublishedStatus({ req: superAdminReq } as never), true)
})

test('adminOrPublishedStatus: anonymous → Where filter scoping to published', () => {
  const r = adminOrPublishedStatus({ req: anonReq } as never)
  assert.notEqual(r, true, 'must not grant unrestricted access to anonymous')
  assert.deepEqual(r, { _status: { equals: 'published' } })
})

test('isAuthenticated: anonymous → false; any user → true', () => {
  assert.equal(isAuthenticated({ req: anonReq } as never), false)
  assert.equal(isAuthenticated({ req: superAdminReq } as never), true)
})

test('isCustomer: anonymous → false; staff User → false; customer (collection=customers) → true', () => {
  // After NM20, isCustomer checks user.collection === 'customers' (not the absence-of-roles
  // heuristic, which misclassified staff Users with empty roles as customers). The customer fixture
  // MUST carry collection: 'customers' to be recognized.
  const customerReq = {
    user: { id: 42, email: 'c@example.com', collection: 'customers' },
  } as unknown as Parameters<typeof isCustomer>[0]['req']
  assert.equal(isCustomer({ req: anonReq } as never), false)
  assert.equal(isCustomer({ req: superAdminReq } as never), false)
  assert.equal(isCustomer({ req: customerReq } as never), true)
})

test('isDocumentOwner: super-admin → true', () => {
  assert.equal(isDocumentOwner({ req: superAdminReq } as never), true)
})

test('isDocumentOwner: anonymous → false', () => {
  assert.equal(isDocumentOwner({ req: anonReq } as never), false)
})

test('isDocumentOwner: non-admin authenticated customer → Where filter on customer.id', () => {
  const customerReq = {
    user: { id: 42, email: 'c@example.com' },
  } as unknown as Parameters<typeof isDocumentOwner>[0]['req']
  const r = isDocumentOwner({ req: customerReq } as never)
  assert.deepEqual(r, { customer: { equals: 42 } })
})

test('publicAccess: anonymous returns a Where filter, never `true` (no create/update/delete grant)', () => {
  const r = publicAccess({ req: anonReq } as never)
  assert.notEqual(r, true, 'publicAccess must not return true for anonymous')
  assert.deepEqual(r, { _status: { equals: 'published' } })
})

test('publicAccess: super-admin → true', () => {
  assert.equal(publicAccess({ req: superAdminReq } as never), true)
})

test('commercePluginAccess bundles all 7 functions', () => {
  const keys = Object.keys(commercePluginAccess).sort()
  assert.deepEqual(
    keys,
    [
      'adminOnlyFieldAccess',
      'adminOrPublishedStatus',
      'isAdmin',
      'isAuthenticated',
      'isCustomer',
      'isDocumentOwner',
      'publicAccess',
    ].sort(),
  )
})

// ──────────────────────────────────────────────────────────────────────────────────────────────
// 5. validateStoreSellable — Plan §3.4 + §3.2.
// ──────────────────────────────────────────────────────────────────────────────────────────────

test('validateStoreSellable: missing currency throws', () => {
  assert.throws(
    () =>
      validateStoreSellable({
        currency: undefined,
        product: { id: 1, priceInEGP: 100 } as never,
        quantity: 1,
      }),
    /Currency must be provided/,
  )
})

test('validateStoreSellable: missing product throws', () => {
  assert.throws(
    () =>
      validateStoreSellable({
        currency: 'EGP',
        product: undefined as never,
        quantity: 1,
      }),
    /Product must be provided/,
  )
})

test('validateStoreSellable: non-positive or non-integer quantity throws', () => {
  assert.throws(
    () =>
      validateStoreSellable({
        currency: 'EGP',
        product: { id: 1, priceInEGP: 100 } as never,
        quantity: 0,
      }),
    /Quantity must be a positive integer/,
  )
  assert.throws(
    () =>
      validateStoreSellable({
        currency: 'EGP',
        product: { id: 1, priceInEGP: 100 } as never,
        quantity: 1.5,
      }),
    /Quantity must be a positive integer/,
  )
})

test('validateStoreSellable: product without price in currency throws', () => {
  assert.throws(
    () =>
      validateStoreSellable({
        currency: 'EGP',
        product: { id: 1 } as never,
        quantity: 1,
      }),
    /has no price in EGP/,
  )
})

test('validateStoreSellable: variant without price in currency throws', () => {
  assert.throws(
    () =>
      validateStoreSellable({
        currency: 'EGP',
        product: { id: 1, priceInEGP: 100 } as never,
        quantity: 1,
        variant: { id: 9 } as never,
      }),
    /Variant 9 has no price in EGP/,
  )
})

test('validateStoreSellable: valid product passes; valid variant passes; stock is NOT consulted', () => {
  // Stock intentionally not checked — Phase 1 owns inventory. Even inventory:0 should pass here.
  assert.doesNotThrow(() =>
    validateStoreSellable({
      currency: 'EGP',
      product: { id: 1, priceInEGP: 100, inventory: 0 } as never,
      quantity: 5,
    }),
  )
  assert.doesNotThrow(() =>
    validateStoreSellable({
      currency: 'EGP',
      product: { id: 1, priceInEGP: 100 } as never,
      quantity: 2,
      variant: { id: 9, priceInEGP: 50, inventory: 0 } as never,
    }),
  )
})

// ──────────────────────────────────────────────────────────────────────────────────────────────
// 6. Plan §3.4/§3.5 spot-checks: extension field shapes are configured as required.
// ──────────────────────────────────────────────────────────────────────────────────────────────

test('store-products extension includes slug(required,indexed), sku(indexed), trackInventory(checkbox,default true), taxClass(required select), taxBps(0..10000), images(media hasMany), legacyProductId(hidden,readOnly)', () => {
  const byName = new Map<string, Field>()
  for (const f of productExtensionFields) {
    if ('name' in f && typeof f.name === 'string') byName.set(f.name, f)
  }

  // priceInEGPEnabled is NOT in productExtensionFields — it is mutated onto the plugin's fields
  // by defaultPriceEnabledTrue() at override time (re-declaring collides with the plugin's copy).
  // The regression guard for the "can't add price" bug lives in the dedicated test below.

  const slug = byName.get('slug') as Field & { required?: boolean; index?: boolean }
  assert.ok(slug, 'slug field exists')
  assert.equal(slug.required, true)
  assert.equal(slug.index, true)

  const sku = byName.get('sku') as Field & { index?: boolean; required?: boolean }
  assert.ok(sku)
  assert.equal(sku.index, true)
  assert.notEqual(sku.required, true, 'product sku is nullable for variant products')

  const track = byName.get('trackInventory') as Field & { type: string; defaultValue?: boolean }
  assert.equal(track.type, 'checkbox')
  assert.equal(track.defaultValue, true)

  const taxClass = byName.get('taxClass') as unknown as {
    type: string
    required?: boolean
    options?: Array<{ value: string }>
  }
  assert.equal(taxClass.type, 'select')
  assert.equal(taxClass.required, true)
  const taxValues = (taxClass.options ?? []).map((o) => o.value).sort()
  assert.deepEqual(taxValues, ['exempt', 'reduced', 'standard', 'zero'])

  const taxBps = byName.get('taxBps') as Field & { type: string; min?: number; max?: number }
  assert.equal(taxBps.type, 'number')
  assert.equal(taxBps.min, 0)
  assert.equal(taxBps.max, 10000)

  const images = byName.get('images') as Field & {
    type: string
    relationTo?: string
    hasMany?: boolean
  }
  assert.equal(images.type, 'relationship')
  assert.equal(images.relationTo, 'media')
  assert.equal(images.hasMany, true)

  const legacy = byName.get('legacyProductId') as Field & {
    type: string
    index?: boolean
    admin?: { hidden?: boolean; readOnly?: boolean }
  }
  assert.equal(legacy.type, 'number')
  assert.equal(legacy.index, true)
  assert.equal(legacy.admin?.hidden, true)
  assert.equal(legacy.admin?.readOnly, true)
})

test('store-variants extension includes sku(required,indexed), legacyVariantKey(hidden,readOnly,indexed), images(media hasMany)', () => {
  const byName = new Map<string, Field>()
  for (const f of variantExtensionFields) {
    if ('name' in f && typeof f.name === 'string') byName.set(f.name, f)
  }

  // priceInEGPEnabled is NOT in variantExtensionFields — mutated onto plugin fields by
  // defaultPriceEnabledTrue() at override time (same as products). Guard lives below.

  const sku = byName.get('sku') as Field & { required?: boolean; index?: boolean }
  assert.ok(sku)
  assert.equal(sku.required, true)
  assert.equal(sku.index, true)

  const legacy = byName.get('legacyVariantKey') as Field & {
    index?: boolean
    admin?: { hidden?: boolean; readOnly?: boolean }
  }
  assert.equal(legacy.index, true)
  assert.equal(legacy.admin?.hidden, true)
  assert.equal(legacy.admin?.readOnly, true)

  const images = byName.get('images') as Field & {
    type: string
    relationTo?: string
    hasMany?: boolean
  }
  assert.equal(images.type, 'relationship')
  assert.equal(images.relationTo, 'media')
  assert.equal(images.hasMany, true)
})

test('store-carts extension includes promotionCodes(maxRows 10) and giftCardTokenHash', () => {
  const byName = new Map<string, Field>()
  for (const f of cartExtensionFields) {
    if ('name' in f && typeof f.name === 'string') byName.set(f.name, f)
  }
  const promo = byName.get('promotionCodes') as Field & { type: string; maxRows?: number }
  assert.equal(promo.type, 'array')
  assert.equal(promo.maxRows, 10)
  assert.ok(byName.has('giftCardTokenHash'))
  assert.ok(byName.has('selectedShippingMethod'))
  assert.ok(byName.has('quoteVersion'))
})

test('store-orders extension includes every §3.8 field exactly once', () => {
  const names = fieldNames(orderExtensionFields).sort()
  const expected = [
    'amountDue',
    'billingAddress',
    'checkoutFingerprint',
    'checkoutKey',
    'customerPhone',
    'expiresAt',
    'fulfillmentState',
    'giftCardApplied',
    'legacyOrderId',
    'orderNumber',
    'paymentState',
    'placedAt',
    'providerReference',
    'quoteHash',
    'quoteSnapshot',
    'shippingPrice',
    'subtotal',
    'totalDiscount',
    'totalTax',
  ]
  assert.deepEqual(names, expected)
})

test('store-transactions extension includes every §3.9 field exactly once', () => {
  const names = fieldNames(transactionExtensionFields).sort()
  const expected = [
    'capturedAmount',
    'lastProviderEventTimestamp',
    'lastProviderStatus',
    'legacyTransactionId',
    'providerOrderReference',
    'providerTransactionId',
    'rawPayloadHash',
    'reconciliationStatus',
    'refundedAmount',
  ]
  assert.deepEqual(names, expected)
})

// ──────────────────────────────────────────────────────────────────────────────────────────────
// 7. Price-visibility regression: defaultPriceEnabledTrue mutates the plugin's price-enable
//    checkboxes to defaultValue: true so the priceInEGP input is visible by default (the bug:
//    "I can't add prices to products"). Re-declaring the field collides at sanitize, so the
//    fix mutates the plugin's existing field in place.
// ──────────────────────────────────────────────────────────────────────────────────────────────

test('defaultPriceEnabledTrue sets defaultValue:true on a top-level priceInEGPEnabled checkbox', () => {
  const fields: Field[] = [
    { name: 'name', type: 'text' },
    { name: 'priceInEGPEnabled', type: 'checkbox' } as Field,
  ]
  defaultPriceEnabledTrue(fields)
  const enable = fields[1] as { defaultValue?: boolean }
  assert.equal(enable.defaultValue, true, 'priceInEGPEnabled.defaultValue === true')
})

test('defaultPriceEnabledTrue reaches priceInEGPEnabled nested inside an unnamed group/row (plugin shape)', () => {
  // Mirror the plugin's pricesField output: unnamed group → row → [checkbox, amount].
  const fields: Field[] = [
    {
      type: 'group',
      fields: [
        {
          type: 'row',
          fields: [
            { name: 'priceInEGPEnabled', type: 'checkbox' } as Field,
            { name: 'priceInEGP', type: 'number' } as Field,
          ],
        },
      ],
    } as Field,
  ]
  defaultPriceEnabledTrue(fields)
  const nested = (fields[0] as { fields: Array<{ fields: Array<Field> }> }).fields[0].fields[0] as {
    defaultValue?: boolean
  }
  assert.equal(
    nested.defaultValue,
    true,
    'nested priceInEGPEnabled.defaultValue === true (plugin group/row recursion)',
  )
})

test('defaultPriceEnabledTrue does not touch non-price fields or non-checkbox price fields', () => {
  const fields: Field[] = [
    { name: 'name', type: 'text' },
    { name: 'priceInEGP', type: 'number' } as Field, // amount, not the enable checkbox
    { name: 'priceInUSD', type: 'number' } as Field,
  ]
  defaultPriceEnabledTrue(fields)
  assert.equal(
    (fields[1] as { defaultValue?: boolean }).defaultValue,
    undefined,
    'priceInEGP amount field untouched',
  )
  assert.equal(
    (fields[2] as { defaultValue?: boolean }).defaultValue,
    undefined,
    'priceInUSD field untouched',
  )
})
