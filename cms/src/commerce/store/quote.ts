// Public storefront quote route: POST /api/commerce/store/:tenantSlug/quote
// Server-authoritative, plugin-first price resolution. The browser posts ONLY items (sku + quantity);
// the server resolves the tenant's currency + tax mode, resolves each SKU against the plugin
// `store-products` / `store-variants`, runs the pricing engine, and returns the storefront quote the
// storefront renders. Client-supplied prices are never trusted — the body has no price field by
// contract. This handler is a thin wrapper over quoteStoreItems (commerce/store/quote-plugin.ts);
// the legacy quoteItems read the legacy `products` collection and could not price plugin-first
// catalogs. Gateway-signed by the Astro proxy upstream.
import type { Endpoint, PayloadRequest } from 'payload'
import { readJsonBody, resolveStoreTenant } from './shared'
import { quoteStoreItems } from './quote-plugin'

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

  const result = await quoteStoreItems(
    req.payload,
    tenant.id,
    items as Array<{ sku: unknown; quantity: unknown }>,
  )
  if (!result.ok) {
    return Response.json({ error: result.code, detail: result.detail }, { status: result.status })
  }
  // Flat storefront quote fields + the priced line detail for rendering.
  return Response.json({
    ...result.quote,
    taxMode: result.snapshot.taxMode,
    lines: result.snapshot.lines,
  })
}

export const quoteEndpoints: Endpoint[] = [
  { path: '/commerce/store/:tenantSlug/quote', method: 'post', handler: handleQuote },
]
