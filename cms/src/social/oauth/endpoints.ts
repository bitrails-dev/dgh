// OAuth connect/callback/disconnect endpoints (Task D/E). Mounted globally at /api/social/*.
// All require an authenticated user who may manage the target tenant's socialPublishing settings
// (super-admin, or an assigned tenant admin). Tokens are encrypted before storage; plaintext never
// reaches the client. State is one-time + HMAC-signed (see oauth/state.ts).
import { randomBytes, createHash } from 'node:crypto'
import type { Endpoint, PayloadRequest } from 'payload'
import { getUserTenantIDs, isSuperAdmin } from '../../access/userAccess'
import { encryptToken, decryptToken, isSafeReturnPath } from '../crypto'
import { createOAuthState, consumeOAuthState } from './state'
import { findSelectionSession, consumeSession, drizzleConsume, releaseSession, type ConsumeFn } from './consume'
import { SOCIAL_PUBLISH_TASK_SLUG, SOCIAL_QUEUE } from '../jobs'
import { getOAuthProvider } from './providers'
import type { AccountTarget } from './providers'
import { envCredKeys, hasOAuth, platformLabel, platformMeta } from '../platforms'
import type { Platform } from '../types'

const redirectBase = (): string => (process.env.SOCIAL_REDIRECT_BASE || process.env.PAYLOAD_PUBLIC_SERVER_URL || '').replace(/\/+$/, '')

const clientCreds = (platform: Platform): { clientId: string; clientSecret: string } | null => {
  const keys = envCredKeys(platform)
  if (!keys) return null
  const clientId = process.env[keys[0]] || ''
  const clientSecret = process.env[keys[1]] || ''
  return clientId && clientSecret ? { clientId, clientSecret } : null
}

/** Super-admin or an admin assigned to the tenant may manage its social connections. */
const canManage = (req: PayloadRequest, tenantId: number | string): boolean =>
  isSuperAdmin(req.user) || getUserTenantIDs(req.user).map(String).includes(String(tenantId))

const json = (body: unknown, status: number) => Response.json(body, { status })

const SELECTION_TTL_MS = 5 * 60 * 1000

/** Upsert a connection by tenant+platform+remoteAccountId (the unique index). Tokens encrypted at rest. */
const storeConnection = async (
  req: PayloadRequest,
  tenantId: number | string,
  platform: Platform,
  target: AccountTarget,
): Promise<void> => {
  const encrypted = encryptToken(JSON.stringify(target.credentials))
  const existing = await req.payload.find({
    collection: 'social-connections',
    where: { and: [{ tenant: { equals: tenantId } }, { platform: { equals: platform } }, { remoteAccountId: { equals: target.remoteAccountId } }] },
    overrideAccess: true, limit: 1, req,
  })
  if (existing.docs[0]) {
    await req.payload.update({ collection: 'social-connections', id: existing.docs[0].id as number | string, data: { status: 'connected', encryptedTokens: encrypted, remoteAccountLabel: target.remoteAccountLabel, tokenExpiresAt: target.credentials.expiresAt || null, lastErrorCode: '' }, overrideAccess: true, req })
  } else {
    await req.payload.create({ collection: 'social-connections', data: { tenant: Number(tenantId), platform, remoteAccountId: target.remoteAccountId, remoteAccountLabel: target.remoteAccountLabel, status: 'connected', encryptedTokens: encrypted, tokenExpiresAt: target.credentials.expiresAt || null }, overrideAccess: true, req })
  }
}

const escapeHtml = (s: string): string =>
  s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string))

/** CSRF guard for state-changing POSTs (selection, retry, disconnect): a browser sends `Origin` on a
 *  same-origin POST; a cross-site forged request carries a different (or absent) origin and is rejected
 *  (fail closed). Compares the FULL origin (scheme + host + port), not just the host — a same-host
 *  http→https downgrade or a port change is a different origin and must be rejected. */
