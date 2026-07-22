// Signed plugin-first storefront cart endpoints (Wave E3 continuation, plan §3.7). The legacy
// commerce/store/cart.ts reads/writes the legacy `carts` collection keyed by a client `cartToken`
// snapshot; this module is the plugin-first replacement over the ecommerce plugin's `store-carts`
// collection + its server operations (addItem/updateItem/removeItem/clearCart).
//
// Every handler crosses the commerce-gateway trust boundary first (withVerifiedCommerceGateway — the
// ONLY surface allowed overrideAccess for guest commerce), then reads `cartId` from the verified
// body (writes) or query (GET). The Astro proxy injects that cartId from the Secure HttpOnly
// `store_cart_v2` cookie and plants/clears the cookie from the response `cartId`. Browser totals are
// never trusted — the response quote is server-authoritative via quoteStoreCart (Lane A).
//
// Guest-cart access: the plugin's read/update/delete access requires req.context.cartSecret to match
// the cart's auto-generated `secret`. In the verified gateway context we read the cart (and its
// secret) once with overrideAccess, then pass that secret to each plugin op. Merge-on-login is
// intentionally skipped (YAGNI; the plugin exposes no mergeCart op, only its endpoint) — a cart is
// guest-keyed by cookie; the order is tagged with the customer at checkout.
import type { Endpoint, Payload, PayloadRequest } from 'payload'
import { addItem, updateItem, removeItem, clearCart } from '@payloadcms/plugin-ecommerce'
import { withVerifiedCommerceGateway } from './gateway'
import { quoteStoreCart, type StorefrontQuote } from './quote-plugin'
import { resolveSellableBySku, normalizeSku } from '../inventory/sku-resolution'
import { STORE_COLLECTION_SLUGS } from '../plugin/slugs'
import { loadCommerceSettings } from './shared'

const CARTS = STORE_COLLECTION_SLUGS.carts

export interface CartProductSummary {
  id: number | string
  name?: string
  priceInEGP?: number
  images?: unknown
}
export interface CartViewItem {
  sku: string
  quantity: number
  product?: CartProductSummary
}
export interface CartResponseBody {
  cartId: string
  items: CartViewItem[]
  quote: StorefrontQuote | null
  quoteError?: { code: string }
  /**
   * NH15: the cart's plugin secret. Surfaced on the create response so the trusted Astro proxy can
   * store it in a separate Secure HttpOnly cookie (e.g. `store_cart_v2_secret`) and inject it into
   * the signed body of subsequent cart ops. The browser NEVER sees this value — the proxy strips it
   * before forwarding, exactly like the customer session token on login. Empty for legacy carts that
   * have no secret (admin-created).
   */
  secret?: string
}
export type CartResponse = { status: number; body: CartResponseBody }

// Read a relationship ref as a doc id whether it stored a populated doc or a bare id (mirrors the C4
// loader's relId).
function relId(v: unknown): number | string | undefined {
  if (v === null || v === undefined) return undefined
  if (typeof v === 'object') {
    const id = (v as { id?: unknown }).id
    return id === undefined ? undefined : (id as number | string)
  }
  return v as number | string
}

// The plugin cart ops hardcode overrideAccess:false and authorize via req.context.cartSecret
// (createRequestWithSecret injects the secret into the req it is given — with no req the secret is
// ignored and guest access is denied). Thread the verified req through; default to a context-only req
// for the directly-callable orchestration used in tests.
function opReq(req: PayloadRequest | undefined): PayloadRequest {
  return (req ?? { context: {} }) as PayloadRequest
}

type CartDoc = { id: number | string; secret?: string; items?: unknown[]; tenant?: unknown }

