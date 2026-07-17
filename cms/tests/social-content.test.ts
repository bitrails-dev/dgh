// Task D/E content builder: pure extraction + canonical URL + media selection + post copy. No provider.
import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildPublishInput,
  buildDescription,
  pickLocale,
  selectImage,
  absoluteUrl,
  mediaUrl,
  sanitizeTag,
  truncate,
  firstExcerpt,
} from '../src/social/content'

const art = (overrides: Record<string, unknown> = {}) => ({
  id: 5,
  slug: 'new-mri',
  title: { ar: 'جهاز رنين جديد', en: 'New MRI' },
  thumbnail: { url: '/api/media/file/mri.jpg' },
  categoryRel: { name: { ar: 'أخبار', en: 'News' } },
  content: [{ blockType: 'heading', text: { ar: 'افتتاح القسم', en: 'Opening the ward' } }],
  ...overrides,
})

const OPTS = { tenantId: 7, articleId: 5, platform: 'facebook' as const, locale: 'ar' as const, base: 'https://dgh.bitrail.dev', mediaBase: 'https://cms.dgh.bitrail.dev', tenantName: { ar: 'مستشفى دمياط', en: 'Dumyat Hospital' } }

test('pickLocale prefers the requested locale, falls back to the other, then scalar', () => {
  assert.equal(pickLocale({ ar: 'آ', en: 'En' }, 'ar'), 'آ')
  assert.equal(pickLocale({ ar: 'آ', en: 'En' }, 'en'), 'En')
  assert.equal(pickLocale({ ar: 'آ' }, 'en'), 'آ')
  assert.equal(pickLocale('plain', 'ar'), 'plain')
  assert.equal(pickLocale(null, 'ar'), '')
})

test('mediaUrl reads .url from a populated upload', () => {
  assert.equal(mediaUrl({ url: '/x.jpg' }), '/x.jpg')
  assert.equal(mediaUrl({ id: 9 }), undefined)
  assert.equal(mediaUrl(9), undefined)
})

test('selectImage prefers thumbnail, then the first image block', () => {
  assert.equal(selectImage(art()), '/api/media/file/mri.jpg')
  const noThumb = art({ thumbnail: undefined, content: [
    { blockType: 'richText' },
    { blockType: 'image', image: { url: '/a.jpg' } },
    { blockType: 'image', image: { url: '/b.jpg' } },
  ] })
  assert.equal(selectImage(noThumb), '/a.jpg')
  assert.equal(selectImage(art({ thumbnail: undefined, content: [] })), undefined)
})

test('absoluteUrl prefixes relative URLs and leaves absolute URLs untouched', () => {
  assert.equal(absoluteUrl('/api/media/file/x.jpg', 'https://cms.example.dev'), 'https://cms.example.dev/api/media/file/x.jpg')
  assert.equal(absoluteUrl('/x', 'https://cms.example.dev/'), 'https://cms.example.dev/x')
  assert.equal(absoluteUrl('https://cdn.example.dev/x.jpg', 'https://cms.example.dev'), 'https://cdn.example.dev/x.jpg')
  assert.equal(absoluteUrl(undefined, 'https://x'), undefined)
})

test('firstExcerpt returns the first heading text in the locale', () => {
  assert.equal(firstExcerpt(art(), 'ar'), 'افتتاح القسم')
  assert.equal(firstExcerpt(art(), 'en'), 'Opening the ward')
  assert.equal(firstExcerpt(art({ content: [] }), 'ar'), '')
})

test('truncate appends an ellipsis when over the limit', () => {
  assert.equal(truncate('abcdef', 6), 'abcdef')
  assert.equal(truncate('abcdef', 3), 'ab…')
  assert.equal(truncate('', 5), '')
})

test('sanitizeTag turns spaces/dashes into underscores and strips punctuation (keeps Arabic)', () => {
  assert.equal(sanitizeTag('Dumyat Hospital'), 'Dumyat_Hospital')
  assert.equal(sanitizeTag('news-update!'), 'news_update')
  assert.equal(sanitizeTag('مستشفى دمياط'), 'مستشفى_دمياط')
  assert.equal(sanitizeTag('  '), '')
})

test('buildDescription joins title + excerpt + link + hashtags, skipping empty parts', () => {
  const d = buildDescription('T', 'Excerpt', 'https://x/a', ['News', 'Dumyat'])
  assert.equal(d, 'T\nExcerpt\nhttps://x/a\n#News #Dumyat')
  // No excerpt, no tags.
  assert.equal(buildDescription('T', '', 'https://x/a', []), 'T\nhttps://x/a')
})

test('buildPublishInput: ar link has no lang prefix; en has /en; description carries the link', () => {
  const ar = buildPublishInput(art(), OPTS)
  assert.equal(ar.link, 'https://dgh.bitrail.dev/articles/new-mri')
  assert.ok(ar.description.includes('https://dgh.bitrail.dev/articles/new-mri'))
  assert.ok(ar.description.includes('#News') || ar.description.includes('#أخبار'))
  const en = buildPublishInput(art(), { ...OPTS, locale: 'en' })
  assert.equal(en.link, 'https://dgh.bitrail.dev/en/articles/new-mri')
})

test('buildPublishInput: image resolved absolutely; no owned video; tags derived from category + tenant', () => {
  const out = buildPublishInput(art(), OPTS)
  assert.equal(out.imageUrl, 'https://cms.dgh.bitrail.dev/api/media/file/mri.jpg')
  assert.equal(out.hasOwnedVideo, false)
  // category ar (locale=ar) → 'أخبار'; tenant en → 'Dumyat_Hospital' (case preserved)
  assert.deepEqual(out.tags.sort(), ['Dumyat_Hospital', 'أخبار'].sort())
  assert.ok(out.tags.includes('أخبار'))
  assert.ok(out.tags.includes('Dumyat_Hospital'))
})

test('buildPublishInput: title falls back to slug; no image → imageUrl undefined', () => {
  const a = art({ title: { ar: '', en: '' }, thumbnail: undefined, content: [] })
  const out = buildPublishInput(a, OPTS)
  assert.equal(out.title, 'new-mri')
  assert.equal(out.imageUrl, undefined)
})
