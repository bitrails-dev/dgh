// Multi-tenant seed + backfill. Run AFTER `payload migrate` applies the schema that adds the
// `tenants` collection and the `tenant` FK to every scoped collection.
//
//   seeds:    the "Dumyat" tenant (type=hospital, all features) with branding + hero + contact
//             copied from the pre-tenant single-hospital values.
//   backfill: tenant_id on every existing scoped row (raw SQL — the content API re-validates and
//             some legacy rows have invalid localized fields, per the migration workflow memory).
//   users:    attach every existing user to Dumyat as a super-admin (Local API — users are simple).
//
// Idempotent: re-running is a no-op (tenant found by slug; backfill only touches NULL tenant_id).
//
// Run: cd cms && npx tsx scripts/seed-tenants.ts
import 'dotenv/config'
import { getPayload } from 'payload'
import { sql } from 'drizzle-orm'
import config from '../src/payload.config'

// Collections scoped by the multi-tenant plugin → their SQLite tables carry a `tenant_id` FK.
// (icons is intentionally shared/platform-wide and NOT listed.)
const SCOPED_TABLES = [
  'media', 'categories', 'doctors', 'departments',
  'articles', 'events', 'awards', 'achievements', 'testimonials',
]

// Dumyat Public Hospital — baked from the pre-tenant i18n `site`/`contact` blocks + hero.json.
const DUMYAT = {
  ar: {
    name: 'مستشفى دمياط العام',
    tagline: 'منارة وطنية للتميز في الصحة العامة',
    established: 'تأسس ١٩٥٩ · دمياط',
    address: 'دمياط - كورنيش النيل - سعد زغلول أمام مبنى ديوان عام المحافظة',
    hours: [
      { day: 'السبت - الخميس', time: '8:00 ص - 9:00 م' },
      { day: 'الجمعة', time: '9:00 ص - 6:00 م' },
    ],
    hero: {
      years: { value: '٦٧', unit: '+' },
      departments: { value: '٢٨', unit: '' },
      patients: { value: '١٫٢', unit: 'م+' },
      staff: { value: '٢٤٠٠', unit: '+' },
    },
  },
  en: {
    name: 'Dumyat Public Hospital',
    tagline: 'A national beacon of public health excellence',
    established: 'Est. 1959 · Damietta',
    address: "Dumyat - Nile Corniche - Sa'd Zaghloul St., in front of the Governorate Building",
    hours: [
      { day: 'Saturday - Thursday', time: '8:00 AM - 9:00 PM' },
      { day: 'Friday', time: '9:00 AM - 6:00 PM' },
    ],
    hero: {
      years: { value: '67', unit: '+' },
      departments: { value: '28', unit: '' },
      patients: { value: '1.2', unit: 'M+' },
      staff: { value: '2,400', unit: '+' },
    },
  },
}

const ALL_FEATURES = [
  'departments', 'team', 'articles', 'events', 'awards', 'achievements', 'testimonials', 'portal',
]

async function main() {
  const payload = await getPayload({ config })

  // 1) Dumyat tenant (idempotent by slug). Create in ar, then patch en localized fields.
  let tenantId: number | string
  const found = await payload.find({ collection: 'tenants', where: { slug: { equals: 'dumyat' } }, limit: 1, depth: 0 })
  if (found.docs[0]) {
    tenantId = found.docs[0].id
    console.log(`✓ tenant 'dumyat' already exists (#${tenantId})`)
  } else {
    const created = await payload.create({
      collection: 'tenants',
      locale: 'ar',
      data: {
        slug: 'dumyat',
        type: 'hospital',
        domains: ['dgh.bitrail.dev', 'localhost', '127.0.0.1'],
        features: ALL_FEATURES,
        name: DUMYAT.ar.name,
        branding: { initials: 'DP', themeColor: '#15504f', tagline: DUMYAT.ar.tagline, established: DUMYAT.ar.established },
        hero: DUMYAT.ar.hero,
        contact: {
          phone: '+20 57 222 4340',
          emergencyNumber: '12345',
          whatsapp: '+20 57 222 4340',
          email: 'nrmenelabd1234@yahoo.com',
          address: DUMYAT.ar.address,
          hours: DUMYAT.ar.hours,
        },
      },
    })
    tenantId = created.id
    await payload.update({
      collection: 'tenants', id: tenantId, locale: 'en',
      data: {
        name: DUMYAT.en.name,
        branding: { tagline: DUMYAT.en.tagline, established: DUMYAT.en.established },
        hero: DUMYAT.en.hero,
        contact: { address: DUMYAT.en.address, hours: DUMYAT.en.hours },
      },
    })
    console.log(`✓ created tenant 'dumyat' (#${tenantId})`)
  }

  // 2) Backfill tenant_id on every scoped table (raw SQL, idempotent).
  const db = (payload.db as any).drizzle
  for (const table of SCOPED_TABLES) {
    const res: any = await db.run(sql.raw(`UPDATE ${table} SET tenant_id = ${tenantId} WHERE tenant_id IS NULL`))
    console.log(`  backfilled ${table}: ${res?.rowsAffected ?? '?'} row(s)`)
  }

  // 3) Attach existing users to Dumyat as super-admins (Local API).
  const users = await payload.find({ collection: 'users', limit: 1000, depth: 0 })
  for (const u of users.docs as any[]) {
    const already = Array.isArray(u.tenants) && u.tenants.some((t: any) => (t?.tenant?.id ?? t?.tenant) == tenantId)
    if (already) continue
    await payload.update({
      collection: 'users', id: u.id,
      data: { roles: ['super-admin'], tenants: [...(u.tenants ?? []), { tenant: tenantId }] },
    })
    console.log(`  attached user ${u.email} to dumyat (super-admin)`)
  }

  // 4) Isolation assertion — no scoped row may be left without a tenant.
  for (const table of SCOPED_TABLES) {
    const r: any = await db.run(sql.raw(`SELECT COUNT(*) AS n FROM ${table} WHERE tenant_id IS NULL`))
    const n = Number(r?.rows?.[0]?.n ?? 0)
    if (n > 0) throw new Error(`isolation check failed: ${table} has ${n} row(s) with NULL tenant_id`)
  }
  console.log('✓ isolation check passed — every scoped row has a tenant')

  console.log('Done.')
  process.exit(0)
}

main().catch((e) => { console.error(e); process.exit(1) })
