// Order creation: the single authoritative path that turns a server-computed QuoteSnapshot into a
// persisted order. Verifies the quote's tamper-evident hash, allocates a per-tenant order number,
// and writes an immutable snapshot of totals + items so the order never recomputes when catalog or
// rates later change. Inventory reservation/commit + transaction creation are wired by the checkout
// orchestration; this module owns number allocation + snapshot persistence + initial states.
import type { Payload } from 'payload'
import type { QuoteSnapshot } from '../pricing'
import { verifySnapshot } from '../pricing'
import { allocateOrderNumber } from './numbering'

export interface CreateOrderInput {
  payload: Payload
  tenantId: number | string
  quote: QuoteSnapshot
  items: unknown
  customerEmail?: string
  customerPhone?: string
  cartToken?: string
  shippingAddress?: unknown
  billingAddress?: unknown
  notes?: string
}

export async function createOrder(input: CreateOrderInput) {
  if (!verifySnapshot(input.quote)) {
    throw new Error('quote snapshot failed tamper verification')
  }
  const orderNumber = await allocateOrderNumber(input.payload, input.tenantId)
  return input.payload.create({
    collection: 'orders',
    overrideAccess: true,
    data: {
      tenant: input.tenantId,
      orderNumber,
      cartToken: input.cartToken,
      customerEmail: input.customerEmail,
      customerPhone: input.customerPhone,
      status: 'pending',
      paymentState: 'pending',
      fulfillmentState: 'unfulfilled',
      currency: input.quote.currency,
      subtotal: input.quote.merchandiseSubtotal,
      totalDiscount: input.quote.orderDiscount,
      shippingPrice: input.quote.shippingPrice,
      totalTax: input.quote.totalTax,
      grandTotal: input.quote.grandTotal,
      giftCardApplied: input.quote.giftCardApplied,
      amountDue: input.quote.amountDue,
      quoteHash: input.quote.hash,
      quoteSnapshot: input.quote,
      items: input.items,
      shippingAddress: input.shippingAddress,
      billingAddress: input.billingAddress,
      placedAt: new Date().toISOString(),
      notes: input.notes,
    } as any,
  })
}
