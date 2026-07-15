// Multi-tenant seed + backfill. Run AFTER `payload migrate` applies the schema that adds the
// `tenants` collection and the `tenant` FK to every scoped collection.
//
//   seeds:    the "Damietta General Hospital" tenant (type=hospital, all features) with branding + hero + contact
//             copied from the pre-tenant single-hospital values.
//   backfill: tenant_id on every existing scoped row (raw SQL — the content API re-validates and
//             some legacy rows have invalid localized fields, per the migration workflow memory).
//   users:    attach every existing user to Damietta General Hospital, preserving assigned roles;
//             legacy users without a role become super-admins.
//
// Idempotent: re-running is a no-op (tenant found by slug; backfill only touches NULL tenant_id).
//
// Run: cd cms && npx tsx scripts/seed-tenants.ts
import 'dotenv/config'
import { getPayload } from 'payload'
import { sql } from '@payloadcms/db-sqlite'
import config from '../src/payload.config'

// Collections scoped by the multi-tenant plugin → their SQLite tables carry a `tenant_id` FK.
// (icons is intentionally shared/platform-wide and NOT listed.)
const SCOPED_TABLES = [
  'media', 'categories', 'doctors', 'departments',
  'articles', 'events', 'awards', 'achievements', 'testimonials',
]

// Damietta General Hospital — baked from the pre-tenant i18n `site`/`contact` blocks + hero.json.
const DAMIETTA_GENERAL_HOSPITAL = {
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
    name: 'Damietta General Hospital',
    tagline: 'A national beacon of public health excellence',
    established: 'Est. 1959 · Damietta',
    address: "Damietta - Nile Corniche - Sa'd Zaghloul St., in front of the Governorate Building",
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

const ALL_FEATURES: Array<
  'departments' | 'team' | 'articles' | 'events' | 'awards' |
  'achievements' | 'testimonials' | 'portal'
> = [
  'departments', 'team', 'articles', 'events', 'awards', 'achievements', 'testimonials', 'portal',
]

async function main() {
  const payload = await getPayload({ config })

  // 1) Damietta General Hospital tenant. Upgrade the legacy slug if it already exists.
  let tenantId: number | string
  const found = await payload.find({
    collection: 'tenants',
    where: {
      or: [
        { slug: { equals: 'damietta-general-hospital' } },
        { slug: { equals: 'dumyat' } },
      ],
    },
    limit: 1,
    depth: 0,
  })
  if (found.docs[0]) {
    tenantId = found.docs[0].id
    if (found.docs[0].slug === 'dumyat') {
      await payload.update({
        collection: 'tenants',
        id: tenantId,
        data: { slug: 'damietta-general-hospital' },
      })
      console.log(`✓ renamed tenant 'dumyat' to 'damietta-general-hospital' (#${tenantId})`)
    } else {
      console.log(`✓ tenant 'damietta-general-hospital' already exists (#${tenantId})`)
    }
    await payload.update({
      collection: 'tenants',
      id: tenantId,
      locale: 'en',
      data: {
        name: DAMIETTA_GENERAL_HOSPITAL.en.name,
        branding: {
          tagline: DAMIETTA_GENERAL_HOSPITAL.en.tagline,
          established: DAMIETTA_GENERAL_HOSPITAL.en.established,
        },
        contact: { address: DAMIETTA_GENERAL_HOSPITAL.en.address },
      },
    })
  } else {
    const created = await payload.create({
      collection: 'tenants',
      locale: 'ar',
      data: {
        slug: 'damietta-general-hospital',
        type: 'hospital',
        domains: ['dgh.bitrail.dev', 'localhost', '127.0.0.1'],
        features: ALL_FEATURES,
        name: DAMIETTA_GENERAL_HOSPITAL.ar.name,
        branding: { initials: 'DP', themeColor: '#15504f', tagline: DAMIETTA_GENERAL_HOSPITAL.ar.tagline, established: DAMIETTA_GENERAL_HOSPITAL.ar.established },
        hero: DAMIETTA_GENERAL_HOSPITAL.ar.hero,
        contact: {
          phone: '+20 57 222 4340',
          emergencyNumber: '12345',
          whatsapp: '+20 57 222 4340',
          email: 'nrmenelabd1234@yahoo.com',
          address: DAMIETTA_GENERAL_HOSPITAL.ar.address,
          hours: DAMIETTA_GENERAL_HOSPITAL.ar.hours,
        },
      },
    })
    tenantId = created.id
    await payload.update({
      collection: 'tenants', id: tenantId, locale: 'en',
      data: {
        name: DAMIETTA_GENERAL_HOSPITAL.en.name,
        branding: { tagline: DAMIETTA_GENERAL_HOSPITAL.en.tagline, established: DAMIETTA_GENERAL_HOSPITAL.en.established },
        hero: DAMIETTA_GENERAL_HOSPITAL.en.hero,
        contact: { address: DAMIETTA_GENERAL_HOSPITAL.en.address, hours: DAMIETTA_GENERAL_HOSPITAL.en.hours },
      },
    })
    console.log(`✓ created tenant 'damietta-general-hospital' (#${tenantId})`)
  }

  // 2) Backfill tenant_id on every scoped table (raw SQL, idempotent).
  const db = (payload.db as any).drizzle
  for (const table of SCOPED_TABLES) {
    const res: any = await db.run(sql.raw(`UPDATE ${table} SET tenant_id = ${tenantId} WHERE tenant_id IS NULL`))
    console.log(`  backfilled ${table}: ${res?.rowsAffected ?? '?'} row(s)`)
  }

  // 3) Attach existing users to Damietta General Hospital, preserving assigned roles (Local API).
  let userPage = 1
  while (true) {
    const users = await payload.find({ collection: 'users', limit: 100, page: userPage, depth: 0 })
    for (const u of users.docs as any[]) {
      const already = Array.isArray(u.tenants) && u.tenants.some((t: any) => (t?.tenant?.id ?? t?.tenant) == tenantId)
      if (already) continue

      // Legacy users have no role because the roles table was introduced by this migration.
      // Preserve any role already assigned so rerunning this script never elevates an editor/admin.
      const roles = Array.isArray(u.roles) && u.roles.length > 0 ? u.roles : ['super-admin']
      await payload.update({
        collection: 'users', id: u.id,
        data: { roles, tenants: [...(u.tenants ?? []), { tenant: tenantId }] },
      })
      console.log(`  attached user ${u.email} to damietta-general-hospital (${roles.join(', ')})`)
    }

    if (!users.hasNextPage || !users.nextPage) break
    userPage = users.nextPage
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
