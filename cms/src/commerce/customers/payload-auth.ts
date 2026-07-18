// Tenant-aware customer auth wrappers over Payload's local auth API (plan §3.6 / Wave B2).
// Each wrapper takes the immutable tenant numeric ID from the caller (gateway signature verification
// happens upstream at the Astro edge), derives the server-only username `<tenantId>:<normalizedEmail>`
// (browser never sees it), invokes the corresponding Payload local auth operation, and enforces
// cross-tenant replay defense (a tenant-A token cannot read tenant-B state). HTTP endpoint wiring is
// NOT done here — the integration owner mounts these in commerce/store/endpoints.ts and removes the
// legacy commerce/customers/auth scrypt/session helpers in F2. All wrappers return { status, body }.

import type { Payload } from 'payload'
import { deriveCustomerUsername, normalizeEmailForUsername } from './username'

export type PublicCustomer = {
  id: number | string
  email: string
  name: string | null
  phone: string | null
  status: 'active' | 'disabled'
  verified: boolean
}

export type CustomerAuthResult = { status: number; body: Record<string, unknown> }

type CustomerDoc = {
  id: number | string
  email?: string | null
  name?: string | null
  phone?: string | null
  status?: 'active' | 'disabled' | null
  tenant?: number | string | { id?: number | string } | null
  _verified?: boolean
  username?: string
}

const SESSION_TTL_S = 604800 // mirrors Customers.auth.tokenExpiration

function publicCustomer(c: CustomerDoc): PublicCustomer {
  return {
    id: c.id,
    email: typeof c.email === 'string' ? c.email : '',
    name: c.name ?? null,
    phone: c.phone ?? null,
    status: c.status ?? 'active',
    verified: Boolean(c._verified),
  }
}

function isValidPassword(p: unknown): p is string {
  return typeof p === 'string' && p.length >= 8
}

function isDuplicateError(err: unknown): boolean {
  const message = (err as { message?: string } | null)?.message ?? ''
  return /unique|already|exists|constraint/i.test(message)
}

function isUnverifiedError(err: unknown): boolean {
  const e = err as { name?: string; message?: string } | null
  if (e?.name === 'UnverifiedEmail') return true
  return /unverified|not.*verified/i.test(e?.message ?? '')
}

function isLockedError(err: unknown): boolean {
  const e = err as { name?: string; message?: string } | null
  if (e?.name === 'LockedAuth') return true
  return /locked/i.test(e?.message ?? '')
}

// Register a tenant-local customer. Dedups on the globally-unique derived username (same email in a
// different tenant has a different username and succeeds). overrideAccess:true because registration
// is unauthenticated — this wrapper is the trust boundary. Returns the SERVER-ONLY verification token
// for the gateway's email dispatch; it MUST NOT be forwarded to the browser.
export async function registerCustomer(
  payload: Payload,
  tenantId: number | string,
  input: {
    email?: string
    password?: string
    name?: string | null
    phone?: string | null
    locale?: 'ar' | 'en'
  },
): Promise<CustomerAuthResult> {
  const email = typeof input.email === 'string' ? input.email : ''
  const password = input.password
  const normalized = normalizeEmailForUsername(email)
  if (!normalized || !isValidPassword(password)) {
    return { status: 400, body: { error: 'invalid_input' } }
  }
  const username = deriveCustomerUsername(tenantId, email)
  if (!username) return { status: 400, body: { error: 'invalid_input' } }

  const existing = await payload.find({
    collection: 'customers',
    where: { username: { equals: username } },
    overrideAccess: true,
    limit: 1,
  })
  if (existing.docs.length > 0) return { status: 409, body: { error: 'email_in_use' } }

  // pre-B4-regen: loosen to any until `payload generate:types` emits the auth-field-aware Customer
  // shape; runtime is verified by the B2 test.
  let created: any
  try {
    created = await payload.create({
      collection: 'customers',
      overrideAccess: true,
      showHiddenFields: true,
      disableVerificationEmail: true, // gateway owns dispatch via SMTP
      data: {
        email,
        normalizedEmail: normalized,
        password,
        name: input.name ?? undefined,
        phone: input.phone ?? undefined,
        status: 'active',
        tenant: Number(tenantId),
      },
    } as any)
  } catch (err) {
    if (isDuplicateError(err)) return { status: 409, body: { error: 'email_in_use' } }
    throw err
  }

  return {
    status: 201,
    body: {
      customer: publicCustomer(created),
      verificationToken: created._verificationToken ?? null, // SERVER-ONLY
      requireVerification: true,
    },
  }
}

