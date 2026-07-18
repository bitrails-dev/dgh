// Shopper cart endpoints: GET/POST /api/commerce/store/:tenantSlug/cart. The HTTP routes are thin
// wrappers (tenant-by-slug → feature 404 via resolveStoreTenant) over two directly-callable
// orchestration functions, upsertCart and readCart — the same shape as commerce/payments (thin
// endpoint over a testable orchestration core). Tests drive the orchestration directly with a real
// Payload + migrated temp DB.
//
// `items` is a client-mutable snapshot of [{sku, quantity}] keyed by the anonymous `cartToken`
// (cookie). The server NEVER trusts client prices: every read/write re-runs quoteItems, which
// resolves prices from the tenant's active catalog. A line whose product is unknown/inactive still
// persists (it is the shopper's intent) but is reported back as `quoteError` so the UI can flag it;
// the rest of the quote is null until the line is fixed or removed.
import type { Endpoint, Payload, PayloadRequest } from 'payload'
import { loadCommerceSettings, quoteItems, readJsonBody, resolveStoreTenant } from './shared'

export type CartResponse = { status: number; body: Record<string, unknown> }

// Carts live for 30 days from the last mutation; every upsert refreshes `expiresAt`.
const CART_TTL_MS = 30 * 24 * 60 * 60 * 1000

export interface CartLine {
  sku: string
  quantity: number
}

// Validate + normalize the client-supplied items snapshot. Returns null when the shape is wrong
// (caller → 400 invalid_items). An empty array is valid — it clears the cart. Each entry must be a
// {sku: non-empty string, quantity: positive integer}; sku/quantity are coerced via String/Number.
function validateItems(raw: unknown): CartLine[] | null {
  if (!Array.isArray(raw)) return null
  const items: CartLine[] = []
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') return null
    const { sku, quantity } = entry as { sku?: unknown; quantity?: unknown }
    const skuStr = typeof sku === 'string' ? sku : undefined
    if (!skuStr || skuStr.length === 0) return null
    const qty = Number(quantity)
    if (!Number.isInteger(qty) || qty <= 0) return null
    items.push({ sku: String(skuStr), quantity: Number(qty) })
  }
  return items
}

// Defensive re-normalization of the stored snapshot on read (it was normalized on write, but the
// field is free-form JSON). Drops any entry that lost its shape rather than failing the read.
function readStoredItems(raw: unknown): CartLine[] {
  if (!Array.isArray(raw)) return []
  const items: CartLine[] = []
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue
    const { sku, quantity } = entry as { sku?: unknown; quantity?: unknown }
    if (typeof sku !== 'string' || sku.length === 0) continue
    const qty = Number(quantity)
    if (!Number.isInteger(qty) || qty <= 0) continue
    items.push({ sku, quantity: qty })
  }
  return items
}

// Re-quote persisted items and shape the response. Empty cart → null quote. A quote failure (unknown
// or inactive sku) keeps the cart and reports `quoteError`; the snapshot is the shopper's intent, so
// the line is not silently dropped. The HTTP status is always 200 here — the caller (upsert/read)
// only returns non-200 from input validation.
async function buildQuoteBody(
  payload: Payload,
  tenantId: number | string,
  cartToken: string,
  items: CartLine[],
): Promise<CartResponse> {
  if (items.length === 0) {
    return { status: 200, body: { cartToken, items: [], quote: null } }
  }
  const result = await quoteItems(payload, tenantId, items)
  if (result.ok) {
    return {
      status: 200,
      // snapshot already carries `currency` (set by quoteItems from commerce-settings); spread it as
      // the quote so the storefront sees currency + grandTotal + lines in one object.
      body: { cartToken, items, quote: { ...result.snapshot } },
    }
  }
  return {
    status: 200,
    body: {
      cartToken,
      items,
      quote: null,
      quoteError: { code: result.code, detail: result.detail },
    },
  }
}

