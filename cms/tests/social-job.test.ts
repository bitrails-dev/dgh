// Task D/E publish core: runPublications against a mock payload + mock adapters. Proves idempotency,
// not-connected / not-implemented skips, success → publication + connection update, and failure
// isolation — without a live DB or provider.
import assert from 'node:assert/strict'
import test from 'node:test'
import { decryptToken, encryptToken } from '../src/social/crypto'
import { runPublications } from '../src/social/job'
import { canonicalPublishHash } from '../src/social/content'
import type { AdapterRegistry } from '../src/social/adapters'
import type { Platform, PublishInput, PublishResult, SocialAdapter } from '../src/social/types'

process.env.PAYLOAD_SECRET = 'job-test-secret'

// --- minimal in-memory payload + where matcher (handles {and:[...]}, {field:{equals:x}}) ---
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
    return (stores[collection] ?? []).find((d) => String(d.id) === String(id)) ?? {}
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

const article = { id: 5, slug: 'new-mri', title: { ar: 'جهاز رنين', en: 'New MRI' }, thumbnail: { url: '/mri.jpg' }, categoryRel: { name: { ar: 'أخبار', en: 'News' } }, content: [] }
const tenant = { id: 7, name: { ar: 'مستشفى دمياط', en: 'Dumyat Hospital' } }

const pubOf = (stores: Record<string, Array<Record<string, unknown>>>) => (stores['social-publications'] ?? [])[0]
const connOf = (stores: Record<string, Array<Record<string, unknown>>>) => (stores['social-connections'] ?? [])[0]

const baseDeps = (adapters: AdapterRegistry, stores: Record<string, Array<Record<string, unknown>>>) => ({
  payload: makePayload(stores), adapters, base: 'https://dgh.bitrail.dev', mediaBase: 'https://cms.dgh.bitrail.dev', now: () => '2026-07-16T00:00:00Z',
})

test('no connection → publication skipped(not_connected); adapter not called', async () => {
  let called = false
  const adapters: AdapterRegistry = { get: () => ({ platform: 'facebook', capabilities: { text: true, link: true, image: true, video: false }, async publish() { called = true; return { outcome: 'published', remoteId: 'x' } } }), platforms: () => ['facebook'] }
  const stores: Record<string, Array<Record<string, unknown>>> = { articles: [article], tenants: [tenant], 'social-connections': [] }
  await runPublications(baseDeps(adapters, stores), { articleId: 5, tenantId: 7, platforms: ['facebook'], locale: 'ar' })
  assert.equal(called, false)
  assert.equal(pubOf(stores).status, 'skipped')
  assert.equal(pubOf(stores).skippedReason, 'not_connected')
})

test('platform has no adapter → skipped(platform_not_implemented)', async () => {
  const adapters: AdapterRegistry = { get: () => undefined, platforms: () => [] }
  const stores: Record<string, Array<Record<string, unknown>>> = {
    articles: [article], tenants: [tenant],
    'social-connections': [{ id: 1, tenant: 7, platform: 'youtube', status: 'connected', encryptedTokens: encryptToken('{}') }],
  }
  await runPublications(baseDeps(adapters, stores), { articleId: 5, tenantId: 7, platforms: ['youtube'], locale: 'ar' })
  assert.equal(pubOf(stores).status, 'skipped')
  assert.equal(pubOf(stores).skippedReason, 'platform_not_implemented')
})

test('adapter returns published → publication published(remoteId/url) + connection updated', async () => {
  const adapters: AdapterRegistry = { get: () => ({ platform: 'facebook', capabilities: { text: true, link: true, image: true, video: false }, async publish(input) { return { outcome: 'published', remoteId: 'fb_123', remoteUrl: 'https://facebook.com/fb_123' } } }), platforms: () => ['facebook'] }
  const stores: Record<string, Array<Record<string, unknown>>> = {
    articles: [article], tenants: [tenant],
    'social-connections': [{ id: 1, tenant: 7, platform: 'facebook', status: 'connected', encryptedTokens: encryptToken(JSON.stringify({ pageId: '1', accessToken: 'tok' })) }],
  }
  await runPublications(baseDeps(adapters, stores), { articleId: 5, tenantId: 7, platforms: ['facebook'], locale: 'ar' })
  assert.equal(pubOf(stores).status, 'published')
  assert.equal(pubOf(stores).remoteId, 'fb_123')
  assert.equal(pubOf(stores).remoteUrl, 'https://facebook.com/fb_123')
  assert.equal(connOf(stores).lastPublishStatus, 'published')
  assert.equal(connOf(stores).lastPublishUrl, 'https://facebook.com/fb_123')
  assert.equal(connOf(stores).lastPublishAt, '2026-07-16T00:00:00Z')
  assert.match(String(pubOf(stores).payloadHash), /^[0-9a-f]{64}$/, 'publication record carries a payload hash')
})