// NH15 (default): constant-time string compare so a timing-attack-based secret probe cannot shortcut
// on the first mismatched byte. node:crypto.timingSafeEqual requires equal-length buffers; we hash
// both inputs to a fixed-length digest first so a length mismatch (a common case for a wrong/absent
// secret) does not throw and does not leak length either. Returns true on exact match only.
async function constantTimeEqual(a: string | undefined | null, b: string | undefined | null): Promise<boolean> {
  if (typeof a !== 'string' || typeof b !== 'string' || a === '' || b === '') return false
  const { createHash, timingSafeEqual } = await import('node:crypto')
  const ha = createHash('sha256').update(a).digest()
  const hb = createHash('sha256').update(b).digest()
  return timingSafeEqual(ha, hb)
}

// Fetch the cart (overrideAccess — permitted inside the verified gateway context) tenant-scoped, with
// its plugin secret. Returns null when the cart is absent, belongs to another tenant (ownership =
// scoped read, the same invariant the D1/D2 adapters rely on), OR fails the NH15 secret check.
//
// NH15 (default): the caller MUST pass a `secret` matching `cart.secret` to authorize reading a
// guest cart's contents. The plugin's cart model mints a per-cart `secret` on create; the storefront
// stores it client-side (e.g. a separate HttpOnly cookie set by the Astro proxy from the create
// response) and the gateway-signed body carries it back on every subsequent cart op. A cart with NO
// secret set bypasses the check (legacy / admin-created carts). This is defense-in-depth — the
// gateway signature already authenticates the request, but a stolen cartId alone (e.g. via a leaky
// log) must NOT be enough to read another customer's cart. The constant-time compare prevents
// timing oracles on the secret itself.
//
// Default chosen for reversibility: the secret param is optional and a missing/empty cart secret
// short-circuits the check, so existing carts without a secret continue to work; tighten by always
// requiring the secret once every live cart has one. Note: the Astro proxy cookie-injection is a
// separate concern (NL8 already fixed to cover checkout).
async function getCart(
  payload: Payload,
  tenantId: number | string,
  cartId: number | string | undefined | null,
  secret?: string,
): Promise<CartDoc | null> {
  if (cartId === undefined || cartId === null || cartId === '') return null
  let doc: CartDoc | null = null
  try {
    doc = (await payload.findByID({
      collection: CARTS,
      id: cartId as never,
      overrideAccess: true,
      showHiddenFields: true,
      depth: 0,
    })) as CartDoc | null
  } catch {
    return null
  }
  if (!doc) return null
  const tId = relId(doc.tenant)
  if (tId === undefined || String(tId) !== String(tenantId)) return null
  // NH15: secret enforcement. A cart with no secret set is legacy/admin-owned — bypass the check.
  // Otherwise the caller-supplied secret MUST match (constant-time).
  if (doc.secret) {
    const ok = await constantTimeEqual(secret, doc.secret)
    if (!ok) return null
  }
  return doc
}

// Create a guest `store-carts` doc and return it with its generated secret. The plugin's beforeChange
// hook mints the secret + the afterRead hook surfaces it on the create response.
async function createGuestCart(
  payload: Payload,
  tenantId: number | string,
  currency: string,
): Promise<CartDoc> {
  const doc = (await payload.create({
    collection: CARTS,
    overrideAccess: true,
    data: { tenant: tenantId, currency } as any,
  })) as CartDoc
  // The create response carries the freshly-minted secret; fall back to a re-read if a hook path
  // stripped it. The secret is needed to authorize the subsequent plugin op on this guest cart.
  // We bypass the NH15 caller-secret check on this re-read (read directly via the Local API) because
  // WE just created the cart — the caller has not received the secret yet, so the secret check would
  // incorrectly reject our own just-created row.
  if (!doc.secret) {
    try {
      const reread = (await payload.findByID({
        collection: CARTS,
        id: doc.id,
        overrideAccess: true,
        showHiddenFields: true,
        depth: 0,
      })) as CartDoc | null
      if (reread) return reread
    } catch {
      /* fall through to return doc */
    }
  }
  return doc
}

