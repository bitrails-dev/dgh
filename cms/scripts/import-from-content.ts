// One-time seed: Astro markdown -> Payload. Reads ../../src/content/<dir>/*.md and creates
// docs (default locale AR), then patches the EN locale. Idempotent-ish: skips slugs already
// present. Run once after `npm install` and first admin user creation.
import 'dotenv/config'
import { getPayload } from 'payload'
import config from '../src/payload.config'
import matter from 'gray-matter'
import { readdirSync, readFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { SPECS } from './specs'

const dirname = path.dirname(fileURLToPath(import.meta.url))
const CONTENT = path.resolve(dirname, '../../src/content')

const payload = await getPayload({ config })

for (const spec of SPECS) {
  const inDir = path.join(CONTENT, spec.dir)
  if (!existsSync(inDir)) continue

  let created = 0
  for (const file of readdirSync(inDir).filter((f) => f.endsWith('.md'))) {
    const slug = path.basename(file, '.md')
    const { data: fm, content } = matter(readFileSync(path.join(inDir, file), 'utf-8'))

    const existing = await payload.find({
      collection: spec.collection as any,
      where: { slug: { equals: slug } },
      limit: 1,
      pagination: false,
    })
    if (existing.docs.length) continue

    const { ar, en } = spec.toData(fm, content.trim(), slug)
    const doc = await payload.create({ collection: spec.collection as any, locale: 'ar', data: ar })
    await payload.update({ collection: spec.collection as any, id: doc.id, locale: 'en', data: en })
    created++
  }

  console.log(`✓ ${spec.collection}: imported ${created}`)
}

// Global settings ← settings/hero.json + contact.json.
{
  const settingsDir = path.join(CONTENT, 'settings')
  const heroPath = path.join(settingsDir, 'hero.json')
  const contactPath = path.join(settingsDir, 'contact.json')
  if (existsSync(heroPath) && existsSync(contactPath)) {
    const hero = JSON.parse(readFileSync(heroPath, 'utf-8'))
    const contact = JSON.parse(readFileSync(contactPath, 'utf-8'))
    const s = hero.stats || {}
    const statAr = (x: any = {}) => ({ value: x.valueAr ?? '', unit: x.unitAr ?? '' })
    const statEn = (x: any = {}) => ({ value: x.value ?? '', unit: x.unit ?? '' })

    await payload.updateGlobal({
      slug: 'hospital-settings',
      locale: 'ar',
      data: {
        hero: { years: statAr(s.years), departments: statAr(s.departments), patients: statAr(s.patients), staff: statAr(s.staff) },
        contact: {
          phone: contact.phone, emergencyNumber: contact.emergencyNumber,
          whatsapp: contact.whatsapp, email: contact.email,
          address: contact.addressAr,
          social: contact.social,
          hours: (contact.hours || []).map((h: any) => ({ day: h.dayAr, time: h.timeAr })),
        },
      },
    })
    await payload.updateGlobal({
      slug: 'hospital-settings',
      locale: 'en',
      data: {
        hero: { years: statEn(s.years), departments: statEn(s.departments), patients: statEn(s.patients), staff: statEn(s.staff) },
        contact: {
          address: contact.address,
          hours: (contact.hours || []).map((h: any) => ({ day: h.day, time: h.time })),
        },
      },
    })
    console.log('✓ hospital-settings: imported hero + contact')
  }
}

console.log('Done. Open the admin to review, then `npm run export` to round-trip back to markdown.')
process.exit(0)
