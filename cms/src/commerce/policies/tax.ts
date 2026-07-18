// Tax policy repository + adapter (Plan §3.10).
//
// Bridges the tenant-scoped `tax-zones` / `tax-rates` policy collections and the pure tax resolver
// at `commerce/tax`. The repository reads rows via the Local API (typed Payload-like surface) and
// exposes a `resolveTaxBpsForLine(...)` helper that the quoteCart engine calls per line. Everything
// server-side; nothing from the browser is trusted.
//
// All money is integer minor units; all rates are integer basis points. No floats anywhere — the
// pure core does the single half-up division.

import type { TaxMode, TaxRate } from '../tax'

export interface TaxZoneRow {
  id: string | number
  tenant: string | number
  code: string
  country?: string | null
  regions?: Array<{ code: string }> | null
  postalPrefixes?: Array<{ prefix: string }> | null
  priority: number
  enabled: boolean
}

export interface TaxRateRow {
  id: string | number
  tenant: string | number
  zone: string | number
  taxClass: string
  rateBps: number
  pricesIncludeTax: boolean
  effectiveFrom: string | null
  effectiveTo: string | null
  enabled: boolean
}

// Lightweight Local-API surface this repository needs. The integration owner passes
// `req.payload.find(...)`; tests pass a fake. Untyped Payload is intentional so this module does not
// depend on a running Payload at import time.
export interface PolicyFindApi {
  find(args: {
    collection: string
    where: Record<string, unknown>
    limit?: number
    overrideAccess?: boolean
    sort?: string | string[]
  }): Promise<{ docs: ReadonlyArray<Record<string, unknown>> }>
}

export interface ResolvedTaxZoneMatch {
  zoneId: string | number
  priority: number
}

// Country + region + postal matching for tax-zones. An undefined zone field matches anything; a
// configured country must equal; a configured region must contain the address region; a configured
// postal prefix must be a prefix of the address postal code. Higher `priority` wins on multi-match;
// ties break by zone id ascending (deterministic).
export function matchTaxZone(
  address: { country?: string; region?: string; postal?: string },
  zones: ReadonlyArray<TaxZoneRow>,
): TaxZoneRow | null {
  const cc = address.country !== undefined ? address.country.trim().toUpperCase() : undefined
  const region = address.region !== undefined ? address.region.trim().toUpperCase() : undefined
  const postal = address.postal !== undefined ? address.postal.trim().toUpperCase() : undefined
  let best: TaxZoneRow | null = null
  for (const z of zones) {
    if (!z.enabled) continue
    if (z.country !== undefined && z.country !== null && z.country !== '') {
      const zc = z.country.trim().toUpperCase()
      if (cc !== zc) continue
    }
    if (z.regions && z.regions.length > 0) {
      if (region === undefined) continue
      const codes = z.regions.map((r) => r.code.trim().toUpperCase())
      if (!codes.includes(region)) continue
    }
    if (z.postalPrefixes && z.postalPrefixes.length > 0) {
      if (postal === undefined) continue
      const hit = z.postalPrefixes.some((p) => postal.startsWith(p.prefix.trim().toUpperCase()))
      if (!hit) continue
    }
    if (
      best === null ||
      z.priority > best.priority ||
      (z.priority === best.priority && String(z.id) < String(best.id))
    ) {
      best = z
    }
  }
  return best
}

// Filter tax-rate rows for a (tenant, zone, taxClass) at time `now`. Effective window is inclusive;
// null `effectiveTo` is open-ended; null `effectiveFrom` is "always".
export function pickActiveRate(
  rates: ReadonlyArray<TaxRateRow>,
  tenant: string | number,
  zoneId: string | number,
  taxClass: string,
  now: number,
): TaxRateRow | null {
  let best: TaxRateRow | null = null
  for (const r of rates) {
    if (!r.enabled) continue
    if (String(r.tenant) !== String(tenant)) continue
    if (String(r.zone) !== String(zoneId)) continue
    if (r.taxClass !== taxClass) continue
    const from = r.effectiveFrom ? Date.parse(r.effectiveFrom) : -Infinity
    const to = r.effectiveTo ? Date.parse(r.effectiveTo) : Infinity
    if (Number.isNaN(from) || Number.isNaN(to)) continue
    if (now < from || now > to) continue
    // Pick the latest effectiveFrom on tie (most recently started); deterministic by row id.
    if (
      best === null ||
      from > (best.effectiveFrom ? Date.parse(best.effectiveFrom) : -Infinity) ||
      (from === (best.effectiveFrom ? Date.parse(best.effectiveFrom) : -Infinity) &&
        String(r.id) < String(best.id))
    ) {
      best = r
    }
  }
  return best
}

// Convert a TaxRateRow + tenant tax mode into the shape the pure resolver understands. `exempt` and
// `zero` classes are forced to 0 bps regardless of the stored rate; the stored rate is the source of
// truth only for `standard`/`reduced`.
export function toPureTaxRate(row: TaxRateRow): TaxRate {
  const bps = row.taxClass === 'exempt' || row.taxClass === 'zero' ? 0 : Math.max(0, row.rateBps | 0)
  return {
    id: String(row.id),
    taxClass: row.taxClass,
    bps,
    inclusive: row.pricesIncludeTax,
  }
}

