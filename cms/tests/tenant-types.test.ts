import assert from 'node:assert/strict'
import test from 'node:test'
import type { Endpoint } from 'payload'
import { Tenants } from '../src/collections/Tenants'
import { TenantTypes, REFERENCED_TYPE_DELETE_MESSAGE } from '../src/collections/TenantTypes'
import { TENANT_FEATURES } from '../src/collections/tenantFeatures'

const superAdmin = { id: 1, roles: ['super-admin'], tenants: [] }
const tenantAdmin = { id: 2, roles: ['admin'], tenants: [{ tenant: 7 }] }

// `endpoints` is typed `false | Endpoint[]`; ours is always a non-empty array, so assert it once.
const tenantEndpoints = (Tenants.endpoints ?? []) as Omit<Endpoint, 'root'>[]
type EndpointHandler = NonNullable<(typeof tenantEndpoints)[number]['handler']>
const resetEndpoint = tenantEndpoints.find((e) => e.path === '/:id/reset-features-to-type-defaults')
if (!resetEndpoint) throw new Error('reset-features-to-type-defaults endpoint must be registered on Tenants')
const resetHandler = resetEndpoint.handler as EndpointHandler

const findField = (name: string) =>
  Tenants.fields.find((f) => 'name' in f && (f as { name?: string }).name === name)

// ---------------------------------------------------------------------------
// 1. TenantTypes access: public read, super-admin-only create/update/delete
// ---------------------------------------------------------------------------

test('tenant-types read is public so the anonymous /api/tenants?depth=1 type relationship populates', () => {
  const read = TenantTypes.access?.read
  if (typeof read !== 'function') throw new TypeError('TenantTypes.read access must be a function')
  // No user at all (anonymous public site) must still read the non-secret type identity.
  assert.equal(read({ req: { user: null } } as never), true)
  assert.equal(read({ req: { user: undefined } } as never), true)
})

test('only super-admins can create/update/delete tenant types', async () => {
  for (const op of ['create', 'update', 'delete'] as const) {
    const access = TenantTypes.access?.[op]
    if (typeof access !== 'function') throw new TypeError(`TenantTypes.${op} access must be a function`)
    assert.equal(await access({ req: { user: superAdmin } } as never), true)
    assert.equal(await access({ req: { user: tenantAdmin } } as never), false)
    assert.equal(await access({ req: { user: null } } as never), false)
  }
})

test('tenant-types carries a unique slug and a defaultFeatures select over the code-defined catalogue', () => {
  const slug = TenantTypes.fields.find((f) => 'name' in f && f.name === 'slug') as { unique?: boolean } | undefined
  assert.equal(slug?.unique, true)
  const defaults = TenantTypes.fields.find((f) => 'name' in f && f.name === 'defaultFeatures') as
    | { type?: string; options?: Array<{ value: string }> }
    | undefined
  assert.equal(defaults?.type, 'select')
  assert.deepEqual(
    (defaults?.options ?? []).map((o) => o.value),
    TENANT_FEATURES.map((f) => f.value),
  )
})

// ---------------------------------------------------------------------------
// 2. Referenced type deletion is rejected with a clear 400
// ---------------------------------------------------------------------------

test('deleting a referenced tenant type throws APIError 400 with the stable message', async () => {
  const hook = TenantTypes.hooks?.beforeDelete?.[0]
  if (typeof hook !== 'function') throw new TypeError('TenantTypes.beforeDelete hook must be wired')
  // Referenced by one tenant → 400.
  await assert.rejects(
    hook({
      req: { payload: { count: async () => ({ totalDocs: 3 }) } },
      id: 9,
    } as never),
    (err: { status?: number; message?: string }) => {
      assert.equal(err.status, 400, `expected 400, got ${err.status}`)
      assert.ok(
        err.message?.startsWith(REFERENCED_TYPE_DELETE_MESSAGE),
        `message should start with the stable prefix, got: ${err.message}`,
      )
      return true
    },
  )
})

test('deleting an unreferenced tenant type is allowed (no throw)', async () => {
  const hook = TenantTypes.hooks?.beforeDelete?.[0]
  if (typeof hook !== 'function') throw new TypeError('TenantTypes.beforeDelete hook must be wired')
  await hook({ req: { payload: { count: async () => ({ totalDocs: 0 }) } }, id: 9 } as never)
})

// ---------------------------------------------------------------------------
// 3. tenants.type is a required, super-admin-only relationship to tenant-types
// ---------------------------------------------------------------------------

test('tenants.type is a required relationship to tenant-types with super-admin-only update', async () => {
  const typeField = findField('type') as unknown as
    | { type?: string; relationTo?: string; required?: boolean; access?: { update?: (args: { req: { user: unknown } }) => unknown } }
    | undefined
  assert.equal(typeField?.type, 'relationship')
  assert.equal(typeField?.relationTo, 'tenant-types')
  assert.equal(typeField?.required, true)
  const updateAccess = typeField?.access?.update
  if (typeof updateAccess !== 'function') throw new TypeError('type.access.update must be a function')
  assert.equal(await updateAccess({ req: { user: superAdmin } }), true)
  assert.equal(await updateAccess({ req: { user: tenantAdmin } }), false)
})

