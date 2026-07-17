// Task F: single-source platform metadata (src/social/platforms.ts) + cross-boundary parity with
// the frontend normalizer. Asserts the catalogue shape, the tier/env mapping, and that the frontend
// exposes a `<key>Url` social field for every CMS platform (drift catcher — no Astro import).
import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  ALL_PLATFORMS, TIER_1_PLATFORMS, DEFERRED_PLATFORMS,
  PLATFORM_SELECT_OPTIONS, envCredKeys, hasOAuth, platformLabel, platformMeta,
} from '../src/social/platforms'

test('PLATFORMS is exactly the eight public-feed platforms in display order; whatsapp excluded', () => {
  assert.deepEqual(ALL_PLATFORMS, ['facebook', 'instagram', 'x', 'threads', 'snapchat', 'youtube', 'linkedin', 'tiktok'])
  assert.ok(!ALL_PLATFORMS.includes('whatsapp' as never))
  assert.equal(PLATFORM_SELECT_OPTIONS.length, 8)
})

test('tier split: tier 1 has OAuth+adapter (7); tier 2 is deferred (Snapchat allowlist)', () => {
  assert.deepEqual(TIER_1_PLATFORMS, ['facebook', 'instagram', 'x', 'threads', 'youtube', 'linkedin', 'tiktok'])
  assert.deepEqual(DEFERRED_PLATFORMS, ['snapchat'])
  for (const p of TIER_1_PLATFORMS) assert.equal(hasOAuth(p), true)
  for (const p of DEFERRED_PLATFORMS) assert.equal(hasOAuth(p), false)
})

test('envCredKeys maps tier-1 platforms to SOCIAL_<STEM>_CLIENT_{ID,SECRET}; null for tier 2', () => {
  assert.deepEqual(envCredKeys('facebook'), ['SOCIAL_FB_CLIENT_ID', 'SOCIAL_FB_CLIENT_SECRET'])
  assert.deepEqual(envCredKeys('instagram'), ['SOCIAL_IG_CLIENT_ID', 'SOCIAL_IG_CLIENT_SECRET'])
  assert.deepEqual(envCredKeys('linkedin'), ['SOCIAL_LINKEDIN_CLIENT_ID', 'SOCIAL_LINKEDIN_CLIENT_SECRET'])
  assert.deepEqual(envCredKeys('youtube'), ['SOCIAL_YOUTUBE_CLIENT_ID', 'SOCIAL_YOUTUBE_CLIENT_SECRET'])
  assert.deepEqual(envCredKeys('x'), ['SOCIAL_X_CLIENT_ID', 'SOCIAL_X_CLIENT_SECRET'])
  assert.deepEqual(envCredKeys('threads'), ['SOCIAL_THREADS_CLIENT_ID', 'SOCIAL_THREADS_CLIENT_SECRET'])
  assert.deepEqual(envCredKeys('tiktok'), ['SOCIAL_TIKTOK_CLIENT_ID', 'SOCIAL_TIKTOK_CLIENT_SECRET'])
  assert.equal(envCredKeys('snapchat'), null)
})

test('every tier-2 platform carries a precise deferredReason + operator note', () => {
  for (const p of DEFERRED_PLATFORMS) {
    const m = platformMeta(p)!
    assert.ok(m.deferredReason === 'not_implemented' || m.deferredReason === 'approval_required', `${p} needs a deferredReason`)
    assert.ok(m.approvalNote && m.approvalNote.length > 0, `${p} needs an approvalNote`)
  }
})

test('platformLabel returns the ar/en label', () => {
  assert.equal(platformLabel('facebook', 'en'), 'Facebook')
  assert.equal(platformLabel('facebook', 'ar'), 'فيسبوك')
})

// Parity with the public Astro normalizer — the one place the platform list is duplicated across a
// runtime boundary. Reads the source text so no Astro/vite runtime is needed.
test('frontend src/lib/tenant.ts defines a <key>Url social field for every CMS platform', () => {
  const frontend = resolve(process.cwd(), '../src/lib/tenant.ts')
  const src = readFileSync(frontend, 'utf8')
  for (const key of ALL_PLATFORMS) {
    assert.match(src, new RegExp(`${key}Url\\s*\\??:`), `frontend must define social.${key}Url for platform "${key}"`)
  }
})
