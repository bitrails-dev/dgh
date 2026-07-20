// The closed inventory loop, plugin-first (Wave F2 rewrite): processCheckout reserves stock by
// normalized SKU → a captured payment event folds via the D3 process-payment-event task → the task's
// inventory checkpoint commits the order's reservation (Phase-1 SKU layer). Also exercises the
// repointed commitOrderInventory (now operating on store-orders) directly on an offline order, and
// verifies both paths are idempotent. Asserts onHand drops, reserved returns to 0, store-orders /
// store-transactions are written, and NO legacy orders/transactions doc is ever written. Replaces
// the legacy checkout()/commitOrderInventory suite.
import assert from 'node:assert/strict'
import { rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import type { Payload } from 'payload'

const TEMP_DB = join(tmpdir(), `commerce-capture-itest-${process.pid}-${Date.now()}.db`)
process.env.DATABASE_URI = `file:${TEMP_DB}`
process.env.PAYLOAD_SECRET = process.env.PAYLOAD_SECRET || 'commerce-capture-itest-secret'

const { default: config } = await import('../src/payload.config')
const { getPayload } = await import('payload')
const { seedTenant, seedLocation, seedLevel } = await import('./helpers/commerce')
const payload = (await getPayload({ config })) as unknown as Payload
await payload.db.migrate()

const { processCheckout } = await import('../src/commerce/checkout/process')
const { commitOrderInventory } = await import('../src/commerce/checkout')
const { insertPaymentEvent, processPaymentEvent } = await import('../src/commerce/payments/events')
const { buildProductionSideEffects } = await import('../src/commerce/payments/job')
import type { SideEffectResult } from '../src/commerce/payments/events'
const { getLevel } = await import('../src/commerce/inventory')
import type { PaymentAdapter } from '../src/commerce/payments/types'
import type { AdapterBuilder } from '../src/commerce/payments/adapters/registry'

// Fake gateway adapter (no network) — mirrors commerce-store-checkout-plugin's fakeBuilder.
const fakeBuilder: AdapterBuilder = () =>
  ({
    provider: 'paymob',
    capabilities: () => ({
      hostedCheckout: true, authorization: true, refunds: true, partialRefunds: true,
      voiding: true, recurring: false, webhookSignature: 'hmac',
    }),
    createHostedCheckout: async () => ({ checkoutUrl: 'https://x', providerSessionId: 'p1' }),
    refund: async () => ({ ok: true }),
    verifyWebhook: async () => ({ accepted: false, reason: 'no_verifying_in_capture_test' }),
    lookup: async () => ({ state: 'pending' }),
  }) as PaymentAdapter

let tenantId: number | string
let locationId: number | string

test.before(async () => {
  ;({ tenantId } = await seedTenant(payload, { features: ['commerce'] }))
  await payload.create({
    collection: 'commerce-settings', overrideAccess: true,
    data: {
      tenant: tenantId, status: 'live', currency: 'EGP', taxMode: 'exclusive', sandbox: true,
      paymob: { enabled: true, apiKey: 'k', hmacSecret: 'h', iframeId: '1', integrationId: '2' },
    } as any,
  })
  locationId = await seedLocation(payload, tenantId)
})
test.after(async () => {
  try { try { await (payload.db as any).drizzle?.session?.client?.close?.() } catch { /* libsql native teardown fix (commit 1630a03) */ } await payload.destroy() } finally { try { rmSync(TEMP_DB, { force: true }) } catch { /* */ } }
})

async function seedStoreProduct(sku: string, priceInEGP: number): Promise<number | string> {
  const p = await payload.create({
    collection: 'store-products', overrideAccess: true,
    data: { tenant: tenantId, slug: `slug-${sku.toLowerCase()}`, sku, priceInEGPEnabled: true, priceInEGP, taxClass: 'standard', trackInventory: true } as any,
  })
  return p.id
}

async function seedCart(productId: number | string, quantity: number): Promise<number | string> {
  const c = await payload.create({
    collection: 'store-carts', overrideAccess: true,
    data: { tenant: tenantId, currency: 'EGP', items: [{ product: productId, quantity }] } as any,
  })
  return c.id
}

// Production order/transaction/inventory side-effects with a no-op notification, so the event
// completes without the jobs runtime (the durable notification task is exercised by its own suite).
function captureSideEffects() {
  return {
    ...buildProductionSideEffects(payload),
    // No-op notification so the event completes without the jobs runtime (the durable notification
    // task is exercised by its own suite). Annotated SideEffectResult so `ok` narrows to literal true.
    notification: async (): Promise<SideEffectResult> => ({ ok: true, effect: 'test-noop' }),
  }
}

async function countLegacy(slug: string): Promise<number> {
  const { totalDocs } = await payload.count({ collection: slug as never, where: { tenant: { equals: tenantId } }, overrideAccess: true })
  return totalDocs
}

test('processCheckout reserves; a captured event folds via the D3 job and commits the reservation', async () => {
  await seedLevel(payload, tenantId, locationId, 'CAP-A', 5) // 5 on hand
  const pid = await seedStoreProduct('CAP-A', 1000)
  const cartId = await seedCart(pid, 2)

  const beforeOrders = await countLegacy('orders')
  const beforeTxns = await countLegacy('transactions')

  const co = await processCheckout(payload, { tenantId }, {
    cartId, paymentMethod: 'paymob', shippingAddress: { country: 'EG' }, customerEmail: 'x@dgh.test', returnUrl: 'https://shop/return',
  }, { buildAdapter: fakeBuilder })
  assert.equal(co.status, 200, `processCheckout: ${JSON.stringify(co.body)}`)
  const orderNumber = co.body.orderNumber as string
  assert.equal((await getLevel({ payload, tenantId, locationId, sku: 'CAP-A' }))?.reserved, 2, 'reserved at checkout')
  // processCheckout already wrote store-orders + store-transactions for the online path.
  assert.ok((co.body as { transactionId?: string }).transactionId !== undefined, 'store-transactions row created at checkout')

  // The webhook writes a captured event for this order; the D3 job folds it AND runs the production
  // side-effects — the inventory checkpoint commits the reservation.
  const ev = await insertPaymentEvent({ payload, tenantId, gateway: 'paymob', providerEventId: 'cap-evt-1', merchantReference: orderNumber, targetState: 'captured', amount: co.body.amountDue as number })
  assert.ok(ev.id !== undefined, 'event inserted')
  const fold = await processPaymentEvent(payload, ev.id as number, { sideEffects: captureSideEffects() })
  assert.equal(fold.foldedState, 'captured')
  assert.equal(fold.merchantReference, orderNumber, 'fold carries the order ref')
  assert.equal(fold.tenantId, tenantId)
  assert.equal(fold.completed, true, 'every checkpoint succeeded')

  const lvl = await getLevel({ payload, tenantId, locationId, sku: 'CAP-A' })
  assert.equal(lvl?.onHand, 3, 'on-hand dropped by the committed quantity (5 - 2)')
  assert.equal(lvl?.reserved, 0, 'reservation fulfilled by the D3 job inventory checkpoint')

  // The store-order paymentState was synced to captured; no legacy order/transaction was written.
  const order = (await payload.find({ collection: 'store-orders', where: { and: [{ tenant: { equals: tenantId } }, { orderNumber: { equals: orderNumber } }] }, overrideAccess: true, limit: 1 })).docs[0] as { paymentState?: string } | undefined
  assert.equal(order?.paymentState, 'captured', 'store-order paymentState synced from the folded state')
  assert.equal(await countLegacy('orders'), beforeOrders, 'no legacy order written')
  assert.equal(await countLegacy('transactions'), beforeTxns, 'no legacy transaction written')

  // The repointed commitOrderInventory now reads store-orders; after the D3 job already committed,
  // it finds the order but commits nothing (idempotent).
  const again = await commitOrderInventory({ payload, tenantId, orderNumber })
  assert.equal(again.found, true, 'commitOrderInventory found the store-order')
  assert.equal(again.committed, 0, 'already committed by the D3 job — no double-consume')
})

test('the repointed commitOrderInventory commits a COD store-order reservation and is idempotent', async () => {
  await seedLevel(payload, tenantId, locationId, 'CAP-B', 4) // 4 on hand
  const pid = await seedStoreProduct('CAP-B', 500)
  const cartId = await seedCart(pid, 3)

  const co = await processCheckout(payload, { tenantId }, {
    cartId, paymentMethod: 'cod', shippingAddress: { country: 'EG' }, customerEmail: 'x@dgh.test',
  })
  assert.equal(co.status, 200, `processCheckout(cod): ${JSON.stringify(co.body)}`)
  const orderNumber = co.body.orderNumber as string
  assert.equal((await getLevel({ payload, tenantId, locationId, sku: 'CAP-B' }))?.reserved, 3, 'reserved at checkout')

  // commitOrderInventory (repointed to store-orders) consumes the order's reservation directly —
  // this is the offline-COD admin-confirm path F3 will drive.
  const first = await commitOrderInventory({ payload, tenantId, orderNumber })
  assert.equal(first.found, true, 'found the store-order by orderNumber')
  assert.equal(first.committed, 1, 'one reservation consumed')

  const lvl = await getLevel({ payload, tenantId, locationId, sku: 'CAP-B' })
  assert.equal(lvl?.onHand, 1, 'on-hand dropped exactly once (4 - 3)')
  assert.equal(lvl?.reserved, 0, 'reservation fulfilled')

  // Idempotent: a second call finds the order but commits nothing.
  const second = await commitOrderInventory({ payload, tenantId, orderNumber })
  assert.equal(second.found, true)
  assert.equal(second.committed, 0, 'already committed — no double-consume')
  assert.equal((await getLevel({ payload, tenantId, locationId, sku: 'CAP-B' }))?.onHand, 1, 'on-hand unchanged by the idempotent re-run')
})
