// Public storefront quote route: POST /api/commerce/store/:tenantSlug/quote
// Server-authoritative price resolution. The browser posts ONLY items (sku + quantity); the server
// resolves the tenant's currency, tax mode, and active prices, runs the pricing engine, and returns a
// QuoteSnapshot the storefront renders (and the order later persists verbatim). Client-supplied
// prices are never trusted — the body has no price field by contract. This handler is a thin wrapper
// over quoteItems (commerce/store/shared.ts) so tenant resolution, the feature 404, settings load,
// price resolution, and the engine each have ONE implementation shared with cart/checkout — mirroring
// the webhook pattern in commerce/payments.
import type { Endpoint, PayloadRequest } from 'payload'
import { quoteItems, readJsonBody, resolveStoreTenant } from './shared'

async function handleQuote(req: PayloadRequest): Promise<Response> {
  const tenantSlug = req.routeParams?.tenantSlug as string | undefined
  if (!tenantSlug) return Response.json({ error: 'missing_tenant' }, { status: 400 })

  const tenant = await resolveStoreTenant(req.payload, tenantSlug)
  if (!tenant) return Response.json({ error: 'not_found' }, { status: 404 })

  const body = await readJsonBody(req)
  const items = (body as { items?: unknown } | null)?.items
  if (!Array.isArray(items) || items.length === 0) {
    return Response.json({ error: 'invalid_items' }, { status: 400 })
  }

  const result = await quoteItems(req.payload, tenant.id, items as { sku: string; quantity: number }[])
  if (!result.ok) {
    return Response.json({ error: result.code, detail: result.detail }, { status: result.status })
  }
  // snapshot already carries currency + taxMode; the explicit keys restate them as the authoritative
  // response fields (placed after the spread so tsc does not flag them as overwritten — values match).
  return Response.json({
    ...result.snapshot,
    currency: result.currency,
    taxMode: result.taxMode,
  })
}

export const quoteEndpoints: Endpoint[] = [
  { path: '/commerce/store/:tenantSlug/quote', method: 'post', handler: handleQuote },
]
