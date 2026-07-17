// Real-pipeline integration coverage for Task A (tenant types + feature templates) against an
// isolated, throwaway SQLite database. No persistent/dev database is touched.
import assert from 'node:assert/strict'
import test from 'node:test'
import type { Endpoint } from 'payload'
import { rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// The config reads DATABASE_URI at import time; point it at an isolated temp file BEFORE the
// dynamic import (static imports are hoisted and would load the config too early).
const TEMP_DB = join(tmpdir(), `tenant-types-itest-${process.pid}-${Date.now()}.db`)
process.env.DATABASE_URI = `file:${TEMP_DB}`
process.env.PAYLOAD_SECRET = process.env.PAYLOAD_SECRET || 'tenant-types-itest-secret'

const { default: config } = await import('../src/payload.config')
const { getPayload } = await import('payload')
const { Tenants } = await import('../src/collections/Tenants')

type PayloadLike = {
  create: (args: unknown) => Promise<Record<string, unknown>>
  findByID: (args: unknown) => Promise<Record<string, unknown>>
  update: (args: unknown) => Promise<Record<string, unknown>>
  find: (args: unknown) => Promise<{ docs: Record<string, unknown>[] }>
  delete: (args: unknown) => Promise<unknown>
  db: { migrate: () => Promise<void>; destroy: () => Promise<void> }
  destroy: () => Promise<void>
}

let payload: PayloadLike | undefined
let superAdmin: Record<string, unknown>
let tenantAdmin: Record<string, unknown>

const asArr = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])
const featuresOf = (doc: Record<string, unknown>): string[] => asArr(doc.features).map(String)

// The hero stat group has four required localized `value` subfields (years/departments/patients/staff).
// Every tenant create must supply them or Payload rejects the document before the behavior under
// test runs. Mirrors the valid-create fixture in tenant-settings.integration.test.ts.
const HERO_STATS = {
  years: { value: '20' },
  departments: { value: '12' },
  patients: { value: '500k' },
  staff: { value: '800' },
}

const createType = async (slug: string, defaultFeatures: string[]) => {
  const t = await payload!.create({
    collection: 'tenant-types',
    data: { slug, name: slug, defaultFeatures },
    overrideAccess: true,
  })
  return t.id as number
}

test.before(async () => {
  payload = (await getPayload({ config })) as unknown as PayloadLike
  await payload.db.migrate()

  superAdmin = await payload.create({
    collection: 'users',
    data: { email: `sa-${Date.now()}@example.test`, password: 'password12345', roles: ['super-admin'], tenants: [] },
    overrideAccess: true,
  })
  tenantAdmin = await payload.create({
    collection: 'users',
    data: {
      email: `ta-${Date.now()}@example.test`,
      password: 'password12345',
      roles: ['admin'],
      tenants: [], // assigned to a tenant below once it exists
    },
    overrideAccess: true,
  })
})

test.after(async () => {
  try { await payload?.destroy() } catch { /* disposable */ }
  try { rmSync(TEMP_DB, { force: true }) } catch { /* ignore */ }
})

const api = (): PayloadLike => {
  if (!payload) throw new Error('payload not initialized')
  return payload
}

const resetHandler = (Tenants.endpoints as Omit<Endpoint, 'root'>[]).find((e) => e.path === '/:id/reset-features-to-type-defaults')!.handler as
  (req: { user: unknown; routeParams: { id?: string }; payload: unknown }) => Promise<Response>

// ---------------------------------------------------------------------------
// 1. New tenant with omitted features copies the selected type template
// ---------------------------------------------------------------------------

test('create with omitted features copies the type defaultFeatures (cloned)', async () => {
  const typeId = await createType(`tpl-${Date.now()}-a`, ['articles', 'events'])
  const tenant = await api().create({
    collection: 'tenants',
    data: { name: 'Copy Template', slug: `copy-${process.pid}-${Date.now()}`, type: typeId, hero: HERO_STATS },
    overrideAccess: true,
  })
  assert.deepEqual(featuresOf(tenant).sort(), ['articles', 'events'])
})

test('create with an explicitly empty features array stays empty', async () => {
  const typeId = await createType(`tpl-${Date.now()}-b`, ['articles'])
  const tenant = await api().create({
    collection: 'tenants',
    data: { name: 'Explicit Empty', slug: `empty-${process.pid}-${Date.now()}`, type: typeId, features: [], hero: HERO_STATS },
    overrideAccess: true,
  })
  assert.deepEqual(featuresOf(tenant), [])
})

test('create with an explicit non-empty features value is preserved', async () => {
  const typeId = await createType(`tpl-${Date.now()}-c`, ['articles', 'events'])
  const tenant = await api().create({
    collection: 'tenants',
    data: { name: 'Explicit Set', slug: `set-${process.pid}-${Date.now()}`, type: typeId, features: ['portal'], hero: HERO_STATS },
    overrideAccess: true,
  })
  assert.deepEqual(featuresOf(tenant), ['portal'])
})

// ---------------------------------------------------------------------------
// 2. Changing a tenant's type never silently changes its customized features
// ---------------------------------------------------------------------------

