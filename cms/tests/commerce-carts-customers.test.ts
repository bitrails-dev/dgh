// Carts + customers: server-normalized email identity (unique per tenant), tenant isolation, and
// write-only credentials. Runs against an isolated throwaway DB migrated from scratch.
import assert from 'node:assert/strict'
import { rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import type { Payload } from 'payload'

const TEMP_DB = join(tmpdir(), `commerce-carts-itest-${process.pid}-${Date.now()}.db`)
process.env.DATABASE_URI = `file:${TEMP_DB}`
process.env.PAYLOAD_SECRET = process.env.PAYLOAD_SECRET || 'commerce-carts-itest-secret'

const { default: config } = await import('../src/payload.config')
const { getPayload } = await import('payload')
const { seedTenant } = await import('./helpers/commerce')
const payload = (await getPayload({ config })) as unknown as Payload
await payload.db.migrate()

let tenantA: number | string
let tenantB: number | string

test.before(async () => {
  ;({ tenantId: tenantA } = await seedTenant(payload))
  ;({ tenantId: tenantB } = await seedTenant(payload))
})
test.after(async () => {
  try { try { await (payload.db as any).drizzle?.session?.client?.close?.() } catch { /* libsql native teardown fix (commit 1630a03) */ } await payload.destroy() } finally { try { rmSync(TEMP_DB, { force: true }) } catch { /* */ } }
})

test('customer username is server-derived; duplicate email per tenant is rejected, cross-tenant allowed', async () => {
  // Payload-auth model (B2): username = `<tenantId>:<normalizedEmail>`, globally unique. Payload
  // hashes the password via its auth strategy; the username is derived by a beforeChange hook.
  const c1: any = await payload.create({ collection: 'customers', overrideAccess: true, data: { tenant: tenantA, email: 'Alice@Test.com', password: 'password123', name: 'Alice' } as any })
  assert.equal(c1.username, `${tenantA}:alice@test.com`, 'username server-derived from tenant + normalized email')

  // same tenant, same identity (case/spacing differ) -> same username -> rejected by the unique index
  await assert.rejects(
    () => payload.create({ collection: 'customers', overrideAccess: true, data: { tenant: tenantA, email: '  alice@test.com  ', password: 'password123' } as any }),
  )
  // different tenant, same email -> different username -> allowed (tenant-local identity)
  const c2: any = await payload.create({ collection: 'customers', overrideAccess: true, data: { tenant: tenantB, email: 'Alice@Test.com', password: 'password123', name: 'Alice B' } as any })
  assert.ok(c2.id !== c1.id, 'a different tenant may have the same email')
})

test('store-carts are tenant-scoped; items stored as {product, variant?, quantity}', async () => {
  // store-carts (plugin-first, Wave E3) has no cartToken — it's keyed by numeric id + a guest secret.
  // Items are tenant-scoped relationship rows to store-products (variant optional).
  const productA: any = await payload.create({
    collection: 'store-products', overrideAccess: true,
    data: { tenant: tenantA, slug: 'sku-cart-probe-a', sku: 'SKU-CART-PROBE-A', priceInEGPEnabled: true, priceInEGP: 5000, taxClass: 'standard', trackInventory: true } as any,
  })
  const cart: any = await payload.create({
    collection: 'store-carts', overrideAccess: true,
    data: { tenant: tenantA, currency: 'EGP', items: [{ product: productA.id, quantity: 2 }] } as any,
  })
  assert.equal(String(cart.tenant?.id ?? cart.tenant), String(tenantA), 'cart is tenant-scoped')
  assert.ok(Array.isArray(cart.items) && cart.items.length === 1, 'item row stored')
  const line = cart.items[0]
  assert.equal(String(line.product?.id ?? line.product), String(productA.id), 'item stores the product ref')
  assert.equal(line.quantity, 2, 'item stores quantity')
  assert.equal(line.variant, null, 'variant omitted for a simple product')

  // A cart in tenantB is a distinct, tenant-scoped doc (no global cartToken namespace).
  const cartB: any = await payload.create({
    collection: 'store-carts', overrideAccess: true,
    data: { tenant: tenantB, currency: 'EGP' } as any,
  })
  assert.notEqual(String(cartB.id), String(cart.id), 'different cart docs')
  assert.equal(String(cartB.tenant?.id ?? cartB.tenant), String(tenantB), 'cartB belongs to tenantB')
})
