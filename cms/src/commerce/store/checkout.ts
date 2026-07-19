// Shopper-facing checkout + pay route: the single place-order endpoint. A thin HTTP handler over
// placeOrder (directly callable, hence directly testable). placeOrder chains the server-authoritative
// checkout (reserve → quote → create order — client prices/totals are never trusted) and then, for an
// online gateway, initiates a hosted checkout. Offline methods (cod/bank) leave inventory RESERVED
// for an admin to confirm later (which triggers commitOrderInventory). The capture→commit loop is
// owned by the payment webhook + job; this route only starts it. Mirrors the webhook pattern: tenant
// resolved by URL slug → 404 when missing/featureless; buildAdapter is injectable for fake-adapter
// tests with no network.
import type { Endpoint, Payload, PayloadRequest } from 'payload'
import { checkout } from '../checkout'
import { money } from '../money'
import { loadGatewayConfig, type GatewayProvider } from '../payments/settings'
import { buildPaymentAdapter, type AdapterBuilder } from '../payments/adapters/registry'
import { createHash } from 'node:crypto'
import { loadCommerceSettings } from './shared'
import { withVerifiedCommerceGateway } from './gateway'
import { processCheckout, type ProcessCheckoutInput } from '../checkout/process'

export interface PlaceOrderItem {
  sku: string
  quantity: number
}

export interface PlaceOrderInput {
  cartToken: string
  items: PlaceOrderItem[]
  // RFC 4122 UUID v4 from the browser's Idempotency-Key header (commit 1.4). When present, a replay
  // returns the already-created order; a different normalized payload returns 409.
  idempotencyKey?: string
  customerEmail?: string
  customerPhone?: string
  shippingAddress?: unknown
  billingAddress?: unknown
  paymentMethod: 'cod' | 'bank' | 'paymob' | 'kashier'
  returnUrl?: string
  locationId?: number | string
}

// checkout() failure code → HTTP status + body. Prices and stock are resolved server-side, so these
// are the only shopper-facing failure modes from the place-order step (a browser never sends totals).
const checkoutFailure = (
  code: 'PRODUCT_NOT_FOUND' | 'INSUFFICIENT_STOCK' | 'TAMPER',
  detail?: unknown,
): { status: number; body: Record<string, unknown> } => {
  const status = code === 'INSUFFICIENT_STOCK' ? 409 : code === 'PRODUCT_NOT_FOUND' ? 422 : 500
  return { status, body: { error: code, detail } }
}

// RFC 4122 v4 — the only key shape accepted (commit 1.4). Rejects malformed keys before any work.
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
export function isUuidV4(key: string | undefined | null): key is string {
  return typeof key === 'string' && UUID_V4.test(key.trim())
}

// Deep-sort object keys, trim string leaves, and pass scalars through — so key-insertion order and
// insignificant whitespace cannot flip the fingerprint. Arrays keep order (line order is normalized
// separately by summing per SKU).
function canonicalize(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(canonicalize)
  if (v && typeof v === 'object') {
    return Object.keys(v as Record<string, unknown>).sort().reduce<Record<string, unknown>>((acc, k) => {
      acc[k] = canonicalize((v as Record<string, unknown>)[k])
      return acc
    }, {})
  }
  if (typeof v === 'string') return v.trim()
  return v
}

// SHA-256 over the normalized checkout payload: duplicate SKUs summed to one quantity (matching
// checkout()'s normalizeLines), lines sorted by SKU, addresses canonicalized, and payment method.
// (Promotion codes, gift-card code hash and shipping method join the fingerprint in Phases 5/6.)
// Same fingerprint => same business request; a mismatch under one key => 409.
function checkoutFingerprint(input: PlaceOrderInput): string {
  const summed = new Map<string, number>()
  for (const it of input.items) {
    const sku = String(it.sku ?? '').trim()
    if (!sku) continue
    summed.set(sku, (summed.get(sku) ?? 0) + Number(it.quantity))
  }
  const items = [...summed.entries()].map(([s, q]) => ({ s, q })).sort((a, b) => (a.s < b.s ? -1 : a.s > b.s ? 1 : 0))
  const canonical = JSON.stringify({
    i: items,
    s: canonicalize(input.shippingAddress ?? null),
    b: canonicalize(input.billingAddress ?? null),
    pm: input.paymentMethod,
  })
  return createHash('sha256').update(canonical).digest('hex')
}

async function findOrderByCheckoutKey(payload: Payload, tenantId: number | string, checkoutKey: string) {
  const { docs } = await payload.find({
    collection: 'orders',
    where: { and: [{ tenant: { equals: tenantId } }, { checkoutKey: { equals: checkoutKey } }] },
    overrideAccess: true,
    limit: 1,
  })
  return docs[0] as
    | { orderNumber: string; amountDue: number; currency: string; paymentState?: string; checkoutFingerprint?: string }
    | undefined
}

// Replay an already-placed order (same key, same fingerprint), or 409 when the body changed. A keyed
// order always carries a fingerprint (written with the key), so a missing stored fingerprint means
// corrupt/legacy state — fail closed rather than silently dedup an unknown body.
function replayOrConflict(
  existing: { orderNumber: string; amountDue: number; currency: string; paymentState?: string; checkoutFingerprint?: string },
  fingerprint: string | undefined,
  currency: string,
): { status: number; body: Record<string, unknown> } {
  if (!existing.checkoutFingerprint || existing.checkoutFingerprint !== fingerprint) {
    return { status: 409, body: { error: 'idempotency_conflict' } }
  }
  return {
    status: 200,
    body: {
      orderNumber: existing.orderNumber,
      amountDue: existing.amountDue,
      currency: existing.currency || currency,
      paymentState: existing.paymentState ?? 'pending',
      replayed: true,
    },
  }
}

