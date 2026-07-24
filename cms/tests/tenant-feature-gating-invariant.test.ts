// Invariant: every collection slug registered under `multiTenantPlugin({ collections })` in
// payload.config.ts MUST either be governed by `TENANT_COLLECTION_FEATURES` (so the per-tenant
// capability flag actually gates it) or appear in `INTENTIONALLY_UNGATED_COLLECTIONS` with a
// documented platform-wide reason.
//
// Why this test exists: the gating map at `TENANT_COLLECTION_FEATURES` has drifted from the
// multi-tenant collections list three times in this repo's history — first when legacy commerce
// slugs were added, again when plugin-first `store-*` slugs shipped (Wave B4), and a third time
// when the policy collections shipped (Wave C4). Each drift silently meant the `commerce` feature
// flag stopped governing a set of tenant-owned collections, leaving them editable by tenant-admins
// of non-commerce tenants and hiding the `tenant` ownership column in super-admin aggregate lists.
//
// This test makes the source of truth (the multi-tenant plugin's `collections` argument) the
// referee: any new tenant-owned collection MUST be added to one of the two lists. Failures here are
// a signal to update the gate map when introducing a tenant-scoped collection, not to weaken the test.

import assert from 'node:assert/strict'
import test from 'node:test'

import configPromise from '../src/payload.config'
import {
  INTENTIONALLY_UNGATED_COLLECTIONS,
  TENANT_COLLECTION_FEATURES,
} from '../src/plugins/tenantFeatureAccess'

// The multi-tenant plugin's `collections` argument is not retained on the sanitized config —
// re-derive the set of tenant-scoped slugs by finding every collection that has the plugin-injected
// `tenant` relationship field. This is exactly what the multi-tenant plugin injects and what
// `tenantFeatureAccessPlugin` looks for when re-enabling the tenant list column.
async function tenantScopedSlugs(): Promise<Set<string>> {
  const config = await configPromise
  const slugs = new Set<string>()
  for (const collection of config.collections ?? []) {
    const hasTenantRelationship = (collection.fields ?? []).some(
      (f) => 'name' in f && (f as { name?: string }).name === 'tenant' && (f as { type?: string }).type === 'relationship',
    )
    if (hasTenantRelationship) slugs.add(collection.slug)
  }
  return slugs
}

test('every tenant-scoped collection is governed by the feature gate or explicitly ungated', async () => {
  const scoped = await tenantScopedSlugs()
  const governed = new Set<string>(Object.keys(TENANT_COLLECTION_FEATURES))
  const ungated = new Set<string>(INTENTIONALLY_UNGATED_COLLECTIONS)

  const unaccounted: string[] = []
  for (const slug of scoped) {
    if (!governed.has(slug) && !ungated.has(slug)) unaccounted.push(slug)
  }

  assert.deepEqual(
    unaccounted,
    [],
    `Tenant-scoped collections missing from both TENANT_COLLECTION_FEATURES and INTENTIONALLY_UNGATED_COLLECTIONS.
    Each of these has a 'tenant' relationship (so it's tenant-owned) but is not governed by any tenant
    feature flag, which means the flag silently fails to gate it. Add each slug to
    TENANT_COLLECTION_FEATURES (preferred) or to INTENTIONALLY_UNGATED_COLLECTIONS with a documented
    platform-wide reason. Missing: ${unaccounted.join(', ')}`,
  )
})

test('a slug is not listed in both the feature gate and the ungate allowlist (contradiction)', () => {
  const governed = new Set<string>(Object.keys(TENANT_COLLECTION_FEATURES))
  const ungated = new Set<string>(INTENTIONALLY_UNGATED_COLLECTIONS)
  const overlap = [...governed].filter((slug) => ungated.has(slug))
  assert.deepEqual(
    overlap,
    [],
    `Slugs appear in both TENANT_COLLECTION_FEATURES and INTENTIONALLY_UNGATED_COLLECTIONS, which is
    contradictory: a collection is either governed by the feature gate or intentionally platform-wide.
    Contradictions: ${overlap.join(', ')}`,
  )
})

test('the commerce feature actually governs every live commerce collection', async () => {
  // Direct guard against the specific regression this fix addresses: the `commerce` tenant feature
  // must gate the plugin-first `store-*` surface AND the policy collections, not only the legacy
  // slugs. If any of these slip out of the map, the per-tenant toggle stops working for them.
  const requiredCommerceSlugs = [
    'store-products',
    'store-variants',
    'store-variant-types',
    'store-variant-options',
    'store-carts',
    'store-addresses',
    'store-orders',
    'store-transactions',
    'tax-zones',
    'tax-rates',
    'shipping-zones',
    'shipping-methods',
    'promotions',
    'promotion-redemptions',
    'gift-cards',
    'gift-card-ledger',
  ]
  for (const slug of requiredCommerceSlugs) {
    const policy = TENANT_COLLECTION_FEATURES[slug as keyof typeof TENANT_COLLECTION_FEATURES] as
      | { features?: unknown; tenantScoped?: boolean }
      | undefined
    assert.ok(policy, `${slug} must be in TENANT_COLLECTION_FEATURES`)
    assert.equal(policy!.features, 'commerce', `${slug} must be gated on the 'commerce' feature`)
    assert.equal(policy!.tenantScoped, true, `${slug} must be tenant-scoped`)
  }
})

test('plugin-owned commerce models have no legacy duplicate collections', async () => {
  const config = await configPromise
  const slugs = new Set<string>((config.collections ?? []).map((collection) => collection.slug))

  for (const slug of ['products', 'carts', 'orders', 'transactions']) {
    assert.equal(slugs.has(slug), false, `${slug} duplicates its plugin-owned store-* collection`)
  }
})
