import assert from 'node:assert/strict'
import test from 'node:test'

import { money } from '../src/commerce/money'
import { matchZone, quoteShipping } from '../src/commerce/shipping'
import type {
  QuoteShippingInput,
  QuoteShippingResult,
  ShippingRate,
  ShippingZone,
} from '../src/commerce/shipping'

const EGP = (amount: number) => money(amount, 'EGP')
const NOW = 1_000_000

function zone(id: string, over: Partial<ShippingZone> = {}): ShippingZone {
  return { id, name: id, ...over }
}

function rate(
  id: string,
  zoneId: string,
  over: Partial<ShippingRate> & { kind: ShippingRate['kind'] },
): ShippingRate {
  return { id, zoneId, ...over }
}

// Defaulted quoteShipping caller so each test only spells out the relevant knobs.
function quote(
  over: Partial<QuoteShippingInput> & Pick<QuoteShippingInput, 'zone' | 'rates'>,
): QuoteShippingResult {
  return quoteShipping({
    cartSubtotalMinor: 1000,
    cartWeightGrams: 500,
    currency: 'EGP',
    pickup: false,
    now: NOW,
    ...over,
  })
}

function okPrice(r: QuoteShippingResult): number {
  if (!('rate' in r)) throw new Error('expected an ok result')
  return r.price.amount
}

function okRate(r: QuoteShippingResult): ShippingRate {
  if (!('rate' in r)) throw new Error('expected an ok result')
  return r.rate
}

function errCode(r: QuoteShippingResult): string {
  if (!('code' in r)) throw new Error('expected an error result')
  return r.code
}

// --- zone matching ----------------------------------------------------------

test('matchZone: country in countries[] matches with or without a city', () => {
  const z = zone('eg', { countries: ['EG'] })
  assert.equal(matchZone({ country: 'EG', city: 'Cairo' }, [z]), z)
  assert.equal(matchZone({ country: 'EG' }, [z]), z)
})

test('matchZone: country code is normalized (lowercase input matches uppercase config)', () => {
  const z = zone('eg', { countries: ['EG'] })
  assert.equal(matchZone({ country: 'eg' }, [z]), z)
})

test('matchZone: countryCity true matches any city in that country', () => {
  const z = zone('eg-all', { countryCity: { EG: true } })
  assert.equal(matchZone({ country: 'EG', city: 'Anywhere' }, [z]), z)
})

test('matchZone: countryCity array requires the city to be listed', () => {
  const z = zone('eg-cities', { countryCity: { EG: ['Cairo', 'Alexandria'] } })
  assert.equal(matchZone({ country: 'EG', city: 'Cairo' }, [z]), z)
  assert.equal(matchZone({ country: 'EG', city: 'Giza' }, [z]), null)
  assert.equal(matchZone({ country: 'EG' }, [z]), null) // city required but absent
})

test('matchZone: city match is case-insensitive', () => {
  const z = zone('eg-cities', { countryCity: { EG: ['Cairo'] } })
  assert.equal(matchZone({ country: 'EG', city: 'CAIRO' }, [z]), z)
})

test('matchZone: first matching zone wins', () => {
  const a = zone('a', { countries: ['EG'] })
  const b = zone('b', { countries: ['EG'] })
  assert.equal(matchZone({ country: 'EG' }, [a, b]), a)
})

test('matchZone: restOfWorld is the fallback when no country matches', () => {
  const row = zone('row', { restOfWorld: true })
  assert.equal(matchZone({ country: 'US' }, [row]), row)
  assert.equal(matchZone({}, [row]), row) // no country at all
})

test('matchZone: a country-specific zone beats restOfWorld even when listed later', () => {
  const row = zone('row', { restOfWorld: true })
  const eg = zone('eg', { countries: ['EG'] })
  assert.equal(matchZone({ country: 'EG' }, [row, eg]), eg)
})

test('matchZone: no match returns null', () => {
  assert.equal(matchZone({ country: 'US' }, [zone('eg', { countries: ['EG'] })]), null)
})

