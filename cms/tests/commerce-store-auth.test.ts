// Customer auth orchestration. The HTTP routes are thin wrappers; this exercises registerCustomer,
// loginCustomer, and readSession directly with payload + tenantId: input validation, duplicate-email
// dedup on the normalized email, constant-time credentials (same error for unknown email vs. wrong
// password), stateless session verification (tampered + expired), and tenant isolation.
import assert from 'node:assert/strict'
import { rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import type { Payload } from 'payload'

const TEMP_DB = join(tmpdir(), `commerce-store-auth-itest-${process.pid}-${Date.now()}.db`)
process.env.DATABASE_URI = `file:${TEMP_DB}`
process.env.PAYLOAD_SECRET = process.env.PAYLOAD_SECRET || 'commerce-store-auth-itest-secret'

const { default: config } = await import('../src/payload.config')
const { getPayload } = await import('payload')
const { seedTenant } = await import('./helpers/commerce')
const payload = (await getPayload({ config })) as unknown as Payload
await payload.db.migrate()

const { registerCustomer, loginCustomer, readSession } = await import('../src/commerce/store/auth')
const { signSession } = await import('../src/commerce/crypto')

let tenantA: { tenantId: number | string }
let tenantB: { tenantId: number | string }

test.before(async () => {
  tenantA = await seedTenant(payload, { features: ['commerce'] })
  tenantB = await seedTenant(payload, { features: ['commerce'] })
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

const uniqueEmail = () =>
  `cust-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`

test('register → 200, customer created, session verifies via readSession; no secret fields leaked', async () => {
  const email = uniqueEmail()
  const r = await registerCustomer(payload, tenantA.tenantId, {
    email,
    password: 'supersecret',
    name: 'Aisha',
  })
  assert.equal(r.status, 200)
  const body = r.body as {
    customer: { id: number; email: string; name: string }
    sessionToken: string
    expiresIn: number
  }
  assert.equal(body.customer.email, email)
  assert.equal(body.customer.name, 'Aisha')
  assert.equal(body.expiresIn, 604800)
  assert.ok(typeof body.sessionToken === 'string' && body.sessionToken.length > 0)
  // passwordHash/passwordSalt never appear in the response customer.
  assert.equal('passwordHash' in body.customer, false)
  assert.equal('passwordSalt' in body.customer, false)

  // The customer row exists for this tenant.
  const { docs } = await payload.find({
    collection: 'customers',
    where: {
      and: [
        { tenant: { equals: tenantA.tenantId } },
        { normalizedEmail: { equals: email.toLowerCase() } },
      ],
    },
    overrideAccess: true,
    limit: 1,
  })
  assert.equal(docs.length, 1)
  assert.equal((docs[0] as { id: number }).id, body.customer.id)

  // The SAME token round-trips through readSession and returns the customer.
  const me = await readSession(payload, body.sessionToken, tenantA.tenantId)
  assert.equal(me.status, 200)
  const meBody = me.body as { customer: { id: number; email: string } }
  assert.equal(meBody.customer.id, body.customer.id)
  assert.equal(meBody.customer.email, email)
})

test('register duplicate email (case/whitespace variant) → 409', async () => {
  const email = uniqueEmail()
  const first = await registerCustomer(payload, tenantA.tenantId, {
    email,
    password: 'supersecret',
  })
  assert.equal(first.status, 200)
  // Different case + surrounding whitespace collapses to the same normalizedEmail.
  const dup = await registerCustomer(payload, tenantA.tenantId, {
    email: ` ${email.toUpperCase()} `,
    password: 'supersecret',
  })
  assert.equal(dup.status, 409)
  assert.equal((dup.body as { error: string }).error, 'email_in_use')
})

test('register weak password (<8) → 400', async () => {
  const r = await registerCustomer(payload, tenantA.tenantId, {
    email: uniqueEmail(),
    password: 'short',
  })
  assert.equal(r.status, 400)
  assert.equal((r.body as { error: string }).error, 'invalid_input')
})

test('login correct password → 200; wrong password → 401; unknown email → 401 (same error)', async () => {
  const email = uniqueEmail()
  await registerCustomer(payload, tenantA.tenantId, { email, password: 'supersecret' })

  const ok = await loginCustomer(payload, tenantA.tenantId, { email, password: 'supersecret' })
  assert.equal(ok.status, 200)
  assert.ok(typeof (ok.body as { sessionToken: string }).sessionToken === 'string')

  const wrong = await loginCustomer(payload, tenantA.tenantId, {
    email,
    password: 'wrong-password',
  })
  assert.equal(wrong.status, 401)
  assert.equal((wrong.body as { error: string }).error, 'invalid_credentials')

  const unknown = await loginCustomer(payload, tenantA.tenantId, {
    email: 'no-such-user@example.com',
    password: 'supersecret',
  })
  assert.equal(unknown.status, 401)
  assert.equal((unknown.body as { error: string }).error, 'invalid_credentials')
})

test('readSession rejects a tampered token → 401', async () => {
  const email = uniqueEmail()
  const reg = await registerCustomer(payload, tenantA.tenantId, { email, password: 'supersecret' })
  const token = (reg.body as { sessionToken: string }).sessionToken
  // Flip the last character (inside the MAC) to break the signature.
  const tampered = token.slice(0, -1) + (token.endsWith('A') ? 'B' : 'A')
  const r = await readSession(payload, tampered, tenantA.tenantId)
  assert.equal(r.status, 401)
  assert.equal((r.body as { error: string }).error, 'invalid_session')
})

test('readSession rejects an expired token → 401', async () => {
  const email = uniqueEmail()
  const reg = await registerCustomer(payload, tenantA.tenantId, { email, password: 'supersecret' })
  const customerId = (reg.body as { customer: { id: number } }).customer.id
  const expired = signSession({
    customerId,
    tenantId: tenantA.tenantId,
    exp: Date.now() - 1000,
  })
  const r = await readSession(payload, expired, tenantA.tenantId)
  assert.equal(r.status, 401)
  assert.equal((r.body as { error: string }).error, 'invalid_session')
})

test('tenant isolation: a customer on tenant A is invisible to tenant B readSession', async () => {
  const email = uniqueEmail()
  const reg = await registerCustomer(payload, tenantA.tenantId, { email, password: 'supersecret' })
  const token = (reg.body as { sessionToken: string }).sessionToken
  // Valid token, but asked from tenant B's scope → the customer id does not exist there.
  const r = await readSession(payload, token, tenantB.tenantId)
  assert.equal(r.status, 401)
  assert.equal((r.body as { error: string }).error, 'invalid_session')
})