test('adapter returns skipped → publication skipped with reason', async () => {
  const adapters: AdapterRegistry = { get: () => ({ platform: 'youtube', capabilities: { text: false, link: false, image: false, video: true }, async publish() { return { outcome: 'skipped', skippedReason: 'no_owned_video' } } }), platforms: () => ['youtube'] }
  const stores: Record<string, Array<Record<string, unknown>>> = {
    articles: [article], tenants: [tenant],
    'social-connections': [{ id: 1, tenant: 7, platform: 'youtube', status: 'connected', encryptedTokens: encryptToken('{}') }],
  }
  await runPublications(baseDeps(adapters, stores), { articleId: 5, tenantId: 7, platforms: ['youtube'], locale: 'ar' })
  assert.equal(pubOf(stores).status, 'skipped')
  assert.equal(pubOf(stores).skippedReason, 'no_owned_video')
})

test('adapter throws → publication failed(transient, network); other platforms unaffected', async () => {
  let igCalled = false
  const adapters: AdapterRegistry = {
    get: (p) => p === 'facebook'
      ? { platform: 'facebook', capabilities: { text: true, link: true, image: true, video: false }, async publish() { throw new Error('connection reset') } }
      : { platform: 'instagram', capabilities: { text: false, link: false, image: true, video: false }, async publish() { igCalled = true; return { outcome: 'published', remoteId: 'ig_1' } } },
    platforms: () => ['facebook', 'instagram'],
  }
  const stores: Record<string, Array<Record<string, unknown>>> = {
    articles: [article], tenants: [tenant],
    'social-connections': [
      { id: 1, tenant: 7, platform: 'facebook', status: 'connected', encryptedTokens: encryptToken('{}') },
      { id: 2, tenant: 7, platform: 'instagram', status: 'connected', encryptedTokens: encryptToken('{}') },
    ],
  }
  await runPublications(baseDeps(adapters, stores), { articleId: 5, tenantId: 7, platforms: ['facebook', 'instagram'], locale: 'ar' })
  const pubs = stores['social-publications']!
  const fb = pubs.find((p) => p.platform === 'facebook')!
  const ig = pubs.find((p) => p.platform === 'instagram')!
  assert.equal(fb.status, 'failed')
  assert.equal(fb.failureKind, 'transient')
  assert.equal(fb.errorCode, 'network')
  assert.equal(ig.status, 'published') // the facebook failure did not block instagram
  assert.equal(igCalled, true)
})

test('idempotent: an already-published record is not re-published', async () => {
  let called = 0
  const adapters: AdapterRegistry = { get: () => ({ platform: 'facebook', capabilities: { text: true, link: true, image: true, video: false }, async publish() { called++; return { outcome: 'published', remoteId: 'fb_1' } } }), platforms: () => ['facebook'] }
  const stores: Record<string, Array<Record<string, unknown>>> = {
    articles: [article], tenants: [tenant],
    'social-connections': [{ id: 1, tenant: 7, platform: 'facebook', status: 'connected', encryptedTokens: encryptToken('{}') }],
    'social-publications': [{ id: 99, tenant: 7, article: 5, platform: 'facebook', status: 'published', remoteId: 'fb_original', attempts: 1 }],
  }
  await runPublications(baseDeps(adapters, stores), { articleId: 5, tenantId: 7, platforms: ['facebook'], locale: 'ar' })
  assert.equal(called, 0) // adapter not invoked
  assert.equal(pubOf(stores).remoteId, 'fb_original') // original result preserved
})

