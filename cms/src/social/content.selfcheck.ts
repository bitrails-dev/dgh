// Runnable self-check for the pure content/dispatch logic — no network, no Payload.
//   Run:  cd cms && npx tsx src/social/content.selfcheck.ts
import assert from 'node:assert'
import { buildDescription, buildPublishInput, firstProse, lexicalToText, truncate } from './content'
import { mergeResults } from './dispatch'
import type { PublishResult } from './types'

process.env.SITE_URL = 'https://dgh.example.dev'
process.env.PUBLIC_MEDIA_BASE = 'https://cms.example.dev'

// lexicalToText flattens nested nodes.
const lex = {
  root: {
    children: [
      { type: 'paragraph', children: [{ text: 'مرحبا ' }, { text: 'بالعالم' }] },
      { type: 'paragraph', children: [{ text: 'سطر ثانٍ' }] },
    ],
  },
}
assert.equal(lexicalToText(lex), 'مرحبا بالعالم\nسطر ثانٍ')
assert.equal(lexicalToText(null), '')
assert.equal(lexicalToText({}), '')

// firstProse prefers the first heading/richText with content.
const content = [
  { blockType: 'image', image: 1 },
  { blockType: 'richText', richText: { ar: lex, en: null } },
]
assert.equal(firstProse(content, 'ar'), 'مرحبا بالعالم\nسطر ثانٍ')
assert.equal(firstProse([], 'ar'), '')

// truncate cuts on a word boundary and appends an ellipsis.
assert.equal(truncate('short', 20), 'short')
const t = truncate('one two three four five six seven', 15)
assert.ok(t.endsWith('…') && t.length <= 16, t)

// buildDescription includes title, link, and hashtags.
const d = buildDescription('العنوان', 'مقتطف', 'https://x/y', ['وسم', 'DumyatHospital'])
assert.ok(d.includes('العنوان') && d.includes('https://x/y') && d.includes('#وسم') && d.includes('#DumyatHospital'), d)

// buildPublishInput: video article → public URL + local path + all-platform-ready.
const article = {
  id: 7,
  slug: 'flu-season',
  title: { ar: 'موسم الإنفلونزا', en: 'Flu season' },
  category: 'health-tips',
  content,
  video: { url: '/uploads/videos/clip.mp4', filename: 'clip.mp4' },
  social: { autoPublish: true, caption: null, results: [] },
}
const input = buildPublishInput(article)
assert.equal(input.link, 'https://dgh.example.dev/articles/flu-season')
assert.equal(input.hasVideo, true)
assert.equal(input.videoUrl, 'https://cms.example.dev/uploads/videos/clip.mp4')
assert.ok(input.videoPath?.endsWith('clip.mp4'))
assert.ok(input.description.includes('موسم الإنفلونزا') && input.description.includes(input.link))

// A manual caption override wins over the generated excerpt.
const overridden = buildPublishInput({ ...article, social: { caption: 'نص مخصص', autoPublish: true } })
assert.ok(overridden.description.startsWith('نص مخصص'))

// No-video article: adapters that need video will skip; input still valid.
const noVid = buildPublishInput({ ...article, video: null })
assert.equal(noVid.hasVideo, false)
assert.equal(noVid.videoUrl, undefined)

// mergeResults: a recorded success is never overwritten by a later skip/error.
const at = '2026-07-13T00:00:00.000Z'
const prior: PublishResult[] = [
  { platform: 'facebook', status: 'success', externalId: 'fb1', at },
  { platform: 'youtube', status: 'skipped', reason: 'not configured', at },
]
const fresh: PublishResult[] = [
  { platform: 'facebook', status: 'error', error: 'rate limited', at },
  { platform: 'youtube', status: 'success', externalId: 'yt1', at },
  { platform: 'tiktok', status: 'skipped', reason: 'no video', at },
]
const merged = mergeResults(prior, fresh)
const byId = Object.fromEntries(merged.map((r) => [r.platform, r]))
assert.equal(byId.facebook.status, 'success') // success preserved
assert.equal(byId.youtube.status, 'success') // upgraded from skipped
assert.equal(byId.tiktok.status, 'skipped') // new platform recorded
assert.equal(merged.length, 3)

console.log('✓ social content self-check passed')
