// withVerifiedCommerceGateway — the SINGLE helper permitted `overrideAccess: true` for guest commerce
// operations (Plan §3.2). It is the trust boundary every signed CMS store request crosses before any
// Local API write:
//
//   1. verify() the commerce-gateway signature/timestamp/nonce over the RAW body bytes (reject before
//      parse) using the SQL NonceRepo (replay ledger) + env-resolved current/previous keys;
//   2. resolve the signed tenant slug → tenant id (and confirm the tenant has the `commerce` feature);
//   3. authenticate the optional customer (a Payload session on req.user, if present);
//   4. stash the resolved tenant id on req.commerceTenantID / req.tenantID — the seam the D1/D2 payment
//      adapters read via their `tenantIdResolver` default;
//   5. return the resolved context `{ tenantId, customerId? }`.
//
// Cart/customer OWNERSHIP is then enforced by the orchestration's tenant-scoped Local API re-read of
// the cart (a cart id that does not belong to the resolved tenant simply is not found → 404/403), the
// same pattern the D1/D2 adapters use internally. Unsigned calls get 401/403 and perform no write.
//
// Provider webhook paths (/api/payments/paymob|kashier) are gateway-EXEMPT (Plan §4.2): they never go
// through this helper; they verify the provider signature in webhook.ts.

import type { Payload, PayloadRequest } from 'payload'
import {
  verify,
  resolveKeysFromEnv,
  GatewayKeyError,
  type KeyResolverResult,
  type NonceRepo,
  type VerifyResult,
} from '../gateway'
import { createSqlNonceRepo } from '../gateway/nonce-sql'
import { resolveStoreTenant } from './shared'

export interface VerifiedCommerceContext {
  tenantId: number | string
  /** Resolved Payload customer id when a session is present; undefined for guest checkout. */
  customerId?: number | string
}

export type GatewayVerification =
  | { ok: true; context: VerifiedCommerceContext }
  | { ok: false; status: number; body: Record<string, unknown> }

export interface VerifyGatewayArgs {
  req: PayloadRequest
  /** Lowercase tenant slug derived from the URL (req.routeParams.tenantSlug). */
  tenantSlug: string
  /** Raw request body bytes — hashed BEFORE any JSON parse. */
  bodyBytes: Uint8Array | Buffer
  /** Injectable keys (defaults to resolveKeysFromEnv() at call time). Tests pass a fixed pair. */
  keys?: KeyResolverResult
  /** Injectable NonceRepo (defaults to the SQL repo against commerce_gateway_nonces). Tests pass an
   * in-memory repo. */
  nonceRepo?: NonceRepo
}

// verify() reason → HTTP status. Missing/unknown key is an authentication problem (401); every other
// rejection (timestamp/nonce/signature/replay) is a forbidden request (403). Either way: no write.
function rejectStatus(result: Extract<VerifyResult, { ok: false }>): { status: number; body: Record<string, unknown> } {
  if (result.reason === 'missing_header' || result.reason === 'unknown_key_id') {
    return { status: 401, body: { error: 'unauthorized', reason: result.reason } }
  }
  return { status: 403, body: { error: 'forbidden', reason: result.reason } }
}

// Read the request method/path/query from the Payload request in a host-agnostic way. Payload's
// `req.path` carries the URL path; the canonical path/query is rebuilt inside verify() from these.
function requestTarget(req: PayloadRequest): { method: string; path: string; query: string | null } {
  const method = (req.method ?? 'GET').toUpperCase()
  const rawPath = (req as PayloadRequest & { path?: string; url?: string }).path
    ?? (req as PayloadRequest & { url?: string }).url
    ?? ''
  // Split path from query so verify() rebuilds the canonical form. `req.path` is path-only on Payload
  // (no query); `req.url` may carry a query. We pass whatever query string we can find, or null.
  const [path, query] = String(rawPath).split('?')
  return { method, path, query: query ?? null }
}

/**
 * Verify the commerce-gateway signature on a signed store request and resolve the tenant context.
 * Mutates `req` to stash the resolved tenant id (the adapter seam). Returns a discriminated result;
 * the caller turns `{ok:false}` into the HTTP response unchanged.
 */
export async function withVerifiedCommerceGateway(
  args: VerifyGatewayArgs,
): Promise<GatewayVerification> {
  const { req, tenantSlug, bodyBytes } = args

  let keys: KeyResolverResult
  try {
    keys = args.keys ?? resolveKeysFromEnv()
  } catch (err) {
    // Misconfigured gateway secrets (missing/short) — fail closed. 503: the server is not ready to
    // accept signed commerce until the operator provisions COMMERCE_GATEWAY_*.
    const message = err instanceof GatewayKeyError ? err.message : 'gateway key resolution failed'
    return { ok: false, status: 503, body: { error: 'gateway_misconfigured', detail: message } }
  }

  const nonceRepo: NonceRepo = args.nonceRepo ?? createSqlNonceRepo(req.payload)
  const target = requestTarget(req)

  const result = await verify({
    method: target.method,
    path: target.path,
    query: target.query,
    tenantSlug,
    bodyBytes,
    headers: req.headers as unknown as Record<string, string | string[] | undefined>,
    currentKeys: keys.current,
    previousKeys: keys.previous,
    now: Date.now(),
    nonceRepo,
  })
  if (!result.ok) return { ok: false, ...rejectStatus(result) }

  // Signature verified → resolve the signed tenant slug to a tenant id and confirm commerce is on.
  const tenant = await resolveStoreTenant(req.payload, tenantSlug)
  if (!tenant) return { ok: false, status: 404, body: { error: 'not_found' } }

  // Stash the resolved tenant on every seam the adapters / orchestration read. This is the ONLY place
  // guest commerce operations get a trusted tenant identity; downstream code must not trust a
  // browser-supplied tenant id.
  const reqWithTenant = req as PayloadRequest & {
    commerceTenantID?: string | number
    tenantID?: string | number
  }
  reqWithTenant.commerceTenantID = tenant.id
  reqWithTenant.tenantID = tenant.id

  // Optional customer: a Payload session on req.user (customers collection). Absent for guest checkout.
  const user = (req as PayloadRequest & { user?: { id?: unknown; collection?: string } }).user
  const customerId =
    user && user.id !== undefined ? (user.id as number | string) : undefined

  return { ok: true, context: { tenantId: tenant.id, customerId } }
}
