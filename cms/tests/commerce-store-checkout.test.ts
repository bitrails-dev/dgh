// Storefront checkout endpoint orchestration. placeOrder is tested directly (with a fake adapter
// injected via the buildAdapter seam) so no real gateway is contacted. Covers: COD happy path (order
// placed, stock reserved, pending state), insufficient stock, unknown product, hosted-checkout
// initiation for an online gateway, and gateway-not-configured.
import assert from 'node:assert/strict'
import { rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import type { Payload } from 'payload'

const TEMP_DB = join(tmpdir(), `commerce-store-checkout-itest-${process.pid}-${Date.now()}.db`)
process.env.DATABASE_URI = `file:${TEMP_DB}`
process.env.PAYLOAD_SECRET = process.env.PAYLOAD_SECRET || 'commerce-store-checkout-itest-secret'

const { default: config } = await import('../src/payload.config')
const { getPayload } = await import('payload')
const { seedTenant, seedLocation, seedLevel } = await import('./helpers/commerce')
const payload = (await getPayload({ config })) as unknown as Payload
await payload.db.migrate()

const { placeOrder } = await import('../src/commerce/store/checkout')
const { getLevel } = await import('../src/commerce/inventory')
import type { PaymentAdapter } from '../src/commerce/payments/types'
import type { AdapterBuilder } from '../src/commerce/payments/adapters/registry'

// Fake adapter builder: createHostedCheckout returns a fixed hosted URL. Mirrors the webhook test's
// fake (all required PaymentAdapter methods present) but never touches the network.
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
    createHostedCheckout: async () => ({ checkoutUrl: 'https://x', providerSessionId: 'p1' }),
    refund: async () => ({ ok: true }),
    verifyWebhook: async () => ({ accepted: false, reason: 'no_verifying_in_checkout_test' }),
    lookup: async () => ({ state: 'pending' }),
  }) as PaymentAdapter

let tenantId: number | string
let locationId: number | string
let noGatewayTenantId: number | string
let noGatewayLocationId: number | string

async function seedProduct(tid: number | string, sku: string, price: number, taxBps = 0) {
  return payload.create({
    collection: 'products',
    overrideAccess: true,
    data: { tenant: tid, name: sku, sku, price, taxBps, status: 'active', productKind: 'physical', trackInventory: true } as any,
  })
}

test.before(async () => {
  // Tenant A: commerce live in EGP (exclusive), sandbox, paymob configured.
  ;({ tenantId } = await seedTenant(payload, { features: ['commerce'] }))
  await payload.create({
    collection: 'commerce-settings',
    overrideAccess: true,
    data: {
      tenant: tenantId, status: 'live', currency: 'EGP', taxMode: 'exclusive', sandbox: true,
      paymob: { enabled: true, apiKey: 'k', hmacSecret: 'h', iframeId: '1', integrationId: '2' },
    } as any,
  })
  locationId = await seedLocation(payload, tenantId)

  // Tenant B: commerce live but NO gateway configured.
  ;({ tenantId: noGatewayTenantId } = await seedTenant(payload, { features: ['commerce'] }))
  await payload.create({
    collection: 'commerce-settings',
    overrideAccess: true,
    data: { tenant: noGatewayTenantId, status: 'live', currency: 'EGP', taxMode: 'exclusive', sandbox: true, paymob: { enabled: false } } as any,
  })
  noGatewayLocationId = await seedLocation(payload, noGatewayTenantId)
})
test.after(async () => {
  try {
    await payload.destroy()
  } finally {
    try {
      rmSync(TEMP_DB, { force: true })
    } catch {
      /* */
    }
  }
})