// Upsert the cart for (tenant, cartToken) with the supplied items snapshot, then re-quote. Validates
// cartToken + items first (400). Existing carts are updated in place (items replaced, expiresAt
// refreshed); a new cart is created active with the tenant's currency and a 30-day expiry. The quote
// is recomputed from the catalog on every call — client prices are never persisted or echoed.
export async function upsertCart(
  payload: Payload,
  tenantId: number | string,
  input: { cartToken?: unknown; items?: unknown },
): Promise<CartResponse> {
  const cartToken = input.cartToken
  if (typeof cartToken !== 'string' || cartToken.length === 0) {
    return { status: 400, body: { error: 'missing_cart_token' } }
  }
  const items = validateItems(input.items)
  if (items === null) {
    return { status: 400, body: { error: 'invalid_items' } }
  }

  const settings = await loadCommerceSettings(payload, tenantId)
  const currency = settings?.currency ?? 'EGP'
  const expiresAt = new Date(Date.now() + CART_TTL_MS).toISOString()

  const { docs } = await payload.find({
    collection: 'carts',
    where: { and: [{ tenant: { equals: tenantId } }, { cartToken: { equals: cartToken } }] },
    overrideAccess: true,
    limit: 1,
  })
  const existing = docs[0] as { id: number | string } | undefined

  if (existing) {
    await payload.update({
      collection: 'carts',
      id: existing.id,
      overrideAccess: true,
      data: { items, expiresAt },
    })
  } else {
    await payload.create({
      collection: 'carts',
      overrideAccess: true,
      // The multi-tenant plugin types the injected `tenant` field as `number`, but tenantId is
      // resolved as `number | string`; cast to match the rest of the codebase's tenant writes.
      data: { tenant: tenantId, cartToken, items, currency, status: 'active', expiresAt } as any,
    })
  }

  return buildQuoteBody(payload, tenantId, cartToken, items)
}

// Read the cart for (tenant, cartToken) and re-quote from the catalog. An unknown token is an empty
// cart (200, null quote) — never an error. A missing/empty cartToken is a 400 so the `equals` query
// never runs against an undefined value.
export async function readCart(
  payload: Payload,
  tenantId: number | string,
  cartToken: unknown,
): Promise<CartResponse> {
  if (typeof cartToken !== 'string' || cartToken.length === 0) {
    return { status: 400, body: { error: 'missing_cart_token' } }
  }
  const { docs } = await payload.find({
    collection: 'carts',
    where: { and: [{ tenant: { equals: tenantId } }, { cartToken: { equals: cartToken } }] },
    overrideAccess: true,
    limit: 1,
  })
  const cart = docs[0] as { items?: unknown } | undefined
  const items = readStoredItems(cart?.items)
  return buildQuoteBody(payload, tenantId, cartToken, items)
}

// POST body {cartToken, items} → upsert. GET ?cartToken=TOKEN → read. Both 404 when the tenant slug
// is unknown or lacks the commerce feature (resolveStoreTenant mirrors handleProviderWebhook).
export const cartEndpoints: Endpoint[] = [
  {
    path: '/commerce/store/:tenantSlug/cart',
    method: 'get',
    handler: async (req: PayloadRequest): Promise<Response> => {
      const tenantSlug = req.routeParams?.tenantSlug as string | undefined
      const tenant = tenantSlug ? await resolveStoreTenant(req.payload, tenantSlug) : null
      if (!tenant) return Response.json({ error: 'not_found' }, { status: 404 })
      const url = new URL(req.url ?? '/', 'http://localhost')
      const cartToken = url.searchParams.get('cartToken') ?? undefined
      const result = await readCart(req.payload, tenant.id, cartToken)
      return Response.json(result.body, { status: result.status })
    },
  },
  {
    path: '/commerce/store/:tenantSlug/cart',
    method: 'post',
    handler: async (req: PayloadRequest): Promise<Response> => {
      const tenantSlug = req.routeParams?.tenantSlug as string | undefined
      const tenant = tenantSlug ? await resolveStoreTenant(req.payload, tenantSlug) : null
      if (!tenant) return Response.json({ error: 'not_found' }, { status: 404 })
      const body = (await readJsonBody(req)) as { cartToken?: unknown; items?: unknown } | null
      const result = await upsertCart(req.payload, tenant.id, {
        cartToken: body?.cartToken,
        items: body?.items,
      })
      return Response.json(result.body, { status: result.status })
    },
  },
]
