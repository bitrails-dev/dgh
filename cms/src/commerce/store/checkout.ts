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
    verification.context,
    { ...obj, idempotencyKey: idempotencyKey || undefined } as ProcessCheckoutInput,
  )
  return Response.json(resp, { status })
}

export const checkoutEndpoints: Endpoint[] = [
  { path: '/commerce/store/:tenantSlug/checkout', method: 'post', handler: checkoutHandler },
]
