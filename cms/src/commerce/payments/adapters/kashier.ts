// Kashier payment adapter (kashier.io) — implements the provider-agnostic PaymentAdapter contract.
// Kashier's hosted-checkout model is a SIGNED REDIRECT URL to checkout.kashier.io, not a server-side
// order-create, so createHostedCheckout is pure (no network): it builds and HMAC-signs the checkout
// URL with the merchant PaymentApiKey. A second HMAC (hex) over a fixed-order concatenation of ten
// transaction fields authenticates the webhook/return callback, keyed by a separate iFrame/webhook
// secret. BOTH signature schemes are reproduced verbatim from Kashier's official demo
// (Kashier-payments/NodeJs-Checkout-Demo: backend.js) — they are the contract source of truth, and
// the tests recompute them independently to prove conformance.
//
// Kashier is instant-capture with no separate authorize/void, so capabilities encode exactly that:
// the orchestration layer never calls void() (the method is omitted). Refunds and status lookup hit
// Kashier's REST API; the exact refund/lookup endpoints and the REST auth header are the least-
// documented parts of Kashier's public material and are flagged for sandbox validation. The host
// assumption (app.kashier.io live / test-app.kashier.io sandbox) and auth-header form are isolated
// behind config so they can be corrected without touching signature logic.
//
// ─── Wave D2 (plugin-first commerce, Plan §3.2/§3.9/§4.2/§7 D2) ─────────────────────────────
// This module exports TWO surfaces, on the same object so it works both in the plugin
// `paymentMethods: [kashierAdapter()]` array (Plan §3.2) and in the existing webhook/registry
// orchestration paths that consume the Phase 1 PaymentAdapter:
//
//   1. createKashierAdapter(opts) — the Phase 1 internal adapter. Owns Kashier's signing primitives,
//      verifyWebhook, refund and lookup. Retained VERBATIM as the source of truth for the provider
//      signature contract; the existing contract test (commerce-kashier-adapter.test.ts) continues to
//      assert these against an independent oracle.
//
//   2. kashierAdapter(opts) — the plugin-compatible PaymentAdapter factory (Plan §3.2 wiring:
//      `paymentMethods: [paymobAdapter(), kashierAdapter()]`). Returns the shape defined by
//      `@payloadcms/plugin-ecommerce/dist/types`: { name, label, group, initiatePayment, confirmOrder,
//      endpoints }. It COMPOSES (1) so no signing logic is duplicated. Provider-specific canonical
//      strings and the ten-field FIXED-order webhook signature remain isolated from Paymob's.
//
// Both `initiatePayment` and `confirmOrder` perform the §3.2 tenant re-read as their FIRST operation:
// they re-load the cart/transaction WITHIN the resolved tenant via Local API (`overrideAccess: true`
// is permitted because the gateway has already verified trust — the resolved `tenantId` is the only
// trusted tenant identity) and IGNORE any unscoped wrapper-supplied document. Per Plan §4.2, the
// provider webhook endpoint (`/webhooks`) is gateway-exempt and performs provider-signature
// verification instead. The §3.9 extension fields on `store-transactions` are populated from verified
// provider data; raw payloads are NEVER persisted — only their SHA-256 hash.

import crypto from 'node:crypto'

import type { Money } from '../../money'
import { assertMoney } from '../../money'
import type { PaymentState } from '../state'
import type {
  PaymentAdapter,
  PaymentCapabilities,
  HostedCheckoutInput,
  HostedCheckoutResult,
  RefundInput,
  ProviderResult,
  VerifiedWebhook,
  NormalizedEvent,
} from '../types'
// Plugin-shaped PaymentAdapter (distinct from the local Phase 1 PaymentAdapter in ../types). The
// plugin's shape is what `ecommercePlugin({ payments: { paymentMethods: [...] } })` expects.
import type { PaymentAdapter as PluginPaymentAdapter } from '@payloadcms/plugin-ecommerce/types'
import type { Endpoint, GroupField, PayloadRequest } from 'payload'

import { STORE_COLLECTION_SLUGS } from '../../plugin/slugs'
import { insertPaymentEvent as defaultInsertPaymentEvent } from '../events'

const DEFAULT_CHECKOUT_BASE = 'https://checkout.kashier.io' // shared by live + test (mode selects)
const DEFAULT_API_BASE = 'https://app.kashier.io' // REST API (refunds/lookup), live
const DEFAULT_SANDBOX_API_BASE = 'https://test-app.kashier.io' // REST API, sandbox (ASSUMPTION)

// Structural fetch shape we depend on; global fetch satisfies this and tests inject a fake.
type FetchLike = (
  input: string,
  init?: { method?: string; headers?: Record<string, string>; body?: string },
) => Promise<{
  ok: boolean
  status: number
  json: () => Promise<unknown>
  text: () => Promise<string>
}>

export interface KashierOptions {
  apiKey: string // KASHIER_API_KEY / PaymentApiKey — signs checkout URL + REST auth (ASSUMPTION on header form)
  merchantId: string // KASHIER_MERCHANT_ID (mid)
  webhookSecret?: string // KASHIER_WEBHOOK_SECRET / iFrameSecret — signs webhooks; falls back to apiKey
  sandbox?: boolean // default false (live)
  checkoutBaseURL?: string // default https://checkout.kashier.io
  apiBaseURL?: string // default https://app.kashier.io
  sandboxApiBaseURL?: string // default https://test-app.kashier.io
  fetcher?: FetchLike // default global fetch (injectable so tests never hit the network)
}

// Webhook/return signature: the ten fields, in Kashier's documented FIXED order (NOT alphabetical).
// Reproduced from the official demo's validateSignature(); reordering would break verification.
const WEBHOOK_SIG_FIELDS = [
  'paymentStatus',
  'cardDataToken',
  'maskedCard',
  'merchantOrderId',
  'orderId',
  'cardBrand',
  'orderReference',
  'transactionId',
  'amount',
  'currency',
] as const

