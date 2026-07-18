// Shipping policy repository + adapter (Plan §3.10).
//
// Bridges the tenant-scoped `shipping-zones` / `shipping-methods` policy collections to the
// quoteCart engine. The plan §3.10 step 6 selects the shipping method from the discounted
// merchandise subtotal and the normalized address — this module resolves the applicable zone + the
// candidate methods, then selects the cheapest eligible method given the cart subtotal. Plan §3.10
// step 7 then applies any free-shipping promotion AFTER eligibility is established (it zeroes the
// selected method’s price, it does not change the selection).
//
// Money is integer EGP minor units everywhere.

export interface ShippingZoneRow {
  id: string | number
  tenant: string | number
  code: string
  country?: string | null
  regions?: Array<{ code: string }> | null
  postalPrefixes?: Array<{ prefix: string }> | null
  priority: number
  enabled: boolean
}

export interface ShippingMethodRow {
  id: string | number
  tenant: string | number
  zone: string | number
  code: string
  basePrice: number
  freeAboveSubtotal: number
  minimumSubtotal?: number | null
  maximumSubtotal?: number | null
  enabled: boolean
}

import type { PolicyFindApi } from './tax'

export interface ResolvedShipping {
  methodId: string | number
  code: string
  // Post-free-shipping-promo price the engine actually charges. The caller computes this by zeroing
  // `priceEligible` when a free-shipping promo applies (Plan §3.10 step 7).
  priceEligible: number
  zoneId: string | number
}

export type ShippingResolveErrorCode = 'NO_ZONE' | 'NO_METHOD' | 'MIN_SUBTOTAL' | 'MAX_SUBTOTAL'
export type ShippingResolveResult =
  | ({ ok: true } & ResolvedShipping)
  | { ok: false; code: ShippingResolveErrorCode }

// Same address shape as the tax matcher; same country/region/postal-prefix rules. Higher `priority`
// wins; ties break by zone id ascending so the result is deterministic regardless of input order.
export function matchShippingZone(
  address: { country?: string; region?: string; postal?: string },
  zones: ReadonlyArray<ShippingZoneRow>,
): ShippingZoneRow | null {
  const cc = address.country !== undefined ? address.country.trim().toUpperCase() : undefined
  const region = address.region !== undefined ? address.region.trim().toUpperCase() : undefined
  const postal = address.postal !== undefined ? address.postal.trim().toUpperCase() : undefined
  let best: ShippingZoneRow | null = null
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

// Pricing rule for a single method given the discounted merchandise subtotal (Plan §3.10 step 6):
//   - if freeAboveSubtotal > 0 and subtotal >= freeAboveSubtotal → price 0 (free shipping earned)
//   - else → basePrice
// Returns null when the method is gated out by minimum/maximum subtotal.
function methodPrice(method: ShippingMethodRow, subtotal: number): number | null {
  if (method.minimumSubtotal !== undefined && method.minimumSubtotal !== null && subtotal < method.minimumSubtotal) {
    return null
  }
  if (method.maximumSubtotal !== undefined && method.maximumSubtotal !== null && subtotal > method.maximumSubtotal) {
    return null
  }
  if (method.freeAboveSubtotal > 0 && subtotal >= method.freeAboveSubtotal) return 0
  return method.basePrice
}

// Plan §3.10 step 6 — pick the cheapest eligible method for the resolved zone + subtotal. Ties break
// by method id ascending (deterministic). Surfaces MIN_SUBTOTAL / MAX_SUBTOTAL when a candidate was
// only blocked by a gate so the storefront can surface an actionable error.
export function resolveShipping(args: {
  zones: ReadonlyArray<ShippingZoneRow>
  methods: ReadonlyArray<ShippingMethodRow>
  tenant: string | number
  address: { country?: string; region?: string; postal?: string }
  subtotal: number
}): ShippingResolveResult {
  const { zones, methods, tenant, address, subtotal } = args
  const zone = matchShippingZone(address, zones)
  if (!zone) return { ok: false, code: 'NO_ZONE' }
  let best: { method: ShippingMethodRow; price: number } | null = null
  let gated = false
  for (const m of methods) {
    if (!m.enabled) continue
    if (String(m.tenant) !== String(tenant)) continue
    if (String(m.zone) !== String(zone.id)) continue
    const price = methodPrice(m, subtotal)
    if (price === null) {
      gated = true
      continue
    }
    if (
      best === null ||
      price < best.price ||
      (price === best.price && String(m.id) < String(best.method.id))
    ) {
      best = { method: m, price }
    }
  }
  if (best === null) {
    return { ok: false, code: gated ? 'MIN_SUBTOTAL' : 'NO_METHOD' }
  }
  return {
    ok: true,
    methodId: best.method.id,
    code: best.method.code,
    priceEligible: best.price,
    zoneId: zone.id,
  }
}

export class ShippingPolicyRepository {
  constructor(private readonly api: PolicyFindApi) {}

  async listZones(tenant: string | number): Promise<ShippingZoneRow[]> {
    const { docs } = await this.api.find({
      collection: 'shipping-zones',
      where: { and: [{ tenant: { equals: tenant } }, { enabled: { equals: true } }] },
      limit: 500,
      overrideAccess: true,
      sort: ['-priority', 'code'],
    })
    return docs.map((d) => toShippingZoneRow(d, tenant))
  }

  async listMethods(tenant: string | number): Promise<ShippingMethodRow[]> {
    const { docs } = await this.api.find({
      collection: 'shipping-methods',
      where: { and: [{ tenant: { equals: tenant } }, { enabled: { equals: true } }] },
      limit: 1000,
      overrideAccess: true,
      sort: ['basePrice', 'code'],
    })
    return docs.map((d) => toShippingMethodRow(d, tenant))
  }
}

export function toShippingZoneRow(
  d: Record<string, unknown>,
  tenant: string | number,
): ShippingZoneRow {
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

export function toShippingMethodRow(
  d: Record<string, unknown>,
  tenant: string | number,
): ShippingMethodRow {
  const zoneRaw = (d as { zone?: unknown }).zone
  const zoneId =
    zoneRaw !== null && typeof zoneRaw === 'object' && 'id' in (zoneRaw as Record<string, unknown>)
      ? String((zoneRaw as { id?: unknown }).id ?? '')
      : String(zoneRaw ?? '')
  return {
    id: String((d as { id?: unknown }).id ?? ''),
    tenant,
    zone: zoneId,
    code: String((d as { code?: unknown }).code ?? ''),
    basePrice: Number((d as { basePrice?: unknown }).basePrice ?? 0) || 0,
    freeAboveSubtotal: Number((d as { freeAboveSubtotal?: unknown }).freeAboveSubtotal ?? 0) || 0,
    minimumSubtotal: ((d as { minimumSubtotal?: unknown }).minimumSubtotal ?? null) as number | null | undefined,
    maximumSubtotal: ((d as { maximumSubtotal?: unknown }).maximumSubtotal ?? null) as number | null | undefined,
    enabled: Boolean((d as { enabled?: unknown }).enabled ?? true),
  }
}