const isSameOrigin = (req: PayloadRequest): boolean => {
  const origin = req.headers?.get('origin') ?? req.headers?.get('referer')
  if (!origin) return false
  try {
    const selfUrl = req.url ? new URL(req.url) : (process.env.PAYLOAD_PUBLIC_SERVER_URL ? new URL(process.env.PAYLOAD_PUBLIC_SERVER_URL) : undefined)
    if (!selfUrl) return false
    return new URL(origin).origin === selfUrl.origin
  } catch {
    return false
  }
}

/** The selection POST, with the atomic-consume + compensating-release functions INJECTED so the
 *  win/lose + compensation decisions are fully unit-testable without a live database. Authorizes +
 *  validates the target BEFORE consuming, then exclusively consumes, then stores — and if storage
 *  fails after a won consume, releases the session (compensation) so no partially-consumed /
 *  partially-connected state remains. Concurrent calls produce exactly one winner. */
export async function performSelection(
  req: PayloadRequest,
  consume: ConsumeFn,
  release: (id: number | string) => Promise<void> = releaseSession(req),
): Promise<Response> {
  if (!req.user) return json({ error: 'Unauthorized' }, 401)
  if (!isSameOrigin(req)) return json({ error: 'Cross-origin request not allowed.' }, 403)
  const sessionKey = req.routeParams?.sessionKey as string | undefined
  if (!sessionKey) return json({ error: 'Missing session.' }, 400)
  const bodyText = typeof req.text === 'function' ? await req.text().catch(() => '') : ''
  const targetId = new URLSearchParams(bodyText).get('targetId')
  if (!targetId) return json({ error: 'A targetId is required.' }, 400)

  const f = await findSelectionSession(req.payload as never, sessionKey)
  if (f.status !== 'ok') return json({ error: `Selection session ${f.status === 'not_found' ? 'not found' : f.status}.` }, f.status === 'not_found' ? 404 : 410)
  if (!canManage(req, f.row!.tenant)) return json({ error: 'Forbidden.' }, 403)
  let targets: AccountTarget[]
  try { targets = JSON.parse(decryptToken(f.row!.encryptedCandidates) || '[]') } catch { return json({ error: 'Selection session is corrupt.' }, 410) }
  const target = targets.find((t) => t.remoteAccountId === targetId)
  if (!target) return json({ error: 'Unknown account selected.' }, 400) // tampered / stale id — no consume

  const won = await consumeSession(consume, f.row!.id)
  if (!won) return json({ error: 'Selection session already used.' }, 410) // a concurrent caller won

  try {
    await storeConnection(req, f.row!.tenant, f.row!.platform, target)
  } catch {
    // Compensation: this caller won the consume but the connection could not be stored. Release the
    // session so it is reusable — no partially-consumed (consumed with no connection) state remains.
    // A release error is best-effort and must not mask the storage failure.
    await release(f.row!.id).catch(() => {})
    return json({ error: 'Could not store the connection; the selection session was released. Please retry.' }, 500)
  }
  const safe = typeof f.row!.returnTo === 'string' && isSafeReturnPath(f.row!.returnTo) ? f.row!.returnTo : '/admin/collections/tenants'
  return Response.redirect(`${redirectBase()}${safe}`, 302)
}

