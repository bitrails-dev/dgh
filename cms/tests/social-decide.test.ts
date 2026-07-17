// Task D/E publish-decision + retry-classification. Pure logic, no provider/DB.
import assert from 'node:assert/strict'
import test from 'node:test'
import {
  shouldQueueArticle,
  classifyFailure,
  outstandingPlatforms,
  backoffSeconds,
} from '../src/social/decide'
import type { Platform } from '../src/social/types'

const P = (xs: string[]): Platform[] => xs as Platform[]

test('shouldQueueArticle returns the intersection of included ∩ connected platforms', () => {
  const targets = shouldQueueArticle({
    tenantEnabled: true,
    articleAutoPublish: true,
    includedPlatforms: P(['facebook', 'instagram', 'youtube', 'x']),
    connectedPlatforms: P(['facebook', 'linkedin']),
  })
  assert.deepEqual(targets, ['facebook'])
})

test('shouldQueueArticle returns null when publishing is disabled at the tenant level', () => {
  assert.equal(shouldQueueArticle({ tenantEnabled: false, articleAutoPublish: true, includedPlatforms: P(['facebook']), connectedPlatforms: P(['facebook']) }), null)
})

test('shouldQueueArticle returns null when the article is not auto-publish', () => {
  assert.equal(shouldQueueArticle({ tenantEnabled: true, articleAutoPublish: false, includedPlatforms: P(['facebook']), connectedPlatforms: P(['facebook']) }), null)
})

test('shouldQueueArticle returns null when no included platform is connected', () => {
  assert.equal(shouldQueueArticle({ tenantEnabled: true, articleAutoPublish: true, includedPlatforms: P(['facebook', 'youtube']), connectedPlatforms: P(['linkedin']) }), null)
})

test('shouldQueueArticle returns null when includedPlatforms is empty', () => {
  assert.equal(shouldQueueArticle({ tenantEnabled: true, articleAutoPublish: true, includedPlatforms: [], connectedPlatforms: P(['facebook']) }), null)
})

test('classifyFailure: transient for 429/5xx/network/timeout; permanent otherwise', () => {
  assert.equal(classifyFailure(429), 'transient')
  assert.equal(classifyFailure(500), 'transient')
  assert.equal(classifyFailure(503), 'transient')
  assert.equal(classifyFailure(undefined, 'network'), 'transient')
  assert.equal(classifyFailure(undefined, 'timeout'), 'transient')
  assert.equal(classifyFailure(401), 'permanent')
  assert.equal(classifyFailure(403), 'permanent')
  assert.equal(classifyFailure(400), 'permanent')
  assert.equal(classifyFailure(undefined), 'permanent') // unknown → fail safe
})

test('outstandingPlatforms drops published + skipped, keeps pending/failed/processing', () => {
  const out = outstandingPlatforms([
    { platform: 'facebook', status: 'published' },
    { platform: 'instagram', status: 'failed' },
    { platform: 'linkedin', status: 'skipped' },
    { platform: 'youtube', status: 'pending' },
  ])
  assert.deepEqual(out, ['instagram', 'youtube'])
})

test('backoffSeconds grows exponentially and caps', () => {
  assert.equal(backoffSeconds(0), 1)
  assert.equal(backoffSeconds(1), 2)
  assert.equal(backoffSeconds(2), 4)
  assert.equal(backoffSeconds(3), 8)
  assert.equal(backoffSeconds(20, 3600), 3600) // capped
})
