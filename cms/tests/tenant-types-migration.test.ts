// Data-safe migration round-trip for the tenant_types migration. Runs entirely on a throwaway
// scratch SQLite file: applies every migration EXCEPT the new one, seeds legacy data (including an
// unexpected legacy type string), then exercises up -> down -> up and asserts:
//   - every distinct nonblank legacy type is preserved (incl. unexpected values);
//   - hospital/clinic get their known localized labels;
//   - each type's defaultFeatures = union of features used by tenants of that legacy type;
//   - existing tenant feature rows remain unchanged through up/down/up;
//   - the legacy text column is removed on up and restored (slug) on down;
//   - up -> down -> up is idempotent on scratch SQLite.
import assert from 'node:assert/strict'
import test from 'node:test'
import { rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { sql } from '@payloadcms/db-sqlite'

const TEMP_DB = join(tmpdir(), `tenant-types-migrtest-${process.pid}-${Date.now()}.db`)
process.env.DATABASE_URI = `file:${TEMP_DB}`
process.env.PAYLOAD_SECRET = process.env.PAYLOAD_SECRET || 'tenant-types-migrtest-secret'

const { default: config } = await import('../src/payload.config')
const { getPayload } = await import('payload')
const { migrations } = await import('../src/migrations')

const MIGRATION_INDEX = migrations.findIndex((m) => m.name === '20260715_190731_tenant_types')
const PRIOR = migrations.slice(0, MIGRATION_INDEX)
const TARGET = migrations[MIGRATION_INDEX]

type DB = { run: (q: unknown) => Promise<{ rows: unknown[] }> }

let payload: Awaited<ReturnType<typeof getPayload>> | undefined
let db: DB | undefined

// The drizzle instance (payload.db.drizzle) is exactly what Payload passes to migrations as `db`
// (it exposes `.run(sql\`...\`)`, the only method these SQL-only migrations use). Capture it once.
const drizzle = (): DB => {
  if (!db) throw new Error('db not initialized')
  return db
}

// Run a batch of migrations up/down in order, passing the drizzle instance as `db`.
const runMigrations = async (list: typeof migrations, dir: 'up' | 'down') => {
  for (const m of list) {
    await m[dir]({ db: drizzle(), payload: payload, req: undefined } as never)
  }
}

const rows = async (query: ReturnType<typeof sql>) => {
  const res = await drizzle().run(query)
  return res.rows as Record<string, unknown>[]
}

const scalar = async <T = unknown>(query: ReturnType<typeof sql>): Promise<T | undefined> => {
  const r = await rows(query)
  return (r[0] as Record<string, unknown> | undefined)?.v as T | undefined
}

// Read the full feature set for a tenant as ordered "parent_id:value" rows (stable for comparison).
const featureRows = async () => {
  const r = await rows(sql`SELECT parent_id || ':' || value AS v FROM tenants_features ORDER BY parent_id, \`order\`;`)
  return r.map((row) => String(row.v))
}

const insertLegacyTenant = async (slug: string, type: string, features: string[]) => {
  await drizzle().run(sql`INSERT INTO \`tenants\` (\`slug\`, \`type\`) VALUES (${slug}, ${type});`)
  const id = await scalar<number>(sql`SELECT id AS v FROM \`tenants\` WHERE slug = ${slug};`)
  if (id === undefined) throw new Error(`tenant ${slug} not inserted`)
  for (let i = 0; i < features.length; i++) {
    await drizzle().run(
      sql`INSERT INTO \`tenants_features\` (\`order\`, \`parent_id\`, \`value\`) VALUES (${i}, ${id}, ${features[i]});`,
    )
  }
  return id
}

test.before(async () => {
  payload = await getPayload({ config })
  db = (payload as unknown as { db: { drizzle: DB } }).db.drizzle
  // Apply every migration up to (but not including) the new one: schema has the legacy text `type`.
  await runMigrations(PRIOR, 'up')
})

test.after(async () => {
  try { await payload?.destroy() } catch { /* disposable */ }
  try { rmSync(TEMP_DB, { force: true }) } catch { /* ignore */ }
})

test('migration is registered after 20260715_180048_remove_article_legacy_fields', () => {
  assert.ok(MIGRATION_INDEX > 0)
  assert.equal(migrations[MIGRATION_INDEX - 1].name, '20260715_180048_remove_article_legacy_fields')
})

test('up -> down -> up preserves legacy types, feature rows, and the relationship mapping', async () => {
  // Seed legacy data: two known types and one UNEXPECTED legacy value, each with distinct features.
  await insertLegacyTenant('legacy-hosp', 'hospital', ['departments', 'team'])
  await insertLegacyTenant('legacy-hosp-2', 'hospital', ['articles'])
  await insertLegacyTenant('legacy-clinic', 'clinic', ['portal'])
  await insertLegacyTenant('legacy-unexpected', 'University Medical Center', ['events', 'awards'])

  const featuresBefore = await featureRows()
  assert.ok(featuresBefore.length >= 5)

  // ---- UP ----
  await TARGET.up({ db: drizzle(), payload: payload, req: undefined } as never)

  // Legacy text column is gone.
  const tenantsCols = await rows(sql`PRAGMA table_info(\`tenants\`);`)
  assert.equal(tenantsCols.some((c) => c.name === 'type'), false, 'legacy tenants.type must be dropped')
  assert.ok(tenantsCols.some((c) => c.name === 'type_id'), 'tenants.type_id must exist')

  // Every distinct nonblank legacy type became a tenant_types row (incl. the unexpected value).
  const typeSlugs = (await rows(sql`SELECT slug AS v FROM \`tenant_types\` ORDER BY slug;`)).map((r) => String(r.v))
  assert.ok(typeSlugs.includes('hospital'))
  assert.ok(typeSlugs.includes('clinic'))
  // Unexpected value normalized to a unique slug (lowercased value).
  assert.ok(typeSlugs.includes('university medical center'), `unexpected type not preserved: ${typeSlugs.join(',')}`)

  // hospital/clinic localized labels are the known ones.
  const hospName = await scalar<string>(
    sql`SELECT l.name AS v FROM \`tenant_types_locales\` l
        JOIN \`tenant_types\` t ON t.id = l._parent_id
        WHERE t.slug = 'hospital' AND l._locale = 'en';`,
  )
  assert.equal(hospName, 'Hospital')
  const clinicNameAr = await scalar<string>(
    sql`SELECT l.name AS v FROM \`tenant_types_locales\` l
        JOIN \`tenant_types\` t ON t.id = l._parent_id
        WHERE t.slug = 'clinic' AND l._locale = 'ar';`,
  )
  assert.equal(clinicNameAr, 'عيادة')

  // The unexpected type keeps a readable display name (original value) in both locales.
  const unexpectedName = await scalar<string>(
    sql`SELECT l.name AS v FROM \`tenant_types_locales\` l
        JOIN \`tenant_types\` t ON t.id = l._parent_id
        WHERE t.slug = 'university medical center' AND l._locale = 'en';`,
  )
  assert.equal(unexpectedName, 'University Medical Center')

  // defaultFeatures = conservative union of features used by tenants of that legacy type.
  const hospDefaults = (await rows(
    sql`SELECT value AS v FROM \`tenant_types_default_features\` f
        JOIN \`tenant_types\` t ON t.id = f.parent_id
        WHERE t.slug = 'hospital' ORDER BY value;`,
  )).map((r) => String(r.v))
  assert.deepEqual(hospDefaults.sort(), ['articles', 'departments', 'team'])

  const clinicDefaults = (await rows(
    sql`SELECT value AS v FROM \`tenant_types_default_features\` f
        JOIN \`tenant_types\` t ON t.id = f.parent_id
        WHERE t.slug = 'clinic' ORDER BY value;`,
  )).map((r) => String(r.v))
  assert.deepEqual(clinicDefaults, ['portal'])

  const unexpectedDefaults = (await rows(
    sql`SELECT value AS v FROM \`tenant_types_default_features\` f
        JOIN \`tenant_types\` t ON t.id = f.parent_id
        WHERE t.slug = 'university medical center' ORDER BY value;`,
  )).map((r) => String(r.v))
  assert.deepEqual(unexpectedDefaults.sort(), ['awards', 'events'])

  // Every tenant backfilled to its type (no unresolved relationship).
  const unresolved = await scalar<number>(
    sql`SELECT count(*) AS v FROM \`tenants\` WHERE type_id IS NULL;`,
  )
  assert.equal(unresolved, 0)

  // Existing tenant feature rows are byte/row equivalent after up.
  const featuresAfterUp = await featureRows()
  assert.deepEqual(featuresAfterUp, featuresBefore)

  // ---- DOWN ----
  await TARGET.down({ db: drizzle(), payload: payload, req: undefined } as never)
  const colsAfterDown = await rows(sql`PRAGMA table_info(\`tenants\`);`)
  assert.ok(colsAfterDown.some((c) => c.name === 'type'), 'down must restore the legacy tenants.type column')
  assert.equal(colsAfterDown.some((c) => c.name === 'type_id'), false, 'down must remove tenants.type_id')
  const typeTables = (await rows(sql`SELECT name AS v FROM sqlite_master WHERE type='table' AND name='tenant_types';`))
  assert.equal(typeTables.length, 0, 'down must drop the tenant_types table')

  // Down restored the legacy type slug from the relationship.
  const restoredTypes = (await rows(sql`SELECT slug || '|' || type AS v FROM \`tenants\` ORDER BY slug;`)).map((r) => String(r.v))
  assert.ok(restoredTypes.some((v) => v.endsWith('|hospital')))
  assert.ok(restoredTypes.some((v) => v.endsWith('|clinic')))
  assert.ok(
    restoredTypes.some((v) => v.endsWith('|university medical center')),
    `unexpected type slug must be restored on down: ${restoredTypes.join(',')}`,
  )

  // Feature rows unchanged through down.
  assert.deepEqual(await featureRows(), featuresBefore)

  // ---- UP AGAIN (idempotent) ----
  await TARGET.up({ db: drizzle(), payload: payload, req: undefined } as never)
  const featuresAfterReUp = await featureRows()
  assert.deepEqual(featuresAfterReUp, featuresBefore)
  const typeSlugsReUp = (await rows(sql`SELECT slug AS v FROM \`tenant_types\` ORDER BY slug;`)).map((r) => String(r.v))
  assert.deepEqual(typeSlugsReUp, typeSlugs)
})

test('the backfill guard aborts when a tenant has an unmappable (blank) legacy type', async () => {
  // The round-trip test above leaves the DB in the post-up state (legacy `type` column removed).
  // Restore the legacy schema so the guard path is exercisable, then prove a blank type aborts.
  await TARGET.down({ db: drizzle(), payload: payload, req: undefined } as never)

  // A blank legacy type cannot map to any tenant_type slug → the CHECK guard must abort before the
  // legacy column is dropped.
  await drizzle().run(sql`UPDATE \`tenants\` SET \`type\` = '' WHERE slug = 'legacy-hosp';`)
  await assert.rejects(
    TARGET.up({ db: drizzle(), payload: payload, req: undefined } as never),
    // The CHECK(unresolved = 0) violation surfaces through libsql/drizzle as a failed query on the
    // guard table (the constraint name itself is not always echoed).
    /_tenant_type_backfill_guard|failed query|constraint|check/i,
  )

  // The guard aborted before the rebuild, so the legacy `type` column still exists; restore it so
  // the DB is left consistent.
  await drizzle().run(sql`UPDATE \`tenants\` SET \`type\` = 'hospital' WHERE slug = 'legacy-hosp';`)
})
