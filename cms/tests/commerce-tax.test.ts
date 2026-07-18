import assert from 'node:assert/strict'
import test from 'node:test'

import { mostSpecific, resolveTaxBps } from '../src/commerce/tax'
import type { ResolveTaxBpsResult, TaxRate, TaxSettings } from '../src/commerce/tax'

const settings = (over: Partial<TaxSettings> = {}): TaxSettings => ({ mode: 'exclusive', ...over })

const rate = (id: string, over: Partial<TaxRate> & { taxClass: string; bps: number }): TaxRate => ({
  id,
  ...over,
})

// Defaulted resolver so each test spells out only the relevant knobs.
const resolve = (over: Partial<{
  rates: TaxRate[]
  settings: TaxSettings
  productTaxClass: string
  country: string
  region: string
  customerExempt: boolean
}>): ResolveTaxBpsResult =>
  resolveTaxBps({
    rates: [],
    settings: settings(),
    productTaxClass: 'standard',
    ...over,
  })

// --- the cascade: exact > country > class ----------------------------------

test('exact (class + country + region) beats country beats class', () => {
  const rates = [
    rate('class', { taxClass: 'standard', bps: 500 }),
    rate('country', { taxClass: 'standard', country: 'EG', bps: 1000 }),
    rate('exact', { taxClass: 'standard', country: 'EG', region: 'C', bps: 1400 }),
  ]
  const r = resolve({ rates, country: 'EG', region: 'C' })
  assert.equal(r.bps, 1400)
  assert.equal(r.rate?.id, 'exact')
})

test('country-only wins when the input has no region (exact rate does not apply)', () => {
  const rates = [
    rate('class', { taxClass: 'standard', bps: 500 }),
    rate('country', { taxClass: 'standard', country: 'EG', bps: 1000 }),
    rate('exact', { taxClass: 'standard', country: 'EG', region: 'C', bps: 1400 }),
  ]
  const r = resolve({ rates, country: 'EG' }) // no region
  assert.equal(r.bps, 1000)
  assert.equal(r.rate?.id, 'country')
})

test('class-only wins when the input has no country (jurisdiction rates do not apply)', () => {
  const rates = [
    rate('class', { taxClass: 'standard', bps: 500 }),
    rate('country', { taxClass: 'standard', country: 'EG', bps: 1000 }),
  ]
  assert.equal(resolve({ rates }).bps, 500)
  assert.equal(resolve({ rates }).rate?.id, 'class')
})

test('a region mismatch falls back to the country rate', () => {
  const rates = [
    rate('country', { taxClass: 'standard', country: 'EG', bps: 1000 }),
    rate('exact', { taxClass: 'standard', country: 'EG', region: 'C', bps: 1400 }),
  ]
  const r = resolve({ rates, country: 'EG', region: 'Other' })
  assert.equal(r.bps, 1000)
  assert.equal(r.rate?.id, 'country')
})

test('a rate for another tax class never applies', () => {
  const rates = [rate('food', { taxClass: 'food', country: 'EG', bps: 0 })]
  assert.equal(resolve({ rates, productTaxClass: 'standard', country: 'EG' }).rate, undefined)
})

// --- defaultBps fallback + unmatched ---------------------------------------

test('defaultBps applies when no rate matches', () => {
  const r = resolve({ rates: [], settings: settings({ defaultBps: 300 }), country: 'US' })
  assert.equal(r.bps, 300)
  assert.equal(r.rate, undefined)
})

test('unmatched with no default -> bps 0', () => {
  const r = resolve({ rates: [], country: 'US' })
  assert.equal(r.bps, 0)
  assert.equal(r.inclusive, false) // settings.mode exclusive
  assert.equal(r.rate, undefined)
})

// --- customerExempt --------------------------------------------------------

