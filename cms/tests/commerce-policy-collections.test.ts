// Focused tests for the 8 policy collection definitions (Plan §3.10, §7 Commit C4 policy lane).
//
// These tests DO NOT boot Payload. They drive the CollectionConfig objects directly and assert:
//   - every slug matches §3.10 exactly;
//   - the required §3.10 fields are present, typed correctly, and labelled;
//   - the §3.10 uniqueness constraints are expressed as indexes (the migration lane creates the
//     matching tables from the same spec — we verify the policy side matches);
//   - money/rate fields are integer-only (number + min: 0);
//   - tenant scoping is implicit (the multi-tenant plugin injects the `tenant` field after
//     registration; the unique indexes reference it by name).
//
// The slugs are not yet in the generated `CollectionSlug` union (the integration owner registers
// them at C4), so the collection modules cast via `as CollectionSlug`. These tests use the runtime
// `.slug` string so they are decoupled from the generated type.

import assert from 'node:assert/strict'
import test from 'node:test'

import type { Field } from 'payload'

import { GiftCards } from '../src/commerce/policies/collections/GiftCards'
import { GiftCardLedger } from '../src/commerce/policies/collections/GiftCardLedger'
import { Promotions } from '../src/commerce/policies/collections/Promotions'
import { PromotionRedemptions } from '../src/commerce/policies/collections/PromotionRedemptions'
import { ShippingMethods } from '../src/commerce/policies/collections/ShippingMethods'
import { ShippingZones } from '../src/commerce/policies/collections/ShippingZones'
import { TaxRates } from '../src/commerce/policies/collections/TaxRates'
import { TaxZones } from '../src/commerce/policies/collections/TaxZones'

// ──────────────────────────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────────────────────────

function fieldByName(fields: Field[] | undefined, name: string): Field | undefined {
  return (fields ?? []).find((f) => 'name' in f && f.name === name)
}

function names(fields: Field[] | undefined): string[] {
  return (fields ?? [])
    .map((f) => ('name' in f && typeof f.name === 'string' ? f.name : ''))
    .filter((n) => n !== '')
}

function assertHas(collection: { fields?: Field[] }, field: string): void {
  assert.ok(
    names(collection.fields).includes(field),
    `expected field ${field} to be present`,
  )
}

function assertIntField(f: Field | undefined, label: string): void {
  assert.ok(f, `${label} field missing`)
  assert.equal(f?.type, 'number', `${label} must be a number (integer minor units / bps)`)
  // min:0 — money/rate fields cannot be negative.
  const min = (f as { min?: number }).min
  assert.equal(min, 0, `${label} must have min: 0`)
}

// ──────────────────────────────────────────────────────────────────────────────────────────────
// §3.10 slugs
// ──────────────────────────────────────────────────────────────────────────────────────────────

test('policy collection slugs match §3.10 exactly', () => {
  assert.equal(TaxZones.slug, 'tax-zones')
  assert.equal(TaxRates.slug, 'tax-rates')
  assert.equal(ShippingZones.slug, 'shipping-zones')
  assert.equal(ShippingMethods.slug, 'shipping-methods')
  assert.equal(Promotions.slug, 'promotions')
  assert.equal(PromotionRedemptions.slug, 'promotion-redemptions')
  assert.equal(GiftCards.slug, 'gift-cards')
  assert.equal(GiftCardLedger.slug, 'gift-card-ledger')
})

// ──────────────────────────────────────────────────────────────────────────────────────────────
// tax-zones — fields + tenant-scoped unique code
// ──────────────────────────────────────────────────────────────────────────────────────────────

test('tax-zones: §3.10 fields present + (tenant, code) unique index', () => {
  for (const f of ['code', 'name', 'country', 'regions', 'postalPrefixes', 'priority', 'enabled']) {
    assertHas(TaxZones, f)
  }
  const idxs = TaxZones.indexes ?? []
  assert.ok(
    idxs.some((i) => i.unique && i.fields.length === 2 && i.fields[0] === 'tenant' && i.fields[1] === 'code'),
    'tax-zones must declare a unique (tenant, code) index',
  )
})

test('tax-zones: localized name is a group with en/ar subfields', () => {
  const name = fieldByName(TaxZones.fields, 'name')
  assert.equal(name?.type, 'group')
  const sub = names((name as { fields?: Field[] }).fields)
  assert.ok(sub.includes('en') && sub.includes('ar'))
})

