// Shopper-facing customer auth for the store (/api/commerce/store/:tenantSlug/auth/*). Each route is
// a thin HTTP handler over a directly-callable orchestration function (registerCustomer / loginCustomer
// / readSession); the tenant is resolved from the URL slug → 404 when missing or without `commerce`.
//
// Sessions are stateless HMAC tokens from commerce/crypto (signSession/verifySession): there is no DB
// session row and no server-side revocation — logout just clears the cookie at the Astro edge (rate
// limiting is enforced there too). Password hashing uses commerce/customers/auth (scrypt + constant-
// time verify that fails closed). Plaintext passwords are never logged, and passwordHash/passwordSalt
// are never returned — the response surfaces only { id, email, name }.
import type { Endpoint, Payload, PayloadRequest, Where } from 'payload'
import { resolveStoreTenant, readJsonBody } from './shared'
import { hashPassword, normalizeEmail, verifyPassword } from '../customers/auth'
import { signSession, verifySession } from '../crypto'

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000
const SESSION_TTL_S = SESSION_TTL_MS / 1000

type OrchestrationResult = { status: number; body: Record<string, unknown> }

// The customer fields safe to surface in any response. NEVER include passwordHash/passwordSalt.
const publicCustomer = (c: { id: number | string; email?: string; name?: string | null }): {
  id: number | string
  email?: string
  name: string | null
} => ({ id: c.id, email: c.email, name: c.name ?? null })

// --- Orchestration (testable directly with payload + tenantId) ---------------------------

// Register a tenant-local customer. Validates input, dedups on the SERVER-normalized email (compound
// unique per tenant), hashes the password with scrypt, creates the row, and issues a stateless session.
export async function registerCustomer(
  payload: Payload,
  tenantId: number | string,
  input: { email?: string; password?: string; name?: string | null; phone?: string | null },
): Promise<OrchestrationResult> {
  const email = typeof input.email === 'string' ? input.email : ''
  const password = typeof input.password === 'string' ? input.password : ''
  if (!email || password.length < 8) {
    return { status: 400, body: { error: 'invalid_input' } }
  }
  const normalizedEmail = normalizeEmail(email)
  if (!normalizedEmail) {
    return { status: 400, body: { error: 'invalid_input' } }
  }

  const { docs } = await payload.find({
    collection: 'customers',
    where: { and: [{ tenant: { equals: tenantId } }, { normalizedEmail: { equals: normalizedEmail } }] },
    overrideAccess: true,
    limit: 1,
  })
  if (docs.length > 0) return { status: 409, body: { error: 'email_in_use' } }

  const hashed = hashPassword(password)
  const created = await payload.create({
    collection: 'customers',
    overrideAccess: true,
    data: {
      // SQLite uses numeric AUTOINCREMENT PKs (see payload.config), so the relationship id is a number.
      tenant: Number(tenantId),
      email,
      normalizedEmail,
      name: input.name ?? undefined,
      phone: input.phone ?? undefined,
      // Store the full versioned record so verifyPassword can re-read it (it parses strings too);
      // the salt is also persisted in its own column to match the schema's two-field design.
      passwordHash: JSON.stringify(hashed),
      passwordSalt: hashed.salt,
      status: 'active',
      verified: false,
    },
  })

  const sessionToken = signSession({
    customerId: created.id,
    tenantId,
    exp: Date.now() + SESSION_TTL_MS,
  })
  return {
    status: 200,
    body: {
      customer: publicCustomer(created as { id: number | string; email?: string; name?: string | null }),
      sessionToken,
      expiresIn: SESSION_TTL_S,
    },
  }
}

// Login by email + password. The same `invalid_credentials` error covers an unknown email and a wrong
// password so the response never reveals which — the scrypt derivation still runs for a missing record
// is unnecessary, but verifyPassword fails closed on undefined input regardless.
export async function loginCustomer(
  payload: Payload,
  tenantId: number | string,
  input: { email?: string; password?: string },
): Promise<OrchestrationResult> {
  const email = typeof input.email === 'string' ? input.email : ''
  const password = typeof input.password === 'string' ? input.password : ''
  const normalizedEmail = normalizeEmail(email)
  if (!normalizedEmail || !password) {
    return { status: 401, body: { error: 'invalid_credentials' } }
  }

  const { docs } = await payload.find({
    collection: 'customers',
    where: { and: [{ tenant: { equals: tenantId } }, { normalizedEmail: { equals: normalizedEmail } }] },
    overrideAccess: true,
    limit: 1,
  })
  const customer = docs[0] as
    | { id: number | string; email?: string; name?: string | null; passwordHash?: string }
    | undefined
  // Constant-time verify; the single error never leaks whether the email exists.
  if (!customer || !verifyPassword(password, customer.passwordHash)) {
    return { status: 401, body: { error: 'invalid_credentials' } }
  }

  const sessionToken = signSession({
    customerId: customer.id,
    tenantId,
    exp: Date.now() + SESSION_TTL_MS,
  })
  return {
    status: 200,
    body: {
      customer: publicCustomer(customer),
      sessionToken,
      expiresIn: SESSION_TTL_S,
    },
  }
}