// Consumes a _verificationToken; idempotent (Payload nulls the token on success).
export async function verifyCustomerEmail(
  payload: Payload,
  token: string,
): Promise<CustomerAuthResult> {
  if (typeof token !== 'string' || token.length === 0) {
    return { status: 400, body: { error: 'invalid_input' } }
  }
  try {
    const ok = await payload.verifyEmail({ collection: 'customers', token })
    return { status: ok ? 200 : 403, body: { ok } }
  } catch {
    return { status: 403, body: { error: 'invalid_token' } }
  }
}

// Returns the existing _verificationToken for the gateway to re-dispatch. Always 200 — never reveals
// whether the email exists.
export async function resendVerification(
  payload: Payload,
  tenantId: number | string,
  email: string,
): Promise<CustomerAuthResult> {
  const normalized = normalizeEmailForUsername(email)
  if (!normalized) return { status: 200, body: { ok: true } }
  const username = deriveCustomerUsername(tenantId, email)
  if (!username) return { status: 200, body: { ok: true } }

  const { docs } = await payload.find({
    collection: 'customers',
    where: { username: { equals: username } },
    overrideAccess: true,
    showHiddenFields: true,
    limit: 1,
  })
  const customer = docs[0] as (CustomerDoc & { _verificationToken?: string }) | undefined
  if (!customer) return { status: 200, body: { ok: true } }
  if (customer._verified) return { status: 200, body: { ok: true, alreadyVerified: true } }
  return {
    status: 200,
    body: { ok: true, verificationToken: customer._verificationToken ?? null }, // SERVER-ONLY
  }
}

// Authenticates a tenant-local customer. Maps Payload's distinct error classes into stable response
// codes so the gateway never reveals which: unknown/wrong → 401; locked → 429; unverified → 403.
export async function loginCustomer(
  payload: Payload,
  tenantId: number | string,
  input: { email?: string; password?: string },
): Promise<CustomerAuthResult> {
  const email = typeof input.email === 'string' ? input.email : ''
  const password = input.password
  const normalized = normalizeEmailForUsername(email)
  if (!normalized || typeof password !== 'string' || password === '') {
    return { status: 401, body: { error: 'invalid_credentials' } }
  }
  const username = deriveCustomerUsername(tenantId, email)
  if (!username) return { status: 401, body: { error: 'invalid_credentials' } }

  // pre-B4-regen: loosen result; the generated customers login type already requires username under
  // loginWithUsername. Tightened after generate:types.
  let result: any
  try {
    result = await payload.login({
      collection: 'customers',
      data: { username, password } as any,
    })
  } catch (err) {
    if (isUnverifiedError(err)) return { status: 403, body: { error: 'unverified_email' } }
    if (isLockedError(err)) return { status: 429, body: { error: 'invalid_credentials' } }
    return { status: 401, body: { error: 'invalid_credentials' } }
  }

  if (!result.token || !result.user) {
    return { status: 401, body: { error: 'invalid_credentials' } }
  }

  return {
    status: 200,
    body: {
      customer: publicCustomer(result.user),
      // removeTokenFromResponses:false → Payload returns the token; the trusted Astro gateway receives
      // it, sets the auth cookie, and strips it from the body before forwarding to the browser.
      token: result.token,
      expiresIn: SESSION_TTL_S,
    },
  }
}

// Revokes the session bound to the JWT (removes its sid from the user's sessions array). Always 200.
export async function logoutCustomer(
  payload: Payload,
  token: string,
): Promise<CustomerAuthResult> {
  const { jwtVerify } = await import('jose')
  let decoded: { id?: string | number; collection?: string; sid?: string }
  try {
    const { payload: decodedPayload } = await jwtVerify(
      token,
      new TextEncoder().encode(payload.secret),
    )
    decoded = decodedPayload as typeof decoded
  } catch {
    return { status: 200, body: { ok: true } }
  }
  if (decoded.collection !== 'customers' || !decoded.id) {
    return { status: 200, body: { ok: true } }
  }

  const user = (await payload
    .findByID({
      collection: 'customers',
      id: decoded.id,
      overrideAccess: true,
      showHiddenFields: true,
    })
    .catch(() => null)) as (CustomerDoc & { sessions?: Array<{ id: string }> }) | null
  if (!user) return { status: 200, body: { ok: true } }

  const sessionsAfter = (user.sessions ?? []).filter((s) => s.id !== decoded.sid)
  await payload.update({
    collection: 'customers',
    id: user.id,
    overrideAccess: true,
    data: { sessions: sessionsAfter },
  })

  return { status: 200, body: { ok: true } }
}

