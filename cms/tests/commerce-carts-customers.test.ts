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

test('cart token is unique per tenant; items are stored as JSON', async () => {
  const cart: any = await payload.create({ collection: 'carts', overrideAccess: true, data: { tenant: tenantA, cartToken: 'cart-1', customerEmail: 'a@b.test', currency: 'EGP', items: [{ sku: 'X', quantity: 2 }] } as any })
  assert.deepEqual(cart.items, [{ sku: 'X', quantity: 2 }])
  await assert.rejects(
    () => payload.create({ collection: 'carts', overrideAccess: true, data: { tenant: tenantA, cartToken: 'cart-1' } as any }),
  )
  // same token, different tenant -> allowed
  const cartB: any = await payload.create({ collection: 'carts', overrideAccess: true, data: { tenant: tenantB, cartToken: 'cart-1' } as any })
  assert.ok(cartB.id !== cart.id)
})
