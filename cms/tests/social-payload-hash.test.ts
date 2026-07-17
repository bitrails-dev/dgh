// Task 5: canonicalPublishHash — deterministic SHA-256 over the post-affecting payload. Proves:
// identical semantics hash equally; content/media changes change the hash; tag/key order does not;
// ids/locale (not post content) are excluded.
import assert from 'node:assert/strict'
import test from 'node:test'
import { canonicalPublishHash } from '../src/social/content'
import type { PublishInput } from '../src/social/types'

const input = (overrides: Partial<PublishInput> = {}): PublishInput => ({
  tenantId: 7, articleId: 5, platform: 'facebook', locale: 'ar', slug: 'new-mri',
  title: 'New MRI', description: 'New MRI\nhttps://dgh.bitrail.dev/articles/new-mri\n#News',
  link: 'https://dgh.bitrail.dev/articles/new-mri', tags: ['News', 'Hospital'],
  imageUrl: 'https://cms.dgh.bitrail.dev/mri.jpg', hasOwnedVideo: false, ...overrides,
})

test('identical payload → identical hash', () => {
  assert.equal(canonicalPublishHash(input()), canonicalPublishHash(input()))
})

test('a content change (title/description/link/image) changes the hash', () => {
  const base = canonicalPublishHash(input())
  assert.notEqual(base, canonicalPublishHash(input({ title: 'New MRI II' })))
  assert.notEqual(base, canonicalPublishHash(input({ description: 'changed copy' })))
  assert.notEqual(base, canonicalPublishHash(input({ link: 'https://dgh.bitrail.dev/en/articles/new-mri' })))
  assert.notEqual(base, canonicalPublishHash(input({ imageUrl: 'https://cms.dgh.bitrail.dev/other.jpg' })))
})

test('tag order does not change the hash; a different tag set does', () => {
  const base = canonicalPublishHash(input({ tags: ['News', 'Hospital'] }))
  assert.equal(base, canonicalPublishHash(input({ tags: ['Hospital', 'News'] }))) // order-independent
  assert.notEqual(base, canonicalPublishHash(input({ tags: ['News'] })))
})

test('ids, locale, and slug are excluded (they are not post content)', () => {
  const base = canonicalPublishHash(input())
  assert.equal(base, canonicalPublishHash(input({ tenantId: 999, articleId: 999 })))
  assert.equal(base, canonicalPublishHash(input({ locale: 'en', slug: 'other-slug' })))
})

test('a different platform changes the hash (different post target)', () => {
  assert.notEqual(canonicalPublishHash(input()), canonicalPublishHash(input({ platform: 'instagram' })))
})
