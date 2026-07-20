// Shared helpers for the shopper-facing store endpoints (/api/commerce/store/:tenantSlug/*). Every
// store concern (catalog, quote, cart, auth, checkout) calls these so tenant resolution, the feature
// gate, commerce-settings, and JSON body parsing each have ONE implementation. Mirrors the webhook
// pattern (tenant-by-slug → feature 404) in commerce/payments.
//
// Wave F2 retired the legacy `quoteItems`/`resolvePricedLines` helpers that read the legacy
// `products` collection; the plugin-first quote path lives in ./quote-plugin (quoteStoreItems /
// quoteStoreCart, reading store-products / store-variants). The four helpers below are still used by
// the plugin-first paths (catalog, quote, cart-v2, auth, checkout-handler, processCheckout).
import type { Payload, PayloadRequest } from 'payload'

export interface StoreItem {
  sku: string
  quantity: number
}

// Tenant-by-slug → feature gate. Returns null for an unknown tenant or one without `commerce`; the
// caller turns null into a 404 (exactly like handleProviderWebhook in commerce/payments/webhook.ts).
export async function resolveStoreTenant(
  payload: Payload,
  tenantSlug: string,
): Promise<{ id: number | string } | null> {
  const { docs } = await payload.find({
    collection: 'tenants',
    where: { slug: { equals: tenantSlug } },
    overrideAccess: true,
    limit: 1,
  })
  const t = docs[0] as { id: number | string; features?: string[] | null } | undefined
  if (!t || !(t.features ?? []).includes('commerce')) return null
  return { id: t.id }
}

// Per-tenant commerce settings: currency + tax mode (+ sandbox flag). Quote/checkout resolve these
// server-side; browsers never supply currency or tax mode. Returns null if the tenant has no doc.
export async function loadCommerceSettings(
  payload: Payload,
  tenantId: number | string,
): Promise<{ currency: string; taxMode: 'inclusive' | 'exclusive'; sandbox: boolean } | null> {
  const { docs } = await payload.find({
    collection: 'commerce-settings',
    where: { tenant: { equals: tenantId } },
    overrideAccess: true,
    limit: 1,
  })
  const s = docs[0] as { currency?: string; taxMode?: string; sandbox?: boolean } | undefined
  if (!s) return null
  return {
    currency: s.currency ?? 'EGP',
    taxMode: s.taxMode === 'inclusive' ? 'inclusive' : 'exclusive',
    sandbox: Boolean(s.sandbox),
  }
}

// Read + parse a JSON request body; null on any read/parse failure (the caller returns 400).
export async function readJsonBody(req: PayloadRequest): Promise<unknown | null> {
  try {
    const text = typeof req.text === 'function' ? await req.text() : ''
    return text ? JSON.parse(text) : null
  } catch {
    return null
  }
}