// Resolve a raw cart-items array to the storefront shape: each item's sku + a product summary. Variant
// lines take their sku + price from the variant doc, name/images from the parent product. Items that
// have lost their sellable doc are dropped from the view (the authoritative quote flags them too).
async function resolveCartItems(
  payload: Payload,
  tenantId: number | string,
  rawItems: unknown,
): Promise<CartViewItem[]> {
  if (!Array.isArray(rawItems)) return []
  const out: CartViewItem[] = []
  for (const entry of rawItems) {
    if (!entry || typeof entry !== 'object') continue
    const item = entry as { product?: unknown; variant?: unknown; quantity?: unknown }
    const quantity = Number(item.quantity ?? 0)
    if (!Number.isInteger(quantity) || quantity <= 0) continue
    const variantId = relId(item.variant)
    const productId = relId(item.product)
    if (productId === undefined) continue

    let sku: string | undefined
    let priceInEGP: number | undefined
    let summary: CartProductSummary | undefined

    if (variantId !== undefined) {
      const vFind = await payload.find({
        collection: STORE_COLLECTION_SLUGS.variants,
        where: { and: [{ id: { equals: variantId } }, { tenant: { equals: tenantId } }] },
        overrideAccess: true,
        limit: 1,
      })
      const v = vFind.docs[0] as { sku?: string; priceInEGP?: number } | undefined
      if (!v) continue
      sku = typeof v.sku === 'string' ? normalizeSku(v.sku) : undefined
      if (typeof v.priceInEGP === 'number') priceInEGP = v.priceInEGP
    }
    const pFind = await payload.find({
      collection: STORE_COLLECTION_SLUGS.products,
      where: { and: [{ id: { equals: productId } }, { tenant: { equals: tenantId } }] },
      overrideAccess: true,
      limit: 1,
    })
    const p = pFind.docs[0] as { sku?: string; priceInEGP?: number; name?: string; images?: unknown } | undefined
    if (!p) continue
    if (sku === undefined && typeof p.sku === 'string') sku = normalizeSku(p.sku)
    if (priceInEGP === undefined && typeof p.priceInEGP === 'number') priceInEGP = p.priceInEGP
    if (!sku) continue
    summary = { id: productId, name: typeof p.name === 'string' ? p.name : undefined, priceInEGP, images: p.images }
    out.push({ sku, quantity, product: summary })
  }
  return out
}

// The storefront cart view: items (sku + product summary) + the server-authoritative quote. A missing
// cart is an empty cart (200, null quote) — never an error. A quote failure keeps the items and
// reports quoteError so the UI can flag totals. The `secret` (NH15) is threaded straight through to
// the getCart authorization check, and the loaded cart's secret is surfaced on the response so the
// trusted proxy can persist it for the next call.
async function buildCartView(
  payload: Payload,
  tenantId: number | string,
  cartId: number | string | undefined | null,
  secret?: string,
): Promise<CartResponse> {
  const cart = await getCart(payload, tenantId, cartId, secret)
  if (!cart) return { status: 200, body: { cartId: '', items: [], quote: null } }
  const rawItems = Array.isArray(cart.items) ? cart.items : []
  const items = await resolveCartItems(payload, tenantId, rawItems)
  const cartSecret = typeof cart.secret === 'string' && cart.secret.length > 0 ? cart.secret : undefined
  // Empty cart → null quote (matches the legacy cart + the storefront Cart contract).
  if (rawItems.length === 0) {
    return { status: 200, body: { cartId: String(cart.id), items: [], quote: null, ...(cartSecret !== undefined ? { secret: cartSecret } : {}) } }
  }
  const body: CartResponseBody = { cartId: String(cart.id), items, quote: null, ...(cartSecret !== undefined ? { secret: cartSecret } : {}) }
  const quoteRes = await quoteStoreCart(payload, tenantId, cart.id)
  if (quoteRes.ok) body.quote = quoteRes.quote
  else body.quoteError = { code: quoteRes.code }
  return { status: 200, body }
}

