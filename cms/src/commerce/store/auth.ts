// Customer auth HTTP endpoints for the store (/api/commerce/store/:tenantSlug/auth/*). Thin handlers
// over the tenant-aware Payload-auth wrappers in commerce/customers/payload-auth (plan §3.6). The
// tenant is resolved from the URL slug → 404 when missing or without the `commerce` feature.
//
// Password hashing, sessions, verification and reset tokens are owned by Payload's local auth
// strategy. register/reset return a server-only `verificationToken` / `token` in the body for the
// trusted Astro gateway to consume (set the auth cookie; dispatch the SMTP email). The gateway strips
// those fields before forwarding to the browser — that stripping is wired in the B4 gateway pass.
// Commerce stays disabled for all tenants until every release gate passes (plan §0.11).
import type { Endpoint, Payload, PayloadRequest } from 'payload'
import { resolveStoreTenant, readJsonBody } from './shared'
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
      const { status, body: out } = await registerCustomer(req.payload, tenant.id, body as any)
      return Response.json(out, { status })
    },
  },
  {
    path: '/commerce/store/:tenantSlug/auth/verify-email',
    method: 'post',
    handler: async (req: PayloadRequest): Promise<Response> => {
      const body = await readJsonBody(req)
      if (!body) return Response.json({ error: 'invalid_input' }, { status: 400 })
      const { status, body: out } = await verifyCustomerEmail(req.payload, String((body as any).token ?? ''))
      return Response.json(out, { status })
    },
  },
  {
    path: '/commerce/store/:tenantSlug/auth/resend-verification',
    method: 'post',
    handler: async (req: PayloadRequest): Promise<Response> => {
      const tenant = await resolveOr404(req.payload, req.routeParams?.tenantSlug as string | undefined)
      if (tenant instanceof Response) return tenant
      const body = await readJsonBody(req)
      const email = body ? String((body as any).email ?? '') : ''
      const { status, body: out } = await resendVerification(req.payload, tenant.id, email)
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
      const { status, body: out } = await loginCustomer(req.payload, tenant.id, body as any)
      return Response.json(out, { status })
    },
  },
  {
    path: '/commerce/store/:tenantSlug/auth/logout',
    method: 'post',
    handler: async (req: PayloadRequest): Promise<Response> => {
      const token = req.headers.get('x-session-token') ?? ''
      const { status, body: out } = await logoutCustomer(req.payload, token)
      return Response.json(out, { status })
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
      const { status, body: out } = await readCustomerMe(req.payload, token, tenant.id)
      return Response.json(out, { status })
    },
  },
  {
    path: '/commerce/store/:tenantSlug/auth/forgot-password',
    method: 'post',
    handler: async (req: PayloadRequest): Promise<Response> => {
      const tenant = await resolveOr404(req.payload, req.routeParams?.tenantSlug as string | undefined)
      if (tenant instanceof Response) return tenant
      const body = await readJsonBody(req)
      const email = body ? String((body as any).email ?? '') : ''
      const { status, body: out } = await requestPasswordReset(req.payload, tenant.id, email)
      return Response.json(out, { status })
    },
  },
  {
    path: '/commerce/store/:tenantSlug/auth/reset-password',
    method: 'post',
    handler: async (req: PayloadRequest): Promise<Response> => {
      const body = await readJsonBody(req)
      if (!body) return Response.json({ error: 'invalid_input' }, { status: 400 })
      const { status, body: out } = await resetPassword(req.payload, body as any)
      return Response.json(out, { status })
    },
  },
]
