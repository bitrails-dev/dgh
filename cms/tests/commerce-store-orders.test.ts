// Wave E3 continuation (Lane C) — signed plugin-first storefront orders. Drives the post-gateway
// orchestration (listOrders/readOrder) + the x-session-token customer bridge (resolveCustomer)
// directly with a real Payload. The gateway verify is covered by commerce-gateway.test.ts; the
// handlers are thin wrappers. Proves order history/detail are tenant + customer scoped, money is
// integer minor units, and the session bridge rejects unauthenticated/invalid tokens.
import assert from 'node:assert/strict'
import { rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import type { Payload, PayloadRequest } from 'payload'

const TEMP_DB = join(tmpdir(), `commerce-store-orders-itest-${process.pid}-${Date.now()}.db`)
process.env.DATABASE_URI = `file:${TEMP_DB}`
process.env.PAYLOAD_SECRET = process.env.PAYLOAD_SECRET || 'commerce-store-orders-itest-secret'

const { default: config } = await import('../src/payload.config')
const { getPayload } = await import('payload')
const { seedTenant } = await import('./helpers/commerce')
const payload = (await getPayload({ config })) as unknown as Payload
await payload.db.migrate()

const { registerCustomer, verifyCustomerEmail, loginCustomer } = await import('../src/commerce/customers/payload-auth')
const { listOrders, readOrder, resolveCustomer } = await import('../src/commerce/store/orders')

let tenantId: number | string
const PASSWORD = 'password123'

async function loginableCustomer(email: string): Promise<{ customerId: number | string; token: string }> {
  const reg = await registerCustomer(payload, tenantId, { email, password: PASSWORD, name: email })
  const verificationToken = (reg.body as { verificationToken?: string }).verificationToken
  assert.ok(verificationToken)
  await verifyCustomerEmail(payload, verificationToken)
  const login = await loginCustomer(payload, tenantId, { email, password: PASSWORD })
  assert.equal(login.status, 200)
  const body = login.body as { token: string; customer: { id: number | string } }
  return { customerId: body.customer.id, token: body.token }
}

async function seedOrder(customerId: number | string, orderNumber: string, amountDue: number) {
  await payload.create({
    collection: 'store-orders', overrideAccess: true,
    data: {
      tenant: tenantId, customer: customerId, orderNumber,
      status: 'processing', paymentState: 'pending',
      subtotal: amountDue, totalDiscount: 0, shippingPrice: 0, totalTax: 0, giftCardApplied: 0,
      amountDue, currency: 'EGP', placedAt: new Date().toISOString(),
      items: [], quoteSnapshot: { currency: 'EGP' }, quoteHash: 'h-' + orderNumber,
    } as any,
  })
}

const fakeReq = (token: string | null): PayloadRequest =>
  ({ payload, headers: { get: (k: string) => (k === 'x-session-token' ? token : null) } }) as unknown as PayloadRequest

test.before(async () => {
  ;({ tenantId } = await seedTenant(payload, { features: ['commerce'] }))
  await payload.create({
    collection: 'commerce-settings', overrideAccess: true,
    data: { tenant: tenantId, status: 'live', currency: 'EGP', taxMode: 'exclusive', sandbox: true } as any,
  })
})
test.after(async () => {
  try { try { await (payload.db as any).drizzle?.session?.client?.close?.() } catch { /* libsql native teardown */ } await payload.destroy() } finally { try { rmSync(TEMP_DB, { force: true }) } catch { /* */ } }
})

test('resolveCustomer: a valid session token resolves to the customer id', async () => {
  const { token, customerId } = await loginableCustomer('bridge@dgh.test')
  const r = await resolveCustomer(fakeReq(token), tenantId)
  assert.equal(r.ok, true)
  if (r.ok) assert.equal(String(r.customerId), String(customerId))
})

test('resolveCustomer: no token -> 401 invalid_session', async () => {
  const r = await resolveCustomer(fakeReq(null), tenantId)
  assert.equal(r.ok, false)
  if (!r.ok) assert.equal(r.status, 401)
})

test('resolveCustomer: a forged token -> 401', async () => {
  const r = await resolveCustomer(fakeReq('not-a-real-jwt'), tenantId)
  assert.equal(r.ok, false)
  if (!r.ok) assert.equal(r.status, 401)
})

test('listOrders returns the customer\'s orders as integer-minor summaries', async () => {
  const { customerId } = await loginableCustomer('list@dgh.test')
  await seedOrder(customerId, '1001', 10000)
  await seedOrder(customerId, '1002', 25000)
  const r = await listOrders(payload, tenantId, customerId)
  assert.equal(r.status, 200)
  const items = (r.body as { items: Array<{ orderNumber: string; amountDue: number; currency: string }> }).items
  assert.equal(items.length, 2)
  assert.ok(items.every((i) => i.currency === 'EGP'))
  assert.ok(items.some((i) => i.orderNumber === '1001' && i.amountDue === 10000))
})

test('readOrder returns the order detail; an unknown number -> 404', async () => {
  const { customerId } = await loginableCustomer('detail@dgh.test')
  await seedOrder(customerId, '2001', 7000)
  const r = await readOrder(payload, tenantId, customerId, '2001')
  assert.equal(r.status, 200)
  assert.equal((r.body as { orderNumber: string }).orderNumber, '2001')
  assert.equal((r.body as { amountDue: number }).amountDue, 7000)
  const miss = await readOrder(payload, tenantId, customerId, 'NOPE')
  assert.equal(miss.status, 404)
})

test('cross-customer: one customer cannot see another customer\'s order', async () => {
  const a = await loginableCustomer('iso-a@dgh.test')
  const b = await loginableCustomer('iso-b@dgh.test')
  await seedOrder(a.customerId, '3001', 5000)
  const fromB = await listOrders(payload, tenantId, b.customerId)
  assert.equal((fromB.body as { items: unknown[] }).items.length, 0, 'B sees none of A\'s orders')
  const detailFromB = await readOrder(payload, tenantId, b.customerId, '3001')
  assert.equal(detailFromB.status, 404)
})
