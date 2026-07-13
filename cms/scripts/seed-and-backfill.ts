// Data backfill for the content-model change. Run AFTER `payload migrate` applies the additive
// schema. Uses the Payload Local API (safe, validated) and is fully idempotent — re-running is a
// no-op. It only sets the NEW fields; legacy fields are never touched, so nothing is lost.
//
//   seeds:    categories (4 defaults), icons (from the current inline-SVG set + a fallback)
//   backfill: articles.categoryRel, doctors.departmentRel, departments.iconRef
//
// Run: cd cms && npx tsx scripts/seed-and-backfill.ts
import 'dotenv/config'
import { getPayload } from 'payload'
// `sql` re-exported by the sqlite adapter (a direct dep) — importing it from 'drizzle-orm'
// directly fails under an isolated pnpm install where drizzle-orm is only transitive.
import { sql } from '@payloadcms/db-sqlite'
import config from '../src/payload.config'

// --- category seed (mirrors the old fixed enum + its frontend colors) ---
const CATEGORIES: Array<{ slug: string; en: string; ar: string; color: string }> = [
  { slug: 'hospital-news', en: 'Hospital News', ar: 'أخبار المستشفى', color: 'teal' },
  { slug: 'health-tips', en: 'Health Tips', ar: 'نصائح صحية', color: 'navy' },
  { slug: 'research', en: 'Research', ar: 'أبحاث', color: 'gold' },
  { slug: 'events', en: 'Events', ar: 'فعاليات', color: 'ink' },
]

// --- icon seed: the current inline-SVG department icons, promoted to real SVG assets.
// Teal stroke baked in so they render correctly as <img> (no currentColor context). ---
const ICON_PATHS: Record<string, string> = {
  'heart-pulse': '<path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.6l-1-1A5.5 5.5 0 1 0 3.2 12.4l8.8 8.8 8.8-8.8a5.5 5.5 0 0 0 0-7.8Z"/>',
  stethoscope: '<path d="M4.8 2.5v5a4.5 4.5 0 0 0 9 0v-5"/><path d="M4.8 2.5h2M11.8 2.5h2"/><path d="M9.3 12v4.5a4.5 4.5 0 0 0 9 0v-1"/><circle cx="18.3" cy="11" r="2"/>',
  brain: '<path d="M12 4a3 3 0 0 0-3 3v1a3 3 0 0 0-2 2.8v.4a3 3 0 0 0 2 2.8v.2A3 3 0 0 0 12 17a3 3 0 0 0 3-2.8V14a3 3 0 0 0 2-2.8v-.4a3 3 0 0 0-2-2.8V7a3 3 0 0 0-3-3Z"/><path d="M12 4v13M9 7.5c0 1 1 1.5 1.5 1.5M15 7.5c0 1-1 1.5-1.5 1.5"/>',
  baby: '<circle cx="12" cy="7" r="3"/><path d="M7 21c0-3 2-5 5-5s5 2 5 5"/><path d="M10 7h.01M14 7h.01"/>',
  bone: '<path d="M17 3a2.5 2.5 0 0 1 1.8 4.3A2.5 2.5 0 0 1 21 12a2.5 2.5 0 0 1-2.2 4.7A2.5 2.5 0 0 1 17 21a2.5 2.5 0 0 1-4.7-2.2A2.5 2.5 0 0 1 8 21a2.5 2.5 0 0 1-1.8-4.3A2.5 2.5 0 0 1 3 12a2.5 2.5 0 0 1 2.2-4.7A2.5 2.5 0 0 1 7 3a2.5 2.5 0 0 1 4.7 2.2A2.5 2.5 0 0 1 17 3Z"/>',
  eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>',
  cross: '<path d="M17 3a2.5 2.5 0 0 1 1.8 4.3A2.5 2.5 0 0 1 21 12a2.5 2.5 0 0 1-2.2 4.7A2.5 2.5 0 0 1 17 21a2.5 2.5 0 0 1-4.7-2.2A2.5 2.5 0 0 1 8 21a2.5 2.5 0 0 1-1.8-4.3A2.5 2.5 0 0 1 3 12a2.5 2.5 0 0 1 2.2-4.7A2.5 2.5 0 0 1 7 3a2.5 2.5 0 0 1 4.7 2.2A2.5 2.5 0 0 1 17 3Z"/>',
  pill: '<rect x="3" y="8" width="18" height="8" rx="4"/><path d="M12 8v8"/>',
  microscope: '<path d="M6 18h12M8 21h8M10 18v-3l-3-6 3-6h1l3 3-3 3 3 6"/>',
  syringe: '<path d="M18 2l-4 4M17 3l4 4M7.5 12.5L18 2M3 22l3-3M6 19l-3 3M9 13l-2.5 2.5"/>',
  scapel: '<path d="M17 3a2.5 2.5 0 0 1 1.8 4.3A2.5 2.5 0 0 1 21 12a2.5 2.5 0 0 1-2.2 4.7A2.5 2.5 0 0 1 17 21a2.5 2.5 0 0 1-4.7-2.2A2.5 2.5 0 0 1 8 21a2.5 2.5 0 0 1-1.8-4.3A2.5 2.5 0 0 1 3 12a2.5 2.5 0 0 1 2.2-4.7A2.5 2.5 0 0 1 7 3a2.5 2.5 0 0 1 4.7 2.2A2.5 2.5 0 0 1 17 3Z"/>',
  activity: '<path d="M4.8 2.5v5a4.5 4.5 0 0 0 9 0v-5"/><path d="M4.8 2.5h2M11.8 2.5h2"/><path d="M9.3 12v4.5a4.5 4.5 0 0 0 9 0v-1"/><circle cx="18.3" cy="11" r="2"/>',
  'shield-default': '<path d="M12 2l8 4v6c0 5-3.5 9.7-8 12-4.5-2.3-8-7-8-12V6l8-4z"/>',
}
const DEFAULT_ICON = 'shield-default'