// One-shot helper for the quoteCart engine: "given this address, this tenant’s zones + rates, this
// line’s tax class, and now, what bps + inclusive flag apply?". Returns the resolved bps, the
// inclusive flag (which overrides the tenant default for this line), and the matched rate id (for
// the snapshot audit). Falls back to { bps: 0, inclusive: tenantModeInclusive } when no zone/rate
// matches.
export interface ResolvedLineTax {
  bps: number
  inclusive: boolean
  zoneId: string | number | null
  rateId: string | number | null
}

export function resolveLineTax(args: {
  zones: ReadonlyArray<TaxZoneRow>
  rates: ReadonlyArray<TaxRateRow>
  tenant: string | number
  taxClass: string
  address: { country?: string; region?: string; postal?: string }
  tenantTaxMode: TaxMode
  now: number
}): ResolvedLineTax {
  const { zones, rates, tenant, taxClass, address, tenantTaxMode, now } = args
  const zone = matchTaxZone(address, zones)
  if (!zone) {
    return { bps: 0, inclusive: tenantTaxMode === 'inclusive', zoneId: null, rateId: null }
  }
  const rate = pickActiveRate(rates, tenant, zone.id, taxClass, now)
  if (!rate) {
    return { bps: 0, inclusive: tenantTaxMode === 'inclusive', zoneId: zone.id, rateId: null }
  }
  const pure = toPureTaxRate(rate)
  return {
    bps: pure.bps,
    inclusive: pure.inclusive ?? tenantTaxMode === 'inclusive',
    zoneId: zone.id,
    rateId: rate.id,
  }
}

// Repository: tenant-scoped reads via the Local API. The integration owner constructs one
// repository per request with the live `payload` instance; tests construct one with a fake.
export class TaxPolicyRepository {
  constructor(private readonly api: PolicyFindApi) {}

  async listZones(tenant: string | number): Promise<TaxZoneRow[]> {
    const { docs } = await this.api.find({
      collection: 'tax-zones',
      where: { and: [{ tenant: { equals: tenant } }, { enabled: { equals: true } }] },
      limit: 500,
      overrideAccess: true,
      sort: ['-priority', 'code'],
    })
    return docs.map((d) => toTaxZoneRow(d, tenant))
  }

  async listRates(tenant: string | number): Promise<TaxRateRow[]> {
    const { docs } = await this.api.find({
      collection: 'tax-rates',
      where: { and: [{ tenant: { equals: tenant } }, { enabled: { equals: true } }] },
      limit: 1000,
      overrideAccess: true,
      sort: ['-effectiveFrom', 'taxClass'],
    })
    return docs.map((d) => toTaxRateRow(d, tenant))
  }
}

// Row mappers: defensive about the unknown-shape records returned by Payload — every field is
// coerced with a fallback so a malformed row never crashes the quote. Tenant is forced from the
// caller's resolved tenant id (never from the row) so cross-tenant leakage via row tampering cannot
// happen.
export function toTaxZoneRow(d: Record<string, unknown>, tenant: string | number): TaxZoneRow {
  const regions = Array.isArray((d as { regions?: unknown }).regions)
    ? ((d as { regions?: Array<{ code?: unknown }> }).regions ?? []).map((r) => ({
        code: String(r?.code ?? ''),
      }))
    : null
  const postalPrefixes = Array.isArray((d as { postalPrefixes?: unknown }).postalPrefixes)
    ? ((d as { postalPrefixes?: Array<{ prefix?: unknown }> }).postalPrefixes ?? []).map((r) => ({
        prefix: String(r?.prefix ?? ''),
      }))
    : null
  return {
    id: String((d as { id?: unknown }).id ?? ''),
    tenant,
    code: String((d as { code?: unknown }).code ?? ''),
    country: ((d as { country?: unknown }).country ?? null) as string | null | undefined,
    regions,
    postalPrefixes,
    priority: Number((d as { priority?: unknown }).priority ?? 0) || 0,
    enabled: Boolean((d as { enabled?: unknown }).enabled ?? true),
  }
}

export function toTaxRateRow(d: Record<string, unknown>, tenant: string | number): TaxRateRow {
  const zoneRaw = (d as { zone?: unknown }).zone
  const zoneId =
    zoneRaw !== null && typeof zoneRaw === 'object' && 'id' in (zoneRaw as Record<string, unknown>)
      ? String((zoneRaw as { id?: unknown }).id ?? '')
      : String(zoneRaw ?? '')
  return {
    id: String((d as { id?: unknown }).id ?? ''),
    tenant,
    zone: zoneId,
    taxClass: String((d as { taxClass?: unknown }).taxClass ?? 'standard'),
    rateBps: Number((d as { rateBps?: unknown }).rateBps ?? 0) || 0,
    pricesIncludeTax: Boolean((d as { pricesIncludeTax?: unknown }).pricesIncludeTax ?? false),
    effectiveFrom: ((d as { effectiveFrom?: unknown }).effectiveFrom ?? null) as string | null,
    effectiveTo: ((d as { effectiveTo?: unknown }).effectiveTo ?? null) as string | null,
    enabled: Boolean((d as { enabled?: unknown }).enabled ?? true),
  }
}