test('updating a tenant type leaves its customized features untouched', async () => {
  const typeA = await createType(`tpl-${Date.now()}-d`, ['articles'])
  const typeB = await createType(`tpl-${Date.now()}-e`, ['events', 'portal'])
  const tenant = await api().create({
    collection: 'tenants',
    data: { name: 'Type Change', slug: `tc-${process.pid}-${Date.now()}`, type: typeA, features: ['departments'], hero: HERO_STATS },
    overrideAccess: true,
  })
  const updated = await api().update({
    collection: 'tenants',
    id: tenant.id,
    data: { type: typeB },
    overrideAccess: true,
  })
  assert.deepEqual(featuresOf(updated), ['departments'], 'features must not change when the type changes')
})

// ---------------------------------------------------------------------------
// 3. Reset endpoint: success copies the current template; empty template yields []
// ---------------------------------------------------------------------------

test('reset replaces customized features with the current type template (success)', async () => {
  const typeId = await createType(`tpl-${Date.now()}-f`, ['articles', 'team'])
  const tenant = await api().create({
    collection: 'tenants',
    data: { name: 'Reset Me', slug: `reset-${process.pid}-${Date.now()}`, type: typeId, features: ['portal'], hero: HERO_STATS },
    overrideAccess: true,
  })

  const res = await resetHandler({ user: superAdmin, routeParams: { id: String(tenant.id) }, payload: api() })
  assert.equal(res.status, 200)
  const body = await res.json()
  assert.deepEqual((body.features as string[]).sort(), ['articles', 'team'])
  assert.equal(String(body.typeId), String(typeId))

  // Persisted: a fresh read reflects the reset set.
  const after = await api().findByID({ collection: 'tenants', id: tenant.id, depth: 0, overrideAccess: true })
  assert.deepEqual(featuresOf(after).sort(), ['articles', 'team'])
})

test('reset against a type with an intentionally empty template clears features', async () => {
  const typeId = await createType(`tpl-${Date.now()}-g`, [])
  const tenant = await api().create({
    collection: 'tenants',
    data: { name: 'Reset Empty', slug: `reset-empty-${process.pid}-${Date.now()}`, type: typeId, features: ['portal'], hero: HERO_STATS },
    overrideAccess: true,
  })
  const res = await resetHandler({ user: superAdmin, routeParams: { id: String(tenant.id) }, payload: api() })
  assert.equal(res.status, 200)
  const body = await res.json()
  assert.deepEqual(body.features, [])
})

test('reset rejects a tenant admin with 403 and does not change features', async () => {
  const typeId = await createType(`tpl-${Date.now()}-h`, ['articles'])
  const tenant = await api().create({
    collection: 'tenants',
    data: { name: 'Forbidden Reset', slug: `forbid-${process.pid}-${Date.now()}`, type: typeId, features: ['portal'], hero: HERO_STATS },
    overrideAccess: true,
  })
  const res = await resetHandler({ user: tenantAdmin, routeParams: { id: String(tenant.id) }, payload: api() })
  assert.equal(res.status, 403)
  const after = await api().findByID({ collection: 'tenants', id: tenant.id, depth: 0, overrideAccess: true })
  assert.deepEqual(featuresOf(after), ['portal'])
})

// ---------------------------------------------------------------------------
// 4. Referenced tenant type deletion is rejected with a clear 400
// ---------------------------------------------------------------------------

test('deleting a tenant type referenced by a tenant is rejected with 400', async () => {
  const typeId = await createType(`tpl-${Date.now()}-i`, ['articles'])
  await api().create({
    collection: 'tenants',
    data: { name: 'Reference Holder', slug: `ref-${process.pid}-${Date.now()}`, type: typeId, hero: HERO_STATS },
    overrideAccess: true,
  })
  await assert.rejects(
    api().delete({ collection: 'tenant-types', id: typeId, overrideAccess: true }),
    (err: { status?: number; message?: string }) => {
      assert.equal(err.status, 400, `expected 400, got ${err.status}: ${err.message}`)
      return true
    },
  )
})

test('deleting an unreferenced tenant type succeeds', async () => {
  const typeId = await createType(`tpl-${Date.now()}-j`, ['articles'])
  await api().delete({ collection: 'tenant-types', id: typeId, overrideAccess: true })
})

// ---------------------------------------------------------------------------
// 5. Public site: anonymous /api/tenants?depth=1 populates the type relationship
// ---------------------------------------------------------------------------

test('anonymous read populates the tenant type relationship (no auth fallback to hospital)', async () => {
  const slug = `clinic-${process.pid}-${Date.now()}`
  const typeId = await createType(slug, ['articles'])
  await api().create({
    collection: 'tenants',
    data: { name: 'Public Resolve', slug: `pub-${process.pid}-${Date.now()}`, type: typeId, hero: HERO_STATS },
    overrideAccess: true,
  })
  const found = await api().find({
    collection: 'tenants',
    depth: 1,
    overrideAccess: false,
    where: { type: { equals: typeId } },
    req: { user: null } as never,
  })
  assert.equal(found.docs.length, 1)
  const type = found.docs[0].type as { slug?: string; id?: number } | number | undefined
  // With public tenant-types.read, depth=1 must populate the related doc (slug present), so the
  // frontend relSlug() normalizer resolves the real type instead of falling back to 'hospital'.
  assert.equal(typeof type, 'object', 'type relationship must be populated, not left as a scalar id')
  assert.equal((type as { slug?: string })?.slug, slug)
})
