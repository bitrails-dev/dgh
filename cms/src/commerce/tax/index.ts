// Tax rule resolver — pure domain logic. Picks the basis-point rate that applies to a quote line given
// the tenant's tax rates, the product's tax class, the ship-to jurisdiction, and the customer's
// exemption status. commerce/pricing consumes the resulting bps; this module is the single source of
// WHICH rate applies — pricing only does the arithmetic.
//
// All rates are integer basis points (1% = 100 bps); no floats. The resolver touches no DB, no
// Payload, no I/O — the same input always yields the same output, which keeps the QuoteSnapshot
// (commerce/pricing) reproducible across recomputes.
//
// Rate cascade (most-specific match wins; ties keep input order so the result is deterministic):
//   1. customerExempt ⇒ bps 0 (exempt flag set); inclusive from settings.mode
//   2. exact:   taxClass + country + region   (specificity 2)
//   3. country: taxClass + country            (specificity 1)
//   4. class:   taxClass only                 (specificity 0)
//   5. settings.defaultBps                    (no rate matched)
//   6. nothing matched and no default ⇒ bps 0
//
// `inclusive` comes from the matched rate when it sets the flag, otherwise from settings.mode.

export type TaxMode = 'inclusive' | 'exclusive'

export interface TaxRate {
  id: string
  taxClass: string
  country?: string // ISO-3166 alpha-2; undefined = any country
  region?: string // subdivision (state/province); undefined = any region
  bps: number // non-negative integer; 1% = 100 bps
  inclusive?: boolean // overrides settings.mode for this rate when set
}

export interface TaxSettings {
  mode: TaxMode
  defaultBps?: number // fallback bps when no rate matches
}

export interface ResolveTaxBpsInput {
  rates: TaxRate[]
  settings: TaxSettings
  productTaxClass?: string
  country?: string
  region?: string
  customerExempt?: boolean
}

export interface ResolveTaxBpsResult {
  bps: number
  inclusive: boolean
  rate?: TaxRate // the matched rate; absent for exempt / default / unmatched
  exempt?: boolean // true when the customer is tax-exempt (bps forced to 0)
}

const requireNonNegInt = (q: number, label: string): void => {
  if (!Number.isInteger(q) || q < 0) throw new Error(`${label} must be a non-negative integer, got ${q}`)
}

// Structural specificity of a rate = how many jurisdiction fields it pins down. country + region = 2,
// exactly one of them = 1, neither = 0. Independent of any input — purely a property of the rate.
function specificity(r: TaxRate): number {
  return (r.country !== undefined ? 1 : 0) + (r.region !== undefined ? 1 : 0)
}

// Comparator for the rate cascade: positive when `a` is more specific than `b`, negative when less,
// 0 when equally specific. Exposed so the cascade order can be unit-tested directly.
export function mostSpecific(a: TaxRate, b: TaxRate): number {
  return specificity(a) - specificity(b)
}

const inclusiveDefault = (settings: TaxSettings): boolean => settings.mode === 'inclusive'

// Does the rate apply to this line? The tax class must always equal the product's, and each
// jurisdiction field the rate defines must equal the input (an undefined field matches anything).
function applies(
  r: TaxRate,
  taxClass: string | undefined,
  country: string | undefined,
  region: string | undefined,
): boolean {
  if (taxClass === undefined || r.taxClass !== taxClass) return false
  if (r.country !== undefined && r.country !== country) return false
  if (r.region !== undefined && r.region !== region) return false
  return true
}

export function resolveTaxBps(input: ResolveTaxBpsInput): ResolveTaxBpsResult {
  const { rates, settings, productTaxClass, country, region, customerExempt } = input

  // 1. a tax-exempt customer pays no tax, regardless of rates or default.
  if (customerExempt) {
    return { bps: 0, inclusive: inclusiveDefault(settings), exempt: true }
  }

  // 2-4. most-specific applying rate; only replace on strictly greater specificity so ties keep input
  // order (stable → deterministic).
  let best: TaxRate | null = null
  for (const r of rates) {
    if (!applies(r, productTaxClass, country, region)) continue
    if (best === null || mostSpecific(r, best) > 0) best = r
  }
  if (best) {
    requireNonNegInt(best.bps, `rate ${best.id} bps`)
    return {
      bps: best.bps,
      inclusive: best.inclusive !== undefined ? best.inclusive : inclusiveDefault(settings),
      rate: best,
    }
  }

  // 5. tenant default fallback.
  if (settings.defaultBps !== undefined) {
    requireNonNegInt(settings.defaultBps, 'defaultBps')
    return { bps: settings.defaultBps, inclusive: inclusiveDefault(settings) }
  }

  // 6. nothing matched and no default.
  return { bps: 0, inclusive: inclusiveDefault(settings) }
}
