// Checkout orchestration — the single path that turns a cart into a placed order. It:
//   1. resolves product prices SERVER-SIDE (never trusts client prices/totals),
//   2. reserves inventory per line (atomic; releases the whole cart on any shortage),
//   3. builds a server-authoritative quote (commerce/pricing),
//   4. creates the order (immutable snapshot + per-tenant number, commerce/orders/create).
// Stock stays RESERVED until payment is captured; the payment webhook then commits the reservation
// for the order's cartToken (commit wiring follows this step). Guest checkout (customerEmail) is the
// MVP; account link arrives with the customers collection.
import type { Payload } from 'payload'
import { money } from '../money'
import { quote, type QuoteSnapshot } from '../pricing'
import { commitCart, releaseCart, reserve } from '../inventory'
import { createOrder } from '../orders/create'
import { resolvePricedLines } from '../store/shared'
import type { PaymentState } from '../payments/state'

export interface CheckoutLine {
  sku: string
  quantity: number
}

export interface CheckoutInput {
  payload: Payload
  tenantId: number | string
  cartToken: string
  lines: CheckoutLine[]
  locationId: number | string
  currency: string
  taxMode: 'inclusive' | 'exclusive'
  customerEmail?: string
  customerPhone?: string
  shipping?: { price: { amount: number; currency: string }; taxBps?: number } | null
  giftCardTenders?: Array<{ amount: number; currency: string }>
  reservationTtlMs?: number
  shippingAddress?: unknown
  billingAddress?: unknown
}

export type CheckoutResult =
  | { ok: true; order: unknown; quote: QuoteSnapshot; reserved: number }
  | { ok: false; code: 'PRODUCT_NOT_FOUND' | 'INSUFFICIENT_STOCK' | 'TAMPER'; detail?: unknown }

export async function checkout(input: CheckoutInput): Promise<CheckoutResult> {
  const { payload, tenantId, cartToken, lines, locationId, currency, taxMode } = input

  // 1. Resolve products (server-authoritative prices) via the shared resolver — base sku OR variant
  // sku — so a variant sku is the single key into both pricing and inventory.
  const resolved = await resolvePricedLines(payload, tenantId, lines, currency)
  if (!resolved.ok) return { ok: false, code: 'PRODUCT_NOT_FOUND', detail: resolved.detail }
  const products = new Map<string, { id: number | string; price: number; taxBps: number; name?: string }>()
  for (const l of resolved.lines) {
    products.set(l.sku, { id: l.productId, price: l.unitPrice.amount, taxBps: l.taxBps, name: l.name })
  }

  // 2. Reserve inventory per line; release the whole cart on any shortage (no partial holds leak).
  let reserved = 0
  for (const line of lines) {
    const r = await reserve({
      payload, tenantId, locationId, sku: line.sku, quantity: line.quantity, cartToken,
      ttlMs: input.reservationTtlMs,
    })
    if (!r.ok) {
      await releaseCart({ payload, tenantId, cartToken, reason: 'checkout_insufficient' }).catch(() => {})
      return { ok: false, code: 'INSUFFICIENT_STOCK', detail: { sku: line.sku } }
    }
    reserved += 1
  }

  // 3. Server-side quote from resolved product prices.
  const quoteLines = lines.map((l) => {
    const p = products.get(l.sku)!
    return { key: l.sku, sku: l.sku, quantity: l.quantity, unitPrice: money(p.price, currency), taxBps: p.taxBps }
  })
  const q = quote({
    currency,
    taxMode,
    lines: quoteLines,
    shipping: input.shipping
      ? { price: money(input.shipping.price.amount, input.shipping.price.currency), taxBps: input.shipping.taxBps }
      : null,
    giftCardTenders: (input.giftCardTenders ?? []).map((g) => money(g.amount, g.currency)),
  })

  // 4. Create the order (tamper-checked snapshot + number). On any failure, release the reservation.
  const items = lines.map((l) => {
    const p = products.get(l.sku)!
    return { sku: l.sku, name: p.name, quantity: l.quantity, unitPrice: p.price }
  })
  try {
    const order = await createOrder({
      payload, tenantId, quote: q, items,
      customerEmail: input.customerEmail, customerPhone: input.customerPhone,
      cartToken, shippingAddress: input.shippingAddress, billingAddress: input.billingAddress,
    })
    return { ok: true, order, quote: q, reserved }
  } catch (err) {
    await releaseCart({ payload, tenantId, cartToken, reason: 'order_create_failed' }).catch(() => {})
    return { ok: false, code: 'TAMPER', detail: String(err) }
  }
}

// On payment capture, consume the order's reserved stock (closes the reserve→commit loop). Finds the
// order by its per-tenant orderNumber and commits its cartToken reservation. Idempotent: a second
// call after commit finds no active reservations and commits nothing.
export async function commitOrderInventory(input: {
  payload: Payload
  tenantId: number | string
  orderNumber: string
}): Promise<{ committed: number; found: boolean }> {
  const { payload, tenantId, orderNumber } = input
  const { docs } = await payload.find({
    collection: 'orders',
    where: { and: [{ tenant: { equals: tenantId } }, { orderNumber: { equals: orderNumber } }] },
    overrideAccess: true,
    limit: 1,
  })
  const order = docs[0] as { cartToken?: string | null } | undefined
  if (!order || !order.cartToken) return { committed: 0, found: false }
  const { committed } = await commitCart({ payload, tenantId, cartToken: order.cartToken, orderRef: orderNumber })
  return { committed, found: true }
}

// Sync the order's paymentState from the folded payment-event state. The order collection's
// beforeChange hook validates the transition (legal edges only); an illegal move throws, which the
// caller (the payment job) treats as best-effort. No-op if the order is already in that state.
export async function setOrderPaymentState(input: {
  payload: Payload
  tenantId: number | string
  orderNumber: string
  state: PaymentState
}): Promise<{ updated: boolean }> {
  const { docs } = await input.payload.find({
    collection: 'orders',
    where: { and: [{ tenant: { equals: input.tenantId } }, { orderNumber: { equals: input.orderNumber } }] },
    overrideAccess: true,
    limit: 1,
  })
  const order = docs[0] as { id: number | string; paymentState?: string } | undefined
  if (!order || order.paymentState === input.state) return { updated: false }
  await input.payload.update({ collection: 'orders', id: order.id, data: { paymentState: input.state }, overrideAccess: true })
  return { updated: true }
}
