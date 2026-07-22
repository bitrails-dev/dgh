// Shopper-facing checkout + pay route: the plugin-first signed checkout (Plan §7 D4). The handler
// reads the raw body ONCE, verifies the commerce-gateway signature/nonce/timestamp over those exact
// bytes (reject before parse — unsigned calls get 401/403 and perform no write), resolves the
// tenant, then runs processCheckout (commerce/checkout/process), which reserves by normalized SKU,
// runs the authoritative quote, and writes store-orders/store-transactions — never a legacy
// collection. Provider webhooks live on separate routes (/commerce/webhooks/{paymob,kashier} and the
// plugin's /api/payments/*) and never reach this handler, so they are inherently gateway-exempt
// (Plan §4.2). The legacy placeOrder orchestration that used to live here was retired in Wave F2.
import type { Endpoint, PayloadRequest } from 'payload'
import { withVerifiedCommerceGateway } from './gateway'
import { processCheckout, type ProcessCheckoutInput } from '../checkout/process'
import { resolveCustomer } from './orders'

// RFC 4122 v4 — the only idempotency-key shape accepted. Rejects malformed keys before any work.
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
export function isUuidV4(key: string | undefined | null): key is string {
  return typeof key === 'string' && UUID_V4.test(key.trim())
}

// POST /commerce/store/:tenantSlug/checkout — the plugin-first signed checkout. The handler reads
// the raw body ONCE, verifies the commerce-gateway signature/nonce/timestamp over those exact bytes
// (reject before parse — unsigned calls get 401/403 and perform no write), resolves the tenant, then
// runs processCheckout. Provider webhooks live on separate routes and never reach this handler, so
// they are inherently gateway-exempt (Plan §4.2).
const checkoutHandler = async (req: PayloadRequest): Promise<Response> => {
  const tenantSlug = req.routeParams?.tenantSlug as string | undefined
  if (!tenantSlug) return Response.json({ error: 'missing_tenant' }, { status: 400 })

  // Read the raw body once — the gateway hashes these exact bytes before any JSON parse.
  let rawText: string
  try {
    rawText = typeof req.text === 'function' ? await req.text() : ''
  } catch {
    return Response.json({ error: 'invalid_body' }, { status: 400 })
  }
  const bodyBytes = Buffer.from(rawText ?? '', 'utf8')

  const verification = await withVerifiedCommerceGateway({ req, tenantSlug, bodyBytes })
  if (!verification.ok) return Response.json(verification.body, { status: verification.status })

  // NC2 (default): honor an optional authenticated customer session. The Astro storefront proxy
  // forwards the Secure HttpOnly `store_session_v2` cookie as the `x-session-token` header (the same
  // bridge commerce/store/orders.ts uses via resolveCustomer). When present and valid for this
  // tenant, the resolved customerId is threaded into processCheckout via the context so the placed
  // store-orders / store-transactions rows are tagged with the customer. When absent or invalid, the
  // checkout proceeds as a guest (the prior behavior) — login is NEVER required. The gateway verifier
  // already resolved `req.user` if present; we additionally honor the storefront session bridge for
  // signed proxy requests that do not carry a Payload session. Default chosen for reversibility: a
  // single optional code path that falls back to guest; flip the if(false) below to drop the bridge.
  let customerId = verification.context.customerId
  if (customerId === undefined) {
    const resolved = await resolveCustomer(req, verification.context.tenantId)
    // resolveCustomer returns ok:false on missing/invalid token. For the checkout bridge we MUST NOT
    // reject — a missing session simply means guest checkout. Only honor the positive resolution.
    if (resolved.ok) customerId = resolved.customerId
  }
  const ctx = customerId !== undefined ? { ...verification.context, customerId } : verification.context

  // Signature verified → safe to parse.
  let body: unknown
  try {
    body = rawText ? JSON.parse(rawText) : null
  } catch {
    return Response.json({ error: 'invalid_body' }, { status: 400 })
  }
  const obj = body as Partial<ProcessCheckoutInput> | null
  if (!obj || typeof obj !== 'object') {
    return Response.json({ error: 'invalid_body' }, { status: 400 })
  }
  if (obj.cartId === undefined || obj.cartId === null || !obj.paymentMethod || obj.shippingAddress === undefined) {
    return Response.json({ error: 'invalid_body', detail: 'cartId, paymentMethod, shippingAddress required' }, { status: 400 })
  }

  // Idempotency-Key: header or body fallback; reject a malformed key before any commerce work.
  const idempotencyKey = req.headers.get('idempotency-key') || (obj as { idempotencyKey?: string }).idempotencyKey
  if (idempotencyKey !== undefined && !isUuidV4(idempotencyKey)) {
    return Response.json({ error: 'invalid_idempotency_key' }, { status: 400 })
  }

  const { status, body: resp } = await processCheckout(
    req.payload,
    ctx,
    { ...obj, idempotencyKey: idempotencyKey || undefined } as ProcessCheckoutInput,
    // ponytail: test-only adapter injection seam — production req.context is empty so buildAdapter is
    // undefined and processCheckout falls back to the real buildPaymentAdapter. Ceiling: if a non-test
    // caller ever needs to override the adapter, promote to a real config option.
    { buildAdapter: (req as any).context?.commerceBuildAdapter },
  )
  return Response.json(resp, { status })
}

export const checkoutEndpoints: Endpoint[] = [
  { path: '/commerce/store/:tenantSlug/checkout', method: 'post', handler: checkoutHandler },
]
