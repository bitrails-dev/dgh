// Wave E3 continuation (Lane D, §4.1) — storefront auth endpoints are now signed. Drives the real
// auth handlers (register/login) with a hand-signed request (CMS sign + a test gateway key in env +
// the SQL nonce repo) to prove the happy path still works through withVerifiedCommerceGateway, and
// with an UNSIGNED request to prove the gate rejects it. The gateway verify primitive itself is
// covered by commerce-gateway.test.ts; the customer-auth ops by commerce-customer-payload-auth.test.
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import type { Payload, PayloadRequest } from 'payload'

const TEMP_DB = join(tmpdir(), `commerce-store-auth-gateway-itest-${process.pid}-${Date.now()}.db`)
process.env.DATABASE_URI = `file:${TEMP_DB}`
process.env.PAYLOAD_SECRET = process.env.PAYLOAD_SECRET || 'commerce-store-auth-gateway-itest-secret'

// Test gateway key (32 random bytes, base64) — resolved by the handler via resolveKeysFromEnv().
const KEY_ID = 'test-current'
const SECRET_B64 = randomBytes(32).toString('base64')
process.env.COMMERCE_GATEWAY_KEY_ID = KEY_ID
process.env.COMMERCE_GATEWAY_SECRET = SECRET_B64

const { default: config } = await import('../src/payload.config')
const { getPayload } = await import('payload')
const { seedTenant } = await import('./helpers/commerce')
const payload = (await getPayload({ config })) as unknown as Payload
await payload.db.migrate()

const { sign, decodeGatewaySecret } = await import('../src/commerce/gateway')
const { verifyCustomerEmail } = await import('../src/commerce/customers/payload-auth')
const { authEndpoints } = await import('../src/commerce/store/auth')

let tenantSlug: string
const PASSWORD = 'password123'

test.before(async () => {
  const { tenantId } = await seedTenant(payload, { features: ['commerce'] })
  tenantSlug = ((await payload.findByID({ collection: 'tenants', id: tenantId, overrideAccess: true })) as { slug: string }).slug
  await payload.create({
    collection: 'commerce-settings', overrideAccess: true,
    data: { tenant: tenantId, status: 'live', currency: 'EGP', taxMode: 'exclusive', sandbox: true } as any,
  })
})
test.after(async () => {
  try { try { await (payload.db as any).drizzle?.session?.client?.close?.() } catch { /* libsql native teardown */ } await payload.destroy() } finally { try { rmSync(TEMP_DB, { force: true }) } catch { /* */ } }
})

const registerHandler = authEndpoints.find((e) => e.path.endsWith('/auth/register'))!.handler as (req: PayloadRequest) => Promise<Response>
const loginHandler = authEndpoints.find((e) => e.path.endsWith('/auth/login'))!.handler as (req: PayloadRequest) => Promise<Response>

// Build a PayloadRequest carrying a signed (or unsigned) auth body. The signature is over the exact
// CMS path + method + body the handler's verifier reconstructs.
function buildReq(opts: { sign: boolean; body: string }): PayloadRequest {
  const path = `/api/commerce/store/${tenantSlug}/auth/register`
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (opts.sign) {
    const out = sign({
      method: 'POST',
      path,
      query: null,
      tenantSlug,
      body: Buffer.from(opts.body, 'utf8'),
      now: Date.now(),
      keyId: KEY_ID,
      secret: decodeGatewaySecret(SECRET_B64),
    })
    Object.assign(headers, out.headers)
  }
  return {
    payload,
    method: 'POST',
    path,
    routeParams: { tenantSlug },
    headers,
    text: async () => opts.body,
  } as unknown as PayloadRequest
}

test('unsigned register is rejected (401) — auth mutations are now gateway-gated', async () => {
  const body = JSON.stringify({ email: 'unsigned@dgh.test', password: PASSWORD, name: 'U' })
  const res = await registerHandler(buildReq({ sign: false, body }))
  assert.equal(res.status, 401, `expected 401, got ${res.status}`)
})

test('signed register succeeds (200) — the gate does not break the auth flow', async () => {
  const email = 'signed-reg@dgh.test'
  const body = JSON.stringify({ email, password: PASSWORD, name: 'Signed' })
  const res = await registerHandler(buildReq({ sign: true, body }))
  assert.equal(res.status, 201, `expected 201 (Created), got ${res.status}`)
  const out = (await res.json()) as { verificationToken?: string }
  assert.ok(out.verificationToken, 'server-only verification token returned to the gateway')
  await verifyCustomerEmail(payload, out.verificationToken!)
})

test('signed login succeeds (200) and returns a session token in the body', async () => {
  // Register + verify first (reuse the signed register path inline).
  const email = 'signed-login@dgh.test'
  const regBody = JSON.stringify({ email, password: PASSWORD, name: 'SignedLogin' })
  const reg = await registerHandler(buildReq({ sign: true, body: regBody }))
  const regOut = (await reg.json()) as { verificationToken: string }
  await verifyCustomerEmail(payload, regOut.verificationToken)

  const path = `/api/commerce/store/${tenantSlug}/auth/login`
  const loginBody = JSON.stringify({ email, password: PASSWORD })
  const out = sign({ method: 'POST', path, query: null, tenantSlug, body: Buffer.from(loginBody, 'utf8'), now: Date.now(), keyId: KEY_ID, secret: decodeGatewaySecret(SECRET_B64) })
  const res = await loginHandler({
    payload, method: 'POST', path, routeParams: { tenantSlug },
    headers: { 'content-type': 'application/json', ...out.headers },
    text: async () => loginBody,
  } as unknown as PayloadRequest)
  assert.equal(res.status, 200, `expected 200, got ${res.status}`)
  const o = (await res.json()) as { token?: string; customer?: { id?: unknown } }
  assert.ok(typeof o.token === 'string' && o.token.length > 0, 'session token returned in the body')
  assert.ok(o.customer?.id !== undefined)
})

test('unsigned login is rejected (401)', async () => {
  const path = `/api/commerce/store/${tenantSlug}/auth/login`
  const loginBody = JSON.stringify({ email: 'x@dgh.test', password: PASSWORD })
  const res = await loginHandler({
    payload, method: 'POST', path, routeParams: { tenantSlug },
    headers: { 'content-type': 'application/json' }, text: async () => loginBody,
  } as unknown as PayloadRequest)
  assert.equal(res.status, 401)
})
