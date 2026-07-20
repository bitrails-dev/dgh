// Plugin-first checkout orchestration (Plan §7 D4). The single path that turns a verified gateway
// request + a plugin `store-carts` cart into a placed `store-orders` document. Runs the 10 fixed
// steps; no legacy product/cart/order/transaction collection is written by this path.
//
//   1. signed gateway request   — verified upstream by withVerifiedCommerceGateway (store/gateway.ts);
//                                  the resolved {tenantId, customerId?} is the ONLY trusted identity.
//   2. load the plugin cart      — tenant-scoped, inside quoteCart's loader (ownership = scoped read).
//   3. authoritative quote        — quoteCart (§3.10); browser totals are never trusted.
//   4. idempotent order draft     — store-orders keyed on checkoutKey (§3.8 partial unique
//                                  (tenant_id, checkout_key)); replay on same key+fingerprint, 409 on
//                                  same key+different body.
//   5. Phase 1 reservation        — reserve by immutable normalized SKU (C5 resolver), plugin doc ids
//                                  carried as traceability only; orderRef = orderNumber.
//   6. plugin transaction         — store-transactions with §3.9 fields (online only).
//   7. Paymob/Kashier initiation  — hosted checkout URL via the D1/D2 adapter (explicit authoritative
//                                  amount); offline methods skip this and leave stock reserved.
//   8. payment-event processing   — a pending event is durably recorded; capture/refund drives the D3
//                                  side-effect chain via the process-payment-event task. We do NOT
//                                  call setOrderPaymentState / commitOrderInventory ad-hoc.
//   9. reservation commit         — only after the captured/approved state, driven by the payment job
//                                  (not here). Offline orders await admin confirmation.
//  10. immutable order snapshot   — quoteHash + quoteSnapshot + every integer total on store-orders.
//
// The function is directly callable (hence directly testable); the signed endpoint handler in
// store/checkout.ts is a thin wrapper that verifies the gateway then calls this.

import { createHash } from 'node:crypto'
import type { Payload } from 'payload'

import { money } from '../money'
import { quoteCart, type QuoteCartResult, type QuoteCartLoader } from '../policies/quote'
import { createPayloadQuoteCartLoader } from '../policies/quote-loader'
import { allocateOrderNumber } from '../orders/numbering'
import { resolveSellableBySku } from '../inventory/sku-resolution'
import { reserve, releaseOrder, DEFAULT_RESERVATION_TTL_MS } from '../inventory'
import { loadCommerceSettings } from '../store/shared'
import { isUuidV4 } from '../store/checkout'
import { loadGatewayConfig, type GatewayProvider } from '../payments/settings'
import { buildPaymentAdapter, type AdapterBuilder } from '../payments/adapters/registry'
import { insertPaymentEvent } from '../payments/events'
import { STORE_COLLECTION_SLUGS } from '../plugin/slugs'
import type { VerifiedCommerceContext } from '../store/gateway'

export type OfflinePaymentMethod = 'cod' | 'bank'
export type CheckoutPaymentMethod = OfflinePaymentMethod | GatewayProvider

export interface ProcessCheckoutInput {
  /** Plugin `store-carts` document id (the cart re-read is tenant-scoped inside the loader). */
  cartId: number | string
  paymentMethod: CheckoutPaymentMethod
  shippingAddress: unknown
  billingAddress?: unknown
  /** Selected retained shipping-method id (else quoteCart picks the cheapest eligible). */
  shippingMethodId?: number | string | null
  promotionCodes?: string[]
  giftCardCode?: string | null
  /** Explicit fulfillment location; defaults to the tenant's first inventory-location. */
  locationId?: number | string
  customerEmail?: string
  customerPhone?: string
  returnUrl?: string
  /** RFC 4122 v4 Idempotency-Key. Present → replay/409 semantics on (tenant, key). */
  idempotencyKey?: string
  reservationTtlMs?: number
}

export interface ProcessCheckoutOptions {
  /** Injectable adapter builder so the online path is testable with a fake (no network). */
  buildAdapter?: AdapterBuilder
  /** Injectable quote loader (defaults to the Payload-backed loader). */
  loader?: QuoteCartLoader
}

export type ProcessCheckoutResult = { status: number; body: Record<string, unknown> }

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

// Deep-sort + trim so key-insertion order and insignificant whitespace cannot flip the fingerprint.
// Arrays keep order; the quote is order-independent (lines are keyed by SKU), but the cart's line
// order is part of the request so it stays in the fingerprint.
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