// Unified place-order orchestration:
//   1. load commerce settings (503 when the tenant has none),
//   2. resolve a fulfillment location (explicit, else the tenant's first inventory-location; 422 when
//      none),
//   3. checkout() — reserve → quote → create order (never trusting client prices),
//   4a. offline (cod/bank): return a pending order; inventory stays reserved for admin confirmation,
//   4b. online gateway (paymob/kashier): build the adapter from the tenant's decrypted config and
//       initiate a hosted checkout (422 when the gateway isn't configured). `buildAdapter` is
//       injectable so the gateway path is testable with a fake adapter and no network.
export async function placeOrder(
  payload: Payload,
  tenantId: number | string,
  input: PlaceOrderInput,
  opts?: { buildAdapter?: AdapterBuilder },
): Promise<{ status: number; body: Record<string, unknown> }> {
  // Defense in depth (commit 1.4): a directly-called placeOrder rejects a malformed idempotency key
  // before any commerce work, mirroring checkoutHandler's header validation.
  if (input.idempotencyKey !== undefined && !isUuidV4(input.idempotencyKey)) {
    return { status: 400, body: { error: 'invalid_idempotency_key' } }
  }
  const settings = await loadCommerceSettings(payload, tenantId)
  if (!settings) return { status: 503, body: { error: 'commerce_not_configured' } }

  // Resolve the fulfillment location: explicit if provided, else the tenant's first inventory-location.
  let locationId = input.locationId
  if (locationId == null) {
    const { docs } = await payload.find({
      collection: 'inventory-locations',
      where: { tenant: { equals: tenantId } },
      overrideAccess: true,
      limit: 1,
    })
    const loc = docs[0] as { id: number | string } | undefined
    if (!loc) return { status: 422, body: { error: 'no_fulfillment_location' } }
    locationId = loc.id
  }

  // Idempotency (commit 1.4): if a key is present, replay an already-placed order before reserving
  // any stock, and reject a same-key/different-body replay with 409.
  const idempotencyKey = isUuidV4(input.idempotencyKey) ? input.idempotencyKey.trim() : undefined
  const fingerprint = idempotencyKey ? checkoutFingerprint(input) : undefined
  if (idempotencyKey) {
    const existing = await findOrderByCheckoutKey(payload, tenantId, idempotencyKey)
    if (existing) return replayOrConflict(existing, fingerprint, settings.currency)
  }

  const result = await checkout({
    payload,
    tenantId,
    cartToken: input.cartToken,
    checkoutKey: idempotencyKey,
    checkoutFingerprint: fingerprint,
    lines: input.items,
    locationId,
    currency: settings.currency,
    taxMode: settings.taxMode,
    customerEmail: input.customerEmail,
    customerPhone: input.customerPhone,
    shippingAddress: input.shippingAddress,
    billingAddress: input.billingAddress,
  })
  if (!result.ok) {
    // A concurrent same-key request may have won the (tenant_id, checkout_key) race: our reservation
    // was compensated by releaseOrder inside checkout and createOrder surfaced as a TAMPER failure.
    // Re-read the winner and replay it (or 409 if its body differs) instead of returning an error.
    if (idempotencyKey) {
      const existing = await findOrderByCheckoutKey(payload, tenantId, idempotencyKey)
      if (existing) return replayOrConflict(existing, fingerprint, settings.currency)
    }
    return checkoutFailure(result.code, result.detail)
  }

  const orderNumber = (result.order as { orderNumber: string }).orderNumber
  const amountDue = result.quote.amountDue

  // Offline methods: inventory stays reserved; an admin confirms later (→ commitOrderInventory).
  if (input.paymentMethod === 'cod' || input.paymentMethod === 'bank') {
    return {
      status: 200,
      body: {
        orderNumber,
        amountDue,
        currency: settings.currency,
        paymentMethod: input.paymentMethod,
        paymentState: 'pending',
        quote: result.quote,
      },
    }
  }

  // Online gateway: build the adapter from the tenant's decrypted credentials and initiate hosted
  // checkout. The capture→commit loop is owned by the payment webhook + job, so nothing else happens
  // here. Never log the gateway config / secrets.
  const provider = input.paymentMethod as GatewayProvider
  const cfg = await loadGatewayConfig(payload, tenantId, provider)
  if (!cfg) return { status: 422, body: { error: 'gateway_not_configured' } }

  const adapter = (opts?.buildAdapter ?? buildPaymentAdapter)(provider, cfg)
  const r = await adapter.createHostedCheckout({
    merchantReference: orderNumber,
    amount: money(amountDue, settings.currency),
    customerEmail: input.customerEmail,
    billingUrl: input.returnUrl,
    sandbox: settings.sandbox,
  })
  return {
    status: 200,
    body: {
      orderNumber,
      amountDue,
      currency: settings.currency,
      paymentMethod: provider,
      checkoutUrl: r.checkoutUrl,
      providerSessionId: r.providerSessionId,
    },
  }
}

// POST /commerce/store/:tenantSlug/checkout — the plugin-first signed checkout (Plan §7 D4). The
// handler reads the raw body ONCE, verifies the commerce-gateway signature/nonce/timestamp over those
// exact bytes (reject before parse — unsigned calls get 401/403 and perform no write), resolves the
// tenant, then runs the 10-step processCheckout. Provider webhooks live on separate routes
// (/commerce/webhooks/{paymob,kashier} and the plugin's /api/payments/*) and never reach this handler,
// so they are inherently gateway-exempt (Plan §4.2).
//
// `placeOrder` above is retained as the legacy orchestration exercised directly by the existing
// commerce-store-checkout suite until Wave F2 retires the legacy runtime model.
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
