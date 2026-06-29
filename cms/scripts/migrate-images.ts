// Migrate external image URLs -> Media uploads.
//
// Precondition: schema migration 20260629_100000_media_and_uploads has run, so
// each image-bearing table has a `*_id` FK and the old TEXT url columns are gone.
//
// Reads image-urls.json (extracted before the schema migration) — one row per
// (collection, slug, url) — downloads each image to ../public/uploads, creates a
// Media doc via the Payload Local API, and links the parent doc's *_id field.
//
// Idempotent: a parent whose *_id is already set is skipped, so re-running after
// a partial failure picks up where it left off.
import 'dotenv/config'
import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { getPayload } from 'payload'
import config from '../src/payload.config'
import type { Readable } from 'node:stream'

const dirname = path.dirname(fileURLToPath(import.meta.url))
const UPLOADS = path.resolve(dirname, '../../public/uploads')
const URL_JSON = path.resolve(dirname, '../image-urls.json')

// collection slug -> { fkField } the upload-relationship column on the parent table
const FIELD_MAP: Record<string, { fk: string }> = {
  doctors: { fk: 'photo' },
  articles: { fk: 'thumbnail' },
  awards: { fk: 'badgeImage' },
  events: { fk: 'thumbnail' },
  testimonials: { fk: 'avatar' },
}

type Row = { coll: string; slug: string; url: string }

async function download(url: string): Promise<{ buffer: Buffer; mimeType: string; ext: string }> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`)
  const mimeType = res.headers.get('content-type') || 'image/jpeg'
  const buf = Buffer.from(await res.arrayBuffer())
  const ext = mimeType.includes('png') ? 'png' : mimeType.includes('webp') ? 'webp' : 'jpg'
  return { buffer: buf, mimeType, ext }
}

async function main() {
  if (!existsSync(URL_JSON)) throw new Error(`missing ${URL_JSON} — re-extract urls before running`)
  const rows: Row[] = JSON.parse(readFileSync(URL_JSON, 'utf-8'))
  await mkdir(UPLOADS, { recursive: true })

  const payload = await getPayload({ config })
  let migrated = 0, skipped = 0, failed = 0

  for (const row of rows) {
    const { coll, slug, url } = row
    const map = FIELD_MAP[coll]
    if (!map) { console.warn(`? no field map for ${coll}`); continue }

    // find parent doc
    const found = await payload.find({ collection: coll as any, where: { slug: { equals: slug } }, limit: 1, pagination: false, depth: 1 })
    const parent = found.docs[0] as any
    if (!parent) { console.warn(`✗ ${coll}/${slug}: parent not found`); failed++; continue }

    // idempotent: skip if already linked
    const existing = parent[map.fk]
    if (existing && (typeof existing === 'number' || existing?.id)) { skipped++; continue }

    try {
      const { buffer, mimeType, ext } = await download(url)
      const filename = `${coll}-${slug}.${ext}`

      // create Media doc via Payload's file-upload path
      const media = await payload.create({
        collection: 'media' as any,
        data: { alt: `${coll} ${slug}` },
        file: { data: buffer, mimetype: mimeType, name: filename, size: buffer.length },
      }) as any

      // link parent
      await payload.update({ collection: coll as any, id: parent.id, data: { [map.fk]: media.id } })
      console.log(`✓ ${coll}/${slug} -> media #${media.id} (${filename}, ${buffer.length}b)`)
      migrated++
    } catch (e: any) {
      console.error(`✗ ${coll}/${slug}: ${e.message}`)
      failed++
    }
  }

  console.log(`\nDone. migrated=${migrated} skipped=${skipped} failed=${failed}`)
  await payload.destroy()
  process.exit(failed ? 1 : 0)
}

main().catch((e) => { console.error(e); process.exit(1) })
