// Payload -> Astro. Reads every collection and writes markdown into ../../src/content/<dir>.
// Run after editing in the admin, then commit src/content to trigger the Astro rebuild.
import 'dotenv/config'
import { getPayload } from 'payload'
import config from '../src/payload.config'
import matter from 'gray-matter'
import { readdirSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { SPECS, en, ar } from './specs'

const dirname = path.dirname(fileURLToPath(import.meta.url))
const CONTENT = path.resolve(dirname, '../../src/content')

const payload = await getPayload({ config })

for (const spec of SPECS) {
  const outDir = path.join(CONTENT, spec.dir)
  mkdirSync(outDir, { recursive: true })

  const { docs } = await payload.find({
    collection: spec.collection as any,
    locale: 'all',
    depth: 0,
    limit: 100000,
    pagination: false,
  })

  const kept = new Set<string>()
  for (const doc of docs) {
    const { slug, frontmatter, body } = spec.toFile(doc)
    if (!slug) {
      console.warn(`  ! ${spec.collection} id=${doc.id} has no slug — skipped`)
      continue
    }
    writeFileSync(path.join(outDir, `${slug}.md`), matter.stringify(body ?? '', frontmatter))
    kept.add(`${slug}.md`)
  }

  // Drop markdown for records deleted in Payload.
  if (existsSync(outDir)) {
    for (const file of readdirSync(outDir)) {
      if (file.endsWith('.md') && !kept.has(file)) rmSync(path.join(outDir, file))
    }
  }

  console.log(`✓ ${spec.collection}: ${kept.size} files`)
}

// Globals → src/content/settings/*.json (singletons, not markdown). Keys must match the
// shapes Astro imports directly (hero.json, contact.json).
{
  const g: any = await payload.findGlobal({ slug: 'hospital-settings', locale: 'all', depth: 0 })
  const settingsDir = path.join(CONTENT, 'settings')
  mkdirSync(settingsDir, { recursive: true })

  const stat = (s: any = {}) => ({ value: en(s.value), valueAr: ar(s.value), unit: en(s.unit), unitAr: ar(s.unit) })
  const h = g.hero || {}
  const hero = {
    stats: { years: stat(h.years), departments: stat(h.departments), patients: stat(h.patients), staff: stat(h.staff) },
  }
  writeFileSync(path.join(settingsDir, 'hero.json'), JSON.stringify(hero, null, 2) + '\n')

  const c = g.contact || {}
  const contact = {
    phone: c.phone || '',
    emergencyNumber: c.emergencyNumber || '',
    whatsapp: c.whatsapp || '',
    email: c.email || '',
    address: en(c.address),
    addressAr: ar(c.address),
    social: {
      facebookUrl: c.social?.facebookUrl || '',
      xUrl: c.social?.xUrl || '',
      youtubeUrl: c.social?.youtubeUrl || '',
    },
    hours: (c.hours || []).map((x: any) => ({ day: en(x.day), dayAr: ar(x.day), time: en(x.time), timeAr: ar(x.time) })),
  }
  writeFileSync(path.join(settingsDir, 'contact.json'), JSON.stringify(contact, null, 2) + '\n')
  console.log('✓ settings: hero.json, contact.json')
}

console.log('Done. Review `git diff src/content`, then commit to deploy.')
process.exit(0)
