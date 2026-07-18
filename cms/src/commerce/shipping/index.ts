// Shipping zones + rate evaluation engine. Pure domain logic: given a resolved zone, the cart's
// subtotal/weight, and the rates configured for that zone, pick the cheapest eligible shipping method
// and its price. The caller resolves the zone first via matchZone (from the address), so quoteShipping
// has no DB, no Payload, no I/O — the same input always yields the same output, which is what the
// quote snapshot (commerce/pricing) needs to stay reproducible.
//
// All money is integer minor units (see commerce/money.ts); a rate's currency is the currency of its
// price-defining Money field (flatAmount, or the tier amounts). 'free' and 'pickup' carry no money of
// their own (their price is zero) so they are currency-neutral and match any cart currency.
//
// `now` is accepted as an input — no Date.now is ever read — so a future rate schedule can be added
// without changing the call surface, and the result stays a pure function of the input. It is not yet
// consumed by these rules.
//
// Selection rules:
//   1. filter rates to the zone + currency + pickup flag
//   2. drop rates below their minSubtotalMinor gate (reported separately as MIN_SUBTOTAL)
//   3. price each remaining rate; drop any that cannot serve this cart (weight too heavy, free
//      threshold unmet, price tier out of range, ...)
//   4. return the cheapest priced rate; ties keep input order (stable)

import { type Money, money } from '../money'

export interface ShippingZone {
  id: string
  name: string
  countries?: string[] // ISO-3166 alpha-2 codes; any city in these countries matches
  countryCity?: Record<string, string[] | true> // code -> allowed cities, or true for the whole country
  restOfWorld?: boolean // fallback zone matching any address
}

export type ShippingRateKind = 'flat' | 'free' | 'weight' | 'price' | 'pickup'

export interface WeightTier {
  upToGrams: number // inclusive ceiling
  amount: Money
}

export interface PriceTier {
  upToSubtotalMinor: number // inclusive ceiling, integer minor units
  amount: Money
}

export interface ShippingRate {
  id: string
  zoneId: string
  kind: ShippingRateKind
  label?: string
  flatAmount?: Money // kind: 'flat'
  freeOverSubtotalMinor?: number // kind: 'free' — free once subtotal reaches this (inclusive)
  weightTiers?: WeightTier[] // kind: 'weight' — picked by cart weight
  priceTiers?: PriceTier[] // kind: 'price' — picked by cart subtotal
  minSubtotalMinor?: number // gate; rate hidden below this subtotal
  codAllowed?: boolean // cash-on-delivery permitted on this rate (informational)
}

export interface QuoteShippingInput {
  zone: ShippingZone | null // the zone resolved by matchZone for the address
  rates: ShippingRate[]
  cartSubtotalMinor: number
  cartWeightGrams: number
  currency: string
  pickup: boolean // true = customer collects; only pickup rates apply. false = only delivery rates.
  now: number
}

export type ShippingErrorCode = 'NO_ZONE' | 'NO_RATE' | 'MIN_SUBTOTAL'

export type QuoteShippingOk = { rate: ShippingRate; price: Money }
export type QuoteShippingError = { ok: false; code: ShippingErrorCode }
export type QuoteShippingResult = QuoteShippingOk | QuoteShippingError

const requireNonNegInt = (q: number, label: string): void => {
  if (!Number.isInteger(q) || q < 0) throw new Error(`${label} must be a non-negative integer, got ${q}`)
}

const normCountry = (c: string): string => c.trim().toUpperCase()

// Does the zone cover this country (+ optional city refinement)? Country codes are matched
// case-insensitively as ISO alpha-2; a configured city list narrows the match and requires the
// address city to be present and listed (compared case-insensitively).
function zoneCovers(zone: ShippingZone, cc: string, city: string | undefined): boolean {
  const inCountries = zone.countries?.some((c) => normCountry(c) === cc) ?? false
  const citySpec = zone.countryCity?.[cc]
  if (!inCountries && citySpec === undefined) return false
  if (citySpec === undefined) return true // matched via countries[]; any city
  if (citySpec === true) return true // whole country
  if (city === undefined) return false // a city list requires the city
  const needle = city.trim().toLowerCase()
  return citySpec.some((c) => c.trim().toLowerCase() === needle)
}

// Country + city first (first matching zone wins), then restOfWorld as a fallback so a specific zone
// always beats a catch-all regardless of input order.
export function matchZone(
  address: { country?: string; city?: string },
  zones: ShippingZone[],
): ShippingZone | null {
  const cc = address.country !== undefined ? normCountry(address.country) : undefined
  if (cc !== undefined) {
    for (const z of zones) if (zoneCovers(z, cc, address.city)) return z
  }
  for (const z of zones) if (z.restOfWorld === true) return z
  return null
}