// Kashier amounts are decimal MAJOR-UNIT strings (e.g. "22.00"), not integer minor units. Our Money
// is integer minor units (piasters for EGP). Every currency Kashier supports (EGP, USD, GBP, EUR) is
// 2-dp, so dividing minor units by 100 and zero-padding to 2 decimals is exact — computed entirely
// on integers, no floating point. (If a 0/3-dp currency is ever added, this is the single fix point.)
function toKashierAmount(m: Money): string {
  assertMoney(m)
  if (m.amount < 0) throw new Error('Kashier amount must be non-negative')
  const major = Math.trunc(m.amount / 100)
  const minor = Math.abs(m.amount % 100)
  return `${major}.${String(minor).padStart(2, '0')}`
}

// Order redirect hash: HMAC-SHA256(apiKey, "/?payment={mid}.{orderId}.{amount}.{currency}").hex()
// — the signed path contains only the payment token; other URL params (mode, redirect) are unsigned.
function orderHash(secret: string, mid: string, orderId: string, amount: string, currency: string): string {
  const path = `/?payment=${mid}.${orderId}.${amount}.${currency}`
  return crypto.createHmac('sha256', secret).update(path).digest('hex')
}

// Webhook hash: HMAC-SHA256(secret, fixed-order "k=v&k=v" of the ten fields, leading & stripped).hex()
function webhookHash(secret: string, params: Record<string, unknown>): string {
  const parts = WEBHOOK_SIG_FIELDS.map((k) => `&${k}=${params[k] ?? ''}`)
  const finalUrl = parts.join('').slice(1) // drop the leading "&" of the first element
  return crypto.createHmac('sha256', secret).update(finalUrl).digest('hex')
}

// Constant-time compare for equal-length strings (hex digests are fixed length); safe guard first.
function safeEqualHex(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf8')
  const bb = Buffer.from(b, 'utf8')
  if (ab.length !== bb.length) return false
  return crypto.timingSafeEqual(ab, bb)
}

// Map Kashier paymentStatus onto our PaymentState. Only the documented terminal/intermediate values
// are mapped; an unrecognized status is left unmapped (rejected) rather than guessed — the state
// machine must never transition on an ambiguous signal.
function mapStatus(paymentStatus: string): PaymentState | undefined {
  switch ((paymentStatus || '').toUpperCase()) {
    case 'SUCCESS':
      return 'captured'
    case 'FAILED':
      return 'failed'
    case 'REFUNDED':
      return 'refunded'
    case 'VOIDED':
      return 'voided'
    case 'PENDING':
      return 'pending'
    default:
      return undefined
  }
}

// Parse a webhook raw body (JSON or form-urlencoded) into a flat params map. Kashier posts either.
function parseWebhookBody(rawBody: Buffer, contentType: string): Record<string, unknown> {
  const text = rawBody.toString('utf8')
  const ct = contentType.toLowerCase()
  if (ct.includes('application/json')) {
    const parsed = JSON.parse(text || '{}') as Record<string, unknown>
    return parsed
  }
  // form-urlencoded (default for Kashier iframe callbacks): use URLSearchParams for safe decoding.
  const params: Record<string, unknown> = {}
  for (const [k, v] of new URLSearchParams(text)) params[k] = v
  return params
}