export const socialEndpoints: Endpoint[] = [
  // GET /api/social/connect/:platform?tenant=<id>&returnTo=<path> → 302 to the provider auth URL.
  {
    path: '/social/connect/:platform',
    method: 'get',
    handler: async (req: PayloadRequest) => {
      if (!req.user) return json({ error: 'Unauthorized' }, 401)
      const platform = req.routeParams?.platform as Platform | undefined
      const tenant = req.searchParams?.get('tenant')
      const returnTo = req.searchParams?.get('returnTo') || undefined
      if (!platform) return json({ error: 'Unknown platform.' }, 400)
      // Tier-2 platforms have no OAuth flow yet — refuse with the precise reason (never fake connect).
      if (!hasOAuth(platform)) return json({ error: `${platformLabel(platform, 'en')} is not available: ${platformMeta(platform)?.approvalNote ?? 'not implemented.'}` }, 501)
      if (!tenant || !canManage(req, tenant)) return json({ error: 'Forbidden.' }, 403)
      const base = redirectBase()
      if (!base) return json({ error: 'SOCIAL_REDIRECT_BASE is not configured.' }, 500)
      const creds = clientCreds(platform)
      const provider = getOAuthProvider(platform)
      if (!creds || !provider) return json({ error: `${platform} is not configured. Set its client id/secret.` }, 503)
      if (returnTo && !isSafeReturnPath(returnTo)) return json({ error: 'Unsafe return path.' }, 400)

      const redirectUri = `${base}/api/social/callback/${platform}`
      // X uses OAuth 2.0 PKCE: generate a verifier (kept server-side in the session) + S256 challenge.
      let codeChallenge: string | undefined
      let codeVerifier: string | undefined
      if (provider.usePkce) {
        codeVerifier = randomBytes(32).toString('base64url')
        codeChallenge = createHash('sha256').update(codeVerifier).digest('base64url')
      }
      const state = await createOAuthState(req.payload as never, { tenantId: tenant, platform, returnTo, codeVerifier })
      const authUrl = provider.buildAuthUrl({ clientId: creds.clientId, redirectUri, state, codeChallenge })
      return Response.redirect(authUrl, 302)
    },
  },
  // GET /api/social/callback/:platform?code=&state= → verify, exchange, encrypt, store, redirect back.
  {
    path: '/social/callback/:platform',
    method: 'get',
    handler: async (req: PayloadRequest) => {
      if (!req.user) return json({ error: 'Unauthorized' }, 401)
      const platform = req.routeParams?.platform as Platform | undefined
      const code = req.searchParams?.get('code')
      const state = req.searchParams?.get('state')
      if (!platform || !code || !state) return json({ error: 'Missing code/state.' }, 400)
      const provider = getOAuthProvider(platform)
      const creds = clientCreds(platform)
      const base = redirectBase()
      if (!provider || !creds || !base) return json({ error: 'Social publishing is not configured.' }, 503)

      let tenantId: number | string
      let returnTo: string | undefined
      let codeVerifier: string | undefined
      try {
        const consumed = await consumeOAuthState(req.payload as never, state)
        tenantId = consumed.tenantId
        returnTo = consumed.returnTo
        codeVerifier = consumed.codeVerifier
      } catch (e) {
        return json({ error: `OAuth state rejected: ${(e as Error).message}` }, 400)
      }
      if (!canManage(req, tenantId)) return json({ error: 'Forbidden.' }, 403)

      try {
        const redirectUri = `${base}/api/social/callback/${platform}`
        const tokens = await provider.exchangeCode({ code, clientId: creds.clientId, clientSecret: creds.clientSecret, redirectUri, codeVerifier })
        if (!tokens.access_token) throw new Error('Provider did not return an access token.')
        const targets = await provider.listTargets({ tokens, clientId: creds.clientId, clientSecret: creds.clientSecret })
        if (!targets.length) throw new Error('No publishable accounts found for this platform.')

        if (targets.length === 1) {
          // Single target → complete the connection directly.
          await storeConnection(req, tenantId, platform, targets[0])
        } else {
          // Multiple targets → NEVER auto-pick. Persist a one-time selection session (candidates
          // AES-encrypted; tokens never sent to the browser) and let the user choose which account.
          const sessionKey = randomBytes(16).toString('hex')
          await req.payload.create({
            collection: 'social-oauth-states',
            data: { nonceHash: sessionKey, tenant: Number(tenantId), platform, expiresAt: new Date(Date.now() + SELECTION_TTL_MS).toISOString(), consumedAt: null, encryptedCandidates: encryptToken(JSON.stringify(targets)), returnTo: returnTo ?? null },
            overrideAccess: true, req,
          })
          return Response.redirect(`${base}/api/social/select/${sessionKey}`, 302)
        }
      } catch (e) {
        // Surface a sanitized error on the return page (no tokens).
        return Response.redirect(`${base}/admin?social_error=${encodeURIComponent(platform + ': ' + (e as Error).message)}`, 302)
      }

      return Response.redirect(`${base}${returnTo && isSafeReturnPath(returnTo) ? returnTo : '/admin/collections/tenants'}`, 302)
    },
  },
  // GET /api/social/select/:sessionKey → READ-ONLY: renders the candidate accounts (labels/ids only,
  // never tokens) as a form that POSTs the chosen targetId. Selection NEVER mutates via GET.
  {
    path: '/social/select/:sessionKey',
    method: 'get',
    handler: async (req: PayloadRequest) => {
      if (!req.user) return json({ error: 'Unauthorized' }, 401)
      const sessionKey = req.routeParams?.sessionKey as string | undefined
      if (!sessionKey) return json({ error: 'Missing session.' }, 400)
      const s = await findSelectionSession(req.payload as never, sessionKey)
      if (s.status !== 'ok') return json({ error: `Selection session ${s.status === 'not_found' ? 'not found' : s.status}.` }, s.status === 'not_found' ? 404 : 410)
      const row = s.row!
      if (!canManage(req, row.tenant)) return json({ error: 'Forbidden.' }, 403)
      let targets: AccountTarget[]
      try { targets = JSON.parse(decryptToken(row.encryptedCandidates) || '[]') } catch { return json({ error: 'Selection session is corrupt.' }, 410) }
      const items = targets.map((t) =>
        `<li><form method="POST" action="/api/social/select/${encodeURIComponent(sessionKey)}"><input type="hidden" name="targetId" value="${escapeHtml(t.remoteAccountId)}"/><button type="submit">${escapeHtml(t.remoteAccountLabel)}<span class="id">${escapeHtml(t.remoteAccountId)}</span></button></form></li>`,
      ).join('')
      const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Select account</title><style>body{font-family:system-ui,sans-serif;max-width:480px;margin:48px auto;padding:0 16px;color:#222}h1{font-size:18px}p{color:#57606a}li{list-style:none;margin:8px 0}form{margin:0}button{display:flex;justify-content:space-between;align-items:center;width:100%;padding:12px 14px;border:1px solid #d0d7de;border-radius:8px;background:#fff;color:#15504f;cursor:pointer;font:inherit}button:hover{background:#f6f8fa}.id{color:#8c959f;font-size:12px;font-family:monospace}</style></head><body><h1>Select a ${escapeHtml(platformLabel(row.platform, 'en'))} account</h1><p>Choose which account to connect for auto-publishing.</p><ul>${items}</ul></body></html>`
      return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8' } })
    },
  },
  // POST /api/social/select/:sessionKey (form field: targetId) → see performSelection: authorize +
  // validate the target, THEN atomically consume the one-time session and store the connection.
  // Same-origin enforced (CSRF); exactly one concurrent POST wins the compare-and-set.
  {
    path: '/social/select/:sessionKey',
    method: 'post',
    handler: async (req: PayloadRequest) => performSelection(req, drizzleConsume(req)),
  },
  // POST /api/social/disconnect { tenant, platform } → revoke provider creds where supported, then
  // delete the local connection. Providers with no revoke endpoint (FB/IG/LinkedIn) are reported as
  // `local_only` (operator must also revoke via the provider console). A FAILED revocation keeps the
  // local record so the operator can retry — we never claim revocation succeeded when it did not.
  {
    path: '/social/disconnect',
    method: 'post',
    handler: async (req: PayloadRequest) => {
      if (!req.user) return json({ error: 'Unauthorized' }, 401)
      if (!isSameOrigin(req)) return json({ error: 'Cross-origin request not allowed.' }, 403)
      const body = await req.json?.().catch(() => ({})) as { tenant?: number | string; platform?: Platform }
      const { tenant, platform } = body
      if (!tenant || !platform || !hasOAuth(platform)) return json({ error: 'tenant and a supported platform are required.' }, 400)
      if (!canManage(req, tenant)) return json({ error: 'Forbidden.' }, 403)
      const found = await req.payload.find({
        collection: 'social-connections',
        where: { and: [{ tenant: { equals: tenant } }, { platform: { equals: platform } }] },
        overrideAccess: true,
        limit: 1,
      })
      const conn = found.docs[0] as { id: number | string; encryptedTokens?: string } | undefined
      if (!conn) return json({ disconnected: true, revoked: 'absent' }, 200)

      const provider = getOAuthProvider(platform)
      if (provider?.revoke) {
        // Decrypt only to hand the provider its own credential; never return/log it.
        let creds: Record<string, string> = {}
        try { creds = JSON.parse(decryptToken(conn.encryptedTokens ?? '') || '{}') } catch { /* corrupt blob → nothing to revoke */ }
        try {
          const r = await provider.revoke({ credentials: creds })
          if (!r.revoked) {
            await req.payload.update({ collection: 'social-connections', id: conn.id, data: { status: 'error', lastErrorCode: r.errorCode ?? 'revoke_failed' }, overrideAccess: true, req }).catch(() => {})
            return json({ disconnected: false, revoked: 'failed', errorCode: r.errorCode ?? 'revoke_failed', message: 'Provider revocation failed; the local connection was kept so you can retry.' }, 502)
          }
        } catch {
          await req.payload.update({ collection: 'social-connections', id: conn.id, data: { status: 'error', lastErrorCode: 'revoke_error' }, overrideAccess: true, req }).catch(() => {})
          return json({ disconnected: false, revoked: 'failed', errorCode: 'revoke_error', message: 'Provider revocation errored; the local connection was kept so you can retry.' }, 502)
        }
      }
      // Revoked at the provider, OR no revoke endpoint (local_only): the local secret is removed.
      await req.payload.delete({ collection: 'social-connections', id: conn.id, overrideAccess: true, req })
      return json({ disconnected: true, revoked: provider?.revoke ? 'revoked' : 'local_only' }, 200)
    },
  },
  // POST /api/social/retry-publication { tenantId, articleId, platform } → re-enqueue ONE failed
  // publication through the durable social-publishing queue. runPublications only skips `published`,
  // so the existing failed record is re-attempted with attempt/audit history preserved (no new row).
  // Only `failed` records are retryable; the task's per-article exclusive concurrency + supersedes
  // collapse concurrent retries to at most one effective run.
  {
    path: '/social/retry-publication',
    method: 'post',
    handler: async (req: PayloadRequest) => {
      if (!req.user) return json({ error: 'Unauthorized' }, 401)
      if (!isSameOrigin(req)) return json({ error: 'Cross-origin request not allowed.' }, 403)
      const body = await req.json?.().catch(() => ({})) as { tenantId?: number | string; articleId?: number | string; platform?: Platform }
      const { tenantId, articleId, platform } = body
      if (!tenantId || !articleId || !platform || !platformMeta(platform)) return json({ error: 'tenantId, articleId, and a known platform are required.' }, 400)
      if (!canManage(req, tenantId)) return json({ error: 'Forbidden.' }, 403)
      const found = await req.payload.find({
        collection: 'social-publications',
        where: { and: [{ tenant: { equals: tenantId } }, { article: { equals: articleId } }, { platform: { equals: platform } }] },
        overrideAccess: true, limit: 1, req,
      })
      const pub = found.docs[0] as { status?: string } | undefined
      if (!pub) return json({ error: 'No publication record found for that article + platform.' }, 404)
      if (pub.status !== 'failed') return json({ error: `Only failed publications can be retried (current status: ${pub.status}).` }, 400)
      await req.payload.jobs.queue({ task: SOCIAL_PUBLISH_TASK_SLUG, input: { tenantId: Number(tenantId), articleId: Number(articleId), platforms: [platform] }, queue: SOCIAL_QUEUE, req })
      return json({ queued: true }, 200)
    },
  },
]
