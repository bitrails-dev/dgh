// Task 2 contract tests for the new/changed adapters: Facebook image, LinkedIn image (3-step), X
// (text + media upload), Threads (2-step), TikTok photo post. Mocked HTTP only — exact request shapes,
// success normalization, and honest skips.
import assert from 'node:assert/strict'
import test from 'node:test'
import { facebook } from '../src/social/adapters/facebook'
import { linkedin } from '../src/social/adapters/linkedin'
import { x } from '../src/social/adapters/x'
import { threads } from '../src/social/adapters/threads'
import { tiktok } from '../src/social/adapters/tiktok'
import type { PublishInput, ProviderConnection, Platform } from '../src/social/types'

const input = (overrides: Partial<PublishInput> = {}): PublishInput => ({
  tenantId: 7, articleId: 5, platform: 'facebook', locale: 'ar', slug: 'new-mri', title: 'New MRI',
  description: 'New MRI\nhttps://dgh.bitrail.dev/articles/new-mri\n#News',
  link: 'https://dgh.bitrail.dev/articles/new-mri', tags: ['News'],
  imageUrl: 'https://cms.dgh.bitrail.dev/mri.jpg', hasOwnedVideo: false, ...overrides,
})
const conn = (credentials: Record<string, string>, platform: Platform = 'facebook'): ProviderConnection => ({ platform, credentials })

type MockResp = { status?: number; body?: unknown; headers?: Record<string, string>; buffer?: Uint8Array }
const makeFetch = (route: (url: string, init: RequestInit) => MockResp | Promise<MockResp>) => {
  const calls: Array<{ url: string; init: RequestInit }> = []
  const f = async (url: string | URL | Request, init?: RequestInit) => {
    const u = typeof url === 'string' ? url : url.toString()
    calls.push({ url: u, init: init ?? {} })
    const { status = 200, body, headers = {}, buffer } = await route(u, init ?? {})
    return {
      ok: status < 400, status,
      json: async () => body,
      arrayBuffer: async () => buffer ?? new Uint8Array([1, 2, 3]).buffer,
      headers: { get: (k: string) => headers[k.toLowerCase()] ?? null },
    }
  }
  return Object.assign(f as unknown as typeof fetch, { calls })
}

// --- Facebook image ---------------------------------------------------------------------------
test('facebook: eligible image → photo post to /photos with url+caption; permalink resolved', async () => {
  const fetch = makeFetch((url) => {
    if (url.includes('fields=permalink_url')) return { body: { permalink_url: 'https://facebook.com/p/123' } }
    return { body: { id: 'photo_1', post_id: 'P1_99' } } // /photos
  })
  const res = await facebook.publish(input(), conn({ pageId: 'P1', accessToken: 'tok' }), { fetch })
  assert.equal(res.outcome, 'published')
  assert.equal(res.remoteId, 'P1_99')
  assert.equal(res.remoteUrl, 'https://facebook.com/p/123')
  const body = new URLSearchParams(fetch.calls[0].init.body as string)
  assert.equal(body.get('url'), 'https://cms.dgh.bitrail.dev/mri.jpg')
  assert.equal(body.get('published'), 'true')
})

// --- LinkedIn image (3-step) ------------------------------------------------------------------
test('linkedin: eligible image → register → upload bytes → IMAGE ugcPosts', async () => {
  const fetch = makeFetch((url) => {
    if (url.includes('/assets?action=registerUpload')) return { body: { value: { asset: 'urn:li:digitalmediaAsset:A1', uploadMechanism: { 'com.linkedin.digitalmedia.uploading.MediaUploadHttpRequest': { uploadUrl: 'https://linkedin.com/dms/UP' } } } } }
    if (url === 'https://linkedin.com/dms/UP') return { status: 201 } // PUT bytes
    return { body: { id: 'urn:li:share:7' } } // ugcPosts
  })
  const res = await linkedin.publish(input({ platform: 'linkedin' }), conn({ authorUrn: 'urn:li:person:1', accessToken: 'tok' }, 'linkedin'), { fetch })
  assert.equal(res.outcome, 'published')
  assert.equal(res.remoteId, 'urn:li:share:7')
  assert.equal(fetch.calls[1].url, 'https://cms.dgh.bitrail.dev/mri.jpg') // image bytes fetched
  assert.equal(fetch.calls[2].url, 'https://linkedin.com/dms/UP')          // bytes uploaded (PUT)
  assert.equal(fetch.calls[2].init.method, 'PUT')
  assert.equal(fetch.calls[3].url, 'https://api.linkedin.com/v2/ugcPosts')
  const sent = JSON.parse(fetch.calls[3].init.body as string)
  assert.equal(sent.specificContent['com.linkedin.ugc.ShareContent'].shareMediaCategory, 'IMAGE')
  assert.equal(sent.specificContent['com.linkedin.ugc.ShareContent'].media[0].media, 'urn:li:digitalmediaAsset:A1')
})