// Strip any secret/auth material from an error message before it leaves the adapter — a gateway
// 500 or a thrown fetch error can echo request headers; never relay raw auth. Returns a sanitized
// { code, message } suitable for ProviderResult.error.
function sanitizeError(err: unknown, secret: string): { code: string; message: string } {
  const raw = err instanceof Error ? err.message : String(err)
  // Remove the secret anywhere it appears, and collapse any Authorization header echo.
  const safe = raw.split(secret).join('[redacted]').replace(/authorization:\s*[^\s,]+/gi, 'authorization: [redacted]')
  return { code: 'KASHIER_ERROR', message: safe.slice(0, 300) }
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// Phase 1 internal adapter — UNCHANGED. Source of truth for Kashier's provider signature contract.
// Tests in commerce-kashier-adapter.test.ts recompute the signatures independently and assert literal
// equality, so a transcription error here fails the test.
// ═══════════════════════════════════════════════════════════════════════════════════════════════

export function createKashierAdapter(opts: KashierOptions): PaymentAdapter {
  const apiKey = opts.apiKey?.trim()
  const merchantId = opts.merchantId?.trim()
  const webhookSecret = (opts.webhookSecret?.trim() || apiKey) // fall back to apiKey per callBacks.js
  const sandbox = opts.sandbox ?? false
  const checkoutBase = (opts.checkoutBaseURL ?? DEFAULT_CHECKOUT_BASE).replace(/\/$/, '')
  const apiBase = (
    sandbox
      ? opts.sandboxApiBaseURL ?? opts.apiBaseURL ?? DEFAULT_SANDBOX_API_BASE
      : opts.apiBaseURL ?? DEFAULT_API_BASE
  ).replace(/\/$/, '')
  const fetcher = opts.fetcher ?? (fetch as unknown as FetchLike)

  const requireConfig = (): void => {
    if (!apiKey || !merchantId) throw new Error('Kashier not configured')
  }

  return {
    provider: 'kashier',

    capabilities(): PaymentCapabilities {
      return {
        hostedCheckout: true,
        authorization: false, // instant capture only — no authorize-now-capture-later
        refunds: true,
        partialRefunds: true,
        voiding: false, // historically unsupported; void() is intentionally omitted
        recurring: false, // no stored-token subscriptions
        webhookSignature: 'hmac',
      }
    },

    // Build + sign the redirect URL. Pure: Kashier creates the order implicitly on redirect, so no
    // network call is needed here (and thus no fetcher invocation in tests). providerSessionId is the
    // merchant reference — in this flow the gateway issues no separate session token up-front.
    async createHostedCheckout(input: HostedCheckoutInput): Promise<HostedCheckoutResult> {
      requireConfig()
      const orderId = input.merchantReference
      const amountStr = toKashierAmount(input.amount)
      const signature = orderHash(apiKey, merchantId, orderId, amountStr, input.amount.currency)
      const params = new URLSearchParams({
        payment: `${merchantId}.${orderId}.${amountStr}.${input.amount.currency}`,
        signature,
        mode: (input.sandbox ?? sandbox) ? 'test' : 'live',
        allowedMethods: 'card,wallet', // direct payment only — bank_installments (interest/riba) excluded per Sharia
      })
      if (input.billingUrl) params.set('redirect', input.billingUrl)
      return { checkoutUrl: `${checkoutBase}/?${params.toString()}`, providerSessionId: orderId }
    },

    // POST a refund. Kashier refunds are keyed by orderId; the caller passes the Kashier orderId as
    // providerTransactionId. Endpoint + auth header are ASSUMPTIONS pending sandbox validation.
    async refund(input: RefundInput): Promise<ProviderResult> {
      requireConfig()
      const amountStr = toKashierAmount(input.amount)
      const url = `${apiBase}/api/v1/orders/${encodeURIComponent(input.providerTransactionId)}/refund`
      try {
        const res = await fetcher(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: apiKey }, // ASSUMPTION
          body: JSON.stringify({ amount: amountStr, ...(input.reason ? { reason: input.reason } : {}) }),
        })
        const json = (await res.json().catch(() => ({}))) as {
          id?: string
          orderId?: string
          status?: string
          message?: string
        }
        if (!res.ok) {
          return { ok: false, error: { code: 'KASHIER_REFUND_FAILED', message: json.message || `HTTP ${res.status}` } }
        }
        return { ok: true, providerEventId: json.id || json.orderId }
      } catch (err) {
        return { ok: false, error: sanitizeError(err, apiKey) }
      }
    },

    // void() is intentionally omitted: capabilities.voiding === false.

    async verifyWebhook(input: {
      rawBody: Buffer
      headers: Record<string, string | undefined>
    }): Promise<VerifiedWebhook> {
      if (!webhookSecret) return { accepted: false, reason: 'not configured' }
      const contentType = input.headers['content-type'] || input.headers['Content-Type'] || ''
      let params: Record<string, unknown>
      try {
        params = parseWebhookBody(input.rawBody, contentType)
      } catch {
        return { accepted: false, reason: 'malformed body' }
      }
      const provided = typeof params.signature === 'string' ? (params.signature as string) : ''
      if (!provided) return { accepted: false, reason: 'missing signature' }

      const expected = webhookHash(webhookSecret, params)
      if (!safeEqualHex(expected, provided)) return { accepted: false, reason: 'bad signature' }

      const paymentStatus = String(params.paymentStatus ?? '')
      const targetState = mapStatus(paymentStatus)
      if (!targetState) return { accepted: false, reason: `unknown status: ${paymentStatus}` }

      // providerEventId drives idempotency; prefer the gateway transaction id, fall back to order+status.
      const providerEventId =
        (params.transactionId as string) || `${params.orderId || params.merchantOrderId}:${paymentStatus}`
      const merchantReference = String(params.merchantOrderId ?? '')

      // rawRedacted must carry no full card data: drop cardDataToken/maskedCard/cardBrand before audit.
      const redacted: Record<string, unknown> = { ...params }
      delete redacted.cardDataToken
      delete redacted.maskedCard
      delete redacted.cardBrand
      delete redacted.signature

      const event: NormalizedEvent = {
        provider: 'kashier',
        providerEventId,
        merchantReference,
        targetState,
        amount: { amount: 0, currency: String(params.currency ?? '') }, // placeholder; see note
        rawRedacted: redacted,
      }
      // Reconstruct the captured/refunded Money from Kashier's decimal amount when present.
      const amt = Number(params.amount)
      if (params.amount && Number.isFinite(amt)) {
        event.amount = { amount: Math.round(amt * 100), currency: String(params.currency ?? '') }
      }
      return { accepted: true, event }
    },

    // Reconcile status directly with Kashier. GET the order by merchant reference. The response
    // shape is an ASSUMPTION pending sandbox validation.
    async lookup(merchantReference: string): Promise<{ state: PaymentState; providerEventId?: string }> {
      requireConfig()
      const url = `${apiBase}/api/v1/orders/${encodeURIComponent(merchantReference)}`
      try {
        const res = await fetcher(url, { method: 'GET', headers: { authorization: apiKey } }) // ASSUMPTION
        const json = (await res.json().catch(() => ({}))) as {
          status?: string
          paymentStatus?: string
          data?: { status?: string; paymentStatus?: string; transactionId?: string }
          transactionId?: string
        }
        const status = String(
          json.data?.paymentStatus || json.data?.status || json.paymentStatus || json.status || '',
        )
        const state = mapStatus(status)
        if (!state) throw new Error(`unmappable Kashier status: ${status || '(empty)'}`)
        return { state, providerEventId: json.data?.transactionId || json.transactionId }
      } catch (err) {
        throw new Error(sanitizeError(err, apiKey).message)
      }
    },
  }
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// Wave D2: plugin-compatible PaymentAdapter (Plan §3.2/§3.9/§4.2/§7 D2)
// ═══════════════════════════════════════════════════════════════════════════════════════════════

