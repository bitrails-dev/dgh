// Snapchat's Public Profile API is allowlist-gated (not self-serve) — its adapter returns a precise
// approval_required and never calls a provider. (X/Threads/TikTok are now real adapters; see the
// extra + provider contract tests.)
import assert from 'node:assert/strict'
import test from 'node:test'
import { snapchat } from '../src/social/adapters/deferred'
import { platformMeta } from '../src/social/platforms'
import type { PublishInput, ProviderConnection } from '../src/social/types'

const input: PublishInput = {
  tenantId: 7, articleId: 5, platform: 'snapchat', locale: 'ar', slug: 's', title: 'T',
  description: 'd', link: 'https://dgh.bitrail.dev/articles/s', tags: [], imageUrl: 'https://x/y.jpg', hasOwnedVideo: false,
}
const conn: ProviderConnection = { platform: 'snapchat', credentials: {} }

test('snapchat adapter → skipped(approval_required); no provider call; capabilities match catalogue', async () => {
  let called = false
  const fn = (() => { called = true; return Promise.resolve({ ok: true, status: 200, json: async () => ({}) }) }) as unknown as typeof fetch
  const r = await snapchat.publish(input, conn, { fetch: fn })
  assert.equal(r.outcome, 'skipped')
  assert.equal(r.skippedReason, 'approval_required')
  assert.equal(called, false)
  assert.deepEqual(snapchat.capabilities, platformMeta('snapchat')!.capabilities)
})
