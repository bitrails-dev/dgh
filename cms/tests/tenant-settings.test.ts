import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { Tenants } from '../src/collections/Tenants'
import {
  ALL_TENANT_SETTING_GROUPS,
  TENANT_SETTING_GROUPS,
  enforceTenantSettingsEntitlement,
  entitlementIncludes,
  settingValuesEqual,
} from '../src/access/tenantSettings'
import type { TenantSettingGroup } from '../src/access/tenantSettings'

type HookArgs = Parameters<typeof enforceTenantSettingsEntitlement>[0]

const superAdmin = { id: 1, roles: ['super-admin'], tenants: [] }
const tenantAdmin = (id: number | string = 7) => ({
  id: 2,
  roles: ['admin'],
  tenants: [{ tenant: id }],
})
const editor = (id: number | string = 7) => ({
  id: 3,
  roles: ['editor'],
  tenants: [{ tenant: id }],
})

type AdminCondition = (
  data: unknown,
  sibling: unknown,
  ctx: { user: unknown },
) => boolean

const runHook = (args: {
  user: unknown
  data: Record<string, unknown>
  originalDoc: Record<string, unknown>
  operation?: 'create' | 'update'
}) =>
  enforceTenantSettingsEntitlement({
    data: args.data,
    originalDoc: args.originalDoc,
    operation: args.operation ?? 'update',
    req: { user: args.user },
  } as HookArgs)

const expect403 = (fn: () => unknown, messagePattern?: RegExp) => {
  try {
    fn()
    assert.fail('expected the entitlement hook to reject with 403')
  } catch (err) {
    const error = err as { status?: number; message?: string }
    assert.equal(error.status, 403, `expected HTTP 403, got ${error.status}: ${error.message}`)
    if (messagePattern) assert.match(error.message ?? '', messagePattern)
  }
}

const expectAllowed = (fn: () => unknown) => {
  // Must not throw; returns the (possibly mutated) data.
  assert.doesNotThrow(fn)
}

const fieldCondition = (fieldName: string): AdminCondition => {
  const field = Tenants.fields.find((candidate) => 'name' in candidate && candidate.name === fieldName)
  const condition = (field as { admin?: { condition?: AdminCondition } } | undefined)?.admin?.condition
  if (typeof condition !== 'function') {
    throw new TypeError(`${fieldName}.admin.condition must be a function`)
  }
  return condition
}

const ALL_GROUPS: TenantSettingGroup[] = ['general', 'branding', 'hero', 'contact']

const fullTenant = (entitlement: TenantSettingGroup[]): Record<string, unknown> => ({
  id: 7,
  name: 'Al Salam Hospital',
  slug: 'al-salam',
  type: 'hospital',
  domains: ['al-salam.test'],
  features: ['departments'],
  settingsEntitlement: entitlement,
  branding: { initials: 'ASH', tagline: 'Care first', themeColor: '#15504f' },
  hero: {
    years: { value: '20', unit: 'yrs' },
    departments: { value: '12', unit: '' },
    patients: { value: '500k', unit: '' },
    staff: { value: '800', unit: '' },
  },
  contact: {
    phone: '+1',
    emergencyNumber: '911',
    whatsapp: '',
    email: 'info@al-salam.test',
    address: '123 St',
    social: { facebookUrl: 'fb', xUrl: 'x', youtubeUrl: 'yt' },
    hours: [{ day: 'Sat', time: '9-5' }],
  },
})

// ---------------------------------------------------------------------------
// 1. Super-admin can configure the entitlement and edit every setting group
// ---------------------------------------------------------------------------

test('the entitlement hook is wired as the Tenants beforeChange boundary', () => {
  const hooks = Tenants.hooks?.beforeChange ?? []
  assert.equal(hooks.includes(enforceTenantSettingsEntitlement), true)
})

test('a super-admin can edit every setting group and change the entitlement', () => {
  const original = fullTenant(['contact'])
  // Super-admin bypasses all entitlement checks regardless of what is enabled.
  expectAllowed(() =>
    runHook({
      user: superAdmin,
      originalDoc: original,
      data: {
        settingsEntitlement: ALL_GROUPS,
        name: 'New Name',
        branding: { initials: 'XX' },
        hero: { years: { value: '99' } },
        contact: { phone: '+2' },
      },
    }),
  )
})

test('a super-admin sees all setting groups regardless of the entitlement', () => {
  const doc = fullTenant([])
  for (const group of ALL_GROUPS) {
    const fieldName = group === 'general' ? 'name' : group
    assert.equal(fieldCondition(fieldName)(doc, undefined, { user: superAdmin }), true)
  }
  // And manages the entitlement field itself.
  assert.equal(
    fieldCondition('settingsEntitlement')(doc, undefined, { user: superAdmin }),
    true,
  )
})

// ---------------------------------------------------------------------------
// 2. Assigned tenant admin can edit an enabled setting group
// ---------------------------------------------------------------------------

test('an assigned tenant admin can edit a setting group enabled by the entitlement', () => {
  const original = fullTenant(['contact', 'general'])
  expectAllowed(() =>
    runHook({
      user: tenantAdmin(),
      originalDoc: original,
      data: {
        contact: { ...(original.contact as Record<string, unknown>), phone: '+200' },
        name: 'Renamed Tenant',
      },
    }),
  )
})