// Find the plugin cart-item row id for a storefront SKU, so update/remove (which key by SKU in the
// URL) can call updateItem/removeItem (which key by row id). Resolves the SKU to {product, variant},
// then matches the cart item by those refs.
async function findItemRowIdBySku(
  payload: Payload,
  tenantId: number | string,
  cart: CartDoc,
  sku: string,
): Promise<string | undefined> {
  const resolved = await resolveSellableBySku({ payload, tenantId, sku })
  if (!resolved.ok) return undefined
  const { productId, variantId } = resolved.sellable
  const items = Array.isArray(cart.items) ? cart.items : []
  for (const entry of items) {
    if (!entry || typeof entry !== 'object') continue
    const item = entry as { id?: unknown; product?: unknown; variant?: unknown }
    if (String(relId(item.product)) !== String(productId)) continue
    const iv = relId(item.variant)
    const matches = variantId == null ? iv === undefined : iv !== undefined && String(iv) === String(variantId)
    if (matches && item.id !== undefined && item.id !== null) return String(item.id)
  }
  return undefined
}

const ok = (body: CartResponseBody): CartResponse => ({ status: 200, body })

// ── Directly-callable orchestration (post-gateway; tenantId is the ONLY trusted identity) ───────

export async function readPluginCart(
  payload: Payload,
  tenantId: number | string,
  cartId: number | string | undefined | null,
  secret?: string,
): Promise<CartResponse> {
  return buildCartView(payload, tenantId, cartId, secret)
}

export async function pluginAddItem(
  payload: Payload,
  tenantId: number | string,
  input: { cartId?: number | string | null; sku: unknown; quantity: unknown; secret?: string },
  req?: PayloadRequest,
): Promise<CartResponse | { status: number; body: Record<string, unknown> }> {
  const sku = normalizeSku(input.sku)
  const quantity = Number(input.quantity)
  if (!sku || !Number.isInteger(quantity) || quantity <= 0) {
    return { status: 400, body: { error: 'invalid_item', detail: { sku: input.sku, quantity: input.quantity } } }
  }
  const resolved = await resolveSellableBySku({ payload, tenantId, sku })
  if (!resolved.ok) return { status: 422, body: { error: 'product_not_found', detail: { sku } } }

  // Ensure a cart exists: reuse the cookie cart, else mint a guest cart on first add. NH15: the
  // caller-supplied `secret` authorizes reading the existing guest cart; a missing/wrong secret
  // means getCart returns null and a fresh cart is minted (matches the prior "no cart → create"
  // behavior for an unknown cartId). The minted cart's new secret is what the response then carries.
  let cart = await getCart(payload, tenantId, input.cartId ?? null, input.secret)
  const settings = await loadCommerceSettings(payload, tenantId)
  if (!settings) return { status: 503, body: { error: 'commerce_not_configured' } }
  if (!cart) cart = await createGuestCart(payload, tenantId, settings.currency)
  const secret = cart.secret

  const item = { product: resolved.sellable.productId, ...(resolved.sellable.variantId != null ? { variant: resolved.sellable.variantId } : {}) }
  const res = await addItem({
    payload,
    cartsSlug: CARTS,
    cartID: cart.id,
    item: item as never,
    quantity,
    req: opReq(req),
    ...(secret ? { secret } : {}),
  } as never)
  if (!res.success) return { status: 404, body: { error: 'cart_not_found' } }
  return buildCartView(payload, tenantId, cart.id, secret)
}

