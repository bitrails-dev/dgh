// Tenant-aware Payload customer auth wrappers (plan §3.6 / Wave B2). Exercises registerCustomer,
// loginCustomer, readCustomerMe, logoutCustomer, verifyCustomerEmail directly: tenant-local identity
// (same email in two tenants is two distinct customers), duplicate rejection, the email-verification
// gate, wrong-password collapse, cross-tenant session-replay denial, and session revocation on logout.
// Runs against an isolated throwaway DB migrated from scratch.
import assert from 'node:assert/strict'
import { rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import type { Payload } from 'payload'

const TEMP_DB = join(tmpdir(), `commerce-cust-auth-itest-${process.pid}-${Date.now()}.db`)
process.env.DATABASE_URI = `file:${TEMP_DB}`
process.env.PAYLOAD_SECRET = process.env.PAYLOAD_SECRET || 'commerce-cust-auth-itest-secret'

const { default: config } = await import('../src/payload.config')
const { getPayload } = await import('payload')
const { seedTenant } = await import('./helpers/commerce')
const payload = (await getPayload({ config })) as unknown as Payload
await payload.db.migrate()

const {
  registerCustomer,
  loginCustomer,
  readCustomerMe,
  logoutCustomer,
  verifyCustomerEmail,
} = await import('../src/commerce/customers/payload-auth')

let tenantA: number | string
let tenantB: number | string

test.before(async () => {
  ;({ tenantId: tenantA } = await seedTenant(payload))
  ;({ tenantId: tenantB } = await seedTenant(payload))
})
test.after(async () => {
  try { try { await (payload.db as any).drizzle?.session?.client?.close?.() } catch { /* libsql native teardown fix (commit 1630a03) */ } await payload.destroy() } finally { try { rmSync(TEMP_DB, { force: true }) } catch { /* */ } }
})

const PASSWORD = 'password123'

// Verify the customer behind `email` in `tenant` so login + me pass the verification gate. Returns
// nothing — the wrapper consumes the registration token.
async function verify(payload: Payload, tenant: number | string, email: string) {
  const username = `${tenant}:${email.toLowerCase().trim()}`
  const { docs } = await payload.find({
    collection: 'customers',
    where: { username: { equals: username } },
    overrideAccess: true,
    showHiddenFields: true,
    limit: 1,
  })
  const token = (docs[0] as any)?._verificationToken
  assert.ok(token, 'a verification token was issued at registration')
  await verifyCustomerEmail(payload, token)
}

test('register: same email in two tenants yields two customers; duplicate in one tenant is rejected', async () => {
  const email = 'shopper@test.com'
  const a = await registerCustomer(payload, tenantA, { email, password: PASSWORD, name: 'A' })
  assert.equal(a.status, 201, `register A: ${JSON.stringify(a.body)}`)
  assert.equal((a.body as any).customer.username ?? null, null, 'username is never exposed to the client')
  assert.equal((a.body as any).verificationToken === undefined, false, 'server-only verification token returned')

  const dup = await registerCustomer(payload, tenantA, { email, password: PASSWORD })
  assert.equal(dup.status, 409, 'same tenant + same email is rejected')
  assert.equal((dup.body as any).error, 'email_in_use')

  const b = await registerCustomer(payload, tenantB, { email, password: PASSWORD, name: 'B' })
  assert.equal(b.status, 201, 'different tenant + same email is allowed')
  assert.notEqual((a.body as any).customer.id, (b.body as any).customer.id)
})

test('login + me: a tenant-A session cannot read tenant-B state (cross-tenant replay denied)', async () => {
  const email = 'replay@test.com'
  await registerCustomer(payload, tenantA, { email, password: PASSWORD })
  await verify(payload, tenantA, email)

  const login = await loginCustomer(payload, tenantA, { email, password: PASSWORD })
  assert.equal(login.status, 200, `login: ${JSON.stringify(login.body)}`)
  const session = (login.body as any).token
  assert.ok(session, 'a session token was issued')

  const meA = await readCustomerMe(payload, session, tenantA)
  assert.equal(meA.status, 200, 'the session is valid in its own tenant')

  const meB = await readCustomerMe(payload, session, tenantB)
  assert.equal(meB.status, 401, 'the same token cannot read another tenant')
})

test('login with the wrong password collapses to 401 without leaking the account', async () => {
  const email = 'wrong@test.com'
  await registerCustomer(payload, tenantA, { email, password: PASSWORD })
  await verify(payload, tenantA, email)

  const bad = await loginCustomer(payload, tenantA, { email, password: 'nope-nope-nope' })
  assert.equal(bad.status, 401)
  assert.equal((bad.body as any).error, 'invalid_credentials')
})

test('logout revokes the session; a subsequent me is 401', async () => {
  const email = 'out@test.com'
  await registerCustomer(payload, tenantA, { email, password: PASSWORD })
  await verify(payload, tenantA, email)

  const login = await loginCustomer(payload, tenantA, { email, password: PASSWORD })
  const token = (login.body as any).token
  const meBefore = await readCustomerMe(payload, token, tenantA)
  assert.equal(meBefore.status, 200, 'session active before logout')

  await logoutCustomer(payload, token)
  const meAfter = await readCustomerMe(payload, token, tenantA)
  assert.equal(meAfter.status, 401, 'session revoked after logout')
})