test('COD checkout places a pending order, resolves the server price, and reserves stock', async () => {
  await seedLevel(payload, tenantId, locationId, 'SKU-COD', 10)
  await seedProduct(tenantId, 'SKU-COD', 5000) // 50.00 EGP, no tax

  const r = await placeOrder(payload, tenantId, {
    cartToken: 'C1',
    items: [{ sku: 'SKU-COD', quantity: 2 }],
    customerEmail: 'x@y.z',
    paymentMethod: 'cod',
  })
  assert.equal(r.status, 200)
  assert.equal(r.body.paymentMethod, 'cod')
  assert.equal(r.body.paymentState, 'pending')
  assert.equal(r.body.currency, 'EGP')
  assert.equal(r.body.amountDue, 10000, '2 × 5000 minor = 10000, resolved server-side')
  assert.ok(typeof r.body.orderNumber === 'string' && r.body.orderNumber.length > 0)

  // Stock was reserved (onHand unchanged, reserved rose by 2) — the reserve→commit loop.
  const lvl = await getLevel({ payload, tenantId, locationId, sku: 'SKU-COD' })
  assert.equal(lvl?.reserved, 2, '2 units reserved until capture / admin confirm')
  assert.equal(lvl?.onHand, 10, 'on-hand unchanged by reservation')

  // The order exists with status pending (offline — awaiting admin confirmation).
  const { docs } = await payload.find({
    collection: 'orders',
    where: { and: [{ tenant: { equals: tenantId } }, { orderNumber: { equals: r.body.orderNumber } }] },
    overrideAccess: true,
    limit: 1,
  })
  const order = docs[0] as { status?: string; paymentState?: string } | undefined
  assert.ok(order, 'order persisted')
  assert.equal(order?.status, 'pending')
  assert.equal(order?.paymentState, 'pending')
})

test('insufficient stock -> 409 and no order created', async () => {
  await seedLevel(payload, tenantId, locationId, 'SKU-SHORT', 10)
  await seedProduct(tenantId, 'SKU-SHORT', 5000)

  const r = await placeOrder(payload, tenantId, {
    cartToken: 'C2',
    items: [{ sku: 'SKU-SHORT', quantity: 100 }], // wants 100, only 10 on hand
    customerEmail: 'x@y.z',
    paymentMethod: 'cod',
  })
  assert.equal(r.status, 409)
  assert.equal(r.body.error, 'INSUFFICIENT_STOCK')

  const lvl = await getLevel({ payload, tenantId, locationId, sku: 'SKU-SHORT' })
  assert.equal(lvl?.reserved, 0, 'no reservation leaked on shortage')
})

test('unknown product sku -> 422', async () => {
  const r = await placeOrder(payload, tenantId, {
    cartToken: 'C3',
    items: [{ sku: 'SKU-DOES-NOT-EXIST', quantity: 1 }],
    customerEmail: 'x@y.z',
    paymentMethod: 'cod',
  })
  assert.equal(r.status, 422)
  assert.equal(r.body.error, 'PRODUCT_NOT_FOUND')
})

test('online gateway (paymob) initiates a hosted checkout via the injected adapter', async () => {
  await seedLevel(payload, tenantId, locationId, 'SKU-GW', 10)
  await seedProduct(tenantId, 'SKU-GW', 5000)

  const r = await placeOrder(
    payload,
    tenantId,
    {
      cartToken: 'C4',
      items: [{ sku: 'SKU-GW', quantity: 1 }],
      customerEmail: 'x@y.z',
      paymentMethod: 'paymob',
      returnUrl: 'https://shop/return',
    },
    { buildAdapter: fakeBuilder },
  )
  assert.equal(r.status, 200)
  assert.equal(r.body.paymentMethod, 'paymob')
  assert.equal(r.body.checkoutUrl, 'https://x', 'hosted checkout URL from the fake adapter')
  assert.equal(r.body.providerSessionId, 'p1')
  assert.equal(r.body.amountDue, 5000)
  assert.ok(typeof r.body.orderNumber === 'string')
})

test('gateway not configured -> 422 gateway_not_configured', async () => {
  await seedLevel(payload, noGatewayTenantId, noGatewayLocationId, 'SKU-NOGW', 10)
  await seedProduct(noGatewayTenantId, 'SKU-NOGW', 5000)

  const r = await placeOrder(
    payload,
    noGatewayTenantId,
    {
      cartToken: 'C5',
      items: [{ sku: 'SKU-NOGW', quantity: 1 }],
      customerEmail: 'x@y.z',
      paymentMethod: 'paymob',
    },
    { buildAdapter: fakeBuilder },
  )
  assert.equal(r.status, 422)
  assert.equal(r.body.error, 'gateway_not_configured')
})
