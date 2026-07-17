// Durable social-publishing job. The Article create hook enqueues ONE job on the `social-publishing`
// queue carrying stable IDs + the deterministic target-platform list captured at create time. A
// worker drains the queue and delegates to runPublications. The worker NEVER adds targets because
// tenant settings/connections changed after enqueue — it acts only on the snapshot, after reloading
// the Article (cancelled cleanly if deleted or no longer belonging to the queued tenant).
//
// Retry: the handler throws ONLY on transient failure (429/5xx/network) → bounded exponential retry.
// Permanent failures and explicit skips complete (succeeded). Per-article+platform idempotency is the
// [article, platform] unique index, so a retry re-runs harmlessly (published rows are skipped).
import type { TaskConfig } from 'payload'
import { runPublications } from './job'
import type { PayloadLike } from './job'
import type { AdapterRegistry } from './adapters'
import { defaultAdapterRegistry } from './adapters'
import { envCredKeys, platformMeta } from './platforms'
import { OAUTH_PROVIDERS } from './oauth/providers'
import type { Locale, Platform, TokenRefresher } from './types'

export const SOCIAL_QUEUE = 'social-publishing'

const trim = (s: string): string => s.replace(/\/+$/, '')
const siteBase = (): string => trim(process.env.SOCIAL_SITE_URL || process.env.PAYLOAD_PUBLIC_SERVER_URL || '')
const mediaBase = (): string => trim(process.env.SOCIAL_MEDIA_BASE || siteBase())

export const SOCIAL_PUBLISH_TASK_SLUG = 'social-publish-article'

/** Per-platform token refreshers bound to the OAuth providers + env client credentials. X/TikTok have
 *  short-lived access tokens; this refreshes them just-in-time before publish so connections don't
 *  silently expire into reconnect-required. Providers without a refresh method (FB/IG/LinkedIn/YouTube)
 *  return undefined → no refresh. */
const defaultRefreshers = {
  get: (platform: Platform): TokenRefresher | undefined => {
    const provider = OAUTH_PROVIDERS[platform]
    if (!provider?.refresh) return undefined
    const keys = envCredKeys(platform)
    const clientId = keys ? (process.env[keys[0]] || '') : ''
    const clientSecret = keys ? (process.env[keys[1]] || '') : ''
    return (opts: { credentials: Record<string, string>; fetch?: typeof fetch }) =>
      provider.refresh!({ ...opts, clientId, clientSecret })
  },
}

export interface SocialPublishJobDeps {
  payload: PayloadLike
  adapters: AdapterRegistry
  fetch?: typeof fetch
  base: string
  mediaBase: string
  refreshers?: { get(platform: Platform): TokenRefresher | undefined }
}

/**
 * The job core, dependency-injected so it is fully unit-testable. Acts ONLY on the snapshot target
 * list captured at create time (validated against the catalogue); targets are never recomputed from
 * mutable tenant settings/connections. Reloads the Article to cancel cleanly if it was deleted or no
 * longer belongs to the queued tenant. Returns the platforms that ended TRANSIENT so the task wrapper
 * can throw to request a bounded retry.
 */
/** One operator-visible cancellation row per queued target platform, so a deleted/moved Article does
 *  not silently vanish from the publications table. Reuses the existing `skipped` status + a precise
 *  reason — no schema/migration change. Best-effort: a create error (e.g. a pre-existing row from the
 *  unique [article,platform] index, or a transient DB error) is isolated. */
const recordCancellation = async (
  payload: PayloadLike,
  input: { tenantId: number | string; articleId: number | string; platforms: Platform[] },
  reason: 'cancelled_article_deleted' | 'cancelled_tenant_mismatch',
): Promise<void> => {
  for (const platform of input.platforms) {
    await payload.create({
      collection: 'social-publications',
      data: { tenant: Number(input.tenantId), article: Number(input.articleId), platform, status: 'skipped', skippedReason: reason, attempts: 0 },
      overrideAccess: true,
    }).catch(() => { /* a pre-existing row or DB error is isolated, not fatal */ })
  }
}