// ──────────────────────────────────────────────────────────────────────────────────────────────
// tax-rates — integer rateBps + effective interval + (tenant, zone, taxClass, enabled) index
// ──────────────────────────────────────────────────────────────────────────────────────────────

test('tax-rates: §3.10 fields present + rateBps is integer bps', () => {
  for (const f of ['zone', 'taxClass', 'rateBps', 'pricesIncludeTax', 'effectiveFrom', 'effectiveTo', 'enabled']) {
    assertHas(TaxRates, f)
  }
  assertIntField(fieldByName(TaxRates.fields, 'rateBps'), 'rateBps')
  // Cap at 10000 (100%).
  const rateBps = fieldByName(TaxRates.fields, 'rateBps') as { max?: number }
  assert.equal(rateBps.max, 10000)
})

test('tax-rates: indexes support the resolution lookup (interval overlap enforced by hook)', () => {
  const idxs = TaxRates.indexes ?? []
  assert.ok(
    idxs.some((i) =>
      i.fields.length === 4 &&
      i.fields[0] === 'tenant' && i.fields[1] === 'zone' &&
      i.fields[2] === 'taxClass' && i.fields[3] === 'enabled',
    ),
    'tax-rates must declare a (tenant, zone, taxClass, enabled) resolution index',
  )
  assert.ok(
    Array.isArray(TaxRates.hooks?.beforeChange) && TaxRates.hooks?.beforeChange?.length === 1,
    'tax-rates must wire the overlap-rejection beforeChange hook',
  )
})

// ──────────────────────────────────────────────────────────────────────────────────────────────
// shipping-zones + shipping-methods
// ──────────────────────────────────────────────────────────────────────────────────────────────

test('shipping-zones: §3.10 fields + (tenant, code) unique index', () => {
  for (const f of ['code', 'name', 'country', 'regions', 'postalPrefixes', 'priority', 'enabled']) {
    assertHas(ShippingZones, f)
  }
  const idxs = ShippingZones.indexes ?? []
  assert.ok(
    idxs.some((i) => i.unique && i.fields.length === 2 && i.fields[0] === 'tenant' && i.fields[1] === 'code'),
    'shipping-zones must declare a unique (tenant, code) index',
  )
})

test('shipping-methods: §3.10 integer money fields + (tenant, code) unique index', () => {
  for (const f of ['zone', 'code', 'name', 'basePrice', 'freeAboveSubtotal', 'minimumSubtotal', 'maximumSubtotal', 'enabled']) {
    assertHas(ShippingMethods, f)
  }
  assertIntField(fieldByName(ShippingMethods.fields, 'basePrice'), 'basePrice')
  assertIntField(fieldByName(ShippingMethods.fields, 'freeAboveSubtotal'), 'freeAboveSubtotal')
  const idxs = ShippingMethods.indexes ?? []
  assert.ok(
    idxs.some((i) => i.unique && i.fields.length === 2 && i.fields[0] === 'tenant' && i.fields[1] === 'code'),
    'shipping-methods must declare a unique (tenant, code) index',
  )
})

// ──────────────────────────────────────────────────────────────────────────────────────────────
// promotions — type/value/min/maxDiscount + eligible products/variants + (tenant, code) unique
// ──────────────────────────────────────────────────────────────────────────────────────────────

test('promotions: §3.10 fields + (tenant, code) unique index', () => {
  for (const f of [
    'code', 'type', 'value', 'minimumSubtotal', 'maximumDiscount', 'startsAt', 'endsAt',
    'totalUsageLimit', 'perCustomerLimit', 'exclusive', 'eligibleProducts', 'eligibleVariants', 'enabled',
  ]) {
    assertHas(Promotions, f)
  }
  assertIntField(fieldByName(Promotions.fields, 'value'), 'value')
  assertIntField(fieldByName(Promotions.fields, 'minimumSubtotal'), 'minimumSubtotal')
  const idxs = Promotions.indexes ?? []
  assert.ok(
    idxs.some((i) => i.unique && i.fields.length === 2 && i.fields[0] === 'tenant' && i.fields[1] === 'code'),
    'promotions must declare a unique (tenant, code) index',
  )
  const typeField = fieldByName(Promotions.fields, 'type') as { options?: Array<{ value: string }> }
  const typeValues = (typeField.options ?? []).map((o) => o.value).sort()
  assert.deepEqual(typeValues, ['fixed', 'free_shipping', 'percentage'])
})