// ---------------------------------------------------------------------------
// 4. create-default hook: omitted features copy the template (incl. empty); explicit values kept
// ---------------------------------------------------------------------------

const runCopyHook = (args: {
  data: Record<string, unknown>
  operation?: 'create' | 'update'
  findByID?: (q: { id: unknown }) => Promise<unknown>
}) => {
  const copyHook = Tenants.hooks?.beforeChange?.find((h) => h.name !== 'enforceTenantSettingsEntitlement')
  // The second hook (index 1) is the create-default copier; the first is the entitlement boundary.
  const hook = Tenants.hooks?.beforeChange?.[1]
  if (typeof hook !== 'function') throw new TypeError('copyTypeDefaultFeatures hook must be wired')
  void copyHook
  return hook({
    data: args.data,
    operation: args.operation ?? 'create',
    req: { payload: { findByID: args.findByID ?? (async () => { throw new Error('unexpected lookup') }) } },
  } as never)
}

test('omitted features on create copy the selected type template (cloned, not aliased)', async () => {
  const data: Record<string, unknown> = { type: 5 }
  await runCopyHook({
    data,
    findByID: async () => ({ defaultFeatures: ['articles', 'events'] }),
  })
  assert.deepEqual(data.features, ['articles', 'events'])
  // Cloned — mutating the result must not affect a later template read.
  assert.notEqual(data.features, ['articles', 'events'])
})

test('an intentionally empty template is copied as an explicit empty array', async () => {
  const data: Record<string, unknown> = { type: 5 }
  await runCopyHook({ data, findByID: async () => ({ defaultFeatures: null }) })
  assert.deepEqual(data.features, [])
})

test('an explicitly submitted empty features array is preserved (not replaced)', async () => {
  const data: Record<string, unknown> = { type: 5, features: [] }
  let lookedUp = false
  await runCopyHook({
    data,
    findByID: async () => { lookedUp = true; return { defaultFeatures: ['articles'] } },
  })
  assert.equal(lookedUp, false, 'an explicit features value must short-circuit the type lookup')
  assert.deepEqual(data.features, [])
})

test('an explicitly submitted non-empty features value is preserved', async () => {
  const data: Record<string, unknown> = { type: 5, features: ['portal'] }
  await runCopyHook({
    data,
    findByID: async () => ({ defaultFeatures: ['articles', 'events'] }),
  })
  assert.deepEqual(data.features, ['portal'])
})

test('a type change (update) never touches features', async () => {
  const data: Record<string, unknown> = { type: 7 }
  await runCopyHook({
    data,
    operation: 'update',
    findByID: async () => ({ defaultFeatures: ['articles'] }),
  })
  assert.equal('features' in data, false, 'update must not set features')
})

test('a selected required type that cannot be resolved fails closed (no silent create)', async () => {
  const data: Record<string, unknown> = { type: 999 }
  await assert.rejects(
    runCopyHook({ data, findByID: async () => { throw new Error('not found') } }),
    /not found/,
  )
  assert.equal('features' in data, false)
})

test('no type selected leaves features unset (required-field validation owns that case)', async () => {
  const data: Record<string, unknown> = {}
  let lookedUp = false
  await runCopyHook({
    data,
    findByID: async () => { lookedUp = true; return { defaultFeatures: ['x'] } },
  })
  assert.equal(lookedUp, false)
  assert.equal('features' in data, false)
})

// ---------------------------------------------------------------------------
// 5. reset endpoint authorization (auth paths need no DB)
// ---------------------------------------------------------------------------

test('reset endpoint rejects unauthenticated requests with 401', async () => {
  const res = await resetHandler({ user: null, routeParams: { id: '1' } } as never)
  assert.equal(res.status, 401)
})

test('reset endpoint rejects tenant admins with 403', async () => {
  const res = await resetHandler({ user: tenantAdmin, routeParams: { id: '1' } } as never)
  assert.equal(res.status, 403)
})

test('reset endpoint requires a tenant id in the route', async () => {
  const res = await resetHandler({ user: superAdmin, routeParams: {} } as never)
  assert.equal(res.status, 400)
})

// ---------------------------------------------------------------------------
// 6. reset UI is super-admin-only and hidden on create (no document id)
// ---------------------------------------------------------------------------

test('the reset UI field is visible only to super-admins', () => {
  const uiField = Tenants.fields.find((f) => 'name' in f && f.name === 'resetFeatures') as
    | { type?: string; admin?: { condition?: (d: unknown, s: unknown, ctx: { user: unknown }) => boolean } }
    | undefined
  assert.equal(uiField?.type, 'ui')
  const condition = uiField?.admin?.condition
  if (typeof condition !== 'function') throw new TypeError('resetFeatures.admin.condition must be a function')
  assert.equal(condition({}, undefined, { user: superAdmin }), true)
  assert.equal(condition({}, undefined, { user: tenantAdmin }), false)
  assert.equal(condition({}, undefined, { user: null }), false)
})