// --- rate selection ---------------------------------------------------------

test('flat rate: price is the flat amount', () => {
  const z = zone('eg', { countries: ['EG'] })
  assert.equal(okPrice(quote({ zone: z, rates: [rate('flat', 'eg', { kind: 'flat', flatAmount: EGP(500) })] })), 500)
})

test('free rate: price is zero', () => {
  const z = zone('eg', { countries: ['EG'] })
  assert.equal(okPrice(quote({ zone: z, rates: [rate('free', 'eg', { kind: 'free' })] })), 0)
})

test('free rate: threshold not met is ineligible; met yields zero (inclusive bound)', () => {
  const z = zone('eg', { countries: ['EG'] })
  const r = rate('free', 'eg', { kind: 'free', freeOverSubtotalMinor: 5000 })
  assert.equal(errCode(quote({ zone: z, rates: [r], cartSubtotalMinor: 1000 })), 'NO_RATE')
  assert.equal(okPrice(quote({ zone: z, rates: [r], cartSubtotalMinor: 5000 })), 0) // at threshold
  assert.equal(okPrice(quote({ zone: z, rates: [r], cartSubtotalMinor: 6000 })), 0) // above threshold
})

test('weight rate: smallest sufficient tier is chosen (boundary inclusive)', () => {
  const z = zone('eg', { countries: ['EG'] })
  const r = rate('w', 'eg', {
    kind: 'weight',
    weightTiers: [
      { upToGrams: 1000, amount: EGP(300) },
      { upToGrams: 5000, amount: EGP(700) },
      { upToGrams: 10_000, amount: EGP(1200) },
    ],
  })
  assert.equal(okPrice(quote({ zone: z, rates: [r], cartWeightGrams: 500 })), 300)
  assert.equal(okPrice(quote({ zone: z, rates: [r], cartWeightGrams: 1000 })), 300) // exact boundary
  assert.equal(okPrice(quote({ zone: z, rates: [r], cartWeightGrams: 4000 })), 700)
})

test('weight rate: cart heavier than every tier is ineligible', () => {
  const z = zone('eg', { countries: ['EG'] })
  const r = rate('w', 'eg', { kind: 'weight', weightTiers: [{ upToGrams: 1000, amount: EGP(300) }] })
  assert.equal(errCode(quote({ zone: z, rates: [r], cartWeightGrams: 2000 })), 'NO_RATE')
})

test('price rate: smallest sufficient subtotal tier is chosen', () => {
  const z = zone('eg', { countries: ['EG'] })
  const r = rate('p', 'eg', {
    kind: 'price',
    priceTiers: [
      { upToSubtotalMinor: 1000, amount: EGP(250) },
      { upToSubtotalMinor: 10_000, amount: EGP(150) },
    ],
  })
  assert.equal(okPrice(quote({ zone: z, rates: [r], cartSubtotalMinor: 500 })), 250)
  assert.equal(okPrice(quote({ zone: z, rates: [r], cartSubtotalMinor: 5000 })), 150)
})

test('pickup rate: zero price only when pickup is true', () => {
  const z = zone('eg', { countries: ['EG'] })
  const r = rate('pu', 'eg', { kind: 'pickup' })
  assert.equal(okPrice(quote({ zone: z, rates: [r], pickup: true })), 0)
  assert.equal(errCode(quote({ zone: z, rates: [r], pickup: false })), 'NO_RATE')
})

test('pickup=true excludes delivery rates', () => {
  const z = zone('eg', { countries: ['EG'] })
  const flat = rate('flat', 'eg', { kind: 'flat', flatAmount: EGP(500) })
  assert.equal(errCode(quote({ zone: z, rates: [flat], pickup: true })), 'NO_RATE')
})