export async function pluginUpdateItem(
  payload: Payload,
  tenantId: number | string,
  input: { cartId?: number | string | null; sku: unknown; quantity: unknown; secret?: string },
  req?: PayloadRequest,
): Promise<CartResponse | { status: number; body: Record<string, unknown> }> {
  const sku = normalizeSku(input.sku)
  const quantity = Number(input.quantity)
  if (!sku || !Number.isInteger(quantity) || quantity < 0) {
    return { status: 400, body: { error: 'invalid_item', detail: { sku: input.sku, quantity: input.quantity } } }
  }
  const cart = await getCart(payload, tenantId, input.cartId ?? null, input.secret)
  if (!cart) return { status: 404, body: { error: 'cart_not_found' } }
  const itemID = await findItemRowIdBySku(payload, tenantId, cart, sku)
  if (itemID === undefined) return { status: 404, body: { error: 'item_not_found', detail: { sku } } }
  const op = { req: opReq(req), ...(cart.secret ? { secret: cart.secret } : {}) }
  // quantity 0 removes (the plugin's removeOnZero default).
  if (quantity === 0) {
    await removeItem({ payload, cartsSlug: CARTS, cartID: cart.id, itemID, ...op } as never)
  } else {
    const res = await updateItem({ payload, cartsSlug: CARTS, cartID: cart.id, itemID, quantity, ...op } as never)
    if (!res.success) return { status: 404, body: { error: 'item_not_found' } }
  }
  return buildCartView(payload, tenantId, cart.id, cart.secret)
}

export async function pluginRemoveItem(
  payload: Payload,
  tenantId: number | string,
  input: { cartId?: number | string | null; sku: unknown; secret?: string },
  req?: PayloadRequest,
): Promise<CartResponse | { status: number; body: Record<string, unknown> }> {
  const sku = normalizeSku(input.sku)
  if (!sku) return { status: 400, body: { error: 'invalid_item', detail: { sku: input.sku } } }
  const cart = await getCart(payload, tenantId, input.cartId ?? null, input.secret)
  if (!cart) return { status: 404, body: { error: 'cart_not_found' } }
  const itemID = await findItemRowIdBySku(payload, tenantId, cart, sku)
  if (itemID === undefined) {
    // Idempotent remove of an absent line → return the cart view unchanged.
    return buildCartView(payload, tenantId, cart.id, cart.secret)
  }
  await removeItem({ payload, cartsSlug: CARTS, cartID: cart.id, itemID, req: opReq(req), ...(cart.secret ? { secret: cart.secret } : {}) } as never)
  return buildCartView(payload, tenantId, cart.id, cart.secret)
}

export async function pluginClearCart(
  payload: Payload,
  tenantId: number | string,
  cartId: number | string | undefined | null,
  req?: PayloadRequest,
  secret?: string,
): Promise<CartResponse> {
  const cart = await getCart(payload, tenantId, cartId, secret)
  if (!cart) return ok({ cartId: '', items: [], quote: null })
  await clearCart({ payload, cartsSlug: CARTS, cartID: cart.id, req: opReq(req), ...(cart.secret ? { secret: cart.secret } : {}) } as never)
  return buildCartView(payload, tenantId, cart.id, cart.secret)
}

// ── Thin signed HTTP handlers ─────────────────────────────────────────────────────────────────

function cartIdFromQuery(req: PayloadRequest): string | undefined {
  const raw = (req as PayloadRequest & { url?: string }).url
  if (!raw) return undefined
  try {
    return new URL(raw, 'http://localhost').searchParams.get('cartId') ?? undefined
  } catch {
    return undefined
  }
}

// NH15: the cart secret arrives in the gateway-signed body (POST/PATCH) or query (GET/DELETE no
// body). The Astro proxy stores it in a separate HttpOnly cookie (set from the create response) and
// injects it into the signed request alongside cartId. Treat it as opaque here — getCart does the
// constant-time compare against cart.secret.
function secretFromQuery(req: PayloadRequest): string | undefined {
  const raw = (req as PayloadRequest & { url?: string }).url
  if (!raw) return undefined
  try {
    return new URL(raw, 'http://localhost').searchParams.get('secret') ?? undefined
  } catch {
    return undefined
  }
}

