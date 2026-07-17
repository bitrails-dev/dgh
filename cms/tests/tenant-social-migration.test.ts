// Data-safe round-trip for the social_publishing migration. Runs on a throwaway scratch SQLite file:
// applies every migration EXCEPT the new one, seeds one fully-entitled tenant and one intentionally
// restricted tenant, then exercises up -> down -> up and asserts:
//   - the five new social URL columns + socialPublishing group columns are added on up / removed on down;
//   - the included_platforms table is created/dropped;
//   - the socialPublishing entitlement is backfilled ONLY for tenants that had all four prior groups
//     (restricted tenants are preserved as-is);
//   - up -> down -> up is idempotent on scratch SQLite.
import assert from 'node:assert/strict'
import test from 'node:test'
import { rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { sql } from '@payloadcms/db-sqlite'

const TEMP_DB = join(tmpdir(), `tenant-social-migrtest-${process.pid}-${Date.now()}.db`)
process.env.DATABASE_URI = `file:${TEMP_DB}`
process.env.PAYLOAD_SECRET = process.env.PAYLOAD_SECRET || 'tenant-social-migrtest-secret'

const { default: config } = await import('../src/payload.config')
const { getPayload } = await import('payload')
const { migrations } = await import('../src/migrations')

const MIGRATION_INDEX = migrations.findIndex((m) => m.name === '20260715_200619_social_publishing')
const PRIOR = migrations.slice(0, MIGRATION_INDEX)
const TARGET = migrations[MIGRATION_INDEX]

type DB = { run: (q: unknown) => Promise<{ rows: unknown[] }> }
let payload: Awaited<ReturnType<typeof getPayload>> | undefined
let db: DB | undefined
const drizzle = (): DB => {
  if (!db) throw new Error('db not initialized')
  return db
}
const runMigrations = async (list: typeof migrations, dir: 'up' | 'down') => {
  for (const m of list) await m[dir]({ db: drizzle(), payload: payload, req: undefined } as never)
}
const rows = async (query: ReturnType<typeof sql>) => (await drizzle().run(query)).rows as Record<string, unknown>[]
const scalar = async <T = unknown>(query: ReturnType<typeof sql>): Promise<T | undefined> =>
  ((await rows(query))[0] as Record<string, unknown> | undefined)?.v as T | undefined

const NEW_SOCIAL_COLS = [
  'contact_social_instagram_url',
  'contact_social_threads_url',
  'contact_social_snapchat_url',
  'contact_social_linkedin_url',
  'contact_social_tiktok_url',
]
const tenantCols = async () => (await rows(sql`PRAGMA table_info(\`tenants\`);`)).map((c) => String(c.name))

const entitlementValues = async (tenantSlug: string) =>
  (
    await rows(
      sql`SELECT e.\`value\` AS v FROM \`tenants_settings_entitlement\` e
          JOIN \`tenants\` t ON t.\`id\` = e.\`parent_id\` WHERE t.\`slug\` = ${tenantSlug} ORDER BY e.\`order\`;`,
    )
  ).map((r) => String(r.v))

// Seed one fully-entitled tenant and one restricted tenant. Both need a type_id (required FK).
const seedTenant = async (slug: string, groups: string[]) => {
  await drizzle().run(sql`INSERT INTO \`tenants\` (\`slug\`, \`type_id\`) VALUES (${slug}, ${1});`)
  const id = await scalar<number>(sql`SELECT id AS v FROM \`tenants\` WHERE slug = ${slug};`)
  if (id === undefined) throw new Error(`tenant ${slug} not inserted`)
  for (let i = 0; i < groups.length; i++) {
    await drizzle().run(
      sql`INSERT INTO \`tenants_settings_entitlement\` (\`order\`, \`parent_id\`, \`value\`) VALUES (${i}, ${id}, ${groups[i]});`,
    )
  }
  return id
}

test.before(async () => {
  payload = await getPayload({ config })
  db = (payload as unknown as { db: { drizzle: DB } }).db.drizzle
  await runMigrations(PRIOR, 'up')
  // A tenant_types row is required (tenants.type_id NOT NULL FK).
  await drizzle().run(sql`INSERT INTO \`tenant_types\` (\`slug\`) VALUES ('hospital');`)
})

test.after(async () => {
  try { await payload?.destroy() } catch { /* disposable */ }
  try { rmSync(TEMP_DB, { force: true }) } catch { /* ignore */ }
})

test('the social_publishing migration is registered after tenant_types', () => {
  assert.ok(MIGRATION_INDEX > 0)
  assert.equal(migrations[MIGRATION_INDEX - 1].name, '20260715_190731_tenant_types')
})

test('up -> down -> up: schema + conditional entitlement backfill round-trip', async () => {
  await seedTenant('full-tenant', ['general', 'branding', 'hero', 'contact'])
  await seedTenant('restricted-tenant', ['contact'])

  // ---- UP ----
  await TARGET.up({ db: drizzle(), payload: payload, req: undefined } as never)

  const colsUp = await tenantCols()
  for (const col of NEW_SOCIAL_COLS) assert.ok(colsUp.includes(col), `up must add ${col}`)
  assert.ok(colsUp.includes('social_publishing_enabled'), 'up must add social_publishing_enabled')
  assert.ok(colsUp.includes('social_publishing_default_auto_publish'), 'up must add social_publishing_default_auto_publish')
  const tables = (await rows(sql`SELECT name AS v FROM sqlite_master WHERE type='table' AND name='tenants_social_publishing_included_platforms';`))
  assert.equal(tables.length, 1, 'up must create the included_platforms table')

  // Full tenant received the new group; restricted tenant did NOT.
  assert.ok((await entitlementValues('full-tenant')).includes('socialPublishing'))
  assert.ok(!(await entitlementValues('restricted-tenant')).includes('socialPublishing'))

  // ---- DOWN ----
  await TARGET.down({ db: drizzle(), payload: payload, req: undefined } as never)
  const colsDown = await tenantCols()
  for (const col of NEW_SOCIAL_COLS) assert.ok(!colsDown.includes(col), `down must drop ${col}`)
  assert.ok(!colsDown.includes('social_publishing_enabled'))
  assert.ok(!colsDown.includes('social_publishing_default_auto_publish'))
  const tablesDown = (await rows(sql`SELECT name AS v FROM sqlite_master WHERE type='table' AND name='tenants_social_publishing_included_platforms';`))
  assert.equal(tablesDown.length, 0, 'down must drop the included_platforms table')

  // Down removed only the backfilled group; both tenants' original entitlement is intact.
  assert.deepEqual(await entitlementValues('full-tenant'), ['general', 'branding', 'hero', 'contact'])
  assert.deepEqual(await entitlementValues('restricted-tenant'), ['contact'])

  // ---- UP AGAIN (idempotent backfill) ----
  await TARGET.up({ db: drizzle(), payload: payload, req: undefined } as never)
  const fullValues = await entitlementValues('full-tenant')
  assert.equal(fullValues.filter((v) => v === 'socialPublishing').length, 1, 'backfill must not duplicate the group')
  assert.ok(!(await entitlementValues('restricted-tenant')).includes('socialPublishing'))
})