test('an enabled nested/localized group value may change freely (hero)', () => {
  const original = fullTenant(['hero'])
  expectAllowed(() =>
    runHook({
      user: tenantAdmin(),
      originalDoc: original,
      data: { hero: { ...(original.hero as Record<string, unknown>), years: { value: '25', unit: 'years' } } },
    }),
  )
})

// ---------------------------------------------------------------------------
// 3. Assigned tenant admin receives 403 when editing a disabled group
// ---------------------------------------------------------------------------

test('a tenant admin receives 403 when editing a group absent from the entitlement', () => {
  const original = fullTenant(['contact'])
  expect403(
    () =>
      runHook({
        user: tenantAdmin(),
        originalDoc: original,
        data: { branding: { initials: 'HACK' } },
      }),
    /not entitled to edit "branding"/,
  )
})

test('editing the general/name field requires the general entitlement', () => {
  const original = fullTenant(['contact'])
  expect403(
    () =>
      runHook({
        user: tenantAdmin(),
        originalDoc: original,
        data: { name: 'Hacked Name' },
      }),
    /not entitled to edit "general"/,
  )
})

// ---------------------------------------------------------------------------
// 4. Forged attempts to alter the entitlement or platform fields stay blocked
// ---------------------------------------------------------------------------

test('a forged attempt to change the entitlement is rejected with 403', () => {
  const original = fullTenant(['contact'])
  expect403(
    () =>
      runHook({
        user: tenantAdmin(),
        originalDoc: original,
        data: { settingsEntitlement: ALL_GROUPS },
      }),
    /Only platform super-admins can change the "settingsEntitlement"/,
  )
})

test('forged changes to slug, type, domains and features are all rejected', () => {
  const original = fullTenant(ALL_GROUPS)
  for (const [field, value] of [
    ['slug', 'forged-slug'],
    ['type', 'clinic'],
    ['domains', ['evil.example']],
    ['features', ['portal']],
  ] as const) {
    expect403(
      () =>
        runHook({
          user: tenantAdmin(),
          originalDoc: original,
          data: { [field]: value },
        }),
      new RegExp(`Only platform super-admins can change the "${field}"`),
    )
  }
})

test('re-sending an unchanged platform field value is a no-op (not a 403)', () => {
  const original = fullTenant(['contact'])
  expectAllowed(() =>
    runHook({
      user: tenantAdmin(),
      originalDoc: original,
      data: { slug: original.slug, features: original.features },
    }),
  )
})

// ---------------------------------------------------------------------------
// 5. Tenant admin cannot update another tenant (collection access scope)
// ---------------------------------------------------------------------------

test('a tenant admin is constrained to their own tenant id on update', async () => {
  const update = Tenants.access?.update
  if (typeof update !== 'function') throw new TypeError('Tenants.update access must be a function')
  // Assigned only to tenant 7 — the constraint excludes tenant 8.
  assert.deepEqual(await update({ req: { user: tenantAdmin(7) } } as never), {
    id: { in: ['7'] },
  })
})

test('an assigned editor cannot update tenant settings, including through the hook backstop', async () => {
  const update = Tenants.access?.update
  if (typeof update !== 'function') throw new TypeError('Tenants.update access must be a function')
  assert.equal(await update({ req: { user: editor(7) } } as never), false)

  const original = fullTenant(['contact'])
  expect403(
    () => runHook({
      user: editor(7),
      originalDoc: original,
      data: { contact: { phone: '+999' } },
    }),
    /Only tenant admins and super-admins/,
  )
})

// ---------------------------------------------------------------------------
// 6. Removing an entitlement preserves stored data
// ---------------------------------------------------------------------------

test('removing an entitlement leaves the stored setting value untouched', () => {
  const original = fullTenant(['contact']) // branding removed from entitlement
  // Editing an entitled group while a now-disabled group is omitted preserves it.
  const result = runHook({
    user: tenantAdmin(),
    originalDoc: original,
    data: { contact: { ...(original.contact as Record<string, unknown>), phone: '+300' } },
  }) as Record<string, unknown>
  // The disabled group is not part of the write, so its stored value is never overwritten.
  assert.equal('branding' in result, false)
  assert.equal((result.contact as { phone?: string }).phone, '+300')
  // The stored branding value remains intact on the original document.
  assert.deepEqual(original.branding, fullTenant(['contact']).branding)
})

test('forging a cleared value for a disabled group is rejected (data preserved)', () => {
  const original = fullTenant(['contact']) // branding not entitled, but has stored data
  expect403(
    () =>
      runHook({
        user: tenantAdmin(),
        originalDoc: original,
        data: { branding: null },
      }),
    /not entitled to edit "branding"/,
  )
  assert.deepEqual(original.branding, fullTenant(['contact']).branding)
})