// Verify a stateless session token and return the (optionally tenant-scoped) customer. A bad
// signature, a malformed token, an expired token, or a tenant mismatch all collapse to 401.
export async function readSession(
  payload: Payload,
  token: string,
  tenantId?: number | string,
): Promise<OrchestrationResult> {
  let session: { customerId: number | string; tenantId?: number | string; exp: number }
  try {
    session = verifySession(token)
  } catch {
    return { status: 401, body: { error: 'invalid_session' } }
  }

  const where: Where =
    tenantId != null
      ? { and: [{ tenant: { equals: tenantId } }, { id: { equals: session.customerId } }] }
      : { id: { equals: session.customerId } }

  const { docs } = await payload.find({
    collection: 'customers',
    where,
    overrideAccess: true,
    limit: 1,
  })
  const customer = docs[0] as { id: number | string; email?: string; name?: string | null } | undefined
  if (!customer) return { status: 401, body: { error: 'invalid_session' } }
  return { status: 200, body: { customer: publicCustomer(customer) } }
}

// --- HTTP endpoints (thin wrappers over the orchestration) -------------------------------

// Resolves the tenant from the URL slug. Missing slug param → 400 (routing fault); unknown tenant or
// one without `commerce` → 404. Returns either the tenant id or a ready-to-send Response.
const resolveOr404 = async (
  payload: Payload,
  tenantSlug: string | undefined,
): Promise<{ id: number | string } | Response> => {
  if (!tenantSlug) return Response.json({ error: 'missing_tenant' }, { status: 400 })
  const tenant = await resolveStoreTenant(payload, tenantSlug)
  if (!tenant) return Response.json({ error: 'not_found' }, { status: 404 })
  return tenant
}

export const authEndpoints: Endpoint[] = [
  {
    path: '/commerce/store/:tenantSlug/auth/register',
    method: 'post',
    handler: async (req: PayloadRequest): Promise<Response> => {
      const tenant = await resolveOr404(req.payload, req.routeParams?.tenantSlug as string | undefined)
      if (tenant instanceof Response) return tenant
      const body = await readJsonBody(req)
      if (!body) return Response.json({ error: 'invalid_input' }, { status: 400 })
      const { status, body: out } = await registerCustomer(
        req.payload,
        tenant.id,
        body as { email?: string; password?: string; name?: string; phone?: string },
      )
      return Response.json(out, { status })
    },
  },
  {
    path: '/commerce/store/:tenantSlug/auth/login',
    method: 'post',
    handler: async (req: PayloadRequest): Promise<Response> => {
      const tenant = await resolveOr404(req.payload, req.routeParams?.tenantSlug as string | undefined)
      if (tenant instanceof Response) return tenant
      const body = await readJsonBody(req)
      if (!body) return Response.json({ error: 'invalid_input' }, { status: 400 })
      const { status, body: out } = await loginCustomer(
        req.payload,
        tenant.id,
        body as { email?: string; password?: string },
      )
      return Response.json(out, { status })
    },
  },
  {
    path: '/commerce/store/:tenantSlug/auth/logout',
    method: 'post',
    handler: async (req: PayloadRequest): Promise<Response> => {
      const tenant = await resolveOr404(req.payload, req.routeParams?.tenantSlug as string | undefined)
      if (tenant instanceof Response) return tenant
      // Stateless session: nothing to revoke server-side. The Astro layer clears the cookie.
      return Response.json({ ok: true }, { status: 200 })
    },
  },
  {
    path: '/commerce/store/:tenantSlug/auth/me',
    method: 'get',
    handler: async (req: PayloadRequest): Promise<Response> => {
      const tenant = await resolveOr404(req.payload, req.routeParams?.tenantSlug as string | undefined)
      if (tenant instanceof Response) return tenant
      const token = req.headers.get('x-session-token')
      if (!token) return Response.json({ error: 'invalid_session' }, { status: 401 })
      const { status, body: out } = await readSession(req.payload, token, tenant.id)
      return Response.json(out, { status })
    },
  },
]
