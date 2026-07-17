// Tier-1 adapter contract tests. Mocked fetch only — no live provider calls. Asserts request
// URL/method/body shape, success → remote id/permalink, error classification, and honest skips.
import assert from 'node:assert/strict'
import test from 'node:test'
import { facebook } from '../src/social/adapters/facebook'
import { instagram } from '../src/social/adapters/instagram'
import { linkedin } from '../src/social/adapters/linkedin'
import { youtube } from '../src/social/adapters/youtube'
import type { PublishInput, ProviderConnection } from '../src/social/types'

const input = (overrides: Partial<PublishInput> = {}): PublishInput => ({
  tenantId: 7, articleId: 5, platform: 'facebook', locale: 'ar', slug: 'new-mri',
  title: 'New MRI', description: 'New MRI\nhttps://dgh.bitrail.dev/articles/new-mri\n#News',
  link: 'https://dgh.bitrail.dev/articles/new-mri', tags: ['News'],
  imageUrl: 'https://cms.dgh.bitrail.dev/mri.jpg', hasOwnedVideo: false, ...overrides,
})
const conn = (credentials: Record<string, string>): ProviderConnection => ({ platform: 'facebook', credentials })

// Mock fetch factory: routes by URL substring, records calls.
type MockResp = { status?: number; body?: unknown; headers?: Record<string, string> }
const makeFetch = (route: (url: string, init: RequestInit) => MockResp | Promise<MockResp>) => {
  const calls: Array<{ url: string; init: RequestInit }> = []
  const f = async (url: string | URL | Request, init?: RequestInit) => {
    const u = typeof url === 'string' ? url : url.toString()
    calls.push({ url: u, init: init ?? {} })
    const { status = 200, body, headers = {} } = await route(u, init ?? {})
    return {
      ok: status < 400, status,
      json: async () => body,
      headers: { get: (k: string) => headers[k.toLowerCase()] ?? null },
    }
  }
  return Object.assign(f as unknown as typeof fetch, { calls })
}

// --- Facebook ------------------------------------------------------------------------------------

test('facebook: link post → published with id + permalink; correct request shape', async () => {
  const fetch = makeFetch(() => ({ status: 200, body: { id: 'fb_123_456' } }))
  const res = await facebook.publish(input({ imageUrl: undefined }), conn({ pageId: 'P1', accessToken: 'tok' }), { fetch })
  assert.equal(res.outcome, 'published')
  assert.equal(res.remoteId, 'fb_123_456')
  assert.equal(res.remoteUrl, 'https://www.facebook.com/fb_123_456')
  assert.ok(fetch.calls[0].url.endsWith('/P1/feed'))
  const body = new URLSearchParams(fetch.calls[0].init.body as string)
  assert.equal(body.get('link'), 'https://dgh.bitrail.dev/articles/new-mri')
  assert.equal(body.get('access_token'), 'tok')
  assert.ok(body.get('message')!.includes('New MRI'))
})

test('facebook: missing credentials → skipped (no API call)', async () => {
  const fetch = makeFetch(() => ({ body: {} }))
  const res = await facebook.publish(input(), conn({}), { fetch })
  assert.equal(res.outcome, 'skipped')
  assert.equal(res.skippedReason, 'missing_credentials')
  assert.equal(fetch.calls.length, 0)
})

test('facebook: 401 → failed/permanent with sanitized message', async () => {
  const fetch = makeFetch(() => ({ status: 401, body: { error: { message: 'Session expired' } } }))
  const res = await facebook.publish(input({ imageUrl: undefined }), conn({ pageId: 'P1', accessToken: 'bad' }), { fetch })
  assert.equal(res.outcome, 'failed')
  assert.equal(res.errorCode, 'fb_401')
  assert.equal(res.failureKind, 'permanent')
  assert.equal(res.errorMessage, 'Session expired')
})

// --- Instagram ----------------------------------------------------------------------------------

test('instagram: no eligible image → skipped (no API call)', async () => {
  const fetch = makeFetch(() => ({ body: {} }))
  const res = await instagram.publish(input({ imageUrl: undefined, platform: 'instagram' }), conn({ igUserId: 'IG1', accessToken: 'tok' }), { fetch })
  assert.equal(res.outcome, 'skipped')
  assert.equal(res.skippedReason, 'no_eligible_media')
  assert.equal(fetch.calls.length, 0)
})

test('instagram: image container → publish → published with permalink', async () => {
  const fetch = makeFetch((url) => {
    if (url.includes('/media_publish')) return { body: { id: 'ig_9' } }
    if (url.includes('fields=permalink')) return { body: { permalink: 'https://instagram.com/p/abc' } }
    return { body: { id: 'container_1' } } // create container
  })
  const res = await instagram.publish(input({ platform: 'instagram' }), conn({ igUserId: 'IG1', accessToken: 'tok' }), { fetch })
  assert.equal(res.outcome, 'published')
  assert.equal(res.remoteId, 'ig_9')
  assert.equal(res.remoteUrl, 'https://instagram.com/p/abc')
  // create container carried image_url + caption
  const createBody = new URLSearchParams(fetch.calls[0].init.body as string)
  assert.equal(createBody.get('image_url'), 'https://cms.dgh.bitrail.dev/mri.jpg')
})

// --- LinkedIn -----------------------------------------------------------------------------------

test('linkedin: ARTICLE link share → published; body carries author + originalUrl', async () => {
  const fetch = makeFetch(() => ({ status: 201, body: { id: 'urn:li:share:1' } }))
  const res = await linkedin.publish(input({ platform: 'linkedin', imageUrl: undefined }), conn({ authorUrn: 'urn:li:organization:42', accessToken: 'tok' }), { fetch })
  assert.equal(res.outcome, 'published')
  assert.equal(res.remoteId, 'urn:li:share:1')
  const sent = JSON.parse(fetch.calls[0].init.body as string)
  assert.equal(sent.author, 'urn:li:organization:42')
  assert.equal(sent.specificContent['com.linkedin.ugc.ShareContent'].shareMediaCategory, 'ARTICLE')
  assert.equal(sent.specificContent['com.linkedin.ugc.ShareContent'].media[0].originalUrl, 'https://dgh.bitrail.dev/articles/new-mri')
})

test('linkedin: id falls back to x-restli-id header when absent from body', async () => {
  const fetch = makeFetch(() => ({ status: 201, body: {}, headers: { 'x-restli-id': 'urn:li:share:2' } }))
  const res = await linkedin.publish(input({ platform: 'linkedin', imageUrl: undefined }), conn({ authorUrn: 'urn:li:organization:42', accessToken: 'tok' }), { fetch })
  assert.equal(res.outcome, 'published')
  assert.equal(res.remoteId, 'urn:li:share:2')
})

// --- YouTube ------------------------------------------------------------------------------------

test('youtube: always skipped(no_owned_video) — no API call, no fake success', async () => {
  const fetch = makeFetch(() => ({ body: {} }))
  const res = await youtube.publish(input({ platform: 'youtube' }), conn({}), { fetch })
  assert.equal(res.outcome, 'skipped')
  assert.equal(res.skippedReason, 'no_owned_video')
  assert.equal(fetch.calls.length, 0)
})