test('partial updates never erase untouched values via deep equality', () => {
  const original = fullTenant(['contact', 'hero'])
  // Re-submitting branding exactly as stored (equal) is allowed — no erasure, no 403.
  expectAllowed(() =>
    runHook({
      user: tenantAdmin(),
      originalDoc: original,
      data: { branding: original.branding, hero: { ...(original.hero as Record<string, unknown>), staff: { value: '1' } } },
    }),
  )
  assert.ok(settingValuesEqual({ a: { b: [1, 2] } }, { a: { b: [1, 2] } }))
  assert.equal(settingValuesEqual({ a: 1 }, { a: 2 }), false)
})

// ---------------------------------------------------------------------------
// 7. Missing/empty entitlement fails closed; default/migration grants all four
// ---------------------------------------------------------------------------

test('a missing entitlement fails closed for a non-super user', () => {
  const original = fullTenant([]) // empty entitlement
  for (const [field, value] of [
    ['name', 'x'],
    ['branding', { initials: 'y' }],
    ['hero', { years: { value: '0' } }],
    ['contact', { phone: 'z' }],
  ] as const) {
    expect403(() =>
      runHook({ user: tenantAdmin(), originalDoc: original, data: { [field]: value } }),
    )
  }
})

test('an undefined entitlement also fails closed for a non-super user', () => {
  const original = fullTenant(['contact'])
  delete original.settingsEntitlement
  expect403(() =>
    runHook({ user: tenantAdmin(), originalDoc: original, data: { contact: { phone: 'z' } } }),
  )
})

test('newly created tenants default to all four setting groups', () => {
  assert.deepEqual(ALL_TENANT_SETTING_GROUPS, ['general', 'branding', 'hero', 'contact'])
  assert.deepEqual(
    TENANT_SETTING_GROUPS.map((group) => group.value),
    ALL_GROUPS,
  )
  const field = Tenants.fields.find((candidate) => 'name' in candidate && candidate.name === 'settingsEntitlement') as
    | { defaultValue?: unknown }
    | undefined
  assert.deepEqual(field?.defaultValue, ALL_GROUPS)
})

test('the versioned migration is registered and backfills every existing tenant with all four groups', () => {
  // Read the migration index source (avoid importing type-only migration exports at runtime).
  const indexSource = readFileSync(
    new URL('../src/migrations/index.ts', import.meta.url),
    'utf8',
  )
  assert.ok(
    indexSource.includes('settings_entitlement'),
    'the settings_entitlement migration must be registered in the migrations index',
  )

  const migrationSource = readFileSync(
    new URL('../src/migrations/20260715_155701_settings_entitlement.ts', import.meta.url),
    'utf8',
  )
  // The backfill INSERT covers all four groups for existing tenants.
  for (const group of ALL_GROUPS) {
    assert.ok(
      migrationSource.includes(`'${group}'`),
      `backfill must seed the "${group}" group`,
    )
  }
  assert.ok(migrationSource.includes('INSERT INTO'), 'migration must contain a backfill insert')
  assert.ok(migrationSource.includes('tenants_settings_entitlement'), 'migration targets the entitlement table')
})

// ---------------------------------------------------------------------------
// 8. Admin field/group visibility reflects the entitlement (convenience only)
// ---------------------------------------------------------------------------

test('field visibility mirrors the entitlement for a non-super admin', () => {
  const doc = fullTenant(['contact', 'general'])
  assert.equal(fieldCondition('name')(doc, undefined, { user: tenantAdmin() }), true)
  assert.equal(fieldCondition('contact')(doc, undefined, { user: tenantAdmin() }), true)
  assert.equal(fieldCondition('branding')(doc, undefined, { user: tenantAdmin() }), false)
  assert.equal(fieldCondition('hero')(doc, undefined, { user: tenantAdmin() }), false)
  assert.equal(
    fieldCondition('settingsEntitlement')(doc, undefined, { user: tenantAdmin() }),
    false,
    'the entitlement control is hidden from tenant admins',
  )
})

test('an empty entitlement hides every setting group for a non-super admin', () => {
  const doc = fullTenant([])
  for (const group of ALL_GROUPS) {
    const fieldName = group === 'general' ? 'name' : group
    assert.equal(fieldCondition(fieldName)(doc, undefined, { user: tenantAdmin() }), false)
  }
})

test('visibility is convenience only: the hook still blocks a forged disabled-group write', () => {
  const original = fullTenant(['contact']) // branding hidden + not entitled
  assert.equal(fieldCondition('branding')(original, undefined, { user: tenantAdmin() }), false)
  // A client that bypasses the hidden field and submits branding is still rejected server-side.
  expect403(
    () =>
      runHook({
        user: tenantAdmin(),
        originalDoc: original,
        data: { branding: { initials: 'forged' } },
      }),
    /not entitled to edit "branding"/,
  )
})

test('entitlementIncludes is array-safe and treats non-arrays as empty', () => {
  assert.equal(entitlementIncludes(['branding'], 'branding'), true)
  assert.equal(entitlementIncludes(['branding'], 'contact'), false)
  assert.equal(entitlementIncludes(undefined, 'branding'), false)
  assert.equal(entitlementIncludes(null, 'branding'), false)
  assert.equal(entitlementIncludes('branding', 'branding'), false)
})