// SHA-256 over the normalized request: payment method, the cart's priced lines (summed per SKU,
// matching how the quote keys lines), and the addresses. Same key + same body ⇒ same fingerprint ⇒
// replay; same key + different body ⇒ 409. Gift-card codes are hashed into the customer-identity
// inside quoteCart, not the fingerprint (a raw code never lives in the order row).
function checkoutFingerprint(input: ProcessCheckoutInput): string {
  const canonical = JSON.stringify({
    c: String(input.cartId),
    pm: input.paymentMethod,
    s: canonicalize(input.shippingAddress ?? null),
    b: canonicalize(input.billingAddress ?? null),
    pc: [...(input.promotionCodes ?? [])].map((c) => c.trim().toUpperCase()).sort(),
    sm: input.shippingMethodId === undefined || input.shippingMethodId === null ? '' : String(input.shippingMethodId),
  })
  return createHash('sha256').update(canonical).digest('hex')
}

type ExistingOrder = {
  id: number | string
  orderNumber: string
  amountDue: number
  currency?: string
  paymentState?: string
  checkoutFingerprint?: string
}

async function findStoreOrderByCheckoutKey(
  payload: Payload,
  tenantId: number | string,
  checkoutKey: string,
): Promise<ExistingOrder | undefined> {
  const { docs } = await payload.find({
    collection: STORE_COLLECTION_SLUGS.orders,
    where: { and: [{ tenant: { equals: tenantId } }, { checkoutKey: { equals: checkoutKey } }] },
    overrideAccess: true,
    limit: 1,
  })
  return docs[0] as ExistingOrder | undefined
}