// --- X text + image ---------------------------------------------------------------------------
test('x: text tweet → POST /2/tweets with trimmed copy; published with web URL', async () => {
  const fetch = makeFetch(() => ({ body: { data: { id: '178000' } } }))
  const res = await x.publish(input({ imageUrl: undefined, platform: 'x' }), conn({ accessToken: 'tok' }, 'x'), { fetch })
  assert.equal(res.outcome, 'published')
  assert.equal(res.remoteId, '178000')
  assert.equal(res.remoteUrl, 'https://x.com/i/web/status/178000')
  assert.equal(fetch.calls[0].url, 'https://api.x.com/2/tweets')
})

test('x: image → media/upload then tweet with media_ids', async () => {
  const fetch = makeFetch((url) => url.includes('/media/upload') ? { body: { data: { id: 'm1' } } } : { body: { data: { id: '178000' } } })
  const res = await x.publish(input({ platform: 'x' }), conn({ accessToken: 'tok' }, 'x'), { fetch })
  assert.equal(res.outcome, 'published')
  assert.equal(fetch.calls[0].url, 'https://cms.dgh.bitrail.dev/mri.jpg') // image fetched
  assert.equal(fetch.calls[1].url, 'https://api.x.com/2/media/upload')    // uploaded
  assert.equal(fetch.calls[2].url, 'https://api.x.com/2/tweets')
  const sent = JSON.parse(fetch.calls[2].init.body as string)
  assert.deepEqual(sent.media.media_ids, ['m1'])
})

// --- Threads (2-step) -------------------------------------------------------------------------
test('threads: container → publish → fetch REAL permalink; never a fabricated @numericId URL', async () => {
  const fetch = makeFetch((url) => {
    if (url.includes('/threads_publish')) return { body: { id: 'th_9' } }
    if (url.includes('fields=permalink')) return { body: { permalink: 'https://www.threads.net/@dumyat/post/th_9' } }
    return { body: { id: 'container_1' } } // container create
  })
  const res = await threads.publish(input({ platform: 'threads' }), conn({ userId: '1784', accessToken: 'tok' }, 'threads'), { fetch })
  assert.equal(res.outcome, 'published')
  assert.equal(res.remoteId, 'th_9')
  assert.equal(res.remoteUrl, 'https://www.threads.net/@dumyat/post/th_9')
  assert.ok(!res.remoteUrl?.includes('@1784'), 'permalink must not use the numeric user id')
  assert.ok(fetch.calls[0].url.endsWith('/1784/threads'))
  const createBody = new URLSearchParams(fetch.calls[0].init.body as string)
  assert.equal(createBody.get('media_type'), 'IMAGE')
  assert.equal(createBody.get('image_url'), 'https://cms.dgh.bitrail.dev/mri.jpg')
})