/** Pick the publish locale from the reloaded Article's populated title: an English-only Article
 *  publishes in English; otherwise the Arabic site default. (A per-Tenant locale field is the proper
 *  long-term fix — none exists on Tenants today.) */
const deriveLocale = (article: { title?: unknown }): Locale => {
  const t = article.title
  const has = (loc: Locale): boolean => !!t && typeof t === 'object'
    && typeof (t as Record<string, unknown>)[loc] === 'string'
    && !!((t as Record<string, unknown>)[loc])
  return has('en') && !has('ar') ? 'en' : 'ar'
}

export async function runSocialPublishJob(
  deps: SocialPublishJobDeps,
  input: { tenantId: number | string; articleId: number | string; platforms: Platform[] },
): Promise<{ queued: boolean; cancelled?: string; transientFailures: Platform[] }> {
  // Deterministic snapshot from the create event, validated against the shared catalogue.
  const targets = input.platforms.filter((p): p is Platform => platformMeta(p) !== undefined)
  if (!targets.length) return { queued: false, transientFailures: [] }

  // Cancellation: a deleted Article, or one that no longer belongs to the queued tenant, stops cleanly
  // AND records an operator-visible per-platform outcome (no silent drop from the publications table).
  const article = await deps.payload.findByID({
    collection: 'articles', id: input.articleId, depth: 0, overrideAccess: true, locale: 'all',
  }).catch(() => null) as { tenant?: unknown; title?: unknown } | null
  if (!article) {
    await recordCancellation(deps.payload, { tenantId: input.tenantId, articleId: input.articleId, platforms: targets }, 'cancelled_article_deleted')
    return { queued: false, cancelled: 'article_deleted', transientFailures: [] }
  }
  if (String(article.tenant ?? '') !== String(input.tenantId)) {
    await recordCancellation(deps.payload, { tenantId: input.tenantId, articleId: input.articleId, platforms: targets }, 'cancelled_tenant_mismatch')
    return { queued: false, cancelled: 'tenant_mismatch', transientFailures: [] }
  }

  const { transientFailures } = await runPublications(
    { payload: deps.payload, adapters: deps.adapters, fetch: deps.fetch, base: deps.base, mediaBase: deps.mediaBase, refreshers: deps.refreshers },
    { articleId: input.articleId, tenantId: input.tenantId, platforms: targets, locale: deriveLocale(article) },
  )
  return { queued: true, transientFailures }
}

export const socialPublishTask: TaskConfig<any> = {
  slug: SOCIAL_PUBLISH_TASK_SLUG,
  // Bounded retry: up to 6 attempts, exponential backoff (≈5s → 10s → 20s → 40s → 80s → 160s).
  retries: { attempts: 6, backoff: { type: 'exponential', delay: 5000 } },
  // Per-article exclusivity (one in-flight job per Article) WITHOUT supersession: a newer enqueue
  // queues behind a running job rather than replacing a pending one. The [article,platform] unique
  // index still dedups same-platform work, and — unlike `supersedes: true` — two different-platform
  // retries for the same Article no longer silently drop each other.
  concurrency: {
    key: ({ input }) => `article:${(input as { articleId: number | string }).articleId}`,
    exclusive: true,
  },
  inputSchema: [
    { name: 'tenantId', type: 'number', required: true },
    { name: 'articleId', type: 'number', required: true },
    // Deterministic target-platform snapshot captured at create time (validated against the catalogue).
    { name: 'platforms', type: 'json' },
  ],
  handler: async ({ input, req }) => {
    const base = siteBase()
    if (!base) throw new Error('SOCIAL_SITE_URL is not configured') // transient infra config → retry
    const { queued, cancelled, transientFailures } = await runSocialPublishJob(
      { payload: req.payload as unknown as PayloadLike, adapters: defaultAdapterRegistry, base, mediaBase: mediaBase(), refreshers: defaultRefreshers },
      input as { tenantId: number; articleId: number; platforms: Platform[] },
    )
    if (transientFailures.length) {
      throw new Error(`transient publish failures: ${transientFailures.join(', ')}`)
    }
    return { output: { queued, cancelled } }
  },
}