test('customerExempt -> 0 with the exempt flag, even when a rate would match', () => {
  const r = resolve({
    rates: [rate('exact', { taxClass: 'standard', country: 'EG', region: 'C', bps: 1400 })],
    settings: settings({ defaultBps: 300 }),
    country: 'EG',
    region: 'C',
    customerExempt: true,
  })
  assert.equal(r.bps, 0)
  assert.equal(r.exempt, true)
  assert.equal(r.rate, undefined)
})

// --- inclusive flag --------------------------------------------------------

test('inclusive is propagated from the matched rate, overriding settings.mode', () => {
  const r = resolve({
    rates: [rate('std', { taxClass: 'standard', country: 'EG', bps: 1400, inclusive: true })],
    settings: settings({ mode: 'exclusive' }), // mode says exclusive…
    country: 'EG',
  })
  assert.equal(r.inclusive, true) // …but the rate wins
})

test('inclusive falls back to settings.mode when the matched rate does not set it', () => {
  const r = resolve({
    rates: [rate('std', { taxClass: 'standard', country: 'EG', bps: 1400 })],
    settings: settings({ mode: 'inclusive' }),
    country: 'EG',
  })
  assert.equal(r.inclusive, true)
})

test('inclusive for exempt / default / unmatched comes from settings.mode', () => {
  assert.equal(resolve({ customerExempt: true, settings: settings({ mode: 'inclusive' }) }).inclusive, true)
  assert.equal(resolve({ settings: settings({ mode: 'inclusive', defaultBps: 100 }) }).inclusive, true)
  assert.equal(resolve({ settings: settings({ mode: 'inclusive' }) }).inclusive, true)
})

// --- determinism -----------------------------------------------------------

test('equal specificity keeps input order (stable): the first listed rate wins', () => {
  const rates = [
    rate('a', { taxClass: 'standard', country: 'EG', bps: 1000 }),
    rate('b', { taxClass: 'standard', country: 'EG', bps: 1400 }),
  ]
  const r = resolve({ rates, country: 'EG' })
  assert.equal(r.rate?.id, 'a')
  assert.equal(r.bps, 1000)
})

test('same input always yields the same output', () => {
  const rates = [rate('exact', { taxClass: 'standard', country: 'EG', region: 'C', bps: 1400 })]
  const a = resolve({ rates, country: 'EG', region: 'C' })
  const b = resolve({ rates, country: 'EG', region: 'C' })
  assert.deepEqual(a, b)
})

// --- mostSpecific comparator (exposed for testing) -------------------------

test('mostSpecific: exact > country > class; equal specificity scores 0', () => {
  const cls = rate('class', { taxClass: 'standard', bps: 0 })
  const ctry = rate('country', { taxClass: 'standard', country: 'EG', bps: 0 })
  const exact = rate('exact', { taxClass: 'standard', country: 'EG', region: 'C', bps: 0 })
  assert.ok(mostSpecific(exact, ctry) > 0)
  assert.ok(mostSpecific(ctry, cls) > 0)
  assert.ok(mostSpecific(cls, exact) < 0)
  assert.equal(mostSpecific(ctry, { ...ctry, id: 'country2' }), 0)
})

// --- validation: integer bps only ------------------------------------------

test('a selected rate with non-integer / negative bps throws; an unselected one does not', () => {
  assert.throws(
    () => resolve({ rates: [rate('bad', { taxClass: 'standard', country: 'EG', bps: 14.5 })], country: 'EG' }),
    /non-negative integer/,
  )
  assert.throws(
    () => resolve({ rates: [rate('bad', { taxClass: 'standard', country: 'EG', bps: -1 })], country: 'EG' }),
    /non-negative integer/,
  )
  // A malformed rate that does not apply is never inspected, so it does not throw.
  const r = resolve({ rates: [rate('bad', { taxClass: 'food', country: 'EG', bps: -1 })], country: 'EG' })
  assert.equal(r.bps, 0)
})

test('a negative defaultBps throws when it is used', () => {
  assert.throws(
    () => resolve({ rates: [], settings: settings({ defaultBps: -5 }), country: 'US' }),
    /defaultBps must be a non-negative integer/,
  )
})