// --- TikTok photo (creator info + async status) ----------------------------------------------
test('tiktok: creator info → init → PUBLISHED; privacy from ALLOWED options, status polled', async () => {
  const fetch = makeFetch((url) => {
    if (url.includes('/user/info/details/')) return { body: { data: { privacy_level_options: ['SELF_ONLY', 'PUBLIC_TO_EVERYONE'] } } }
    if (url.includes('/content/init/')) return { body: { data: { publish_id: 'v_pub~1' } } }
    if (url.includes('/status/fetch/')) return { body: { data: { status: 'PUBLISHED', permalink: 'https://www.tiktok.com/@dumyat/video/1' } } }
    return { status: 404 }
  })
  const res = await tiktok.publish(input({ platform: 'tiktok' }), conn({ accessToken: 'tok', openId: 'o1' }, 'tiktok'), { fetch, ttPollMax: 5, ttPollIntervalMs: 0 })
  assert.equal(res.outcome, 'published')
  assert.equal(res.remoteId, 'v_pub~1')
  assert.equal(res.remoteUrl, 'https://www.tiktok.com/@dumyat/video/1')
  assert.equal(fetch.calls[0].url, 'https://open.tiktokapis.com/v2/user/info/details/') // creator info first
  const init = JSON.parse(fetch.calls[1].init.body as string)
  assert.equal(init.media_type, 'PHOTO')
  assert.equal(init.source_info.source, 'PULL_FROM_URL')
  assert.deepEqual(init.source_info.photo_images, ['https://cms.dgh.bitrail.dev/mri.jpg'])
  assert.equal(init.post_info.privacy_level, 'PUBLIC_TO_EVERYONE') // most-public ALLOWED option
  assert.equal(fetch.calls[2].url, 'https://open.tiktokapis.com/v2/post/publish/status/fetch/') // status polled
})

test('tiktok: creator restricted to SELF_ONLY → init uses SELF_ONLY (no hardcoded public)', async () => {
  const fetch = makeFetch((url) => {
    if (url.includes('/user/info/details/')) return { body: { data: { privacy_level_options: ['SELF_ONLY'] } } }
    if (url.includes('/content/init/')) return { body: { data: { publish_id: 'v2' } } }
    if (url.includes('/status/fetch/')) return { body: { data: { status: 'PUBLISHED' } } }
    return { status: 404 }
  })
  await tiktok.publish(input({ platform: 'tiktok' }), conn({ accessToken: 'tok' }, 'tiktok'), { fetch, ttPollMax: 3, ttPollIntervalMs: 0 })
  const init = JSON.parse(fetch.calls[1].init.body as string)
  assert.equal(init.post_info.privacy_level, 'SELF_ONLY')
})

test('tiktok: still PROCESSING after the poll budget → failed(transient), never fake success', async () => {
  const fetch = makeFetch((url) => {
    if (url.includes('/user/info/details/')) return { body: { data: { privacy_level_options: ['PUBLIC_TO_EVERYONE'] } } }
    if (url.includes('/content/init/')) return { body: { data: { publish_id: 'v3' } } }
    if (url.includes('/status/fetch/')) return { body: { data: { status: 'PROCESSING' } } }
    return { status: 404 }
  })
  const res = await tiktok.publish(input({ platform: 'tiktok' }), conn({ accessToken: 'tok' }, 'tiktok'), { fetch, ttPollMax: 2, ttPollIntervalMs: 0 })
  assert.equal(res.outcome, 'failed')
  assert.equal(res.failureKind, 'transient')
  assert.equal(res.errorCode, 'tt_async_pending')
})

test('tiktok: status FAILED → failed(permanent)', async () => {
  const fetch = makeFetch((url) => {
    if (url.includes('/user/info/details/')) return { body: { data: {} } }
    if (url.includes('/content/init/')) return { body: { data: { publish_id: 'v4' } } }
    if (url.includes('/status/fetch/')) return { body: { data: { status: 'FAILED' } } }
    return { status: 404 }
  })
  const res = await tiktok.publish(input({ platform: 'tiktok' }), conn({ accessToken: 'tok' }, 'tiktok'), { fetch, ttPollMax: 3, ttPollIntervalMs: 0 })
  assert.equal(res.outcome, 'failed')
  assert.equal(res.failureKind, 'permanent')
})

test('tiktok: no eligible image → skipped(no_eligible_media), no request', async () => {
  const fetch = makeFetch(() => ({ body: {} }))
  const res = await tiktok.publish(input({ imageUrl: undefined, platform: 'tiktok' }), conn({ accessToken: 'tok' }, 'tiktok'), { fetch })
  assert.equal(res.outcome, 'skipped')
  assert.equal(res.skippedReason, 'no_eligible_media')
  assert.equal(fetch.calls.length, 0)
})
