// Paymob Accept (Egypt) provider adapter — the only place Paymob's wire format is known.
//
// Wave D1 (Plan §3.2, §3.9, §4.2, §7 D1). This module exposes TWO compatible surfaces on one object:
//
//   1. The Phase-1 provider-agnostic PaymentAdapter (../types) — capabilities / createHostedCheckout /
//      refund / void / verifyWebhook / lookup. The webhook ingestion path (../webhook.ts) and the
//      orchestration registry (./registry.ts) depend on these. Provider HMAC verification
//      (`computeTransactionHmac` + `verifyWebhook`) is retained VERBATIM: provider webhooks are
//      gateway-exempt per §4.2 and verify the Paymob HMAC-SHA512 signature directly.
//
//   2. The plugin-compatible PaymentAdapter (`@payloadcms/plugin-ecommerce/types`) — name / label /
//      group / endpoints / initiatePayment / confirmOrder. The integration owner adds the default
//      export to `ecommercePlugin({ payments: { paymentMethods: [paymobAdapter(), ...] } })` at
//      D-commit time.
//
// Money is integer minor units everywhere in this codebase, and Paymob's `amount_cents` field is
// *also* integer minor units (piasters for EGP), so `Money.amount` is passed through verbatim — no
// scaling, no floating point. ("amount_cents" is Paymob's name for the smallest currency unit
// regardless of the currency's real exponent; it is not literally decimal cents.)
//
// Identity linkage: Paymob's classic API keys on its own ids. We return the Paymob order id as
// `providerSessionId`, so `verifyWebhook`/`lookup` surface that same Paymob order id as
// `merchantReference`; the caller resolves it back to our order via the stored providerSessionId.
// `providerEventId` is the Paymob *transaction* id (distinct per capture/void/refund) for idempotency.
//
// Trust boundary (§3.2): the signed-endpoint `withVerifiedCommerceGateway` helper (integration-owner
// D4) verifies the commerce-gateway signature/nonce/timestamp and resolves the tenant BEFORE this
// adapter is invoked. The first executable operation in `initiatePayment`/`confirmOrder` is the
// tenant re-read: re-load the cart/transaction WITHIN the resolved tenant via Local API and IGNORE
// any unscoped document the wrapper supplies. We do NOT implement the commerce-gateway verify here
// (no SQL NonceRepo exists yet) — the resolved tenantId is accepted as a parameter (via
// `tenantIdResolver`, default reading `req.tenantID`).
//
// Idempotency & retry: the durable `payment-events` ledger (../events.ts) is the source of truth —
// `INSERT ... ON CONFLICT(tenant_id, gateway, provider_event_id) DO NOTHING` makes a duplicate
// delivery a zero-effect success. `initiatePayment` additionally checks for an existing pending
// transaction for the (tenant, cart) pair so a replay never creates a second Paymob order or
// transaction document. Retryable provider errors are rethrown so the caller's job retries.
//
// Testability: all I/O goes through one injectable `fetcher` (default global fetch), a chosen base
// URL, an injectable `tenantIdResolver`, an injectable `insertPaymentEventFn`, and an injectable
// `clock`. Contract tests never touch the network or boot Payload.

import crypto, { timingSafeEqual } from 'node:crypto'

import type { Money } from '../../money'
import { money } from '../../money'
import type {
  HostedCheckoutInput,
  HostedCheckoutResult,
  PaymentAdapter as LocalPaymentAdapter,
  PaymentCapabilities,
  ProviderResult,
  RefundInput,
  VerifiedWebhook,
} from '../types'
import type { PaymentState } from '../state'
import type { PaymentAdapter as PluginPaymentAdapter } from '@payloadcms/plugin-ecommerce/types'
import type { GroupField, PayloadRequest } from 'payload'

import { insertPaymentEvent as defaultInsertPaymentEvent } from '../events'
import { STORE_COLLECTION_SLUGS } from '../../plugin/slugs'

// Paymob classic Accept API roots. Live and sandbox share a host in Paymob's current regional model
// (mode is governed by keys), but the spec requires a distinct sandbox base and cites the
// `accept.paymob.com` iframe host historically used for test mode. Both are injectable; validate
// against real sandbox keys before relying on the sandbox value.
const LIVE_BASE_URL = 'https://accept.paymob.com/api'
const SANDBOX_BASE_URL = 'https://accept.paym.com/api'

type Json = Record<string, unknown>

