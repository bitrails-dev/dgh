// Task 1/4: durable job core. Proves: the snapshot target list (captured at create) is acted on and
// is NEVER recomputed from mutable tenant settings; cancellation on a deleted/mismatched Article;
// transient → retry signal; permanent → no retry; retry re-runs never re-publish. No live DB/provider.
import assert from 'node:assert/strict'
import test from 'node:test'
import { encryptToken } from '../src/social/crypto'
import { runSocialPublishJob } from '../src/social/jobs'
import type { AdapterRegistry } from '../src/social/adapters'
import type { Platform, SocialAdapter } from '../src/social/types'

process.env.PAYLOAD_SECRET = 'jobs-test-secret'

const matchWhere = (doc: Record<string, unknown>, where: unknown): boolean => {
  if (!where || typeof where !== 'object') return true
  const w = where as Record<string, unknown>
  if (Array.isArray(w.and)) return (w.and as unknown[]).every((cl) => matchWhere(doc, cl))
  for (const [field, cond] of Object.entries(w)) {
    if (field === 'and' || field === 'or') continue
    if (cond && typeof cond === 'object' && 'equals' in (cond as Record<string, unknown>)) {
      if (String(doc[field]) !== String((cond as { equals: unknown }).equals)) return false
    }
  }
  return true
}

const makePayload = (stores: Record<string, Array<Record<string, unknown>>>) => ({
  async find({ collection, where, limit }: { collection: string; where?: unknown; limit?: number }) {
    let docs = (stores[collection] ?? []).filter((d) => matchWhere(d, where))
    if (limit) docs = docs.slice(0, limit)
    return { docs }
  },
  async findByID({ collection, id }: { collection: string; id: number | string }) {
    const doc = (stores[collection] ?? []).find((d) => String(d.id) === String(id))
    if (!doc) throw new Error('not found') // matches Payload Local API, which throws on miss
    return doc
  },
  async create({ collection, data }: { collection: string; data: Record<string, unknown> }) {
    const store = stores[collection] ?? (stores[collection] = [])
    const doc = { id: store.length + 1, ...data }
    store.push(doc)
    return doc
  },
  async update({ collection, id, data }: { collection: string; id: number | string; data: Record<string, unknown> }) {
    const store = stores[collection] ?? []
    const i = store.findIndex((d) => String(d.id) === String(id))
    if (i < 0) return { id, ...data }
    return Object.assign(store[i], data)
  },
})

const article = { id: 5, tenant: 7, slug: 'new-mri', title: { ar: 'جهاز رنين', en: 'New MRI' }, thumbnail: { url: '/mri.jpg' }, categoryRel: { name: { ar: 'أخبار', en: 'News' } }, content: [] }
const tenant = (sp: Record<string, unknown>) => ({ id: 7, name: { ar: 'مستشفى', en: 'Hospital' }, socialPublishing: sp })
const conn = (platform: string) => ({ id: 1, tenant: 7, platform, status: 'connected', encryptedTokens: encryptToken(JSON.stringify({ pageId: '1', accessToken: 'tok', igUserId: '1', authorUrn: 'urn:li:person:1' })) })

const adapter = (publish: SocialAdapter['publish'], platform: Platform = 'facebook'): SocialAdapter => ({
  platform, capabilities: { text: true, link: true, image: true, video: false }, publish,
})
const registry = (a: SocialAdapter): AdapterRegistry => ({ get: (p) => (p === a.platform ? a : undefined), platforms: () => [a.platform] })
const deps = (a: SocialAdapter, stores: Record<string, Array<Record<string, unknown>>>) => ({
  payload: makePayload(stores), adapters: registry(a), base: 'https://dgh.bitrail.dev', mediaBase: 'https://cms.dgh.bitrail.dev',
})
const baseStores = (included: Platform, a: SocialAdapter): Record<string, Array<Record<string, unknown>>> => ({
  articles: [article],
  tenants: [tenant({ enabled: true, includedPlatforms: [included] })],
  'social-connections': [conn(a.platform)],
})

