// Real-pipeline integration coverage for the tenant settings entitlement.
// Runs entirely against an isolated, throwaway SQLite database (created in the OS temp dir) so no
// persistent/dev database is touched. The temp DB is migrated from scratch, proving the versioned
// migration is valid SQL, then seeded and exercised through the real Payload Local API.
import assert from 'node:assert/strict'
import test from 'node:test'
import { rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// The config reads DATABASE_URI at import time, so point it at an isolated temp file BEFORE the
// dynamic import (static imports are hoisted and would load the config too early).
const TEMP_DB = join(tmpdir(), `tenant-settings-itest-${process.pid}-${Date.now()}.db`)
process.env.DATABASE_URI = `file:${TEMP_DB}`
process.env.PAYLOAD_SECRET = process.env.PAYLOAD_SECRET || 'tenant-settings-itest-secret'

const { default: config } = await import('../src/payload.config')
const { getPayload } = await import('payload')

type PayloadLike = {
  create: (args: unknown) => Promise<Record<string, unknown>>
  findByID: (args: unknown) => Promise<Record<string, unknown>>
  update: (args: unknown) => Promise<Record<string, unknown>>
  db: { migrate: () => Promise<void> }
  destroy: () => Promise<void>
}

let payload: PayloadLike | undefined
let tenantId: number | string
let adminUser: Record<string, unknown>
let editorUser: Record<string, unknown>

const seedTenant = {
  name: 'Integration Hospital',
  slug: `integration-${process.pid}-${Date.now()}`,
  type: 'hospital',
  // Branding is intentionally NOT entitled — it holds stored data that must survive.
  settingsEntitlement: ['contact', 'general'],
  branding: { initials: 'IH', themeColor: '#15504f' },
  hero: {
    years: { value: '20' },
    departments: { value: '12' },
    patients: { value: '500k' },
    staff: { value: '800' },
  },
  contact: {
    phone: '+1000',
    email: 'integration@example.test',
    hours: [{ day: 'Sat', time: '9-5' }],
  },
}

const asGroup = (value: unknown): Record<string, unknown> => value as Record<string, unknown>

test.before(async () => {
  payload = (await getPayload({ config })) as unknown as PayloadLike
  // Build the full schema on the isolated DB from the versioned migrations (validates the SQL too).
  await payload.db.migrate()

  tenantId = (await payload.create({
    collection: 'tenants',
    data: seedTenant,
    overrideAccess: true,
  })).id as number

  adminUser = await payload.create({
    collection: 'users',
    data: {
      email: `integration-admin-${Date.now()}@example.test`,
      password: 'password12345',
      roles: ['admin'],
      tenants: [{ tenant: tenantId }],
    },
    overrideAccess: true,
  })

  editorUser = await payload.create({
    collection: 'users',
    data: {
      email: `integration-editor-${Date.now()}@example.test`,
      password: 'password12345',
      roles: ['editor'],
      tenants: [{ tenant: tenantId }],
    },
    overrideAccess: true,
  })
})

test.after(async () => {
  try {
    await payload?.destroy()
  } catch {
    // Best-effort teardown; the temp file is disposable.
  }
  // Best-effort cleanup: on Windows the libsql client may briefly hold a lock. Never fail the
  // suite on cleanup — the file lives in the OS temp dir and is disposable.
  try {
    rmSync(TEMP_DB, { force: true })
  } catch {
    /* ignore */
  }
})

// `payload` is assigned in the `before` hook; this guard keeps the test bodies type-safe.
const api = (): PayloadLike => {
  if (!payload) throw new Error('test setup failed: payload was not initialized')
  return payload
}

const adminReqUser = async () =>
  api().findByID({
    collection: 'users',
    id: adminUser.id,
    depth: 1,
    overrideAccess: true,
  })

const editorReqUser = async () =>
  api().findByID({
    collection: 'users',
    id: editorUser.id,
    depth: 1,
    overrideAccess: true,
  })

test('real Local API: an entitled partial update preserves unrelated nested/array data (no false 403, no erasure)', async () => {
  const updated = await api().update({
    collection: 'tenants',
    id: tenantId,
    // Only the entitled `contact` group is sent (with its nested hours array). Branding/hero are
    // intentionally omitted — they must be preserved exactly.
    data: { contact: { phone: '+2000', email: 'integration@example.test', hours: [{ day: 'Sun', time: '10-6' }] } },
    user: await adminReqUser(),
    overrideAccess: false,
  }) as Record<string, unknown>

  // Entitled change applied (incl. the nested array — Payload adds a row id, so assert by value).
  assert.equal(asGroup(updated.contact).phone, '+2000')
  const hours = asGroup(updated.contact).hours as Array<Record<string, unknown>>
  assert.equal(hours.length, 1)
  assert.equal(hours[0].day, 'Sun')
  assert.equal(hours[0].time, '10-6')
  // Unrelated, non-entitled groups were not erased (Payload populates unset subfields as null,
  // so assert the values that matter rather than the whole group shape).
  assert.equal(asGroup(updated.branding).initials, 'IH')
  assert.equal(asGroup(updated.branding).themeColor, '#15504f')
  assert.equal(asGroup(asGroup(updated.hero).years).value, '20')
})

test('real Local API: a disabled-group change returns HTTP 403 and leaves stored data intact', async () => {
  await assert.rejects(
    api().update({
      collection: 'tenants',
      id: tenantId,
      data: { branding: { initials: 'HACK' } },
      user: await adminReqUser(),
      overrideAccess: false,
    }),
    (err: { status?: number; message?: string }) => {
      assert.equal(err.status, 403, `expected 403, got ${err.status}: ${err.message}`)
      return true
    },
  )

  // The stored branding value was preserved despite the rejected attempt.
  const after = await api().findByID({
    collection: 'tenants',
    id: tenantId,
    depth: 0,
    overrideAccess: true,
  }) as Record<string, unknown>
  assert.equal(asGroup(after.branding).initials, 'IH')
  assert.equal(asGroup(after.branding).themeColor, '#15504f')
})

test('real Local API: an assigned editor cannot update tenant settings', async () => {
  await assert.rejects(
    api().update({
      collection: 'tenants',
      id: tenantId,
      data: { contact: { phone: '+9999' } },
      user: await editorReqUser(),
      overrideAccess: false,
    }),
    (err: { status?: number; message?: string }) => {
      assert.equal(err.status, 403, `expected 403, got ${err.status}: ${err.message}`)
      return true
    },
  )

  const after = await api().findByID({
    collection: 'tenants',
    id: tenantId,
    depth: 0,
    overrideAccess: true,
  }) as Record<string, unknown>
  assert.equal(asGroup(after.contact).phone, '+2000')
})

test('real Local API: a tenant admin cannot alter the entitlement (stored value is preserved)', async () => {
  // `settingsEntitlement` carries field-level access (super-admin-only update) that strips the
  // forged value before the hook; either a 403 (hook) or a silent strip (field access) is an
  // acceptable mechanism. What must hold: the stored entitlement never changes.
  try {
    await api().update({
      collection: 'tenants',
      id: tenantId,
      data: { settingsEntitlement: ['general', 'branding', 'hero', 'contact'] },
      user: await adminReqUser(),
      overrideAccess: false,
    })
  } catch (err) {
    assert.equal(
      (err as { status?: number }).status,
      403,
      'if the entitlement change is rejected it must be a 403',
    )
  }

  const after = await api().findByID({
    collection: 'tenants',
    id: tenantId,
    depth: 0,
    overrideAccess: true,
  }) as Record<string, unknown>
  assert.deepEqual(
    after.settingsEntitlement as unknown,
    ['contact', 'general'] as unknown,
    'the stored entitlement must be unchanged',
  )
})