test('auth failure (401) → publication failed(permanent) + connection reconnect_required', async () => {
  const adapters: AdapterRegistry = { get: () => ({ platform: 'facebook', capabilities: { text: true, link: true, image: true, video: false }, async publish() { return { outcome: 'failed', errorCode: 'fb_401', errorMessage: 'Session expired', failureKind: 'permanent' } } }), platforms: () => ['facebook'] }
  const stores: Record<string, Array<Record<string, unknown>>> = {
    articles: [article], tenants: [tenant],
    'social-connections': [{ id: 1, tenant: 7, platform: 'facebook', status: 'connected', encryptedTokens: encryptToken(JSON.stringify({ pageId: '1', accessToken: 'tok' })) }],
  }
  await runPublications(baseDeps(adapters, stores), { articleId: 5, tenantId: 7, platforms: ['facebook'], locale: 'ar' })
  assert.equal(pubOf(stores).status, 'failed')
  assert.equal(pubOf(stores).failureKind, 'permanent')
  assert.equal(connOf(stores).status, 'reconnect_required')
})

test('retry re-stamps payloadHash to match the content actually published (no stale hash)', async () => {
  // Round-3 fix: a prior attempt left a record under the OLD content; the article then drifted.
  // The retry must publish the NEW content AND re-stamp the hash so the record never carries a
  // hash for content it did not publish. Goes through the real publishOne + canonicalPublishHash.
  let received: PublishInput | undefined
  const adapters: AdapterRegistry = {
    get: () => ({ platform: 'facebook', capabilities: { text: true, link: true, image: true, video: false }, async publish(input) { received = input; return { outcome: 'published', remoteId: 'fb_2' } } }),
    platforms: () => ['facebook'],
  }
  const staleHash = '0'.repeat(64)
  const stores: Record<string, Array<Record<string, unknown>>> = {
    articles: [{ ...article, title: { ar: 'جهاز رنين معدّل', en: 'New MRI II' } }], // content drifted before retry
    tenants: [tenant],
    'social-connections': [{ id: 1, tenant: 7, platform: 'facebook', status: 'connected', encryptedTokens: encryptToken(JSON.stringify({ pageId: '1', accessToken: 'tok' })) }],
    'social-publications': [{ id: 99, tenant: 7, article: 5, platform: 'facebook', status: 'failed', payloadHash: staleHash, attempts: 1 }],
  }
  await runPublications(baseDeps(adapters, stores), { articleId: 5, tenantId: 7, platforms: ['facebook'], locale: 'ar' })
  const pub = pubOf(stores)
  assert.equal(pub.status, 'published')
  assert.notEqual(pub.payloadHash, staleHash, 'hash must be re-stamped, not the stale original')
  assert.equal(pub.payloadHash, canonicalPublishHash(received!), 'record hash matches the content actually published this attempt')
})

test('near-expiry token is refreshed before publish; refreshed token used + persisted', async () => {
  // Round-3: X/TikTok short-lived tokens are refreshed just-in-time. The adapter must receive the
  // refreshed access token, and the connection must persist it so the next publish reuses it.
  let publishedToken: string | undefined
  const adapters: AdapterRegistry = { get: () => ({ platform: 'x', capabilities: { text: true, link: true, image: true, video: false }, async publish(_input, conn) { publishedToken = conn.credentials.accessToken; return { outcome: 'published', remoteId: 'x_1' } } }), platforms: () => ['x'] }
  const expired = new Date(Date.now() - 60_000).toISOString() // already expired → within the refresh window
  const stores: Record<string, Array<Record<string, unknown>>> = {
    articles: [article], tenants: [tenant],
    'social-connections': [{ id: 1, tenant: 7, platform: 'x', status: 'connected', encryptedTokens: encryptToken(JSON.stringify({ accessToken: 'OLD', refreshToken: 'rt1', expiresAt: expired })) }],
  }
  let refreshedWith: string | undefined
  const refreshers = { get: () => async ({ credentials }: { credentials: Record<string, string> }) => { refreshedWith = credentials.refreshToken; return { credentials: { ...credentials, accessToken: 'NEW' }, expiresAt: '2099-01-01T00:00:00Z' } } }
  await runPublications({ payload: makePayload(stores), adapters, base: 'https://dgh.bitrail.dev', mediaBase: 'https://cms.dgh.bitrail.dev', now: () => '2026-07-16T00:00:00Z', refreshers }, { articleId: 5, tenantId: 7, platforms: ['x'], locale: 'ar' })
  assert.equal(refreshedWith, 'rt1', 'refresher received the stored refresh token')
  assert.equal(publishedToken, 'NEW', 'adapter received the refreshed access token, not the stale one')
  const conn = connOf(stores)
  assert.equal(JSON.parse(decryptToken(conn.encryptedTokens as string) || '{}').accessToken, 'NEW', 'connection persists the refreshed token')
  assert.equal(conn.tokenExpiresAt, '2099-01-01T00:00:00Z')
})
