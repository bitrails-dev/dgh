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
import { commitOrder, releaseOrder, reserve } from '../inventory'
import { createOrder } from '../orders/create'
import { allocateOrderNumber } from '../orders/numbering'
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
  // Idempotency key + payload fingerprint (commit 1.4); forwarded into createOrder so the
  // (tenant_id, checkout_key) unique index enforces "one order per key".
  checkoutKey?: string
  checkoutFingerprint?: string
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

// Per-line / per-order ceilings (plan §13.4). Lines are normalized — SKUs trimmed and duplicate SKUs
// summed with overflow + ceiling checks — before any product lookup or reservation, so a cart never
// reserves the wrong quantity (C-02).
const MAX_LINE_QUANTITY = 999
const MAX_LINES_PER_ORDER = 100

function normalizeLines(lines: CheckoutLine[]): CheckoutLine[] {
  if (!Array.isArray(lines) || lines.length === 0) throw new Error('checkout requires at least one line')
  if (lines.length > MAX_LINES_PER_ORDER) throw new Error(`checkout exceeds the per-order line ceiling (${MAX_LINES_PER_ORDER})`)
  const sums = new Map<string, number>()
  for (const l of lines) {
    const sku = (l?.sku ?? '').toString().trim()
    if (!sku) throw new Error('checkout line has a blank SKU')
    if (!Number.isInteger(l.quantity) || l.quantity < 1) throw new Error(`checkout line quantity must be a positive integer, got ${l.quantity}`)
    const next = (sums.get(sku) ?? 0) + l.quantity
    if (!Number.isSafeInteger(next) || next > MAX_LINE_QUANTITY) throw new Error(`checkout line quantity for "${sku}" exceeds the ceiling (${MAX_LINE_QUANTITY})`)
    sums.set(sku, next)
  }
  return Array.from(sums, ([sku, quantity]) => ({ sku, quantity }))
}

export async function checkout(input: CheckoutInput): Promise<CheckoutResult> {
  const { payload, tenantId, cartToken, locationId, currency, taxMode } = input

  // 1. Normalize + validate lines before any product lookup: trim SKU, sum duplicates, reject blank
  //    SKUs / non-integer / sub-1 quantities / over-ceiling totals (C-02).
  const lines = normalizeLines(input.lines)

  // 2. Resolve products (server-authoritative prices) via the shared resolver — base sku OR variant
  //    sku — so a variant sku is the single key into both pricing and inventory.
  const resolved = await resolvePricedLines(payload, tenantId, lines, currency)
  if (!resolved.ok) return { ok: false, code: 'PRODUCT_NOT_FOUND', detail: resolved.detail }
  const products = new Map<string, { id: number | string; price: number; taxBps: number; name?: string }>()
  for (const l of resolved.lines) {
    products.set(l.sku, { id: l.productId, price: l.unitPrice.amount, taxBps: l.taxBps, name: l.name })
  }

  // 3. Allocate the order number exactly once, BEFORE any reservation. Order-number gaps after a
  //    failed checkout are accepted; sequences are never decremented or reused (plan §5 commit 1.3).
  const orderNumber = await allocateOrderNumber(payload, tenantId)

  // 4. Reserve per normalized line, order-scoped. On any failure, compensate by releasing THIS order's
  //    reservations; if compensation itself fails, the throw propagates (never a soft checkout error).
  let reserved = 0
  for (const line of lines) {
    const r = await reserve({
      payload, tenantId, locationId, sku: line.sku, quantity: line.quantity, cartToken,
      orderRef: orderNumber, ttlMs: input.reservationTtlMs,
    })
    if (!r.ok) {
      await releaseOrder({ payload, tenantId, orderNumber, reason: r.code === 'CONFLICT' ? 'reserve_conflict' : 'checkout_insufficient' })
      return { ok: false, code: 'INSUFFICIENT_STOCK', detail: { sku: line.sku, reason: r.code } }
    }
    reserved += 1
  }

  // 5. Server-side quote from resolved product prices.
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

  // 6. Create the order with the preallocated number (tamper-checked snapshot). On failure, release
  //    the order's reservations.
  const items = lines.map((l) => {
    const p = products.get(l.sku)!
    return { sku: l.sku, name: p.name, quantity: l.quantity, unitPrice: p.price }
  })
  try {
    const order = await createOrder({
      payload, tenantId, orderNumber, quote: q, items,
      checkoutKey: input.checkoutKey, checkoutFingerprint: input.checkoutFingerprint,
      customerEmail: input.customerEmail, customerPhone: input.customerPhone,
      cartToken, shippingAddress: input.shippingAddress, billingAddress: input.billingAddress,
    })
    return { ok: true, order, quote: q, reserved }
  } catch (err) {
    await releaseOrder({ payload, tenantId, orderNumber, reason: 'order_create_failed' })
    return { ok: false, code: 'TAMPER', detail: String(err) }
  }
}

// On payment capture, consume the order's reserved stock (closes the reserve→commit loop). Finds the
// order by its per-tenant orderNumber, then commits ONLY that order's reservations (order-scoped —
// never another order's reservations that happen to share a cart token; C-01). Idempotent: a second
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
  if (!docs[0]) return { committed: 0, found: false }
  const { committed } = await commitOrder({ payload, tenantId, orderNumber })
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
