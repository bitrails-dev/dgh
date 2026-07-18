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
        allowedMethods: 'card,wallet,bank_installments',
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

// Default instance wired from env. Reads KASHIER_API_KEY / KASHIER_MERCHANT_ID / KASHIER_WEBHOOK_SECRET
// and KASHIER_SANDBOX. Absent credentials are legal here — the adapter throws 'Kashier not configured'
// only when an operation is actually attempted, so environments without payments don't fail to boot.
export const kashierAdapter: PaymentAdapter = createKashierAdapter({
  apiKey: process.env.KASHIER_API_KEY ?? '',
  merchantId: process.env.KASHIER_MERCHANT_ID ?? '',
  webhookSecret: process.env.KASHIER_WEBHOOK_SECRET,
  sandbox: (process.env.KASHIER_SANDBOX ?? '').toLowerCase() === 'true',
})
