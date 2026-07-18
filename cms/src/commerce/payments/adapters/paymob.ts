// Paymob Accept (Egypt) provider adapter — the only place Paymob's wire format is known. It implements
// the provider-agnostic PaymentAdapter contract (types.ts); the orchestration layer and state machine
// never see Paymob shapes. Money is integer minor units everywhere in this codebase, and Paymob's
// `amount_cents` field is *also* integer minor units (piasters for EGP), so `Money.amount` is passed
// through verbatim — no scaling, no floating point. ("amount_cents" is Paymob's name for the smallest
// currency unit regardless of the currency's real exponent; it is not literally decimal cents.)
//
// Webhook authenticity: Paymob signs transaction callbacks with HMAC-SHA512 over a documented,
// order-sensitive concatenation of fields from the callback's `obj` (the transaction). We reproduce
// that concatenation and compare with crypto.timingSafeEqual — never plain `===`. The auth token and
// raw gateway blobs are never echoed into ProviderResult.error or rawRedacted (sanitized trust boundary).
//
// Identity linkage: Paymob's classic API keys on its own ids. We return the Paymob order id as
// `providerSessionId`, so `verifyWebhook`/`lookup` surface that same Paymob order id as
// `merchantReference`; the caller resolves it back to our order via the stored providerSessionId.
// `providerEventId` is the Paymob *transaction* id (distinct per capture/void/refund) for idempotency.
//
// Testability: all I/O goes through one injectable `fetcher` (default global fetch) and a chosen base
// URL, so contract tests never touch the network.

import crypto, { timingSafeEqual } from 'node:crypto'

import type { Money } from '../../money'
import { money } from '../../money'
import type {
  HostedCheckoutInput,
  HostedCheckoutResult,
  PaymentAdapter,
  PaymentCapabilities,
  ProviderResult,
  RefundInput,
  VerifiedWebhook,
} from '../types'
import type { PaymentState } from '../state'

// Paymob classic Accept API roots. Live and sandbox share a host in Paymob's current regional model
// (mode is governed by keys), but the spec requires a distinct sandbox base and cites the
// `accept.paym.com` iframe host historically used for test mode. Both are injectable; validate against
// real sandbox keys before relying on the sandbox value.
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
}

function env(name: string): string | undefined {
  return process.env[name]
}

export function createPaymobAdapter(opts: PaymobAdapterOptions = {}): PaymentAdapter {
  const apiKey = opts.apiKey ?? env('PAYMOB_API_KEY')
  const hmacSecret = opts.hmacSecret ?? env('PAYMOB_HMAC_SECRET')
  // `PAYMOM_IFRAME_ID` is the env name cited in the spec (a typo for PAYMOB); accept both spellings.
  const iframeId = opts.iframeId ?? env('PAYMOB_IFRAME_ID') ?? env('PAYMOM_IFRAME_ID')
  const integrationId = opts.integrationId ?? env('PAYMOB_INTEGRATION_ID')
  const sandboxDefault = opts.sandbox ?? false
  const liveBase = opts.baseURL ?? LIVE_BASE_URL
  const sandboxBase = opts.sandboxBaseURL ?? SANDBOX_BASE_URL
  const fetcher = opts.fetcher ?? fetch

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

  return {
    provider: 'paymob',
    capabilities,
    createHostedCheckout,
    refund,
    void: voidTransaction,
    verifyWebhook,
    lookup,
  }
}

// Default instance bound to process.env (unconfigured if vars are absent — checkout throws, webhook
// rejects). Tests and explicit wiring use createPaymobAdapter with injected options.
export const paymobAdapter: PaymentAdapter = createPaymobAdapter()