// Minimal Local-API shape. We avoid importing generated types so the module remains importable before
// the integration owner runs `generate:types` at B4. The shape is structural; the plugin and overrides
// already publish the §3.9 fields on `store-transactions`.
interface LocalApi {
  find: (args: {
    collection: string
    where?: unknown
    limit?: number
    overrideAccess?: boolean
    req?: PayloadRequest
  }) => Promise<{ docs: unknown[]; totalDocs?: number }>
  create: (args: {
    collection: string
    data: Record<string, unknown>
    overrideAccess?: boolean
    req?: PayloadRequest
  }) => Promise<Record<string, unknown>>
  update: (args: {
    id: number | string
    collection: string
    data: Record<string, unknown>
    overrideAccess?: boolean
    req?: PayloadRequest
  }) => Promise<Record<string, unknown>>
}
interface PayloadLike {
  find: LocalApi['find']
  create: LocalApi['create']
  update: LocalApi['update']
}

interface CartLike {
  id: number | string
  subtotal?: number
  items?: unknown[]
  currency?: string
}

interface TransactionLike {
  id: number | string
  amount?: number
  currency?: string
  cart?: number | string | { id: number | string }
  customer?: number | string
  customerEmail?: string
  items?: unknown[]
  status?: string
  order?: number | string | { id: number | string } | null
  providerTransactionId?: string
  providerOrderReference?: string
  capturedAmount?: number
  refundedAmount?: number
  lastProviderStatus?: string
  lastProviderEventTimestamp?: string
  reconciliationStatus?: string
  rawPayloadHash?: string
  tenant?: number | string
}

/**
 * Options for the plugin-compatible Kashier adapter. Extends the Phase 1 {@link KashierOptions} (all
 * optional — absent credentials defer to runtime guards, matching Phase 1's boot-safe behavior) with
 * plugin-wiring seams used by the integration owner (Wave D4) and tests.
 *
 * - `tenantIdResolver` — resolves the verified tenant id from the request. Default reads
 *   `req.commerceTenantID ?? req.tenantID ?? req.tenant?.id`. Wave D4's `withVerifiedCommerceGateway`
 *   helper populates one of these after verifying the gateway signature/nonce/timestamp; the adapter
 *   never trusts a browser-supplied tenant id and throws if no verified tenant is present.
 * - `insertPaymentEventFn` — injectable durable ledger inserter (defaults to ../events.ts
 *   `insertPaymentEvent`). The ledger provides idempotency via the `(tenant_id, gateway,
 *   provider_event_id)` unique index.
 * - `clock` — injectable clock for deterministic `lastProviderEventTimestamp` values in tests.
 * - `retryAttempts` — bounded retry count for transient DB write failures inside the webhook handler.
 *   Default 3. The handler NEVER swallows a retryable error — after the final attempt it returns a 5xx
 *   so the provider re-delivers; the unique `(tenant_id, gateway, provider_event_id)` index makes the
 *   retry idempotent at the ledger layer.
 * - `ordersSlug` / `transactionsSlug` / `cartsSlug` — defaults to the permanent `store-*` slugs from
 *   `STORE_COLLECTION_SLUGS`. Override only for tests with synthetic collection names.
 */
export interface KashierPluginOptions extends Partial<KashierOptions> {
  resolvedTenantId?: number | string
  tenantIdResolver?: (req: PayloadRequest, data: Record<string, unknown>) => string | number | undefined
  insertPaymentEventFn?: typeof defaultInsertPaymentEvent
  clock?: () => Date
  ordersSlug?: string
  transactionsSlug?: string
  cartsSlug?: string
  label?: string
  retryAttempts?: number
}

const DEFAULT_TENANT_RESOLVER = (req: PayloadRequest): string | number | undefined => {
  const r = req as PayloadRequest & {
    commerceTenantID?: string | number
    tenantID?: string | number
    tenant?: { id?: string | number } | string | number
  }
  if (r.commerceTenantID !== undefined) return r.commerceTenantID
  if (r.tenantID !== undefined) return r.tenantID
  if (typeof r.tenant === 'object' && r.tenant !== null && r.tenant.id !== undefined) return r.tenant.id
  return undefined
}

// SHA-256(value) as lowercase hex. Used for `rawPayloadHash` on `store-transactions` (Plan §3.9: hash,
// NEVER the raw sensitive payload).
function sha256Hex(value: string | Buffer): string {
  return crypto.createHash('sha256').update(value).digest('hex')
}

// Bounded retry for transient failures. Never swallows: after the final attempt the last error is
// rethrown so the caller (provider re-delivery, payment-events job) can retry downstream. The delay
// is tiny and linear (50ms × attempt) — this is a guard against transient DB contention, not a
// substitute for the durable payment-events job (which owns hours-long retry).
async function withBoundedRetry<T>(label: string, op: () => Promise<T>, attempts: number): Promise<T> {
  let lastErr: unknown
  for (let i = 1; i <= attempts; i++) {
    try {
      return await op()
    } catch (err) {
      lastErr = err
      if (i >= attempts) break
      await new Promise((r) => setTimeout(r, 50 * i))
    }
  }
  // Rethrow — never swallow a retryable error (Plan: idempotency key + bounded retry).
  if (lastErr instanceof Error) throw lastErr
  throw new Error(`${label} failed after ${attempts} attempts`)
}

