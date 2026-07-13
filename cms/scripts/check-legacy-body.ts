// Read-only safety gate. Run BEFORE the cleanup migration (§6) that drops `body`.
// Lists articles that still rely on the legacy `body` field — i.e. have body text but
// NO content blocks. Dropping `body` while any of these exist loses their rendered text.
//
// Run: cd cms && pnpm exec tsx scripts/check-legacy-body.ts
import 'dotenv/config'
import { getPayload } from 'payload'
import config from '../src/payload.config'

const payload = await getPayload({ config })

// ponytail: paginate instead of limit:0 (some Payload versions treat 0 as "none").
const all: any[] = []
let page = 1
let totalPages = 1
while (page <= totalPages) {
  const r = await payload.find({ collection: 'articles', limit: 100, page, depth: 0 })
  totalPages = r.totalPages
  all.push(...r.docs)
  page++
}

const hasBody = (d: any) => typeof d.body === 'string' && d.body.trim().length > 0
const hasBlocks = (d: any) => Array.isArray(d.content) && d.content.length > 0

const bodyOnly = all.filter((d) => hasBody(d) && !hasBlocks(d))

console.log(`articles total:            ${all.length}`)
console.log(`articles with content:     ${all.filter(hasBlocks).length}`)
console.log(`articles body-only (RISK): ${bodyOnly.length}`)

if (bodyOnly.length) {
  console.log('\nRe-author these into Content blocks before dropping `body`:')
  for (const d of bodyOnly) console.log(`  id=${d.id}  slug=${d.slug}  title=${d.title ?? ''}`)
} else {
  console.log('\nSafe: no article relies on `body`. Cleanup migration (§6) may drop it.')
}

process.exit(0)