// Verifies a JWT and returns the bound customer. Cross-tenant replay defense: the resolved
// customer's tenant MUST equal the caller-supplied tenantId. Enforces session revocation + the email
// verification gate.
export async function readCustomerMe(
  payload: Payload,
  token: string,
  tenantId: number | string,
): Promise<CustomerAuthResult> {
  const { jwtVerify } = await import('jose')
  let decoded: { id?: string | number; collection?: string; sid?: string }
  try {
    const { payload: decodedPayload } = await jwtVerify(
      token,
      new TextEncoder().encode(payload.secret),
    )
    decoded = decodedPayload as typeof decoded
  } catch {
    return { status: 401, body: { error: 'invalid_session' } }
  }
  if (decoded.collection !== 'customers' || !decoded.id) {
    return { status: 401, body: { error: 'invalid_session' } }
  }

  const user = (await payload
    .findByID({
      collection: 'customers',
      id: decoded.id,
      overrideAccess: true,
      showHiddenFields: true,
    })
    .catch(() => null)) as
    | (CustomerDoc & { sessions?: Array<{ id: string; expiresAt?: string }> })
    | null
  if (!user) return { status: 401, body: { error: 'invalid_session' } }

  const userTenantId =
    typeof user.tenant === 'object' && user.tenant !== null
      ? user.tenant?.id
      : (user.tenant as number | string | undefined)
  if (userTenantId == null || String(userTenantId) !== String(tenantId)) {
    return { status: 401, body: { error: 'invalid_session' } }
  }

  if (decoded.sid) {
    const now = Date.now()
    const active = (user.sessions ?? []).some((s) => {
      if (s.id !== decoded.sid) return false
      if (!s.expiresAt) return true
      return new Date(s.expiresAt).getTime() > now
    })
    if (!active) return { status: 401, body: { error: 'invalid_session' } }
  }

  if (user._verified === false) {
    return { status: 403, body: { error: 'unverified_email' } }
  }

  return { status: 200, body: { customer: publicCustomer(user) } }
}

// Generates a reset-password token. Always 200 — never reveals whether the email exists.
export async function requestPasswordReset(
  payload: Payload,
  tenantId: number | string,
  email: string,
): Promise<CustomerAuthResult> {
  const normalized = normalizeEmailForUsername(email)
  if (!normalized) return { status: 200, body: { ok: true } }
  const username = deriveCustomerUsername(tenantId, email)
  if (!username) return { status: 200, body: { ok: true } }

  try {
    const forgotData: Record<string, string> = { email: '', username }
    await payload.forgotPassword({
      collection: 'customers',
      disableEmail: true, // gateway owns dispatch via SMTP
      data: forgotData as unknown as { email: string },
    })
  } catch {
    /* swallow — return 200 */
  }
  return { status: 200, body: { ok: true } }
}

// Consumes a reset token and sets a new password. Returns a fresh session token (gateway-only).
export async function resetPassword(
  payload: Payload,
  input: { token?: string; password?: string },
): Promise<CustomerAuthResult> {
  const token = typeof input.token === 'string' ? input.token : ''
  const password = input.password
  if (!token || !isValidPassword(password)) {
    return { status: 400, body: { error: 'invalid_input' } }
  }
  try {
    const result = await payload.resetPassword({
      collection: 'customers',
      overrideAccess: true,
      data: { token, password },
    })
    return {
      status: 200,
      body: {
        token: result.token,
        customer: publicCustomer(result.user as CustomerDoc),
        expiresIn: SESSION_TTL_S,
      },
    }
  } catch {
    return { status: 403, body: { error: 'invalid_token' } }
  }
}
