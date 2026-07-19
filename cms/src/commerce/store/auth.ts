// Customer auth HTTP endpoints for the store (/api/commerce/store/:tenantSlug/auth/*). Thin handlers
// over the tenant-aware Payload-auth wrappers in commerce/customers/payload-auth (plan §3.6).
//
// Wave E3 continuation (Lane D, §4.1): register/login (and every other auth handler) are storefront
// mutations/requests, so each one now crosses withVerifiedCommerceGateway first — the Astro proxy
// signs every /api/store/v2/* request, and this is the trust boundary. The verifier resolves the
// tenant (confirming the commerce feature) and stashes it on req; the handler then uses that tenant
// id. Password hashing, sessions, verification and reset tokens are owned by Payload's local auth.
//
// register/login/reset return a server-only `verificationToken` / `token` in the body for the trusted
// Astro gateway to consume (set the auth cookie; dispatch the SMTP email); the proxy strips
// sessionToken/token for login/register. Commerce stays disabled for all tenants until F3 (plan §0.11).
import type { Endpoint, PayloadRequest } from 'payload'
import { withVerifiedCommerceGateway } from './gateway'
import {
  registerCustomer,
  loginCustomer,
  logoutCustomer,
  readCustomerMe,
  verifyCustomerEmail,
  resendVerification,
  requestPasswordReset,
  resetPassword,
} from '../customers/payload-auth'

// Verify the commerce-gateway signature over the raw body, resolve the tenant, and parse the body.
// Returns the tenant id + parsed body, or a rejection Response the caller returns unchanged. GET /me
// carries no body — the signature covers the path + query + the empty body hash.
async function verifyAuth(
  req: PayloadRequest,
): Promise<{ ok: true; tenantId: number | string; body: unknown } | { ok: false; res: Response }> {
  const tenantSlug = req.routeParams?.tenantSlug as string | undefined
  if (!tenantSlug) return { ok: false, res: Response.json({ error: 'missing_tenant' }, { status: 400 }) }
  let rawText = ''
  try {
    rawText = typeof req.text === 'function' ? await req.text() : ''
  } catch {
    rawText = ''
  }
  const v = await withVerifiedCommerceGateway({ req, tenantSlug, bodyBytes: Buffer.from(rawText ?? '', 'utf8') })
  if (!v.ok) return { ok: false, res: Response.json(v.body, { status: v.status }) }
  let body: unknown = null
  try {
    body = rawText ? JSON.parse(rawText) : null
  } catch {
    body = null
  }
  return { ok: true, tenantId: v.context.tenantId, body }
}

export const authEndpoints: Endpoint[] = [
  {
    path: '/commerce/store/:tenantSlug/auth/register',
    method: 'post',
    handler: async (req: PayloadRequest): Promise<Response> => {
      const a = await verifyAuth(req)
      if (!a.ok) return a.res
      if (!a.body) return Response.json({ error: 'invalid_input' }, { status: 400 })
      const { status, body: out } = await registerCustomer(req.payload, a.tenantId, a.body as any)
      return Response.json(out, { status })
    },
  },
  {
    path: '/commerce/store/:tenantSlug/auth/verify-email',
    method: 'post',
    handler: async (req: PayloadRequest): Promise<Response> => {
      const a = await verifyAuth(req)
      if (!a.ok) return a.res
      if (!a.body) return Response.json({ error: 'invalid_input' }, { status: 400 })
      const { status, body: out } = await verifyCustomerEmail(req.payload, String((a.body as any).token ?? ''))
      return Response.json(out, { status })
    },
  },
  {
    path: '/commerce/store/:tenantSlug/auth/resend-verification',
    method: 'post',
    handler: async (req: PayloadRequest): Promise<Response> => {
      const a = await verifyAuth(req)
      if (!a.ok) return a.res
      const email = a.body ? String((a.body as any).email ?? '') : ''
      const { status, body: out } = await resendVerification(req.payload, a.tenantId, email)
      return Response.json(out, { status })
    },
  },
  {
    path: '/commerce/store/:tenantSlug/auth/login',
    method: 'post',
    handler: async (req: PayloadRequest): Promise<Response> => {
      const a = await verifyAuth(req)
      if (!a.ok) return a.res
      if (!a.body) return Response.json({ error: 'invalid_input' }, { status: 400 })
      const { status, body: out } = await loginCustomer(req.payload, a.tenantId, a.body as any)
      return Response.json(out, { status })
    },
  },
  {
    path: '/commerce/store/:tenantSlug/auth/logout',
    method: 'post',
    handler: async (req: PayloadRequest): Promise<Response> => {
      const a = await verifyAuth(req)
      if (!a.ok) return a.res
      const token = req.headers.get('x-session-token') ?? ''
      const { status, body: out } = await logoutCustomer(req.payload, token)
      return Response.json(out, { status })
    },
  },
  {
    path: '/commerce/store/:tenantSlug/auth/me',
    method: 'get',
    handler: async (req: PayloadRequest): Promise<Response> => {
      const a = await verifyAuth(req)
      if (!a.ok) return a.res
      const token = req.headers.get('x-session-token')
      if (!token) return Response.json({ error: 'invalid_session' }, { status: 401 })
      const { status, body: out } = await readCustomerMe(req.payload, token, a.tenantId)
      return Response.json(out, { status })
    },
  },
  {
    path: '/commerce/store/:tenantSlug/auth/forgot-password',
    method: 'post',
    handler: async (req: PayloadRequest): Promise<Response> => {
      const a = await verifyAuth(req)
      if (!a.ok) return a.res
      const email = a.body ? String((a.body as any).email ?? '') : ''
      const { status, body: out } = await requestPasswordReset(req.payload, a.tenantId, email)
      return Response.json(out, { status })
    },
  },
  {
    path: '/commerce/store/:tenantSlug/auth/reset-password',
    method: 'post',
    handler: async (req: PayloadRequest): Promise<Response> => {
      const a = await verifyAuth(req)
      if (!a.ok) return a.res
      if (!a.body) return Response.json({ error: 'invalid_input' }, { status: 400 })
      const { status, body: out } = await resetPassword(req.payload, a.body as any)
      return Response.json(out, { status })
    },
  },
]
