// The publish core (Task D/E). Loads an Article + its Tenant, and for each target platform:
// resolves the connection, decrypts the token, builds the PublishInput, calls the adapter, and
// writes the idempotent social-publications record + the connection's last-publish status.
//
// It is deliberately a plain function that takes its dependencies (payload, fetch, adapter
// registry, bases, clock) so it is fully unit-testable with mocks — no live DB, no live provider.
// The durable Payload job task (`./jobs`) calls this; it returns the platforms that ended in a
// TRANSIENT failure so the task can request a bounded retry. Failures never throw into the caller.
import { decryptToken, encryptToken } from './crypto'
import { isReconnectRequired } from './decide'
import { buildPublishInput, canonicalPublishHash } from './content'
import type { AdapterRegistry } from './adapters'
import type { Locale, Platform, PublishResult, PublishInput, ProviderConnection, TokenRefresher } from './types'

// Minimal Payload Local-API surface used here. Kept structural so tests can pass a fake.
export interface PayloadLike {
  find: (a: { collection: string; where?: unknown; limit?: number; overrideAccess?: boolean; depth?: number }) => Promise<{ docs: Array<Record<string, unknown>> }>
  findByID: (a: { collection: string; id: number | string; depth?: number; overrideAccess?: boolean; locale?: string }) => Promise<Record<string, unknown>>
  create: (a: { collection: string; data: Record<string, unknown>; overrideAccess?: boolean }) => Promise<Record<string, unknown>>
  update: (a: { collection: string; id: number | string; data: Record<string, unknown>; overrideAccess?: boolean }) => Promise<Record<string, unknown>>
}

export interface PublishDeps {
  payload: PayloadLike
  adapters: AdapterRegistry
  fetch?: typeof fetch
  /** Public site base for the canonical article URL. */
  base: string
  /** Public media base for resolving relative image URLs. */
  mediaBase: string
  /** Per-platform token refreshers (X/TikTok/Threads short-lived tokens). Optional; absent in tests
   *  that don't exercise refresh. */
  refreshers?: { get(platform: Platform): TokenRefresher | undefined }
  now?: () => string
}

export interface PublishArgs {
  articleId: number | string
  tenantId: number | string
  platforms: Platform[]
  locale: Locale
}

const and = (...clauses: unknown[]) => ({ and: clauses })