async function verify(req: PayloadRequest, tenantSlug: string | undefined) {
  if (!tenantSlug) return { ok: false as const, res: Response.json({ error: 'missing_tenant' }, { status: 400 }) }
  let rawText = ''
  try {
    rawText = typeof req.text === 'function' ? await req.text() : ''
  } catch {
    rawText = ''
  }
  const bodyBytes = Buffer.from(rawText ?? '', 'utf8')
  const v = await withVerifiedCommerceGateway({ req, tenantSlug, bodyBytes })
  if (!v.ok) return { ok: false as const, res: Response.json(v.body, { status: v.status }) }
  let body: unknown = null
  try {
    body = rawText ? JSON.parse(rawText) : null
  } catch {
    body = null
  }
  return { ok: true as const, ctx: v.context, body }
}

export const pluginCartEndpoints: Endpoint[] = [
  {
    path: '/commerce/store/:tenantSlug/cart',
    method: 'get',
    handler: async (req: PayloadRequest): Promise<Response> => {
      const tenantSlug = req.routeParams?.tenantSlug as string | undefined
      const v = await verify(req, tenantSlug)
      if (!v.ok) return v.res
      const r = await readPluginCart(req.payload, v.ctx.tenantId, cartIdFromQuery(req), secretFromQuery(req))
      return Response.json(r.body, { status: r.status })
    },
  },
  {
    path: '/commerce/store/:tenantSlug/cart/items',
    method: 'post',
    handler: async (req: PayloadRequest): Promise<Response> => {
      const tenantSlug = req.routeParams?.tenantSlug as string | undefined
      const v = await verify(req, tenantSlug)
      if (!v.ok) return v.res
      const b = (v.body as { cartId?: unknown; sku?: unknown; quantity?: unknown; secret?: unknown } | null) ?? {}
      const r = await pluginAddItem(req.payload, v.ctx.tenantId, { cartId: b.cartId as never, sku: b.sku, quantity: b.quantity, secret: b.secret as string | undefined }, req)
      return Response.json(r.body, { status: r.status })
    },
  },
  {
    path: '/commerce/store/:tenantSlug/cart/items/:sku',
    method: 'patch',
    handler: async (req: PayloadRequest): Promise<Response> => {
      const tenantSlug = req.routeParams?.tenantSlug as string | undefined
      const sku = req.routeParams?.sku as string | undefined
      const v = await verify(req, tenantSlug)
      if (!v.ok) return v.res
      const b = (v.body as { cartId?: unknown; quantity?: unknown; secret?: unknown } | null) ?? {}
      const r = await pluginUpdateItem(req.payload, v.ctx.tenantId, { cartId: b.cartId as never, sku, quantity: b.quantity, secret: b.secret as string | undefined }, req)
      return Response.json(r.body, { status: r.status })
    },
  },
  {
    path: '/commerce/store/:tenantSlug/cart/items/:sku',
    method: 'delete',
    handler: async (req: PayloadRequest): Promise<Response> => {
      const tenantSlug = req.routeParams?.tenantSlug as string | undefined
      const sku = req.routeParams?.sku as string | undefined
      const v = await verify(req, tenantSlug)
      if (!v.ok) return v.res
      const b = (v.body as { cartId?: unknown; secret?: unknown } | null) ?? {}
      // DELETE may carry the cartId/secret in the query (no body) for this clear-one path too.
      const r = await pluginRemoveItem(req.payload, v.ctx.tenantId, { cartId: (b.cartId as never) ?? cartIdFromQuery(req), sku, secret: (b.secret as string | undefined) ?? secretFromQuery(req) }, req)
      return Response.json(r.body, { status: r.status })
    },
  },
  {
    path: '/commerce/store/:tenantSlug/cart',
    method: 'delete',
    handler: async (req: PayloadRequest): Promise<Response> => {
      const tenantSlug = req.routeParams?.tenantSlug as string | undefined
      const v = await verify(req, tenantSlug)
      if (!v.ok) return v.res
      const b = (v.body as { cartId?: unknown; secret?: unknown } | null) ?? {}
      const r = await pluginClearCart(req.payload, v.ctx.tenantId, (b.cartId as never) ?? cartIdFromQuery(req), req, (b.secret as string | undefined) ?? secretFromQuery(req))
      return Response.json(r.body, { status: r.status })
    },
  },
]