function svgFor(inner: string): Buffer {
  // Explicit width/height so sharp can read SVG dimensions without erroring.
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#0f766e" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`,
  )
}

async function main() {
  const payload = await getPayload({ config })
  let created = 0, linked = 0

  // 1) Categories (idempotent by slug), localized ar + en.
  const catBySlug: Record<string, number | string> = {}
  for (const c of CATEGORIES) {
    const existing = await payload.find({ collection: 'categories', where: { slug: { equals: c.slug } }, limit: 1, depth: 0 })
    if (existing.docs[0]) { catBySlug[c.slug] = existing.docs[0].id; continue }
    const doc = await payload.create({ collection: 'categories', locale: 'ar', data: { slug: c.slug, name: c.ar, color: c.color } })
    await payload.update({ collection: 'categories', id: doc.id, locale: 'en', data: { name: c.en } })
    catBySlug[c.slug] = doc.id; created++
  }

  // 2) Icons (idempotent by label). SVG uploads.
  const iconByLabel: Record<string, number | string> = {}
  for (const [label, inner] of Object.entries(ICON_PATHS)) {
    const existing = await payload.find({ collection: 'icons', where: { label: { equals: label } }, limit: 1, depth: 0 })
    if (existing.docs[0]) { iconByLabel[label] = existing.docs[0].id; continue }
    const buffer = svgFor(inner)
    const doc = await payload.create({
      collection: 'icons',
      data: { label },
      file: { data: buffer, mimetype: 'image/svg+xml', name: `${label}.svg`, size: buffer.length },
    })
    iconByLabel[label] = doc.id; created++
  }

  // 3-5) Backfill FK columns via raw SQL. Set-based and bypasses document validation, so a
  // pre-existing invalid field on some row (e.g. a missing localized title) can't block the
  // backfill. Only rows whose FK is still NULL are touched — fully idempotent.
  const db = (payload.db as any).drizzle
  const affected = async (q: any) => Number((await db.run(q))?.rowsAffected ?? 0)

  // articles.category_rel_id from the legacy `category` slug
  for (const [slug, id] of Object.entries(catBySlug)) {
    linked += await affected(sql`UPDATE articles SET category_rel_id = ${id} WHERE category = ${slug} AND category_rel_id IS NULL`)
  }
  // doctors.department_rel_id from the legacy `department` slug (correlated to departments.slug)
  linked += await affected(sql`UPDATE doctors SET department_rel_id = (SELECT id FROM departments WHERE slug = doctors.department) WHERE department_rel_id IS NULL AND department IS NOT NULL AND EXISTS (SELECT 1 FROM departments WHERE slug = doctors.department)`)
  // departments.icon_ref_id from the legacy `icon` name, then the default icon for any remainder
  for (const [label, id] of Object.entries(iconByLabel)) {
    linked += await affected(sql`UPDATE departments SET icon_ref_id = ${id} WHERE icon = ${label} AND icon_ref_id IS NULL`)
  }
  const defIcon = iconByLabel[DEFAULT_ICON]
  if (defIcon) linked += await affected(sql`UPDATE departments SET icon_ref_id = ${defIcon} WHERE icon_ref_id IS NULL`)

  console.log(`seed-and-backfill: created ${created} record(s), linked ${linked} relationship(s). OK`)
  process.exit(0)
}

main().catch((e) => { console.error('seed-and-backfill FAILED:', e); process.exit(1) })