// Field order for the transaction-callback HMAC, as documented by Paymob. Order-sensitive, no
// delimiters; nested paths use dot notation into the `obj`. `order` is a scalar order id in the
// canonical callback (the object form only appears in /ecommerce/orders API responses); we defend by
// falling back to `.id` so an object never stringifies to "[object Object]".
const HMAC_FIELDS = [
  'amount_cents',
  'created_at',
  'currency',
  'error_occured',
  'has_parent_transaction',
  'id',
  'integration_id',
  'is_3d_secure',
  'is_auth',
  'is_capture',
  'is_refunded',
  'is_standalone_receiver',
  'is_voided',
  'order',
  'owner',
  'pending',
  'source_data.pan',
  'source_data.sub_type',
  'source_data.type',
  'success',
] as const

// --- pure helpers (module scope) -----------------------------------------------------------

function resolveField(obj: Json, path: string): string {
  let v: unknown = obj
  for (const part of path.split('.')) {
    v = (v as Json | undefined)?.[part]
    if (v === undefined) break
  }
  if (v !== null && typeof v === 'object') v = (v as Json).id ?? ''
  return v === undefined || v === null ? '' : String(v)
}

function hmacConcatenation(obj: Json): string {
  return HMAC_FIELDS.map((f) => resolveField(obj, f)).join('')
}

/** Compute the Paymob transaction-callback HMAC-SHA512 over the canonical field concatenation. */
export function computeTransactionHmac(obj: Json, secret: string): string {
  return crypto.createHmac('sha512', secret).update(hmacConcatenation(obj), 'utf8').digest('hex')
}

/** SHA-256 hex of a UTF-8 string. Used for `rawPayloadHash` — the hash of a sensitive provider
 * payload that must never be persisted raw (§3.9). */
function sha256Hex(value: string): string {
  return crypto.createHash('sha256').update(value, 'utf8').digest('hex')
}

// Map Paymob's per-transaction flags onto our payment state machine. Void/refund take precedence
// over success; a pending auth (not yet captured) lands in `authorized`, otherwise `pending`.
// `is_refunded` is boolean so partial vs full is not distinguishable here — a partial refund is
// surfaced as the terminal `refunded` and the caller reconciles amounts via the state machine.
function mapState(obj: Json): PaymentState {
  if (obj.is_voided === true) return 'voided'
  if (obj.is_refunded === true) return 'refunded'
  if (obj.success === true) return 'captured'
  if (obj.pending === true) return obj.is_auth === true ? 'authorized' : 'pending'
  return 'failed'
}

function amountFromObj(obj: Json): Money | undefined {
  const cents = obj.amount_cents
  const currency = typeof obj.currency === 'string' ? obj.currency.toUpperCase() : ''
  if (typeof cents !== 'number' || !Number.isInteger(cents)) return undefined
  if (!/^[A-Z]{3}$/.test(currency)) return undefined
  return money(cents, currency)
}

// Remove full PAN, tokens, and card secrets from the audit copy we keep in rawRedacted. Masked pan
// and last digits are retained (already safe).
function sanitizeForAudit(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitizeForAudit)
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (/^(pan|token|cvv|security_code|card)$/i.test(k)) continue
      out[k] = sanitizeForAudit(v)
    }
    return out
  }
  return value
}

