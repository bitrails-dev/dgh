// Read-only safety gate. Run before the cleanup migration that drops `articles.body`.
// The collection schema no longer exposes the legacy field, so this checks SQLite directly.
//
// Run: cd cms && pnpm exec tsx scripts/check-legacy-body.ts
import 'dotenv/config'
import { sql } from '@payloadcms/db-sqlite'
import { getPayload } from 'payload'
import config from '../src/payload.config'

const payload = await getPayload({ config })
const db = (payload.db as any).drizzle

const bodyOnly = await db.all(sql`
  SELECT a.id, a.slug
  FROM articles AS a
  WHERE trim(coalesce(a.body, '')) <> ''
    AND NOT EXISTS (SELECT 1 FROM articles_blocks_rich_text AS b WHERE b._parent_id = a.id)
    AND NOT EXISTS (SELECT 1 FROM articles_blocks_heading AS b WHERE b._parent_id = a.id)
    AND NOT EXISTS (SELECT 1 FROM articles_blocks_image AS b WHERE b._parent_id = a.id)
    AND NOT EXISTS (SELECT 1 FROM articles_blocks_youtube AS b WHERE b._parent_id = a.id)
    AND NOT EXISTS (SELECT 1 FROM articles_blocks_testimonial AS b WHERE b._parent_id = a.id)
  ORDER BY a.id
`)

const unresolvedCategories = await db.all(sql`
  SELECT id, slug, category
  FROM articles
  WHERE category_rel_id IS NULL
    AND trim(coalesce(category, '')) <> ''
    AND NOT EXISTS (
      SELECT 1
      FROM categories
      WHERE categories.slug = articles.category
    )
  ORDER BY id
`)

console.log(`articles body-only (will be converted): ${bodyOnly.length}`)
console.log(`articles with unresolved legacy categories (RISK): ${unresolvedCategories.length}`)

if (bodyOnly.length) {
  console.log('\nThe cleanup migration will preserve these as localized Rich Text blocks:')
  for (const article of bodyOnly) console.log(`  id=${article.id}  slug=${article.slug}`)
}

if (unresolvedCategories.length) {
  console.log('\nCreate or assign Categories for these articles before running the cleanup migration:')
  for (const article of unresolvedCategories) {
    console.log(`  id=${article.id}  slug=${article.slug}  category=${article.category}`)
  }
}

process.exitCode = unresolvedCategories.length ? 1 : 0
if (!process.exitCode) console.log('\nSafe: the cleanup migration can preserve or replace every legacy Article value.')

await payload.destroy()