// Read the integer-minor-unit amount from a re-read cart document. Plan §3.3: persisted amounts are
// integer minor units (EGP, 2 dp). The cart's `subtotal` is set server-side by the cart operations
// after the authoritative quote (Plan §3.10: "never trusts browser totals or eligibility results").
// We treat the DB-stored value as authoritative and reject anything that is not a safe integer.
function readAuthoritativeAmount(cartDoc: CartLike, data: { currency?: unknown }, fallback = 'EGP'): Money {
  const subtotal = cartDoc.subtotal
  const currency = (
    typeof cartDoc.currency === 'string' && cartDoc.currency ? cartDataCurrency(cartDoc) :
    typeof data.currency === 'string' && data.currency ? String(data.currency) :
    fallback
  ).toUpperCase()
  if (typeof subtotal !== 'number' || !Number.isSafeInteger(subtotal) || subtotal <= 0) {
    throw new Error('Kashier plugin adapter: cart subtotal must be a positive integer (minor units)')
  }
  if (currency !== 'EGP') {
    throw new Error(`Kashier plugin adapter: only EGP supported, got ${currency}`)
  }
  return { amount: subtotal, currency }
}

function cartDataCurrency(cartDoc: CartLike): string {
  return (cartDoc.currency ?? 'EGP').toUpperCase()
}

// Re-read a document within the resolved tenant via Local API, ignoring any unscoped wrapper-supplied
// document (Plan §3.2). Returns `undefined` when no document matches in this tenant.
async function findInTenant(
  payload: PayloadLike,
  collection: string,
  where: unknown,
  req: PayloadRequest,
): Promise<Record<string, unknown> | undefined> {
  const res = await payload.find({ collection, where, limit: 1, overrideAccess: true, req })
  return res.docs[0] as Record<string, unknown> | undefined
}

/**
 * Plugin-compatible Kashier PaymentAdapter factory (Wave D2). Returns the shape defined by
 * `@payloadcms/plugin-ecommerce/types` so the integration owner can wire
 * `paymentMethods: [paymobAdapter(), kashierAdapter()]` (Plan §3.2) once D4 lands.
 *
 * The factory composes the Phase 1 {@link createKashierAdapter} for all signing/verifyWebhook/refund/
 * lookup logic — provider signing is NOT duplicated. `initiatePayment` and `confirmOrder` perform the
 * §3.2 tenant re-read as their first operation and never trust browser-supplied totals; the
 * `/webhooks` endpoint is gateway-exempt (Plan §4.2) and performs provider-signature verification
 * instead.
 *
 * Per Plan §4.2, the plugin registers payment endpoints under `/api/payments/kashier/*`; the FIRST
 * executable operation in `initiatePayment`/`confirmOrder` is still the tenant re-read, so a direct
 * unsigned call has no verified tenant and throws before any write (the integration owner wraps the
 * endpoint with `withVerifiedCommerceGateway` to set the resolved tenant id on `req`).
 */