test('snapshot targets win: input list is acted on even if tenant settings later disagree', async () => {
  let called = 0
  const a = adapter(async () => { called++; return { outcome: 'published', remoteId: 'fb_1' } })
  // tenant.includedPlatforms says instagram, but the create-time snapshot says facebook → facebook is published
  const stores = baseStores('instagram', a); stores['social-connections'] = [conn('facebook')]
  const { payload, adapters, base, mediaBase } = deps(a, stores)
  const r = await runSocialPublishJob({ payload, adapters, base, mediaBase }, { tenantId: 7, articleId: 5, platforms: ['facebook'] })
  assert.equal(r.queued, true)
  assert.equal(called, 1)
  assert.equal(stores['social-publications']![0].platform, 'facebook')
  assert.equal(stores['social-publications']![0].status, 'published')
})

test('unknown platform in the snapshot is dropped (validated against the catalogue)', async () => {
  const a = adapter(async () => ({ outcome: 'published', remoteId: 'x' }), 'facebook')
  const stores = baseStores('facebook', a)
  const { payload, adapters, base, mediaBase } = deps(a, stores)
  const r = await runSocialPublishJob({ payload, adapters, base, mediaBase }, { tenantId: 7, articleId: 5, platforms: ['facebook', 'not-a-real-platform' as Platform] })
  assert.equal(r.queued, true)
  assert.equal(stores['social-publications']!.length, 1)
  assert.equal(stores['social-publications']![0].platform, 'facebook')
})

test('empty snapshot → queued:false, nothing published', async () => {
  const a = adapter(async () => ({ outcome: 'published', remoteId: 'x' }))
  const stores = baseStores('facebook', a)
  const { payload, adapters, base, mediaBase } = deps(a, stores)
  const r = await runSocialPublishJob({ payload, adapters, base, mediaBase }, { tenantId: 7, articleId: 5, platforms: [] })
  assert.equal(r.queued, false)
  assert.equal((stores['social-publications'] ?? []).length, 0)
})

test('deleted Article → cancelled AND records an operator-visible per-platform cancellation row', async () => {
  const a = adapter(async () => ({ outcome: 'published', remoteId: 'x' }))
  const stores: Record<string, Array<Record<string, unknown>>> = { articles: [], tenants: [tenant({})], 'social-connections': [conn('facebook')] }
  const { payload, adapters, base, mediaBase } = deps(a, stores)
  const r = await runSocialPublishJob({ payload, adapters, base, mediaBase }, { tenantId: 7, articleId: 5, platforms: ['facebook'] })
  assert.equal(r.queued, false)
  assert.equal(r.cancelled, 'article_deleted')
  const pubs = stores['social-publications'] ?? []
  assert.equal(pubs.length, 1, 'one cancellation row per target')
  assert.equal(pubs[0].status, 'skipped')
  assert.equal(pubs[0].skippedReason, 'cancelled_article_deleted')
})

test('deleted Article with multiple targets → one cancellation row per target platform', async () => {
  const reg: AdapterRegistry = { get: () => undefined, platforms: () => ['facebook', 'x'] }
  const stores: Record<string, Array<Record<string, unknown>>> = { articles: [], tenants: [tenant({})], 'social-connections': [conn('facebook'), conn('x')] }
  const r = await runSocialPublishJob({ payload: makePayload(stores), adapters: reg, base: 'https://dgh.bitrail.dev', mediaBase: 'https://cms.dgh.bitrail.dev' }, { tenantId: 7, articleId: 5, platforms: ['facebook', 'x'] })
  assert.equal(r.cancelled, 'article_deleted')
  const pubs = stores['social-publications'] ?? []
  assert.equal(pubs.length, 2, 'one row per queued target')
  assert.deepEqual(pubs.map((p) => p.platform).sort(), ['facebook', 'x'])
  assert.ok(pubs.every((p) => p.status === 'skipped' && p.skippedReason === 'cancelled_article_deleted'))
})