test('cheapest eligible rate wins (flat vs weight vs an unearned free rate)', () => {
  const z = zone('eg', { countries: ['EG'] })
  const rates = [
    rate('flat', 'eg', { kind: 'flat', flatAmount: EGP(500) }),
    rate('w', 'eg', { kind: 'weight', weightTiers: [{ upToGrams: 5000, amount: EGP(300) }] }),
    rate('free', 'eg', { kind: 'free', freeOverSubtotalMinor: 100_000 }), // not earned at subtotal 1000
  ]
  const out = quote({ zone: z, rates, cartSubtotalMinor: 1000, cartWeightGrams: 500 })
  assert.equal(okRate(out).id, 'w')
  assert.equal(okPrice(out), 300)
})

// --- minSubtotal gate: NO_RATE vs MIN_SUBTOTAL -----------------------------

test('minSubtotal gate: below the minimum on every rate -> MIN_SUBTOTAL', () => {
  const z = zone('eg', { countries: ['EG'] })
  const r = rate('flat', 'eg', { kind: 'flat', flatAmount: EGP(500), minSubtotalMinor: 2000 })
  assert.equal(errCode(quote({ zone: z, rates: [r], cartSubtotalMinor: 1000 })), 'MIN_SUBTOTAL')
})

test('minSubtotal gate: at/above the minimum the rate applies', () => {
  const z = zone('eg', { countries: ['EG'] })
  const r = rate('flat', 'eg', { kind: 'flat', flatAmount: EGP(500), minSubtotalMinor: 2000 })
  assert.equal(okPrice(quote({ zone: z, rates: [r], cartSubtotalMinor: 2000 })), 500) // at bound
  assert.equal(okPrice(quote({ zone: z, rates: [r], cartSubtotalMinor: 3000 })), 500) // above
})

test('minSubtotal gate is reported as NO_RATE when the rate belongs to another zone', () => {
  const z = zone('eg', { countries: ['EG'] })
  const r = rate('flat', 'us', { kind: 'flat', flatAmount: EGP(500), minSubtotalMinor: 2000 })
  assert.equal(errCode(quote({ zone: z, rates: [r], cartSubtotalMinor: 1000 })), 'NO_RATE')
})

// --- currency, no-zone / no-rate, end-to-end -------------------------------

test('currency mismatch: a USD flat rate is rejected for an EGP cart', () => {
  const z = zone('eg', { countries: ['EG'] })
  const r = rate('usd', 'eg', { kind: 'flat', flatAmount: money(500, 'USD') })
  assert.equal(errCode(quote({ zone: z, rates: [r] })), 'NO_RATE')
})

test('no zone -> NO_ZONE', () => {
  assert.equal(errCode(quote({ zone: null, rates: [] })), 'NO_ZONE')
})

test('no rate for the zone -> NO_RATE', () => {
  const z = zone('eg', { countries: ['EG'] })
  assert.equal(errCode(quote({ zone: z, rates: [] })), 'NO_RATE')
})

test('matchZone + quoteShipping end-to-end: a ROW address gets the ROW flat rate', () => {
  const zones = [zone('eg', { countries: ['EG'] }), zone('row', { restOfWorld: true })]
  const rates = [
    rate('eg-flat', 'eg', { kind: 'flat', flatAmount: EGP(200) }),
    rate('row-flat', 'row', { kind: 'flat', flatAmount: EGP(1500) }),
  ]
  const out = quoteShipping({
    zone: matchZone({ country: 'US' }, zones),
    rates,
    cartSubtotalMinor: 1000,
    cartWeightGrams: 500,
    currency: 'EGP',
    pickup: false,
    now: NOW,
  })
  assert.equal(okRate(out).id, 'row-flat')
  assert.equal(okPrice(out), 1500)
})

test('inputs must be non-negative integers', () => {
  const z = zone('eg', { countries: ['EG'] })
  assert.throws(() => quote({ zone: z, rates: [], cartSubtotalMinor: -1 }), /non-negative integer/)
  assert.throws(() => quote({ zone: z, rates: [], cartWeightGrams: 1.5 }), /non-negative integer/)
})
