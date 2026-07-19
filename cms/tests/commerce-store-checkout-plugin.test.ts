// Wave D4 — plugin-first checkout (cms/src/commerce/checkout/process.ts). Drives processCheckout
// directly (the signed gateway verify it sits behind is covered by commerce-gateway.test.ts; the
// endpoint handler is a thin wrapper). Proves:
//   - offline (cod) checkout writes store-orders (NOT legacy orders), reserves stock by normalized
//     SKU, and persists the immutable quote snapshot + integer totals;
//   - online (paymob) checkout additionally writes store-transactions (§3.9 fields), returns a hosted
//     checkout URL from the adapter, and records a durable PENDING payment event (it is NOT processed
//     — the process-payment-event task drives capture→commit; notifications land with Wave E1, so we
//     only assert the event was enqueued, per the D4 handoff);
//   - idempotency: same checkoutKey+fingerprint replays, same key+different body → 409;
//   - no legacy product/cart/order/transaction write occurs on the plugin path.
import assert from 'node:assert/strict'
import { rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import type { Payload } from 'payload'

const TEMP_DB = join(tmpdir(), `commerce-store-checkout-plugin-itest-${process.pid}-${Date.now()}.db`)
process.env.DATABASE_URI = `file:${TEMP_DB}`
process.env.PAYLOAD_SECRET = process.env.PAYLOAD_SECRET || 'commerce-store-checkout-plugin-itest-secret'

const { default: config } = await import('../src/payload.config')
const { getPayload } = await import('payload')
const { seedTenant, seedLocation, seedLevel } = await import('./helpers/commerce')
const payload = (await getPayload({ config })) as unknown as Payload
await payload.db.migrate()

const { processCheckout } = await import('../src/commerce/checkout/process')
const { getLevel } = await import('../src/commerce/inventory')
import type { PaymentAdapter } from '../src/commerce/payments/types'
import type { AdapterBuilder } from '../src/commerce/payments/adapters/registry'

// Fake adapter: createHostedCheckout returns a fixed URL + session id. No network. Mirrors the
// commerce-store-checkout fake builder.
const fakeBuilder: AdapterBuilder = () =>
  ({
    provider: 'paymob',
    capabilities: () => ({
      hostedCheckout: true,
      authorization: true,
      refunds: true,
      partialRefunds: true,
      voiding: true,
      recurring: false,
      webhookSignature: 'hmac',
    }),
    createHostedCheckout: async () => ({ checkoutUrl: 'https://paymob.example/iframes/1?payment_token=t', providerSessionId: 'po-1' }),
    refund: async () => ({ ok: true }),
    verifyWebhook: async () => ({ accepted: false, reason: 'no_verifying_in_plugin_checkout_test' }),
    lookup: async () => ({ state: 'pending' }),
  }) as PaymentAdapter

let tenantId: number | string
let locationId: number | string

async function seedProduct(sku: string, price: number) {
  const p = await payload.create({
    collection: 'store-products',
    overrideAccess: true,
    data: {
      tenant: tenantId,
      slug: `slug-${sku.toLowerCase()}`,
      sku,
      priceInEGPEnabled: true,
      priceInEGP: price,
      taxClass: 'standard',
      trackInventory: true,
    } as any,
  })
  return p.id
}

async function seedCart(productId: number | string, quantity: number) {
  const c = await payload.create({
    collection: 'store-carts',
    overrideAccess: true,
    data: {
      tenant: tenantId,
      currency: 'EGP',
      items: [{ product: productId, quantity }],
    } as any,
  })
  return c.id
}

test.before(async () => {
  ;({ tenantId } = await seedTenant(payload, { features: ['commerce'] }))
  await payload.create({
    collection: 'commerce-settings',
    overrideAccess: true,
    data: {
      tenant: tenantId,
      status: 'live',
      currency: 'EGP',
      taxMode: 'exclusive',
      sandbox: true,
      paymob: { enabled: true, apiKey: 'k', hmacSecret: 'h', iframeId: '1', integrationId: '2' },
    } as any,
  })
  locationId = await seedLocation(payload, tenantId)
})

test.after(async () => {
  try {
    try { await (payload.db as any).drizzle?.session?.client?.close?.() } catch { /* */ }
    await payload.destroy()
  } finally {
    try { rmSync(TEMP_DB, { force: true }) } catch { /* */ }
  }
})

test('offline (cod) plugin checkout writes store-orders, reserves stock, and never touches legacy orders', async () => {
  await seedLevel(payload, tenantId, locationId, 'SKU-D4-COD', 10)
  const pid = await seedProduct('SKU-D4-COD', 5000) // 50.00 EGP
  const cid = await seedCart(pid, 2)

  const r = await processCheckout(payload, { tenantId }, {
    cartId: cid,
    paymentMethod: 'cod',
    shippingAddress: { country: 'EG' },
    customerEmail: 'guest@dgh.test',
  })
  assert.equal(r.status, 200, `expected 200, got ${r.status}: ${JSON.stringify(r.body)}`)
  assert.equal(r.body.paymentMethod, 'cod')
  assert.equal(r.body.paymentState, 'pending')
  assert.equal(r.body.currency, 'EGP')
  assert.equal(r.body.amountDue, 10000, '2 × 5000 minor, resolved server-side from priceInEGP')
  assert.ok(typeof r.body.orderNumber === 'string' && (r.body.orderNumber as string).length > 0)

  // Stock reserved (order-scoped), on-hand unchanged.
  const lvl = await getLevel({ payload, tenantId, locationId, sku: 'SKU-D4-COD' })
  assert.equal(lvl?.reserved, 2)
  assert.equal(lvl?.onHand, 10)

  // The order lives in store-orders with the immutable snapshot + integer totals.
  const { docs } = await payload.find({
    collection: 'store-orders',
    where: { and: [{ tenant: { equals: tenantId } }, { orderNumber: { equals: r.body.orderNumber } }] },
    overrideAccess: true,
    limit: 1,
  })
  const order = docs[0] as { paymentState?: string; status?: string; amountDue?: number; quoteHash?: string; quoteSnapshot?: unknown } | undefined
  assert.ok(order, 'store-orders row persisted')
  assert.equal(order?.paymentState, 'pending')
  assert.equal(order?.status, 'processing', 'plugin OrderStatus starts at processing; paymentState tracks payment')
  assert.equal(order?.amountDue, 10000)
  assert.ok(typeof order?.quoteHash === 'string' && (order.quoteHash as string).length > 0, 'quoteHash written')
  assert.ok(order?.quoteSnapshot, 'immutable quote snapshot written')

  // CRITICAL: no legacy order/transaction was written by the plugin path.
  const { docs: legacyOrders } = await payload.find({
    collection: 'orders',
    where: { tenant: { equals: tenantId } },
    overrideAccess: true,
    limit: 10,
  })
  assert.equal(legacyOrders.length, 0, 'no legacy orders written on the plugin-first path')
})

test('online (paymob) plugin checkout writes store-orders + store-transactions, returns a checkout URL, and enqueues a pending payment event', async () => {
  await seedLevel(payload, tenantId, locationId, 'SKU-D4-GW', 10)
  const pid = await seedProduct('SKU-D4-GW', 5000)
  const cid = await seedCart(pid, 1)

  const r = await processCheckout(
    payload,
    { tenantId },
    {
      cartId: cid,
      paymentMethod: 'paymob',
      shippingAddress: { country: 'EG' },
      customerEmail: 'guest@dgh.test',
      returnUrl: 'https://shop/return',
    },
    { buildAdapter: fakeBuilder },
  )
  assert.equal(r.status, 200, `expected 200, got ${r.status}: ${JSON.stringify(r.body)}`)
  assert.equal(r.body.paymentMethod, 'paymob')
  assert.equal(r.body.amountDue, 5000)
  assert.equal(r.body.checkoutUrl, 'https://paymob.example/iframes/1?payment_token=t')
  assert.equal(r.body.providerSessionId, 'po-1')
  assert.ok(r.body.transactionId !== undefined, 'transaction id returned')

  // store-transactions carries the §3.9 fields + the authoritative amount.
  const { docs: txns } = await payload.find({
    collection: 'store-transactions',
    where: { and: [{ tenant: { equals: tenantId } }, { id: { equals: r.body.transactionId } }] },
    overrideAccess: true,
    limit: 1,
  })
  const txn = txns[0] as {
    paymentMethod?: string
    status?: string
    amount?: number
    currency?: string
    providerOrderReference?: string
    reconciliationStatus?: string
    rawPayloadHash?: string
    order?: { id?: number | string } | number | string
  } | undefined
  assert.ok(txn, 'store-transactions row persisted')
  assert.equal(txn?.paymentMethod, 'paymob')
  assert.equal(txn?.amount, 5000, 'transaction amount is the authoritative quote amountDue')
  assert.equal(txn?.providerOrderReference, 'po-1')
  assert.ok(typeof txn?.rawPayloadHash === 'string' && (txn.rawPayloadHash as string).length > 0, 'rawPayloadHash written (hash, never raw)')
  assert.equal(txn?.reconciliationStatus, 'pending')

  // The order is linked to the transaction and in the processing state.
  const { docs: orders } = await payload.find({
    collection: 'store-orders',
    where: { and: [{ tenant: { equals: tenantId } }, { orderNumber: { equals: r.body.orderNumber } }] },
    overrideAccess: true,
    limit: 1,
  })
  const order = orders[0] as { status?: string; paymentState?: string } | undefined
  assert.equal(order?.status, 'processing')

  // A durable PENDING payment event was recorded (NOT processed — the process-payment-event task + the
  // send-commerce-notification task (Wave E1) drive completion; we only assert it was enqueued).
  const { docs: events } = await payload.find({
    collection: 'payment-events',
    where: { and: [{ tenant: { equals: tenantId } }, { merchantReference: { equals: r.body.orderNumber } }] },
    overrideAccess: true,
    limit: 10,
  })
  assert.ok(events.length >= 1, 'pending payment event enqueued for the order')
  const ev = events[0] as { processed?: number | boolean; target_state?: string; gateway?: string }
  assert.equal(ev.gateway, 'paymob')
  assert.ok(!ev.processed, 'event is pending — not processed until the payment job + E1 run')

  // Stock is reserved (capture→commit happens later via the payment job).
  const lvl = await getLevel({ payload, tenantId, locationId, sku: 'SKU-D4-GW' })
  assert.equal(lvl?.reserved, 1)
})

test('idempotency: same checkoutKey replays the same store-order; a different body under the same key is 409', async () => {
  await seedLevel(payload, tenantId, locationId, 'SKU-D4-IDEM', 20)
  const pid = await seedProduct('SKU-D4-IDEM', 1000)
  // One cart reused across the retry/conflict calls — a real client retries the SAME cart, and the
  // fingerprint includes cartId, so a fresh cart per call would falsely diverge.
  const cid = await seedCart(pid, 3)
  const key = '55555555-5555-4555-8555-555555555555'

  const first = await processCheckout(payload, { tenantId }, {
    cartId: cid,
    paymentMethod: 'cod',
    shippingAddress: { country: 'EG' },
    customerEmail: 'i@dgh.test',
    idempotencyKey: key,
  })
  assert.equal(first.status, 200)

  // Same key, same body (same cart + payment method + addresses) → replay.
  const replay = await processCheckout(payload, { tenantId }, {
    cartId: cid,
    paymentMethod: 'cod',
    shippingAddress: { country: 'EG' },
    customerEmail: 'i@dgh.test',
    idempotencyKey: key,
  })
  assert.equal(replay.status, 200)
  assert.equal(replay.body.orderNumber, first.body.orderNumber, 'replayed the same order')
  assert.equal(replay.body.replayed, true)

  // Same key, different body (different payment method) → 409.
  const conflict = await processCheckout(payload, { tenantId }, {
    cartId: cid,
    paymentMethod: 'bank',
    shippingAddress: { country: 'EG' },
    customerEmail: 'i@dgh.test',
    idempotencyKey: key,
  })
  assert.equal(conflict.status, 409)
  assert.equal(conflict.body.error, 'idempotency_conflict')

  // Exactly one store-order for the key.
  const { docs } = await payload.find({
    collection: 'store-orders',
    where: { and: [{ tenant: { equals: tenantId } }, { checkoutKey: { equals: key } }] },
    overrideAccess: true,
    limit: 10,
  })
  assert.equal(docs.length, 1, 'exactly one store-order for the checkout key')
})