/** Per-platform publish. Idempotent: a previously `published` record is never re-published. */
async function publishOne(deps: PublishDeps, ctx: {
  article: Record<string, unknown>
  tenant: Record<string, unknown>
  platform: Platform
  locale: Locale
}): Promise<{ transient: boolean }> {
  const { payload, adapters, base, mediaBase, now } = deps
  const { article, tenant, platform, locale } = ctx
  const articleId = article.id as number | string
  const tenantId = tenant.id as number | string
  const ts = (deps.now ?? (() => new Date().toISOString()))()

  const existing = await payload.find({
    collection: 'social-publications',
    where: and({ article: { equals: articleId } }, { platform: { equals: platform } }),
    overrideAccess: true,
    limit: 1,
  })
  let pub = existing.docs[0]
  // Idempotency: once published, never re-publish (re-save/update must not duplicate).
  if (pub?.status === 'published') return { transient: false }

  const input: PublishInput = buildPublishInput(article as never, {
    tenantId, articleId, platform, locale, base, mediaBase, tenantName: tenant.name,
  })
  // Hash of the post-affecting payload, captured at the first attempt and preserved across retries
  // (content drift after enqueue is a new event, not a silent retry of changed content).
  const payloadHash = canonicalPublishHash(input)

  // One record per article+platform. Create it once (if absent) carrying the payload hash, then
  // update in place so processing → final lands on the same row (the unique index guarantees this).
  const ensure = async () => {
    if (pub) return pub
    pub = await payload.create({
      collection: 'social-publications',
      data: { tenant: tenantId, article: articleId, platform, locale, status: 'pending', attempts: 0, payloadHash },
      overrideAccess: true,
    })
    return pub
  }
  const setPub = async (data: Record<string, unknown>) => {
    await ensure()
    pub = await payload.update({ collection: 'social-publications', id: pub.id as number | string, data, overrideAccess: true })
  }
  const nextAttempt = () => ((pub?.attempts as number) ?? 0) + 1

  const adapter = adapters.get(platform)

  const connFound = await payload.find({
    collection: 'social-connections',
    where: and({ tenant: { equals: tenantId } }, { platform: { equals: platform } }, { status: { equals: 'connected' } }),
    overrideAccess: true,
    limit: 1,
  })
  const conn = connFound.docs[0]

  if (!conn) {
    await setPub({ status: 'skipped', skippedReason: 'not_connected' })
    return { transient: false }
  }
  if (!adapter) {
    await setPub({ status: 'skipped', skippedReason: 'platform_not_implemented' })
    return { transient: false }
  }

  let credentials: Record<string, string>
  try {
    credentials = JSON.parse(decryptToken(conn.encryptedTokens as string) || '{}')
  } catch {
    await setPub({ status: 'failed', errorCode: 'token_decrypt_failed', failureKind: 'permanent', attempts: nextAttempt() })
    // An undecryptable token is unusable (key rotated / corrupt) — flag the connection for reconnect.
    await payload.update({ collection: 'social-connections', id: conn.id as number | string, data: { status: 'reconnect_required', lastPublishStatus: 'failed', lastPublishAt: ts, lastErrorCode: 'token_decrypt_failed' }, overrideAccess: true }).catch(() => { /* best-effort */ })
    return { transient: false }
  }

  // Refresh a near-expiry token just-in-time when the provider supports it (X/TikTok short-lived
  // tokens). Persist the refreshed credentials so the next publish reuses them. Non-fatal on failure:
  // fall through with the existing token and let the adapter 401 → reconnect_required.
  const refresher = deps.refreshers?.get(platform)
  if (refresher && credentials.refreshToken) {
    const exp = credentials.expiresAt ? Date.parse(credentials.expiresAt) : 0
    const nearExpiry = !exp || exp - Date.now() < 5 * 60 * 1000 // refresh within 5 min of expiry, or when expiry is unknown
    if (nearExpiry) {
      try {
        const r = await refresher({ credentials, fetch: deps.fetch })
        credentials = { ...credentials, ...r.credentials }
        await payload.update({ collection: 'social-connections', id: conn.id as number | string, data: { encryptedTokens: encryptToken(JSON.stringify(credentials)), tokenExpiresAt: r.expiresAt ?? null }, overrideAccess: true }).catch(() => { /* best-effort persist */ })
      } catch { /* refresh failed → use the existing token; adapter will 401 if truly expired */ }
    }
  }

  // Re-stamp the hash on EVERY attempt (not just create): the input above was built from the
  // current Article, so the record must reflect the content actually published this attempt.
  // A retry that re-publishes drifted content updates the hash to match — no stale-hash-on-retry.
  await setPub({ status: 'processing', attempts: nextAttempt(), payloadHash })

  let result: PublishResult
  try {
    const providerConn: ProviderConnection = { platform, credentials }
    result = await adapter.publish(input, providerConn, { fetch: deps.fetch })
  } catch (e) {
    result = { outcome: 'failed', errorCode: 'network', errorMessage: String((e as Error)?.message ?? e), failureKind: 'transient' }
  }

  await setPub(publicationFields(result))
  // Best-effort: reflect the sanitized last result on the connection (no tokens). An auth/scope
  // failure flips the connection to reconnect_required so the panel can prompt a re-connect.
  const reconnectRequired = isReconnectRequired(result)
  await payload.update({
    collection: 'social-connections',
    id: conn.id as number | string,
    data: {
      ...(reconnectRequired ? { status: 'reconnect_required' } : {}),
      lastPublishStatus: result.outcome,
      lastPublishAt: ts,
      lastPublishUrl: result.remoteUrl ?? '',
      lastErrorCode: result.errorCode ?? '',
    },
    overrideAccess: true,
  }).catch(() => { /* a failed status update must not fail the publish */ })
  return { transient: result.outcome === 'failed' && result.failureKind === 'transient' }
}

function publicationFields(r: PublishResult): Record<string, unknown> {
  if (r.outcome === 'published') {
    return { status: 'published', remoteId: r.remoteId ?? '', remoteUrl: r.remoteUrl ?? '', errorCode: '', errorMessage: '', failureKind: '', skippedReason: '' }
  }
  if (r.outcome === 'skipped') {
    return { status: 'skipped', skippedReason: r.skippedReason ?? '', errorCode: '', failureKind: '', remoteId: '', remoteUrl: '' }
  }
  return { status: 'failed', errorCode: r.errorCode ?? 'unknown', errorMessage: r.errorMessage ?? '', failureKind: r.failureKind ?? 'permanent', remoteId: '', remoteUrl: '' }
}

/** Publish one article to the given platforms. Never throws — all failures are recorded. Returns the
 *  platforms that ended in a TRANSIENT failure so the durable job task can request a bounded retry;
 *  permanent failures and explicit skips are terminal. */
export async function runPublications(deps: PublishDeps, args: PublishArgs): Promise<{ transientFailures: Platform[] }> {
  const { payload } = deps
  const article = await payload.findByID({ collection: 'articles', id: args.articleId, depth: 2, overrideAccess: true, locale: 'all' })
  const tenant = await payload.findByID({ collection: 'tenants', id: args.tenantId, depth: 1, overrideAccess: true, locale: 'all' })
  const transientFailures: Platform[] = []
  for (const platform of args.platforms) {
    try {
      const r = await publishOne(deps, { article, tenant, platform, locale: args.locale })
      if (r.transient) transientFailures.push(platform)
    } catch {
      // An unexpected throw is infra-level → treat as transient so the durable job retries. A
      // failure on one platform must never block the others or propagate to the caller.
      transientFailures.push(platform)
    }
  }
  return { transientFailures }
}
