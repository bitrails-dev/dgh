// Shared helpers for the shopper-facing store endpoints (/api/commerce/store/:tenantSlug/*). Every
// store concern (catalog, quote, cart, auth, checkout, pay) calls these so tenant resolution, the
// feature gate, commerce-settings, and server-authoritative price resolution each have ONE
// implementation. Mirrors the webhook pattern (tenant-by-slug → feature 404) in commerce/payments.
import type { Payload, PayloadRequest } from 'payload'
import { money, type Money } from '../money'
import { quote, type QuoteSnapshot } from '../pricing'

export interface StoreItem {
  sku: string
  quantity: number
}

export interface ResolvedLine {
  sku: string
  quantity: number
  unitPrice: Money
  taxBps: number
  name?: string
  productId: number | string
  variantKey?: string
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

type Variant = { sku?: string; name?: string; price?: number; taxBps?: number }
type Product = {
  id: number | string
  sku?: string
  name?: string
  price?: number
  taxBps?: number
  variants?: Variant[] | null
}

// Server-authoritative price resolution. Loads the tenant's active products ONCE and indexes every
// purchasable sku — the product's base sku plus each variant's sku — to its resolved price/tax.
// checkout() and the storefront quote/cart endpoints all go through here, so a variant sku is the
// single key into both pricing and inventory. ponytail: one query loads all active products for the
// tenant (catalogs are small per tenant); paginate if a tenant ever has hundreds of products.
export async function resolvePricedLines(
  payload: Payload,
  tenantId: number | string,
  items: StoreItem[],
  currency: string,
): Promise<
  | { ok: true; lines: ResolvedLine[] }
  | { ok: false; code: 'PRODUCT_NOT_FOUND' | 'INVALID'; detail?: unknown }
> {
  if (!Array.isArray(items) || items.length === 0) return { ok: false, code: 'INVALID', detail: 'no_items' }
  const { docs } = await payload.find({
    collection: 'products',
    where: { and: [{ tenant: { equals: tenantId } }, { status: { equals: 'active' } }] },
    overrideAccess: true,
    limit: 500,
  })
  const index = new Map<
    string,
    { productId: number | string; unitPrice: number; taxBps: number; name?: string; variantKey?: string }
  >()
  for (const p of docs as Product[]) {
    if (p.sku) {
      index.set(String(p.sku), { productId: p.id, unitPrice: Number(p.price ?? 0), taxBps: Number(p.taxBps ?? 0), name: p.name })
    }
    for (const v of p.variants ?? []) {
      if (v.sku) {
        index.set(String(v.sku), {
          productId: p.id,
          unitPrice: Number(v.price ?? p.price ?? 0),
          taxBps: Number(v.taxBps ?? p.taxBps ?? 0),
          name: v.name ?? p.name,
          variantKey: String(v.sku),
        })
      }
    }
  }
  const lines: ResolvedLine[] = []
  for (const item of items) {
    const sku = String(item.sku ?? '')
    const qty = Number(item.quantity)
    if (!sku || !Number.isInteger(qty) || qty <= 0) {
      return { ok: false, code: 'INVALID', detail: { sku, quantity: item.quantity } }
    }
    const hit = index.get(sku)
    if (!hit) return { ok: false, code: 'PRODUCT_NOT_FOUND', detail: { sku } }
    lines.push({
      sku,
      quantity: qty,
      unitPrice: money(hit.unitPrice, currency),
      taxBps: hit.taxBps,
      name: hit.name,
      productId: hit.productId,
      variantKey: hit.variantKey,
    })
  }
  return { ok: true, lines }
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

// The server-authoritative quote step shared by the quote and cart endpoints (and a reference shape
// for checkout): load the tenant's commerce settings → resolve prices → run the pricing engine.
// Browsers supply only items; currency/tax/prices are all resolved here. Errors carry an HTTP status
// so the thin endpoint handler can pass it through unchanged.
export type QuoteResult =
  | { ok: true; currency: string; taxMode: 'inclusive' | 'exclusive'; snapshot: QuoteSnapshot }
  | { ok: false; status: number; code: string; detail?: unknown }

export async function quoteItems(
  payload: Payload,
  tenantId: number | string,
  items: StoreItem[],
): Promise<QuoteResult> {
  const settings = await loadCommerceSettings(payload, tenantId)
  if (!settings) return { ok: false, status: 503, code: 'commerce_not_configured' }
  const resolved = await resolvePricedLines(payload, tenantId, items, settings.currency)
  if (!resolved.ok) {
    return {
      ok: false,
      status: resolved.code === 'INVALID' ? 400 : 422,
      code: resolved.code === 'INVALID' ? 'invalid_items' : 'product_not_found',
      detail: resolved.detail,
    }
  }
  const snapshot = quote({
    currency: settings.currency,
    taxMode: settings.taxMode,
    lines: resolved.lines.map((l) => ({
      key: l.sku,
      sku: l.sku,
      quantity: l.quantity,
      unitPrice: l.unitPrice,
      taxBps: l.taxBps,
    })),
  })
  return { ok: true, currency: settings.currency, taxMode: settings.taxMode, snapshot }
}