export function kashierAdapter(opts: KashierPluginOptions = {}): PluginPaymentAdapter {
  // Compose the Phase 1 internal adapter for all signing/verifyWebhook/refund/lookup logic. Cast
  // because KashierPluginOptions makes apiKey/merchantId optional; the Phase 1 factory already
  // defends with `?.trim()` and requireConfig() throws at operation time if absent.
  const internal = createKashierAdapter(opts as KashierOptions)
  const ordersSlug = opts.ordersSlug ?? STORE_COLLECTION_SLUGS.orders
  const transactionsSlug = opts.transactionsSlug ?? STORE_COLLECTION_SLUGS.transactions
  const cartsSlug = opts.cartsSlug ?? STORE_COLLECTION_SLUGS.carts
  const tenantIdResolver = opts.tenantIdResolver ?? DEFAULT_TENANT_RESOLVER
  const insertPaymentEventFn = opts.insertPaymentEventFn ?? defaultInsertPaymentEvent
  const clock = opts.clock ?? (() => new Date())
  const retryAttempts = opts.retryAttempts ?? 3

  function resolveTenant(req: PayloadRequest, data: Record<string, unknown>): string | number {
    const tid = opts.resolvedTenantId ?? tenantIdResolver(req, data)
    if (tid === undefined || tid === null || tid === '') {
      throw new Error('Kashier plugin adapter: resolved tenant id missing — gateway verification required (Plan §3.2)')
    }
    return tid
  }

  // Initiate: re-read cart in tenant → server-authoritative amount → signed Kashier URL → create
  // store-transactions row with §3.9 fields → return checkout URL + IDs.
  async function initiatePayment(args: {
    data: {
      billingAddress?: unknown
      cart: CartLike
      currency?: string
      customerEmail?: string
      shippingAddress?: unknown
    }
    req: PayloadRequest
    transactionsSlug?: string
  }): Promise<{ message: string; [key: string]: unknown }> {
    const { data, req } = args
    const txSlug = args.transactionsSlug ?? transactionsSlug
    const payload = (req as PayloadRequest & { payload: PayloadLike }).payload
    if (!payload) throw new Error('Kashier plugin adapter: req.payload missing')
    const tenantId = resolveTenant(req, data as Record<string, unknown>)

    const wrapperCart = data?.cart
    const cartId = wrapperCart?.id
    if (cartId === undefined || cartId === null || cartId === '') {
      throw new Error('Kashier plugin adapter: cart id required')
    }

    // Idempotency: an existing pending transaction for this (tenant, cart) short-circuits the
    // redirect rebuild (the URL is identical for the same merchantReference). A replay must never
    // create a second transaction document (Phase 1 checkout idempotency + Plan §3.9).
    const existing = (await findInTenant(
      payload,
      txSlug,
      { and: [{ cart: { equals: cartId } }, { tenant: { equals: tenantId } }, { status: { equals: 'pending' } }] },
      req,
    )) as TransactionLike | undefined
    if (existing && existing.providerOrderReference) {
      // Re-build the signed URL deterministically — pure function, identical output for identical input.
      const amount = readAuthoritativeAmount(
        { id: cartId, subtotal: existing.amount, currency: existing.currency },
        data,
      )
      const hosted = await internal.createHostedCheckout({
        merchantReference: existing.providerOrderReference,
        amount,
        customerEmail: data.customerEmail,
        sandbox: opts.sandbox ?? false,
      })
      return {
        message: 'Payment already initiated',
        transactionID: existing.id,
        providerSessionId: existing.providerOrderReference,
        providerOrderReference: existing.providerOrderReference,
        checkoutUrl: hosted.checkoutUrl,
        replay: true,
      }
    }

    // Plan §3.2: re-read the cart WITHIN the resolved tenant; ignore any unscoped wrapper-supplied
    // document. The wrapper-supplied `data.cart` is only a hint for the cart ID.
    const cart = (await findInTenant(
      payload,
      cartsSlug,
      { and: [{ id: { equals: cartId } }, { tenant: { equals: tenantId } }] },
      req,
    )) as CartLike | undefined
    if (!cart) {
      // The wrapper-supplied cart is wrong-tenant or unscoped — no write happens.
      throw new Error('Kashier plugin adapter: cart not found in resolved tenant')
    }

    // Server-authoritative amount from the re-read cart snapshot (Plan §3.3 + §3.10). NEVER trust
    // browser-supplied totals — the DB subtotal is the server-side quote result.
    const amount = readAuthoritativeAmount(cart, data)
    const merchantReference = String(cart.id)

    // Build + sign the Kashier hosted-checkout URL via the retained Phase 1 signing logic. Pure — no
    // network call, no fetcher invocation.
    const hosted = await internal.createHostedCheckout({
      merchantReference,
      amount,
      customerEmail: data.customerEmail,
      sandbox: opts.sandbox ?? false,
    })

    // Hash the sensitive provider-interaction payload (merchantReference + checkoutUrl signature).
    // Raw provider tokens are NEVER persisted — only the SHA-256 hash (§3.9).
    const rawPayloadHash = sha256Hex(JSON.stringify({
      merchantReference,
      providerSessionId: hosted.providerSessionId,
    }))
    const nowISO = clock().toISOString()

    // Create the store-transactions document with §3.9 fields pre-populated. The provider transaction
    // id is unknown until the webhook fires — leave it empty; the webhook enriches it.
    //
    // Plan §3.2: "executes one Local API operation with the resolved tenant explicitly written and
    // queried." We set `tenant: tenantId` explicitly here (the multi-tenant plugin's tenant-field
    // defaultValue hook only fires for normal-auth calls; we use overrideAccess: true because the
    // gateway already verified trust).
    const txnData: Record<string, unknown> = {
      // Plan §3.2: tenant explicitly written:
      tenant: tenantId,
      // Plugin base transaction fields:
      amount: amount.amount,
      currency: amount.currency,
      cart: cart.id,
      items: Array.isArray(cart.items) ? cart.items : [],
      paymentMethod: 'kashier',
      status: 'pending',
      ...(typeof data.customerEmail === 'string' ? { customerEmail: data.customerEmail } : {}),
      ...(data.billingAddress !== undefined ? { billingAddress: data.billingAddress } : {}),
      ...(data.shippingAddress !== undefined ? { shippingAddress: data.shippingAddress } : {}),
      // §3.9 adapter-group fields:
      providerTransactionId: '',
      providerOrderReference: hosted.providerSessionId,
      capturedAmount: 0,
      refundedAmount: 0,
      lastProviderStatus: 'initiated',
      lastProviderEventTimestamp: nowISO,
      reconciliationStatus: 'pending',
      rawPayloadHash,
      legacyTransactionId: null,
    }
    const user = (req as PayloadRequest & { user?: { id?: unknown } }).user
    if (user?.id !== undefined) txnData.customer = user.id
    const txnDoc = (await payload.create({
      collection: txSlug,
      data: txnData,
      overrideAccess: true,
      req,
    })) as unknown as TransactionLike

    // Durable ledger entry. Idempotent via the (tenant_id, gateway, provider_event_id) unique index
    // on payment-events. providerEventId is namespaced per-cart so a replay that did not find the
    // pending transaction above still produces only one ledger row.
    try {
      await insertPaymentEventFn({
        payload: (req as PayloadRequest & { payload: unknown }).payload as never,
        tenantId,
        gateway: 'kashier',
        providerEventId: `initiate:${cartId}`,
        merchantReference: String(txnDoc.id),
        targetState: 'pending',
        amount: amount.amount,
        rawRedacted: JSON.stringify({ providerOrderReference: hosted.providerSessionId }),
      })
    } catch {
      // Ledger failure does NOT roll back the transaction write — the ledger is the idempotency
      // record and the next sweep re-inserts. We swallow HERE (not on the provider call) because the
      // transaction is already durably created; never swallow a retryable provider error elsewhere.
    }

    return {
      message: 'Kashier payment initiated',
      checkoutUrl: hosted.checkoutUrl,
      providerSessionId: hosted.providerSessionId,
      providerOrderReference: hosted.providerSessionId,
      transactionID: txnDoc.id,
    }
  }

  // Confirm: re-read transaction in tenant → optional Kashier lookup → idempotent order create →
  // update transaction §3.9 fields → durable ledger row.
  async function confirmOrder(args: {
    data: Record<string, unknown> & { customerEmail?: string }
    req: PayloadRequest
    ordersSlug?: string
    cartsSlug?: string
    transactionsSlug?: string
    customersSlug?: string
  }): Promise<{ message: string; orderID: unknown; transactionID: unknown; [key: string]: unknown }> {
    const { data, req } = args
    const ordSlug = args.ordersSlug ?? ordersSlug
    const txSlug = args.transactionsSlug ?? transactionsSlug
    const payload = (req as PayloadRequest & { payload: PayloadLike }).payload
    if (!payload) throw new Error('Kashier plugin adapter: req.payload missing')
    const tenantId = resolveTenant(req, data)

    const transactionID = data?.transactionID
    if (transactionID === undefined || transactionID === null || transactionID === '') {
      throw new Error('Kashier plugin adapter: transactionID required')
    }

    // Tenant re-read: re-load the transaction WITHIN the resolved tenant (§3.2). The wrapper-supplied
    // transactionID is untrusted until the tenant-scoped DB read confirms it.
    const txn = (await findInTenant(
      payload,
      txSlug,
      { and: [{ id: { equals: transactionID } }, { tenant: { equals: tenantId } }] },
      req,
    )) as TransactionLike | undefined
    if (!txn) {
      throw new Error('Kashier plugin adapter: transaction not found in resolved tenant')
    }

    const providerOrderReference = txn.providerOrderReference
    if (!providerOrderReference) {
      throw new Error('Kashier plugin adapter: transaction missing providerOrderReference')
    }

    // Authoritative state from Kashier. `lookup` queries /api/v1/orders/<merchantReference>; the
    // response shape is an ASSUMPTION pending sandbox validation. Soft-fail to 'pending' on network
    // error — the webhook remains the source of truth for capture transitions.
    let state: PaymentState = 'pending'
    let providerEventId: string | undefined
    try {
      const looked = await internal.lookup(providerOrderReference)
      state = looked.state
      providerEventId = looked.providerEventId
    } catch {
      // Stay in 'pending' — the webhook will transition the state on the provider's SUCCESS event.
    }

    // Idempotency: if the transaction is already in a captured/succeeded state, the order was
    // already created — return it. We never double-create the order.
    const alreadyConfirmed = txn.status === 'succeeded' || txn.lastProviderStatus === 'captured'
    let orderID: number | string | undefined
    if (txn.order) {
      orderID = typeof txn.order === 'object' ? (txn.order as { id: number | string }).id : txn.order
    }
    if (alreadyConfirmed && orderID !== undefined) {
      return {
        message: 'Order already confirmed',
        orderID,
        transactionID: txn.id,
        replay: true,
      }
    }

    const nowISO = clock().toISOString()
    const capturedAmount = state === 'captured' ? (txn.amount ?? 0) : (txn.capturedAmount ?? 0)

    // Update the transaction with the §3.9 fields reflecting the authoritative provider state.
    await payload.update({
      id: txn.id,
      collection: txSlug,
      data: {
        status: state === 'captured' ? 'succeeded' : state === 'failed' ? 'failed' : (txn.status ?? 'pending'),
        lastProviderStatus: state,
        lastProviderEventTimestamp: nowISO,
        capturedAmount,
        reconciliationStatus: state === 'captured' ? 'matched' : 'pending',
        ...(providerEventId ? { providerTransactionId: providerEventId } : {}),
      },
      overrideAccess: true,
      req,
    })

    // Idempotent ledger entry. providerEventId namespaced by transaction + state so a duplicate
    // confirm is a no-op.
    try {
      await insertPaymentEventFn({
        payload: (req as PayloadRequest & { payload: unknown }).payload as never,
        tenantId,
        gateway: 'kashier',
        providerEventId: providerEventId ?? `confirm:${String(txn.id)}:${state}`,
        merchantReference: providerOrderReference,
        targetState: state,
        amount: capturedAmount,
        rawRedacted: JSON.stringify({ state, providerOrderReference }),
      })
    } catch {
      // see initiatePayment — ledger failure does not roll back the provider write
    }

    // Create the order if it does not yet exist (Stripe-pattern). Phase 1 idempotency for the order
    // itself is the integration owner's responsibility (D4); here we only create when no order is
    // linked to the transaction.
    if (orderID === undefined) {
      const orderData: Record<string, unknown> = {
        // Plan §3.2: tenant explicitly written:
        tenant: tenantId,
        amount: txn.amount ?? 0,
        currency: txn.currency ?? 'EGP',
        transactions: [txn.id],
        cart: txn.cart,
        status: 'processing',
        paymentState: state,
        placedAt: nowISO,
        providerReference: providerOrderReference,
        ...(txn.customer !== undefined ? { customer: txn.customer } : {}),
        ...(txn.customerEmail ? { customerEmail: txn.customerEmail } : {}),
        ...(Array.isArray(txn.items) ? { items: txn.items } : {}),
      }
      const orderDoc = (await payload.create({
        collection: ordSlug,
        data: orderData,
        overrideAccess: true,
        req,
      })) as { id: number | string }
      orderID = orderDoc.id

      // Link the transaction back to the order for future idempotency.
      await payload.update({
        id: txn.id,
        collection: txSlug,
        data: { order: orderID },
        overrideAccess: true,
        req,
      })
    }

    return {
      message: 'Order confirmed successfully',
      orderID,
      transactionID: txn.id,
    }
  }

  // Provider webhook HTTP handler. Gateway-exempt (Plan §4.2) — performs provider-signature
  // verification via the Phase 1 `verifyWebhook`, then idempotently appends to the payment-events
  // ledger and updates the `store-transactions` row with the §3.9 extension fields. Idempotency comes
  // from the `(tenant_id, gateway, provider_event_id)` unique index on payment_events — a duplicate
  // delivery returns `{ inserted: false, duplicate: true }` and we skip the write.
  const webhookHandler: NonNullable<Endpoint['handler']> = async (req: PayloadRequest): Promise<Response> => {
    // Provider signature verification — gateway-exempt per Plan §4.2.
    let rawBody: Buffer
    try {
      // `req.text` may be undefined on synthetic test requests; mirror the Stripe adapter's guard.
      const bodyText = typeof req.text === 'function' ? await req.text() : ''
      rawBody = Buffer.from(bodyText ?? '', 'utf8')
    } catch {
      return Response.json({ received: false, reason: 'unreadable body' }, { status: 400 })
    }
    const contentType = req.headers.get('content-type') ?? ''
    const verified = await internal.verifyWebhook({ rawBody, headers: { 'content-type': contentType } })
    if (!verified.accepted || !verified.event) {
      // Never write on a rejected signature — return 401 so the provider can re-deliver.
      return Response.json({ received: false, reason: verified.reason ?? 'rejected' }, { status: 401 })
    }
    const event = verified.event

    // Resolve tenant from the transaction row keyed by providerOrderReference within the verified
    // merchantReference. Webhooks are gateway-exempt (Plan §4.2), so we cannot rely on
    // `req.commerceTenantID`. We instead locate the transaction by its merchantReference and read
    // its `tenant` — this is the only tenant-scoping signal the webhook has.
    const payload = (req as PayloadRequest & { payload: PayloadLike }).payload
    if (!payload) {
      return Response.json({ received: false, reason: 'req.payload missing' }, { status: 500 })
    }

    let transactionDoc: TransactionLike | undefined
    try {
      transactionDoc = (await withBoundedRetry('kashier webhook transaction lookup', () => findInTenant(
        payload,
        transactionsSlug,
        { providerOrderReference: { equals: event.merchantReference } },
        req,
      ), retryAttempts)) as TransactionLike | undefined
    } catch {
      return Response.json({ received: false, reason: 'transaction lookup failed' }, { status: 502 })
    }
    if (!transactionDoc || transactionDoc.tenant === undefined || transactionDoc.tenant === null) {
      // No transaction found for this merchantReference — accept the signature (it verified) and 200.
      // Most likely a delivery for an order not yet initiated, or a tenant we don't host. No write.
      return Response.json({ received: true, noTransaction: true })
    }
    const tenantId = transactionDoc.tenant as string | number

    // Idempotency ledger insert. The unique (tenant_id, gateway, provider_event_id) index makes a
    // duplicate delivery a zero-effect success — Plan §3.9: "Retain payment-events as the append-only
    // signed-event and retry ledger."
    const rawPayloadHash = sha256Hex(rawBody)
    let insertRes: { inserted: boolean; duplicate?: boolean; id?: number }
    try {
      insertRes = await withBoundedRetry('kashier ledger insert', () => insertPaymentEventFn({
        payload: (req as PayloadRequest & { payload: unknown }).payload as never,
        tenantId,
        gateway: 'kashier',
        providerEventId: event.providerEventId,
        merchantReference: event.merchantReference,
        targetState: event.targetState,
        amount: event.amount?.amount,
        rawRedacted: event.rawRedacted === undefined ? undefined : JSON.stringify(event.rawRedacted),
      }), retryAttempts)
    } catch {
      // Ledger insert failed after retry — 503 so the provider re-delivers.
      return Response.json({ received: false, reason: 'ledger write failed' }, { status: 503 })
    }
    if (!insertRes.inserted) {
      // Duplicate delivery — idempotent no-op.
      return Response.json({ received: true, duplicate: true })
    }

    // New event — fold into the transaction's §3.9 extension fields. The state.ts machine owns
    // transition legality; here we just persist the provider-observed amount/status/hash/timestamp.
    const capturedAmount = event.targetState === 'captured' ? (event.amount?.amount ?? 0) : 0
    const refundedAmount = event.targetState === 'refunded' ? (event.amount?.amount ?? 0) : 0
    const lastProviderStatus = event.targetState
    const lastProviderEventTimestamp = clock().toISOString()

    try {
      await withBoundedRetry('kashier transaction update', () => payload.update({
        id: transactionDoc!.id,
        collection: transactionsSlug,
        data: {
          providerTransactionId: event.providerEventId,
          capturedAmount,
          refundedAmount,
          lastProviderStatus,
          lastProviderEventTimestamp,
          // Reconciliation sweep (Wave E reports) flips this to 'matched'/'exception'.
          reconciliationStatus: 'pending',
          // Hash, NEVER the raw payload.
          rawPayloadHash,
          ...(event.targetState === 'captured' ? { status: 'succeeded' } : {}),
          ...(event.targetState === 'failed' ? { status: 'failed' } : {}),
        },
        overrideAccess: true,
        req,
      }), retryAttempts)
    } catch {
      // Transaction update failed after retry — 503 so the provider re-delivers. The ledger row was
      // already inserted, so a duplicate delivery will not double-write (idempotency index); it will
      // re-attempt the transaction update only.
      return Response.json({ received: false, reason: 'transaction update failed' }, { status: 503 })
    }

    return Response.json({ received: true })
  }

  // §3.9 adapter group on `store-transactions`. The §3.9 fields themselves live as top-level fields
  // on the transactions collection via `overrideStoreTransactions` (Wave B1) — the group here is
  // minimal so the plugin's admin UI hides it cleanly when paymentMethod !== 'kashier'. We do NOT
  // duplicate the §3.9 fields in the group (that would re-add them and clash with the override).
  const group: GroupField = {
    name: 'kashier',
    type: 'group',
    admin: {
      condition: (data) => data?.paymentMethod === 'kashier',
    },
    fields: [],
  }

  // Plugin registers the webhook under `/api/payments/kashier/webhooks`. Gateway-exempt — the handler
  // performs provider-signature verification (Plan §4.2).
  const endpoints: Endpoint[] = [
    { path: '/webhooks', method: 'post', handler: webhookHandler },
  ]

  return {
    name: 'kashier',
    label: opts.label ?? 'Kashier',
    group,
    initiatePayment: initiatePayment as unknown as PluginPaymentAdapter['initiatePayment'],
    confirmOrder: confirmOrder as unknown as PluginPaymentAdapter['confirmOrder'],
    endpoints,
  }
}