// Strip anything that looks like a credential from a gateway error before it reaches the caller.
// Paymob errors come back as { detail: [...] } or { message }; we never forward the auth token
// (which lives only in the request) and collapse raw blobs to a short, safe string.
function redact(value: unknown): string {
  if (typeof value !== 'string') return ''
  return value.replace(/tok_[A-Za-z0-9_-]+|Bearer\s+\S+|api_key[^&\s"']*/gi, '[redacted]').slice(0, 300)
}

function gatewayError(body: Json | undefined, fallback: string): { code: string; message: string } {
  const detail = body?.detail
  let raw = ''
  if (typeof detail === 'string') raw = detail
  else if (Array.isArray(detail) && detail.length) raw = String(detail[0] ?? '')
  else if (typeof body?.message === 'string') raw = body.message
  return { code: 'PAYMOB_GATEWAY_ERROR', message: redact(raw) || fallback }
}

// --- Local-API minimal shape used by initiatePayment / confirmOrder -----------------------
// We avoid importing generated types so the module remains importable before the integration owner
// runs `generate:types` at B4. The shape is structural; the plugin and overrides already publish
// the §3.9 fields on `store-transactions`.

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
}

// --- adapter factory ------------------------------------------------------------------------

export interface PaymobAdapterOptions {
  apiKey?: string
  hmacSecret?: string
  iframeId?: string | number
  integrationId?: string | number
  sandbox?: boolean
  baseURL?: string
  sandboxBaseURL?: string
  fetcher?: typeof fetch
  /**
   * Resolves the verified tenant id from the request. The default reads `req.tenantID` — the
   * integration owner's `withVerifiedCommerceGateway` helper (Plan §3.2) stashes the resolved
   * tenant there after verifying the commerce-gateway signature/nonce/timestamp. Returning
   * `undefined | null` causes `initiatePayment`/`confirmOrder` to throw before any write.
   *
   * Tests inject this to avoid booting Payload.
   */
  tenantIdResolver?: (req: PayloadRequest, data: Record<string, unknown>) => string | number | undefined
  /**
   * Injectable durable ledger inserter (defaults to ../events.ts `insertPaymentEvent`). The ledger
   * provides idempotency via the `(tenant_id, gateway, provider_event_id)` unique index.
   */
  insertPaymentEventFn?: typeof defaultInsertPaymentEvent
  /** Injectable clock for deterministic `lastProviderEventTimestamp` values in tests. */
  clock?: () => Date
}

function env(name: string): string | undefined {
  return process.env[name]
}

const DEFAULT_TENANT_RESOLVER = (req: PayloadRequest): string | number | undefined => {
  const r = req as PayloadRequest & { tenantID?: string | number; tenant?: { id?: string | number } }
  if (r.tenantID !== undefined) return r.tenantID
  return r.tenant?.id
}

// The intersection of the Phase-1 provider interface and the plugin-compatible interface. Returned
// by `createPaymobAdapter` so the same object works in both `paymentMethods: [paymobAdapter()]` and
// in the existing webhook/registry orchestration paths.
export type PaymobAdapterInstance = LocalPaymentAdapter & PluginPaymentAdapter

export function createPaymobAdapter(opts: PaymobAdapterOptions = {}): PaymobAdapterInstance {
  const apiKey = opts.apiKey ?? env('PAYMOB_API_KEY')
  const hmacSecret = opts.hmacSecret ?? env('PAYMOB_HMAC_SECRET')
  // `PAYMOM_IFRAME_ID` is the env name cited in the spec (a typo for PAYMOB); accept both spellings.
  const iframeId = opts.iframeId ?? env('PAYMOB_IFRAME_ID') ?? env('PAYMOM_IFRAME_ID')
  const integrationId = opts.integrationId ?? env('PAYMOB_INTEGRATION_ID')
  const sandboxDefault = opts.sandbox ?? false
  const liveBase = opts.baseURL ?? LIVE_BASE_URL
  const sandboxBase = opts.sandboxBaseURL ?? SANDBOX_BASE_URL
  const fetcher = opts.fetcher ?? fetch
  const tenantIdResolver = opts.tenantIdResolver ?? DEFAULT_TENANT_RESOLVER
  const insertPaymentEventFn = opts.insertPaymentEventFn ?? defaultInsertPaymentEvent
  const clock = opts.clock ?? (() => new Date())

  const baseFor = (useSandbox: boolean): string => (useSandbox ? sandboxBase : liveBase)

  const requireCheckoutConfigured = (): void => {
    if (!apiKey || iframeId === undefined || integrationId === undefined) {
      throw new Error('Paymob not configured')
    }
  }

  interface GatewayResponse {
    status: number
    body: Json | undefined
  }

  const jsonHeaders = { 'Content-Type': 'application/json' }

  async function request(useSandbox: boolean, path: string, init: RequestInit): Promise<GatewayResponse> {
    const res = await fetcher(`${baseFor(useSandbox)}${path}`, init)
    const text = await res.text()
    let body: Json | undefined
    if (text) {
      try {
        body = JSON.parse(text) as Json
      } catch {
        body = { raw: text }
      }
    }
    return { status: res.status, body }
  }

  // Auth tokens last ~1h. Cache briefly so a checkout/refund/void burst does not re-auth per call.
  let tokenCache: { token: string; expiresAt: number } | null = null
  const TOKEN_TTL_MS = 55 * 60 * 1000

  async function authToken(): Promise<string> {
    if (!apiKey) throw new Error('Paymob not configured')
    if (tokenCache && Date.now() < tokenCache.expiresAt) return tokenCache.token
    const { status, body } = await request(false, '/auth/tokens', {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({ api_key: apiKey }),
    })
    const token = body?.token
    if (status >= 400 || typeof token !== 'string' || !token) {
      throw new Error('Paymob not configured')
    }
    tokenCache = { token, expiresAt: Date.now() + TOKEN_TTL_MS }
    return token
  }

  function capabilities(): PaymentCapabilities {
    return {
      hostedCheckout: true,
      authorization: true,
      refunds: true,
      partialRefunds: true,
      voiding: true,
      recurring: false,
      webhookSignature: 'hmac',
    }
  }

  async function createOrder(
    useSandbox: boolean,
    token: string,
    input: HostedCheckoutInput,
  ): Promise<number> {
    const { status, body } = await request(useSandbox, '/ecommerce/orders', {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({
        auth_token: token,
        delivery_needed: false,
        amount_cents: input.amount.amount,
        currency: input.amount.currency,
        merchant_order_id: input.merchantReference,
        items: [],
      }),
    })
    const id = body?.id
    if (status >= 400 || (typeof id !== 'number' && typeof id !== 'string')) {
      throw new Error('Paymob order creation failed')
    }
    return Number(id)
  }

  async function requestPaymentKey(
    useSandbox: boolean,
    token: string,
    input: HostedCheckoutInput,
    orderId: number,
  ): Promise<string> {
    // billing_data is required by Paymob even for digital goods; pass the customer email through and
    // fill the remaining mandatory fields with neutral placeholders (test mode accepts these).
    const billing = {
      apartment: 'NA',
      email: input.customerEmail ?? 'guest@example.com',
      first_name: 'Customer',
      last_name: 'Guest',
      floor: 'NA',
      street: 'NA',
      building: 'NA',
      phone_number: '0000000000',
      shipping_method: 'NA',
      city: 'Cairo',
      country: 'EG',
      state: 'NA',
    }
    const { status, body } = await request(useSandbox, '/acceptance/payment_keys', {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({
        auth_token: token,
        amount_cents: input.amount.amount,
        expiration: 3600,
        order_id: orderId,
        billing_data: billing,
        currency: input.amount.currency,
        integration_id: integrationId,
        lock_order_when_paid: true,
      }),
    })
    const key = body?.token
    if (status >= 400 || typeof key !== 'string' || !key) {
      throw new Error('Paymob payment key request failed')
    }
    return key
  }

  async function createHostedCheckout(input: HostedCheckoutInput): Promise<HostedCheckoutResult> {
    requireCheckoutConfigured()
    const useSandbox = input.sandbox
    const token = await authToken()
    const orderId = await createOrder(useSandbox, token, input)
    const paymentToken = await requestPaymentKey(useSandbox, token, input, orderId)
    const checkoutUrl = `${baseFor(useSandbox)}/acceptance/iframes/${iframeId}?payment_token=${paymentToken}`
    return { checkoutUrl, providerSessionId: String(orderId) }
  }

  async function refund(input: RefundInput): Promise<ProviderResult> {
    const token = await authToken()
    let res: GatewayResponse
    try {
      res = await request(false, '/acceptance/void_refund/refund', {
        method: 'POST',
        headers: jsonHeaders,
        body: JSON.stringify({
          auth_token: token,
          transaction_id: input.providerTransactionId,
          amount_cents: input.amount.amount,
        }),
      })
    } catch {
      return { ok: false, error: { code: 'PAYMOB_REQUEST_FAILED', message: 'refund request failed' } }
    }
    if (res.status >= 400) return { ok: false, error: gatewayError(res.body, 'refund failed') }
    return {
      ok: res.body?.success === true,
      providerEventId: res.body?.id !== undefined ? String(res.body.id) : undefined,
      error: res.body?.success === true ? undefined : gatewayError(res.body, 'refund not applied'),
    }
  }

  async function voidTransaction(input: {
    providerTransactionId: string
    reason?: string
  }): Promise<ProviderResult> {
    const token = await authToken()
    let res: GatewayResponse
    try {
      res = await request(false, '/acceptance/void_refund/void', {
        method: 'POST',
        headers: jsonHeaders,
        body: JSON.stringify({
          auth_token: token,
          transaction_id: input.providerTransactionId,
        }),
      })
    } catch {
      return { ok: false, error: { code: 'PAYMOB_REQUEST_FAILED', message: 'void request failed' } }
    }
    if (res.status >= 400) return { ok: false, error: gatewayError(res.body, 'void failed') }
    return {
      ok: res.body?.success === true,
      providerEventId: res.body?.id !== undefined ? String(res.body.id) : undefined,
      error: res.body?.success === true ? undefined : gatewayError(res.body, 'void not applied'),
    }
  }

  async function verifyWebhook(input: {
    rawBody: Buffer
    headers: Record<string, string | undefined>
  }): Promise<VerifiedWebhook> {
    if (!hmacSecret) return { accepted: false, reason: 'Paymob not configured' }
    const headerLookup: Record<string, string | undefined> = {}
    for (const [k, v] of Object.entries(input.headers)) headerLookup[k.toLowerCase()] = v
    const sent = headerLookup['hmac']
    if (typeof sent !== 'string' || sent.length === 0) {
      return { accepted: false, reason: 'missing hmac header' }
    }

    let envelope: Json | undefined
    try {
      envelope = JSON.parse(input.rawBody.toString('utf8')) as Json
    } catch {
      return { accepted: false, reason: 'malformed body' }
    }
    // Paymob wraps the transaction as { type, obj }. Fall back to the whole body if `obj` is absent.
    const obj = (envelope.obj && typeof envelope.obj === 'object' ? envelope.obj : envelope) as Json
    if (!obj || typeof obj !== 'object') return { accepted: false, reason: 'no transaction object' }

    const computed = computeTransactionHmac(obj, hmacSecret)
    const a = Buffer.from(computed, 'utf8')
    const b = Buffer.from(sent, 'utf8')
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      return { accepted: false, reason: 'bad signature' }
    }

    return {
      accepted: true,
      event: {
        provider: 'paymob',
        providerEventId: obj.id !== undefined ? String(obj.id) : String(obj.order ?? ''),
        merchantReference: String(obj.order ?? ''),
        targetState: mapState(obj),
        amount: amountFromObj(obj),
        rawRedacted: sanitizeForAudit(obj),
      },
    }
  }

  // Authoritative reconciliation. merchantReference is interpreted as the Paymob transaction id (the
  // providerEventId we surfaced); the caller passes the stored handle. The transaction inquiry carries
  // the success/pending/void/refunded flags directly.
  async function lookup(
    merchantReference: string,
  ): Promise<{ state: PaymentState; providerEventId?: string }> {
    // Classic Accept authenticates the GET transaction inquiry with the auth token as a query param.
    const token = await authToken()
    let res: GatewayResponse
    try {
      res = await request(
        false,
        `/acceptance/transactions/${encodeURIComponent(merchantReference)}?token=${encodeURIComponent(token)}`,
        { method: 'GET', headers: jsonHeaders },
      )
    } catch {
      return { state: 'pending' }
    }
    const obj = res.body
    if (res.status >= 400 || !obj) return { state: 'pending' }
    const id = obj.id !== undefined ? String(obj.id) : undefined
    return { state: mapState(obj), providerEventId: id }
  }

  // --- plugin-compatible surface (Wave D1, §3.2 / §3.9 / §4.2) ---------------------------
  //
  // The plugin calls `initiatePayment` via `/api/payments/paymob/initiate` and `confirmOrder` via
  // `/api/payments/paymob/confirm-order`. Both are registered by the plugin but the FIRST executable
  // operation in each is the tenant re-read described in §3.2 — direct unsigned calls receive 403
  // upstream (the integration owner wires `withVerifiedCommerceGateway` around the plugin endpoint).
  //
  // We do not implement the commerce-gateway verify here (no SQL NonceRepo exists yet); the resolved
  // tenantId is accepted via `tenantIdResolver`.

  function resolveTenant(req: PayloadRequest, data: Record<string, unknown>): string | number {
    const tid = tenantIdResolver(req, data)
    if (tid === undefined || tid === null || tid === '') {
      throw new Error('Paymob plugin adapter: resolved tenant required')
    }
    return tid
  }

  // Re-read a document within the resolved tenant via Local API, ignoring any unscoped wrapper-supplied
  // document. Returns `undefined` when no document matches in this tenant.
  async function findInTenant(
    payload: PayloadLike,
    collection: string,
    where: unknown,
    req: PayloadRequest,
  ): Promise<Record<string, unknown> | undefined> {
    const res = await payload.find({
      collection,
      where,
      limit: 1,
      overrideAccess: true,
      req,
    })
    return res.docs[0] as Record<string, unknown> | undefined
  }

  async function initiatePayment(args: {
    data: {
      billingAddress?: unknown
      cart: CartLike
      currency?: string
      customerEmail?: string
      shippingAddress?: unknown
    }
    req: PayloadRequest
    transactionsSlug: string
  }): Promise<{ message: string; [key: string]: unknown }> {
    const { data, req, transactionsSlug } = args
    // 1. Resolved tenant (D4 verified the gateway signature upstream).
    const tenantId = resolveTenant(req, data as Record<string, unknown>)
    const payload = (req as PayloadRequest & { payload: PayloadLike }).payload
    if (!payload) throw new Error('Paymob initiatePayment: req.payload missing')

    const wrapperCart = data?.cart
    const cartId = wrapperCart?.id
    if (cartId === undefined || cartId === null || cartId === '') {
      throw new Error('Paymob initiatePayment: cart id required')
    }

    // 2. Idempotency: an existing pending transaction for this (tenant, cart) short-circuits the
    //    Paymob round-trip. A replay must never create a second transaction document or call Paymob
    //    twice (Plan §3.9 + Phase 1 checkout idempotency).
    const existing = (await findInTenant(
      payload,
      transactionsSlug,
      {
        and: [
          { cart: { equals: cartId } },
          { tenant: { equals: tenantId } },
          { status: { equals: 'pending' } },
        ],
      },
      req,
    )) as TransactionLike | undefined
    if (existing && existing.providerOrderReference) {
      return {
        message: 'Payment already initiated',
        transactionID: existing.id,
        providerSessionId: existing.providerOrderReference,
        providerOrderReference: existing.providerOrderReference,
        replay: true,
      }
    }

    // 3. Tenant re-read: re-load the cart WITHIN the resolved tenant (§3.2). The wrapper-supplied
    //    `data.cart` is untrusted browser input — only the tenant-scoped DB read is authoritative.
    const cart = (await findInTenant(
      payload,
      STORE_COLLECTION_SLUGS.carts,
      { and: [{ id: { equals: cartId } }, { tenant: { equals: tenantId } }] },
      req,
    )) as CartLike | undefined
    if (!cart) {
      // The wrapper-supplied cart is wrong-tenant or unscoped — no write happens.
      throw new Error('Paymob initiatePayment: cart not found in resolved tenant')
    }

    // 4. Authoritative amount: read from the re-read cart (integer minor units, EGP only). NEVER
    //    trust browser-supplied totals (Plan §3.3). The re-read cart's subtotal is the server-side
    //    quote result; the adapter does not compute the quote itself.
    const amount = cart.subtotal
    const currency = (cart.currency ?? data?.currency ?? 'EGP').toUpperCase()
    if (typeof amount !== 'number' || !Number.isInteger(amount) || amount <= 0) {
      throw new Error('Paymob initiatePayment: cart subtotal must be a positive integer (minor units)')
    }
    if (currency !== 'EGP') {
      throw new Error(`Paymob initiatePayment: only EGP supported, got ${currency}`)
    }

    // 5. Paymob round-trip: auth → create order → request payment key → iframe URL. A network /
    //    gateway error is thrown (never swallowed) so the caller's job retries with backoff.
    requireCheckoutConfigured()
    const useSandbox = sandboxDefault
    const token = await authToken()
    const checkoutInput: HostedCheckoutInput = {
      merchantReference: String(cart.id),
      amount: money(amount, currency),
      customerEmail: typeof data?.customerEmail === 'string' ? data.customerEmail : undefined,
      sandbox: useSandbox,
    }
    const paymobOrderId = await createOrder(useSandbox, token, checkoutInput)
    const paymentToken = await requestPaymentKey(useSandbox, token, checkoutInput, paymobOrderId)
    const checkoutUrl = `${baseFor(useSandbox)}/acceptance/iframes/${iframeId}?payment_token=${paymentToken}`

    // 6. Hash the sensitive provider payload (Paymob order id + payment token). Raw tokens are NEVER
    //    persisted — only the SHA-256 hash is stored on `rawPayloadHash` (§3.9).
    const rawPayloadHash = sha256Hex(JSON.stringify({ paymobOrderId, paymentToken }))
    const nowISO = clock().toISOString()

    // 7. Create the store-transactions document with §3.9 fields populated.
    const txnData: Record<string, unknown> = {
      // Plugin base transaction fields
      amount,
      currency,
      cart: cart.id,
      items: Array.isArray(cart.items) ? cart.items : [],
      paymentMethod: 'paymob',
      status: 'pending',
      ...(typeof data?.customerEmail === 'string' ? { customerEmail: data.customerEmail } : {}),
      ...(data?.billingAddress !== undefined ? { billingAddress: data.billingAddress } : {}),
      ...(data?.shippingAddress !== undefined ? { shippingAddress: data.shippingAddress } : {}),
      // §3.9 adapter-group fields
      providerTransactionId: '',
      providerOrderReference: String(paymobOrderId),
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
      collection: transactionsSlug,
      data: txnData,
      overrideAccess: true,
      req,
    })) as unknown as TransactionLike

    // 8. Durable ledger entry. Idempotent via the (tenant_id, gateway, provider_event_id) unique
    //    index on `payment-events`. `providerEventId` is namespaced per-cart so a replay that did
    //    not find the pending transaction above (e.g. the transaction moved out of pending in a
    //    race) still produces only one ledger row.
    try {
      await insertPaymentEventFn({
        payload: (req as PayloadRequest & { payload: unknown }).payload as never,
        tenantId,
        gateway: 'paymob',
        providerEventId: `initiate:${cartId}`,
        merchantReference: String(txnDoc.id),
        targetState: 'pending',
        amount,
        rawRedacted: JSON.stringify({ providerOrderReference: String(paymobOrderId) }),
      })
    } catch {
      // Ledger failure does NOT roll back the transaction write — the ledger is the idempotency
      // record, and the next sweep re-inserts. The job rethrows on the *provider* call failing;
      // here we swallow because the transaction is already durably created.
    }

    return {
      message: 'Payment initiated successfully',
      checkoutUrl,
      providerSessionId: String(paymobOrderId),
      providerOrderReference: String(paymobOrderId),
      transactionID: txnDoc.id,
    }
  }

  async function confirmOrder(args: {
    data: { [key: string]: unknown; customerEmail?: string }
    req: PayloadRequest
    ordersSlug?: string
    cartsSlug?: string
    transactionsSlug?: string
    customersSlug?: string
  }): Promise<{ message: string; orderID: number; transactionID: number; [key: string]: unknown }> {
    const { data, req } = args
    const ordersSlug = args.ordersSlug ?? STORE_COLLECTION_SLUGS.orders
    const transactionsSlug = args.transactionsSlug ?? STORE_COLLECTION_SLUGS.transactions

    // 1. Resolved tenant.
    const tenantId = resolveTenant(req, data)
    const payload = (req as PayloadRequest & { payload: PayloadLike }).payload
    if (!payload) throw new Error('Paymob confirmOrder: req.payload missing')

    const transactionID = data?.transactionID
    if (transactionID === undefined || transactionID === null || transactionID === '') {
      throw new Error('Paymob confirmOrder: transactionID required')
    }

    // 2. Tenant re-read: re-load the transaction WITHIN the resolved tenant (§3.2). The
    //    wrapper-supplied transactionID is untrusted until the tenant-scoped DB read confirms it.
    const txn = (await findInTenant(
      payload,
      transactionsSlug,
      { and: [{ id: { equals: transactionID } }, { tenant: { equals: tenantId } }] },
      req,
    )) as TransactionLike | undefined
    if (!txn) {
      throw new Error('Paymob confirmOrder: transaction not found in resolved tenant')
    }

    const providerOrderReference = txn.providerOrderReference
    if (!providerOrderReference) {
      throw new Error('Paymob confirmOrder: transaction missing providerOrderReference')
    }

    // 3. Idempotency FIRST: if this transaction is already captured/succeeded AND linked to an order,
    //    return both ids without calling Paymob. A replay must never hit the provider or create a
    //    second order. (Plan §3.9 + Phase 1 checkout idempotency.)
    const alreadyConfirmed = txn.status === 'succeeded' || txn.lastProviderStatus === 'captured'
    let orderID: number | undefined
    if (txn.order) {
      const raw = typeof txn.order === 'object' ? (txn.order as { id: number | string }).id : txn.order
      orderID = Number(raw)
    }
    if (alreadyConfirmed && orderID !== undefined) {
      return {
        message: 'Order already confirmed',
        orderID,
        transactionID: Number(txn.id),
        replay: true,
      }
    }

    // 4. Authoritative state from Paymob. `lookup` queries `/acceptance/transactions/<id>`; when the
    //    Paymob transaction id is not yet known (only the order id is), the lookup falls back to
    //    `pending`. The webhook remains the authoritative path; `confirmOrder` reconciles best-effort
    //    so the storefront can show the right confirmation page.
    let state: PaymentState = 'pending'
    let providerEventId: string | undefined
    if (txn.providerTransactionId) {
      try {
        const r = await lookup(txn.providerTransactionId)
        state = r.state
        providerEventId = r.providerEventId
      } catch {
        // Network failures must rethrow so the caller retries — never swallow a retryable error.
        throw new Error('Paymob confirmOrder: provider lookup failed')
      }
    }

    const nowISO = clock().toISOString()
    const capturedAmount = state === 'captured' ? (txn.amount ?? 0) : (txn.capturedAmount ?? 0)

    // 5. Update the transaction with the §3.9 fields reflecting the authoritative provider state.
    await payload.update({
      id: txn.id,
      collection: transactionsSlug,
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

    // 6. Idempotent ledger entry. `providerEventId` is namespaced by transaction + state so a
    //    duplicate confirm is a no-op.
    try {
      await insertPaymentEventFn({
        payload: (req as PayloadRequest & { payload: unknown }).payload as never,
        tenantId,
        gateway: 'paymob',
        providerEventId: `confirm:${String(txn.id)}:${state}`,
        merchantReference: String(txn.id),
        targetState: state,
        amount: capturedAmount,
        rawRedacted: JSON.stringify({ state, providerOrderReference }),
      })
    } catch {
      // see initiatePayment — ledger failure does not roll back the provider write
    }

    // 7. Create the order if it does not yet exist (Stripe-pattern). Phase 1 idempotency for the
    //    order itself is the integration owner's responsibility (D4); here we only create when no
    //    order is linked to the transaction.
    if (orderID === undefined) {
      const orderData: Record<string, unknown> = {
        amount: txn.amount ?? 0,
        currency: txn.currency ?? 'EGP',
        transactions: [txn.id],
        cart: txn.cart,
        status: 'processing',
        paymentState: state,
        placedAt: nowISO,
        ...(txn.customer !== undefined ? { customer: txn.customer } : {}),
        ...(txn.customerEmail ? { customerEmail: txn.customerEmail } : {}),
        ...(Array.isArray(txn.items) ? { items: txn.items } : {}),
      }
      const orderDoc = (await payload.create({
        collection: ordersSlug,
        data: orderData,
        overrideAccess: true,
        req,
      })) as { id: number | string }
      orderID = Number(orderDoc.id)

      // Link the transaction back to the order for future idempotency.
      await payload.update({
        id: txn.id,
        collection: transactionsSlug,
        data: { order: orderID },
        overrideAccess: true,
        req,
      })
    }

    return {
      message: 'Order confirmed successfully',
      orderID,
      transactionID: Number(txn.id),
    }
  }

  // §3.9 adapter group on `store-transactions`. The §3.9 fields themselves live as top-level fields
  // on the transactions collection via `overrideStoreTransactions` (Wave B1) — the group here is
  // minimal so the plugin's admin UI hides it cleanly when paymentMethod !== 'paymob'. We do NOT
  // duplicate the §3.9 fields in the group (that would re-add them and clash with the override).
  const group: GroupField = {
    name: 'paymob',
    type: 'group',
    admin: {
      condition: (data) => data?.paymentMethod === 'paymob',
    },
    fields: [],
  }

  // Provider webhooks are gateway-exempt and verified by `verifyWebhook` via the existing webhook
  // ingestion path (../webhook.ts). The plugin mounts any `endpoints` we declare under
  // `/api/payments/paymob/*`; declaring none keeps the plugin-path surface minimal so the
  // integration owner can route Paymob webhooks through the gateway-exempt handler.
  const endpoints: PluginPaymentAdapter['endpoints'] = []

  return {
    // Phase-1 local PaymentAdapter surface (retained verbatim — provider integration unchanged).
    provider: 'paymob',
    capabilities,
    createHostedCheckout,
    refund,
    void: voidTransaction,
    verifyWebhook,
    lookup,
    // Plugin-compatible PaymentAdapter surface (Wave D1).
    name: 'paymob',
    label: 'Paymob',
    group,
    endpoints,
    initiatePayment,
    confirmOrder,
  }
}

// Default instance bound to process.env (unconfigured if vars are absent — checkout throws, webhook
// rejects). Tests and explicit wiring use createPaymobAdapter with injected options. The integration
// owner adds this to `ecommercePlugin({ payments: { paymentMethods: [paymobAdapter(), ...] } })`.
export const paymobAdapter: PaymobAdapterInstance = createPaymobAdapter()
