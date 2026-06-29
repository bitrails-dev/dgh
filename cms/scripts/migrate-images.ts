// Link images: reads image URLs from the source markdown frontmatter, downloads
// each to ../../public/uploads, creates a Media doc via the Payload Local API,
// and links the parent doc's upload field.
//
// Works on any DB state — fresh import or existing. The source of truth for
// image URLs is the markdown (src/content/<dir>/*.md), so this is independent of
// whatever a DB snapshot may contain.
//
// Idempotent: a parent whose image field is already set is skipped.
//
// Run after `import-from-content.ts` (which creates the parent docs) and after
// the media/upload schema migration.
import 'dotenv/config'
import { mkdir } from 'node:fs/promises'
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import matter from 'gray-matter'
import { getPayload } from 'payload'
import config from '../src/payload.config'

const dirname = path.dirname(fileURLToPath(import.meta.url))
const UPLOADS = path.resolve(dirname, '../../public/uploads')
const CONTENT = path.resolve(dirname, '../../src/content')

// collection slug -> { dir, fmField, fkField }
//   dir:     markdown source directory
//   fmField: frontmatter key holding the image URL
//   fkField: Payload upload-relationship field name (the *_id column derives from it)
const MAP: Record<string, { dir: string; fm: string; fk: string }> = {
  doctors: { dir: 'doctors', fm: 'photo', fk: 'photo' },
  articles: { dir: 'articles', fm: 'thumbnail', fk: 'thumbnail' },
  awards: { dir: 'awards', fm: 'badgeImage', fk: 'badgeImage' },
  events: { dir: 'events', fm: 'thumbnail', fk: 'thumbnail' },
  testimonials: { dir: 'testimonials', fm: 'avatar', fk: 'avatar' },
}

async function download(url: string): Promise<{ buffer: Buffer; mimeType: string; ext: string }> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`)
  const mimeType = res.headers.get('content-type') || 'image/jpeg'
  const buf = Buffer.from(await res.arrayBuffer())
  const ext = mimeType.includes('png') ? 'png' : mimeType.includes('webp') ? 'webp' : 'jpg'
  return { buffer: buf, mimeType, ext }
}

async function main() {
  await mkdir(UPLOADS, { recursive: true })
  const payload = await getPayload({ config })
  let migrated = 0, skipped = 0, failed = 0

  for (const [coll, { dir, fm, fk }] of Object.entries(MAP)) {
    const inDir = path.join(CONTENT, dir)
    if (!existsSync(inDir)) continue

    for (const file of readdirSync(inDir).filter((f) => f.endsWith('.md'))) {
      const slug = path.basename(file, '.md')
      const { data: frontmatter } = matter(readFileSync(path.join(inDir, file), 'utf-8'))
      const url: string | undefined = frontmatter[fm]
      if (!url) { skipped++; continue }

      const found = await payload.find({
        collection: coll as any, where: { slug: { equals: slug } }, limit: 1, depth: 1, pagination: false,
      })
      const parent = found.docs[0] as any
      if (!parent) { console.warn(`✗ ${coll}/${slug}: parent not found (run import-from-content first)`); failed++; continue }

      // idempotent: skip if already linked
      const existing = parent[fk]
      if (existing && (typeof existing === 'number' || existing?.id)) { skipped++; continue }

      try {
        const { buffer, mimeType, ext } = await download(url)
        const filename = `${coll}-${slug}.${ext}`
        const media = await payload.create({
          collection: 'media' as any,
          data: { alt: `${coll} ${slug}` },
          file: { data: buffer, mimetype: mimeType, name: filename, size: buffer.length },
        }) as any
        await payload.update({ collection: coll as any, id: parent.id, data: { [fk]: media.id } })
        console.log(`✓ ${coll}/${slug} -> media #${media.id} (${filename}, ${buffer.length}b)`)
        migrated++
      } catch (e: any) {
        console.error(`✗ ${coll}/${slug}: ${e.message}`)
        failed++
      }
    }
  }

  console.log(`\nDone. migrated=${migrated} skipped=${skipped} failed=${failed}`)
  await payload.destroy()
  process.exit(failed ? 1 : 0)
}

main().catch((e) => { console.error(e); process.exit(1) })