// The currency a rate prices in: its flat amount, or its first tier amount. free/pickup price zero in
// any currency, so they return undefined and match any cart currency.
function rateCurrency(rate: ShippingRate): string | undefined {
  if (rate.flatAmount) return rate.flatAmount.currency
  if (rate.weightTiers && rate.weightTiers.length > 0) return rate.weightTiers[0].amount.currency
  if (rate.priceTiers && rate.priceTiers.length > 0) return rate.priceTiers[0].amount.currency
  return undefined
}

function currencyOk(rate: ShippingRate, currency: string): boolean {
  const rc = rateCurrency(rate)
  return rc === undefined || rc === currency
}

// pickup is a clean either/or: pickup rates apply only when collecting, delivery rates only when not.
function pickupOk(rate: ShippingRate, pickup: boolean): boolean {
  if (rate.kind === 'pickup') return pickup === true
  return pickup === false
}

// Smallest sufficient weight tier (tightest fit) whose amount is in the cart currency; null when the
// cart is heavier than every tier.
function weightPrice(tiers: WeightTier[], grams: number, currency: string): number | null {
  let best: WeightTier | null = null
  for (const t of tiers) {
    if (t.upToGrams >= grams && t.amount.currency === currency) {
      if (best === null || t.upToGrams < best.upToGrams) best = t
    }
  }
  return best === null ? null : best.amount.amount
}

function pricePrice(tiers: PriceTier[], subtotal: number, currency: string): number | null {
  let best: PriceTier | null = null
  for (const t of tiers) {
    if (t.upToSubtotalMinor >= subtotal && t.amount.currency === currency) {
      if (best === null || t.upToSubtotalMinor < best.upToSubtotalMinor) best = t
    }
  }
  return best === null ? null : best.amount.amount
}

// The rate's price in minor units, or null when the rate cannot serve this cart (for any reason other
// than the minSubtotal gate, which is handled by the caller).
function priceForRate(
  rate: ShippingRate,
  cartSubtotalMinor: number,
  cartWeightGrams: number,
  currency: string,
): number | null {
  switch (rate.kind) {
    case 'pickup':
      return 0
    case 'free':
      if (rate.freeOverSubtotalMinor !== undefined && cartSubtotalMinor < rate.freeOverSubtotalMinor) {
        return null // free shipping not yet earned
      }
      return 0
    case 'flat':
      if (!rate.flatAmount || rate.flatAmount.currency !== currency) return null
      return rate.flatAmount.amount
    case 'weight':
      return weightPrice(rate.weightTiers ?? [], cartWeightGrams, currency)
    case 'price':
      return pricePrice(rate.priceTiers ?? [], cartSubtotalMinor, currency)
  }
}

export function quoteShipping(input: QuoteShippingInput): QuoteShippingResult {
  const { zone, rates, cartSubtotalMinor, cartWeightGrams, currency, pickup } = input
  money(0, currency) // validate the ISO-4217 currency once at the trust boundary
  requireNonNegInt(cartSubtotalMinor, 'cartSubtotalMinor')
  requireNonNegInt(cartWeightGrams, 'cartWeightGrams')

  if (!zone) return { ok: false, code: 'NO_ZONE' }

  const candidates = rates.filter(
    (r) => r.zoneId === zone.id && currencyOk(r, currency) && pickupOk(r, pickup),
  )
  if (candidates.length === 0) return { ok: false, code: 'NO_RATE' }

  let best: { rate: ShippingRate; amount: number } | null = null
  let minBlocked = false
  for (const r of candidates) {
    if (r.minSubtotalMinor !== undefined && cartSubtotalMinor < r.minSubtotalMinor) {
      minBlocked = true
      continue
    }
    const amount = priceForRate(r, cartSubtotalMinor, cartWeightGrams, currency)
    if (amount === null) continue
    if (best === null || amount < best.amount) best = { rate: r, amount }
  }

  if (best === null) {
    // No rate could be priced. If any candidate was blocked only by the min-subtotal gate, surface
    // MIN_SUBTOTAL (the customer can act on it); otherwise no rate services this cart.
    return { ok: false, code: minBlocked ? 'MIN_SUBTOTAL' : 'NO_RATE' }
  }
  return { rate: best.rate, price: money(best.amount, currency) }
}