function replayOrConflict(
  existing: ExistingOrder,
  fingerprint: string | undefined,
  currency: string,
): ProcessCheckoutResult {
  // A keyed order always carries a fingerprint; a missing/mismatched store is a real conflict.
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

const failure = (
  status: number,
  code: string,
  detail?: unknown,
): ProcessCheckoutResult => ({ status, body: detail === undefined ? { error: code } : { error: code, detail } })

/**
 * Run the 10-step plugin-first checkout. `ctx` is the verified gateway context (tenant + optional
 * customer). Returns an HTTP-shaped `{status, body}` the endpoint passes through unchanged.
 */
export async function processCheckout(
  payload: Payload,
  ctx: VerifiedCommerceContext,
  input: ProcessCheckoutInput,
  opts?: ProcessCheckoutOptions,
): Promise<ProcessCheckoutResult> {
  const { tenantId } = ctx

  // Defense in depth: reject a malformed idempotency key before any commerce work.
  if (input.idempotencyKey !== undefined && !isUuidV4(input.idempotencyKey)) {
    return failure(400, 'invalid_idempotency_key')
  }

  const settings = await loadCommerceSettings(payload, tenantId)
  if (!settings) return failure(503, 'commerce_not_configured')
  const currency = settings.currency

  const checkoutKey = isUuidV4(input.idempotencyKey) ? (input.idempotencyKey as string).trim() : undefined
  const fingerprint = checkoutKey ? checkoutFingerprint(input) : undefined

  // Step 4 (idempotency replay) — before any reservation. A keyed replay returns the placed order.
  if (checkoutKey) {
    const existing = await findStoreOrderByCheckoutKey(payload, tenantId, checkoutKey)
    if (existing) return replayOrConflict(existing, fingerprint, currency)
  }

  // Step 2 + 3 — load the cart (tenant-scoped, inside the loader) and run the authoritative quote.
  // quoteCart throws when the cart is absent or a sellable doc is missing/mispriced; map to a 422.
  const loader = opts?.loader ?? createPayloadQuoteCartLoader(payload)
  const quoteInputAddress = (input.shippingAddress ?? null) as {
    country?: string
    region?: string
    postal?: string
    city?: string
    line1?: string
  }
  let quote: QuoteCartResult
  try {
    quote = await quoteCart(loader, {
      tenantId,
      cartId: input.cartId,
      shippingAddress: quoteInputAddress,
      billingAddress: input.billingAddress as never | undefined,
      shippingMethodId: input.shippingMethodId ?? null,
      promotionCodes: input.promotionCodes ?? [],
      giftCardCode: input.giftCardCode ?? null,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (/not found/i.test(msg)) return failure(422, 'cart_not_found')
    return failure(500, 'quote_failed', msg)
  }

  // Resolve the fulfillment location: explicit, else the tenant's first inventory-location.
  let locationId = input.locationId
  if (locationId == null) {
    const { docs } = await payload.find({
      collection: 'inventory-locations',
      where: { tenant: { equals: tenantId } },
      overrideAccess: true,
      limit: 1,
    })
    const loc = docs[0] as { id: number | string } | undefined
    if (!loc) return failure(422, 'no_fulfillment_location')
    locationId = loc.id
  }

  const orderNumber = await allocateOrderNumber(payload, tenantId)
  const ttlMs = input.reservationTtlMs ?? DEFAULT_RESERVATION_TTL_MS

  // Step 5 — reserve each quote line by immutable normalized SKU (C5 resolver). The plugin doc ids are
  // traceability only; SKU is the allocation key. On any shortage, compensate by releasing this
  // order's reservations (order-scoped — never another order's holds).
  for (const line of quote.snapshot.lines) {
    const resolved = await resolveSellableBySku({ payload, tenantId, sku: line.sku })
    if (!resolved.ok) {
      await releaseOrder({ payload, tenantId, orderNumber, reason: 'sku_unresolved' })
      return failure(422, 'PRODUCT_NOT_FOUND', { sku: line.sku })
    }
    const r = await reserve({
      payload,
      tenantId,
      locationId,
      sku: resolved.sellable.sku,
      quantity: line.quantity,
      cartToken: String(input.cartId),
      orderRef: orderNumber,
      ttlMs,
    })
    if (!r.ok) {
      await releaseOrder({ payload, tenantId, orderNumber, reason: 'reserve_insufficient' })
      return failure(409, 'INSUFFICIENT_STOCK', { sku: line.sku, reason: r.code })
    }
  }

  // Build the order items in the plugin cart-item shape ({product, variant, quantity}); the priced
  // detail lives in the immutable quote snapshot.
  const orderItems = quote.snapshot.lines.map((l) => ({
    product: l.productId,
    ...(l.variantId !== undefined && l.variantId !== null ? { variant: l.variantId } : {}),
    quantity: l.quantity,
  }))

  const isOnline = input.paymentMethod === 'paymob' || input.paymentMethod === 'kashier'
  const nowIso = new Date().toISOString()

  // Steps 6 + 7 (online) — create the store-transactions doc + initiate hosted checkout with the
  // authoritative amountDue. The D1/D2 adapter's createHostedCheckout takes the explicit Money so the
  // provider never receives a browser/derived total. Offline methods skip both.
  let transactionId: number | string | undefined
  let checkoutUrl: string | undefined
  let providerSessionId: string | undefined
  if (isOnline) {
    const provider = input.paymentMethod as GatewayProvider
    const cfg = await loadGatewayConfig(payload, tenantId, provider)
    if (!cfg) {
      await releaseOrder({ payload, tenantId, orderNumber, reason: 'gateway_not_configured' })
      return failure(422, 'gateway_not_configured')
    }

    const adapter = (opts?.buildAdapter ?? buildPaymentAdapter)(provider, cfg)
    let hosted: { checkoutUrl: string; providerSessionId: string }
    try {
      hosted = await adapter.createHostedCheckout({
        merchantReference: orderNumber,
        amount: money(quote.amountDue, currency),
        customerEmail: input.customerEmail,
        billingUrl: input.returnUrl,
        sandbox: settings.sandbox,
      })
    } catch (err) {
      await releaseOrder({ payload, tenantId, orderNumber, reason: 'initiation_failed' })
      return failure(502, 'gateway_initiate_failed', err instanceof Error ? err.message : String(err))
    }
    checkoutUrl = hosted.checkoutUrl
    providerSessionId = hosted.providerSessionId

    // §3.9 transaction row. rawPayloadHash never persists the raw provider payload — only its hash.
    const rawPayloadHash = createHash('sha256')
      .update(JSON.stringify({ merchantReference: orderNumber, providerSessionId: hosted.providerSessionId }))
      .digest('hex')
    const txnDoc = (await payload.create({
      collection: STORE_COLLECTION_SLUGS.transactions,
      overrideAccess: true,
      data: {
        tenant: tenantId,
        amount: quote.amountDue,
        currency,
        // ponytail: store-carts uses numeric ids (sqlite defaultIDType); input.cartId arrives as a
        // STRING on the live path (pluginAddItem.body.cartId = String(cart.id), and the signed
        // checkout handler receives it from JSON). Payload's relationship validator (isValidID with
        // type 'number') rejects a string id → "invalid relationships: <id> 0". Coerce to the native
        // number. If a future adapter uses text/uuid cart ids, resolve the type from
        // payload.collections[carts].customIDType instead of assuming number.
        cart: Number(input.cartId),
        items: orderItems,
        paymentMethod: provider,
        status: 'pending',
        customerEmail: input.customerEmail,
        providerTransactionId: '',
        providerOrderReference: hosted.providerSessionId,
        capturedAmount: 0,
        refundedAmount: 0,
        lastProviderStatus: 'initiated',
        lastProviderEventTimestamp: nowIso,
        reconciliationStatus: 'pending',
        rawPayloadHash,
        legacyTransactionId: null,
        ...(ctx.customerId !== undefined ? { customer: ctx.customerId } : {}),
      } as any,
    })) as { id: number | string }
    transactionId = txnDoc.id

    // Step 8 — durable pending payment event. The capture/refund webhook later folds the real
    // provider event; the process-payment-event task (D3) drives order/transaction/inventory side
    // effects. We only RECORD a pending event here — never call setOrderPaymentState / commitOrder
    // ad-hoc (the payment job owns the capture→commit transition). Ledger insert is best-effort: a
    // duplicate (replay under the same cart) is a zero-effect success via the unique index.
    try {
      await insertPaymentEvent({
        payload,
        tenantId,
        gateway: provider,
        providerEventId: `initiate:${input.cartId}`,
        merchantReference: orderNumber,
        targetState: 'pending',
        amount: quote.amountDue,
        rawRedacted: JSON.stringify({ providerOrderReference: hosted.providerSessionId }),
      })
    } catch {
      // The transaction + order are already durable; a ledger miss is reconciled by the next sweep.
    }
  }

  // Steps 4 + 10 — create the store-orders document with the immutable quote snapshot. The partial
  // unique (tenant_id, checkout_key) index makes a concurrent same-key race surface here as a unique
  // violation; we treat that as TAMPER, release, and replay the winner.
  let orderId: number | string
  try {
    const orderDoc = (await payload.create({
      collection: STORE_COLLECTION_SLUGS.orders,
      overrideAccess: true,
      data: {
        tenant: tenantId,
        orderNumber,
        ...(checkoutKey ? { checkoutKey, checkoutFingerprint: fingerprint } : {}),
        paymentState: 'pending',
        // OrderStatus is 'processing' | 'completed' | 'cancelled' | 'refunded' (the plugin owns the
        // administrative lifecycle). Both offline (awaiting confirmation) and online (awaiting capture)
        // land start in 'processing'; our retained `paymentState` carries the payment lifecycle.
        status: 'processing',
        subtotal: quote.subtotal,
        totalDiscount: quote.totalDiscount,
        shippingPrice: quote.shippingPrice,
        totalTax: quote.totalTax,
        giftCardApplied: quote.giftCardApplied,
        amountDue: quote.amountDue,
        quoteHash: quote.quoteHash,
        quoteSnapshot: quote.snapshot,
        placedAt: nowIso,
        customerEmail: input.customerEmail,
        customerPhone: input.customerPhone,
        items: orderItems,
        ...(providerSessionId !== undefined ? { providerReference: providerSessionId } : {}),
        ...(ctx.customerId !== undefined ? { customer: ctx.customerId } : {}),
      } as any,
    })) as { id: number | string }
    orderId = orderDoc.id
  } catch (err) {
    await releaseOrder({ payload, tenantId, orderNumber, reason: 'order_create_failed' })
    // A concurrent same-key request may have won the (tenant_id, checkout_key) race — replay it.
    if (checkoutKey) {
      const existing = await findStoreOrderByCheckoutKey(payload, tenantId, checkoutKey)
      if (existing) return replayOrConflict(existing, fingerprint, currency)
    }
    return failure(500, 'order_create_failed', err instanceof Error ? err.message : String(err))
  }

  // Link the transaction back to the order for future idempotency (the adapter's confirmOrder reads
  // txn.order to avoid double-creating). Best-effort; the order is already authoritative.
  if (transactionId !== undefined) {
    try {
      await payload.update({
        collection: STORE_COLLECTION_SLUGS.transactions,
        id: transactionId,
        overrideAccess: true,
        data: { order: orderId } as any,
      })
    } catch {
      /* the order row is the source of truth; a missed back-link is reconciled by the webhook */
    }
  }

  return {
    status: 200,
    body: {
      orderId,
      orderNumber,
      amountDue: quote.amountDue,
      currency,
      paymentMethod: input.paymentMethod,
      paymentState: 'pending',
      ...(checkoutUrl !== undefined ? { checkoutUrl } : {}),
      ...(providerSessionId !== undefined ? { providerSessionId } : {}),
      ...(transactionId !== undefined ? { transactionId } : {}),
      quote: {
        subtotal: quote.subtotal,
        totalDiscount: quote.totalDiscount,
        shippingPrice: quote.shippingPrice,
        totalTax: quote.totalTax,
        giftCardApplied: quote.giftCardApplied,
        amountDue: quote.amountDue,
        quoteHash: quote.quoteHash,
      },
    },
  }
}