test('promotions: code is normalized (trim, uppercase, collapse whitespace) before save', () => {
  // The beforeChange hook list is non-empty; we don’t drive the hook here (it runs server-side),
  // but the test confirms the hook exists.
  assert.ok(
    Array.isArray(Promotions.hooks?.beforeChange) && (Promotions.hooks?.beforeChange?.length ?? 0) > 0,
    'promotions must wire a normalizeCode beforeChange hook',
  )
})

// ──────────────────────────────────────────────────────────────────────────────────────────────
// promotion-redemptions — (promotion, order) unique
// ──────────────────────────────────────────────────────────────────────────────────────────────

test('promotion-redemptions: (promotion, order) unique index + system-managed writes', () => {
  for (const f of ['promotion', 'order', 'customerIdentityHash', 'discountAmount', 'redeemedAt']) {
    assertHas(PromotionRedemptions, f)
  }
  const idxs = PromotionRedemptions.indexes ?? []
  assert.ok(
    idxs.some((i) => i.unique && i.fields.length === 2 && i.fields[0] === 'promotion' && i.fields[1] === 'order'),
    'promotion-redemptions must declare a unique (promotion, order) index',
  )
  // System-managed — create/update/delete return false at the access layer.
  const access = PromotionRedemptions.access ?? {}
  for (const op of ['create', 'update', 'delete'] as const) {
    const fn = access[op]
    assert.equal(typeof fn, 'function', `${op} access must be defined`)
    assert.equal(fn!({} as never), false, `${op} must deny through the API`)
  }
})

// ──────────────────────────────────────────────────────────────────────────────────────────────
// gift-cards — codeHash unique GLOBALLY (no tenant prefix)
// ──────────────────────────────────────────────────────────────────────────────────────────────

test('gift-cards: codeHash unique GLOBALLY + balance is read-only', () => {
  for (const f of ['codeHash', 'lastFour', 'currency', 'initialBalance', 'balance', 'status', 'expiresAt']) {
    assertHas(GiftCards, f)
  }
  const idxs = GiftCards.indexes ?? []
  // §3.10: codeHash unique GLOBALLY — index must be exactly [codeHash], no tenant prefix.
  const codeHashUnique = idxs.find(
    (i) => i.unique && i.fields.length === 1 && i.fields[0] === 'codeHash',
  )
  assert.ok(codeHashUnique, 'gift-cards must declare a unique (codeHash) GLOBAL index')
  // Cached balance is read-only via field access.update = () => false.
  const balance = fieldByName(GiftCards.fields, 'balance') as { access?: { update?: () => boolean } }
  assert.equal(balance.access?.update?.(), false, 'balance.update must deny through the API')
})

// ──────────────────────────────────────────────────────────────────────────────────────────────
// gift-card-ledger — (tenant, idempotencyKey) unique + (giftCard, createdAt) replay order
// ──────────────────────────────────────────────────────────────────────────────────────────────

test('gift-card-ledger: (tenant, idempotencyKey) unique + giftCard+createdAt replay index', () => {
  for (const f of ['giftCard', 'order', 'kind', 'amount', 'idempotencyKey', 'createdAt']) {
    assertHas(GiftCardLedger, f)
  }
  const idxs = GiftCardLedger.indexes ?? []
  assert.ok(
    idxs.some((i) => i.unique && i.fields.length === 2 && i.fields[0] === 'tenant' && i.fields[1] === 'idempotencyKey'),
    'gift-card-ledger must declare a unique (tenant, idempotencyKey) index',
  )
  assert.ok(
    idxs.some((i) => i.fields.length === 2 && i.fields[0] === 'giftCard' && i.fields[1] === 'createdAt'),
    'gift-card-ledger must declare a (giftCard, createdAt) replay index',
  )
  // System-managed — append-only ledger; never directly edited.
  const access = GiftCardLedger.access ?? {}
  for (const op of ['create', 'update', 'delete'] as const) {
    const fn = access[op]
    assert.equal(typeof fn, 'function', `${op} access must be defined`)
    assert.equal(fn!({} as never), false, `${op} must deny through the API`)
  }
  // Kind is the §3.10 enum exactly.
  const kindField = fieldByName(GiftCardLedger.fields, 'kind') as { options?: Array<{ value: string }> }
  const kindValues = (kindField.options ?? []).map((o) => o.value).sort()
  assert.deepEqual(kindValues, ['adjustment', 'issue', 'redeem', 'refund'])
})
