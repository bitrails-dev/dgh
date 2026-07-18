// Shopper cart orchestration (upsertCart + readCart). Drives the orchestration directly with a real
// Payload + migrated temp DB, the same pattern as commerce-webhook-endpoint.test.ts: tenant + cart
// are resolved in the thin HTTP layer; here we pass tenantId straight in. Covers create, update
// (same doc, items replaced), variant pricing, unknown-sku quoteError with persisted intent, the
// empty-cart read, input validation, and tenant isolation.
import assert from 'node:assert/strict'
import { rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import type { Payload } from 'payload'

const TEMP_DB = join(tmpdir(), `commerce-store-cart-itest-${process.pid}-${Date.now()}.db`)
process.env.DATABASE_URI = `file:${TEMP_DB}`
process.env.PAYLOAD_SECRET = process.env.PAYLOAD_SECRET || 'commerce-store-cart-itest-secret'

const { default: config } = await import('../src/payload.config')
const { getPayload } = await import('payload')
const { seedTenant } = await import('./helpers/commerce')
const payload = (await getPayload({ config })) as unknown as Payload
await payload.db.migrate()

const { upsertCart, readCart } = await import('../src/commerce/store/cart')

let tenantId: number | string
let otherTenantId: number | string

const seedProduct = async (
  tid: number | string,
  data: Record<string, unknown>,
): Promise<void> => {
  await payload.create({
    collection: 'products',
    overrideAccess: true,
    data: {
      tenant: tid,
      name: data.sku as string,
      productKind: 'physical',
      trackInventory: true,
      ...data,
    } as any,
  })
}

const seedSettings = async (tid: number | string): Promise<void> => {
  await payload.create({
    collection: 'commerce-settings',
    overrideAccess: true,
    data: { tenant: tid, status: 'live', currency: 'EGP', taxMode: 'exclusive', sandbox: true } as any,
  })
}

// The cart body is a Record<string, unknown> at the type level (it carries quote | quoteError |
// error variants); cast once per call so the assertions read naturally.
type CartBody = {
  items?: Array<{ sku: string; quantity: number }>
  quote?: { grandTotal: number; currency: string } | null
  quoteError?: { code: string; detail?: unknown } | null
  error?: string
}
const b = (r: { body: Record<string, unknown> }): CartBody => r.body as CartBody

// Read the persisted cart doc for (tenant, cartToken) to assert server-side storage.
const findCartDoc = async (
  tid: number | string,
  cartToken: string,
): Promise<{ items?: unknown } | undefined> => {
  const { docs } = await payload.find({
    collection: 'carts',
    where: { and: [{ tenant: { equals: tid } }, { cartToken: { equals: cartToken } }] },
    overrideAccess: true,
    limit: 1,
  })
  return docs[0] as { items?: unknown } | undefined
}

const countCarts = async (tid: number | string, cartToken: string): Promise<number> => {
  const { totalDocs } = await payload.count({
    collection: 'carts',
    where: { and: [{ tenant: { equals: tid } }, { cartToken: { equals: cartToken } }] },
    overrideAccess: true,
  })
  return totalDocs
}

test.before(async () => {
  const a = await seedTenant(payload, { features: ['commerce'] })
  tenantId = a.tenantId
  await seedSettings(tenantId)
  // Base product priced at 100.00 (10000 minor units); variant product with a cheaper variant sku.
  await seedProduct(tenantId, { sku: 'CART-BASE', price: 10000, taxBps: 0, status: 'active' })
  await seedProduct(tenantId, {
    sku: 'CART-VARPROD',
    price: 20000,
    taxBps: 0,
    status: 'active',
    variants: [{ sku: 'CART-VAR', name: 'Small', price: 5000, taxBps: 0 }],
  })

  // Second tenant with its own settings + an identically-skued product for the isolation test.
  const bb = await seedTenant(payload, { features: ['commerce'] })
  otherTenantId = bb.tenantId
  await seedSettings(otherTenantId)
  await seedProduct(otherTenantId, { sku: 'CART-BASE', price: 10000, taxBps: 0, status: 'active' })
})

test.after(async () => {
  try { try { await (payload.db as any).drizzle?.session?.client?.close?.() } catch { /* libsql native teardown fix (commit 1630a03) */ } await payload.destroy() } finally { try { rmSync(TEMP_DB, { force: true }) } catch { /* */ } }
})

test('upsert with a new cartToken creates a cart; quote.grandTotal reflects server price (qty 2 -> 20000)', async () => {
  const r = await upsertCart(payload, tenantId, { cartToken: 't1', items: [{ sku: 'CART-BASE', quantity: 2 }] })
  assert.equal(r.status, 200)
  assert.equal(b(r).quote?.grandTotal, 20000)
  assert.equal(b(r).quote?.currency, 'EGP')
  assert.deepEqual(b(r).items, [{ sku: 'CART-BASE', quantity: 2 }])
  assert.equal(await countCarts(tenantId, 't1'), 1)
})

test('upsert again with the same cartToken + different items updates the same doc (items replaced)', async () => {
  const before = await countCarts(tenantId, 't1')
  const r = await upsertCart(payload, tenantId, { cartToken: 't1', items: [{ sku: 'CART-BASE', quantity: 3 }] })
  assert.equal(r.status, 200)
  assert.equal(b(r).quote?.grandTotal, 30000) // server re-prices: 3 * 10000
  assert.deepEqual(b(r).items, [{ sku: 'CART-BASE', quantity: 3 }])
  assert.equal(await countCarts(tenantId, 't1'), before, 'no new cart doc created')
  const doc = await findCartDoc(tenantId, 't1')
  assert.deepEqual(doc?.items, [{ sku: 'CART-BASE', quantity: 3 }])
})

test('a variant sku line quotes at the variant price', async () => {
  const r = await upsertCart(payload, tenantId, { cartToken: 't2', items: [{ sku: 'CART-VAR', quantity: 1 }] })
  assert.equal(r.status, 200)
  assert.equal(b(r).quote?.grandTotal, 5000) // variant price, not the 20000 product base
})

test('an unknown sku keeps the cart but reports quoteError (product_not_found), quote null, items persisted', async () => {
  const r = await upsertCart(payload, tenantId, { cartToken: 't3', items: [{ sku: 'NOPE', quantity: 1 }] })
  assert.equal(r.status, 200)
  assert.equal(b(r).quote, null)
  assert.equal(b(r).quoteError?.code, 'product_not_found')
  assert.deepEqual(b(r).items, [{ sku: 'NOPE', quantity: 1 }])
  const doc = await findCartDoc(tenantId, 't3')
  assert.deepEqual(doc?.items, [{ sku: 'NOPE', quantity: 1 }], 'unavailable line is still persisted as shopper intent')
})

test('a multi-line cart with one unknown sku reports quoteError and persists all items', async () => {
  const r = await upsertCart(payload, tenantId, {
    cartToken: 't3b',
    items: [
      { sku: 'CART-BASE', quantity: 1 },
      { sku: 'NOPE', quantity: 1 },
    ],
  })
  assert.equal(r.status, 200)
  assert.equal(b(r).quote, null)
  assert.equal(b(r).quoteError?.code, 'product_not_found')
  assert.equal(b(r).items?.length, 2)
})

test('readCart on an unknown token returns an empty cart', async () => {
  const r = await readCart(payload, tenantId, 'never-seen')
  assert.equal(r.status, 200)
  assert.deepEqual(b(r).items, [])
  assert.equal(b(r).quote, null)
})

test('readCart re-quotes a persisted cart from the catalog', async () => {
  await upsertCart(payload, tenantId, { cartToken: 't4', items: [{ sku: 'CART-BASE', quantity: 2 }] })
  const r = await readCart(payload, tenantId, 't4')
  assert.equal(r.status, 200)
  assert.deepEqual(b(r).items, [{ sku: 'CART-BASE', quantity: 2 }])
  assert.equal(b(r).quote?.grandTotal, 20000)
})

test('tenant isolation: a second tenant cartToken is not visible from the first tenant', async () => {
  const created = await upsertCart(payload, otherTenantId, { cartToken: 'iso', items: [{ sku: 'CART-BASE', quantity: 1 }] })
  assert.equal(created.status, 200)
  assert.equal(b(created).quote?.grandTotal, 10000)
  // Same token read from the first tenant sees nothing.
  const fromA = await readCart(payload, tenantId, 'iso')
  assert.equal(fromA.status, 200)
  assert.deepEqual(b(fromA).items, [])
  assert.equal(b(fromA).quote, null)
  assert.equal(await countCarts(tenantId, 'iso'), 0)
})

test('upsert with missing cartToken -> 400 missing_cart_token', async () => {
  const r = await upsertCart(payload, tenantId, { items: [{ sku: 'CART-BASE', quantity: 1 }] })
  assert.equal(r.status, 400)
  assert.equal(b(r).error, 'missing_cart_token')
})

test('upsert with items that is not an array -> 400 invalid_items', async () => {
  const r = await upsertCart(payload, tenantId, { cartToken: 't5', items: { sku: 'CART-BASE', quantity: 1 } })
  assert.equal(r.status, 400)
  assert.equal(b(r).error, 'invalid_items')
})

test('upsert with a non-positive / fractional quantity -> 400 invalid_items', async () => {
  const zero = await upsertCart(payload, tenantId, { cartToken: 't6', items: [{ sku: 'CART-BASE', quantity: 0 }] })
  assert.equal(zero.status, 400)
  assert.equal(b(zero).error, 'invalid_items')
  const frac = await upsertCart(payload, tenantId, { cartToken: 't6', items: [{ sku: 'CART-BASE', quantity: 1.5 }] })
  assert.equal(frac.status, 400)
  assert.equal(b(frac).error, 'invalid_items')
})

test('upsert with an empty items array clears the cart (quote null)', async () => {
  await upsertCart(payload, tenantId, { cartToken: 't7', items: [{ sku: 'CART-BASE', quantity: 2 }] })
  const cleared = await upsertCart(payload, tenantId, { cartToken: 't7', items: [] })
  assert.equal(cleared.status, 200)
  assert.deepEqual(b(cleared).items, [])
  assert.equal(b(cleared).quote, null)
  const doc = await findCartDoc(tenantId, 't7')
  assert.deepEqual(doc?.items, [])
})