test('Article moved to a different tenant → cancelled (fail closed) with a per-platform row', async () => {
  const a = adapter(async () => ({ outcome: 'published', remoteId: 'x' }))
  const stores: Record<string, Array<Record<string, unknown>>> = { articles: [{ ...article, tenant: 999 }], tenants: [tenant({})], 'social-connections': [conn('facebook')] }
  const { payload, adapters, base, mediaBase } = deps(a, stores)
  const r = await runSocialPublishJob({ payload, adapters, base, mediaBase }, { tenantId: 7, articleId: 5, platforms: ['facebook'] })
  assert.equal(r.cancelled, 'tenant_mismatch')
  const pubs = stores['social-publications'] ?? []
  assert.equal(pubs.length, 1)
  assert.equal(pubs[0].status, 'skipped')
  assert.equal(pubs[0].skippedReason, 'cancelled_tenant_mismatch')
})

test('transient failure → transientFailures lists the platform (handler will throw → bounded retry)', async () => {
  const a = adapter(async () => { throw new Error('connection reset') })
  const stores = baseStores('facebook', a)
  const { payload, adapters, base, mediaBase } = deps(a, stores)
  const r = await runSocialPublishJob({ payload, adapters, base, mediaBase }, { tenantId: 7, articleId: 5, platforms: ['facebook'] })
  assert.deepEqual(r.transientFailures, ['facebook'])
  assert.equal(stores['social-publications']![0].failureKind, 'transient')
})

test('permanent failure (401) → no retry signal; connection flagged reconnect_required', async () => {
  const a = adapter(async () => ({ outcome: 'failed', errorCode: 'fb_401', errorMessage: 'bad token', failureKind: 'permanent' }))
  const stores = baseStores('facebook', a)
  const { payload, adapters, base, mediaBase } = deps(a, stores)
  const r = await runSocialPublishJob({ payload, adapters, base, mediaBase }, { tenantId: 7, articleId: 5, platforms: ['facebook'] })
  assert.deepEqual(r.transientFailures, [])
  assert.equal(stores['social-connections']![0].status, 'reconnect_required')
})

test('retry re-run never re-publishes already-published platforms (idempotency across retries)', async () => {
  let called = 0
  const a = adapter(async () => { called++; return { outcome: 'published', remoteId: 'fb_1' } })
  const stores = baseStores('facebook', a)
  const { payload, adapters, base, mediaBase } = deps(a, stores)
  await runSocialPublishJob({ payload, adapters, base, mediaBase }, { tenantId: 7, articleId: 5, platforms: ['facebook'] })
  await runSocialPublishJob({ payload, adapters, base, mediaBase }, { tenantId: 7, articleId: 5, platforms: ['facebook'] })
  assert.equal(called, 1)
  assert.equal(stores['social-publications']!.length, 1)
})

test('publish locale follows the Article content (en-only → en, bilingual → ar)', async () => {
  // Round-3: the worker no longer hardcodes 'ar'; it derives the locale from the reloaded Article's
  // populated title. An English-only Article publishes in English; a bilingual one uses the site default.
  let locale: string | undefined
  const a = adapter(async (input) => { locale = input.locale; return { outcome: 'published', remoteId: 'x' } })
  const enStores: Record<string, Array<Record<string, unknown>>> = { articles: [{ ...article, title: { en: 'New MRI' } }], tenants: [tenant({ enabled: true, includedPlatforms: ['facebook'] })], 'social-connections': [conn('facebook')] }
  const d1 = deps(a, enStores)
  await runSocialPublishJob({ payload: d1.payload, adapters: d1.adapters, base: d1.base, mediaBase: d1.mediaBase }, { tenantId: 7, articleId: 5, platforms: ['facebook'] })
  assert.equal(locale, 'en')
  assert.equal(enStores['social-publications']![0].locale, 'en')

  locale = undefined
  const biStores = baseStores('facebook', a)
  const d2 = deps(a, biStores)
  await runSocialPublishJob({ payload: d2.payload, adapters: d2.adapters, base: d2.base, mediaBase: d2.mediaBase }, { tenantId: 7, articleId: 5, platforms: ['facebook'] })
  assert.equal(locale, 'ar')
})
