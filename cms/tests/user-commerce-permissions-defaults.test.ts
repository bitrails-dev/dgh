// Tests for the role-based `commercePermissions` defaulting added to `enforceUserScope`
// (cms/src/access/userAccess.ts).
//
// Background: the `commercePermissions` field on each User→Tenant assignment row was referenced
// by the commerce permission reader (cms/src/commerce/permissions.ts) and access functions
// (cms/src/commerce/plugin/access.ts) but was never declared in the schema, so every non-super-admin
// had an empty set and `isCommerceAdmin()` returned false — tenant-admins saw no "Add product" CTA.
// The fix declares the field via `tenantsArrayField.rowFields` (payload.config.ts) and stamps
// role-based defaults in `enforceUserScope` when the row's set is UNSET.
//
// These tests exercise the hook directly (no Payload boot) and assert the normalization rule
// documented in permissions.ts:7-8:
//   - tenant-admin (role 'admin') → ALL_COMMERCE_PERMISSIONS
//   - editor      (role 'editor') → ['catalog.manage']
//   - super-admin                     → left unset (reader short-circuits to ALL)
//   - unknown / no roles              → [] (no default)
//
// Idempotency: an explicit value (including `[]`) is never overwritten — only `undefined` is.

import assert from 'node:assert/strict'
import test from 'node:test'

import { enforceUserScope } from '../src/access/userAccess'
import { ALL_COMMERCE_PERMISSIONS } from '../src/commerce/permissions'
import type { UserLike } from '../src/access/userAccess'

type HookArgs = Parameters<typeof enforceUserScope>[0]
type UserData = UserLike & { tenants?: (NonNullable<UserLike['tenants']>[number])[] }

// The hook's full args type includes `collection` + `context` (required by CollectionBeforeChangeHook);
// we only exercise the data/operation/originalDoc/req slice, matching the `as never` pattern used in
// tenant-feature-access.test.ts. The hook never reads `collection`/`context`, so omitting them is safe.
const runHook = async ({
  data,
  operation = 'create',
  originalDoc,
  actor,
}: {
  data: Record<string, unknown>
  operation?: 'create' | 'update'
  originalDoc?: Record<string, unknown>
  actor: UserLike
}): Promise<UserData> => {
  const req = {
    user: actor,
    headers: new Headers(),
    payload: { db: { defaultIDType: 'number' as const } },
  }
  const result = await enforceUserScope({
    data,
    operation,
    originalDoc,
    req,
  } as never as HookArgs)
  return result as UserData
}

const superAdmin: UserLike = { id: 1, roles: ['super-admin'], tenants: [] }
const tenantAdmin: UserLike = { id: 2, roles: ['admin'], tenants: [{ tenant: 7 }] }
const editor: UserLike = { id: 3, roles: ['editor'], tenants: [{ tenant: 7 }] }

// ─── Role-based defaults on CREATE ─────────────────────────────────────────────────────────────

test('a tenant-admin create stamps ALL_COMMERCE_PERMISSIONS on each new assignment row', async () => {
  const data = await runHook({
    actor: superAdmin,
    data: { roles: ['admin'], tenants: [{ tenant: 7 }] },
  })
  assert.deepEqual(data.tenants![0].commercePermissions, [...ALL_COMMERCE_PERMISSIONS])
})

test('an editor create stamps only catalog.manage on each new assignment row', async () => {
  const data = await runHook({
    actor: superAdmin,
    data: { roles: ['editor'], tenants: [{ tenant: 7 }] },
  })
  assert.deepEqual(data.tenants![0].commercePermissions, ['catalog.manage'])
})

test('a super-admin create leaves commercePermissions unset (reader grants ALL at read time)', async () => {
  const data = await runHook({
    actor: superAdmin,
    data: { roles: ['super-admin'] },
  })
  assert.equal(data.tenants, undefined)
})

test('a tenant-admin auto-assign path (no data.tenants) stamps the default on the synthesized row', async () => {
  // Simulates the tenant-admin "create user, tenant comes from cookie" path (userAccess.ts:150-158).
  // The hook synthesizes `data.tenants = [{ tenant: <from cookie> }]`; the default must still apply.
  const req = {
    user: tenantAdmin,
    headers: new Headers({ cookie: 'payload-tenant=7' }),
    payload: { db: { defaultIDType: 'number' as const } },
  }
  const data = (await enforceUserScope({
    data: { roles: ['editor'] },
    operation: 'create',
    req,
  } as never as HookArgs)) as UserData
  assert.ok(data.tenants?.length === 1)
  assert.deepEqual(data.tenants![0].commercePermissions, ['catalog.manage'])
})

// ─── Idempotency: explicit values are preserved ────────────────────────────────────────────────

test('an explicit [] is preserved (deliberate "no commerce" grant, not overwritten)', async () => {
  const data = await runHook({
    actor: superAdmin,
    data: { roles: ['admin'], tenants: [{ tenant: 7, commercePermissions: [] }] },
  })
  assert.deepEqual(data.tenants![0].commercePermissions, [])
})

test('an explicit partial set is preserved (operator-curated, not overwritten)', async () => {
  const data = await runHook({
    actor: superAdmin,
    data: {
      roles: ['admin'],
      tenants: [{ tenant: 7, commercePermissions: ['catalog.manage', 'orders.read'] }],
    },
  })
  assert.deepEqual(data.tenants![0].commercePermissions, ['catalog.manage', 'orders.read'])
})

// ─── Self-edit lock (tenant-admin cannot self-elevate) ─────────────────────────────────────────

test('a tenant-admin editing their own row cannot change commercePermissions via data.tenants', async () => {
  // The existing self-edit lock (userAccess.ts:136-138) forbids `data.roles !== undefined ||
  // data.tenants !== undefined` when actorID === targetID. `commercePermissions` lives inside
  // `data.tenants`, so the same lock covers it — a tenant-admin cannot self-grant.
  await assert.rejects(
    runHook({
      actor: tenantAdmin,
      operation: 'update',
      originalDoc: { id: 2, roles: ['admin'], tenants: [{ tenant: 7 }] },
      data: {
        roles: ['admin'],
        tenants: [{ tenant: 7, commercePermissions: [...ALL_COMMERCE_PERMISSIONS, 'payments.refund' as never] }],
      },
    }),
    /own role or tenant assignments/i,
  )
})

test('a tenant-admin editing a DIFFERENT user in their tenant stamps the default on new rows', async () => {
  const data = await runHook({
    actor: tenantAdmin,
    operation: 'update',
    originalDoc: { id: 99, roles: ['editor'], tenants: [{ tenant: 7 }] },
    data: { roles: ['editor'], tenants: [{ tenant: 7 }] },
  })
  assert.deepEqual(data.tenants![0].commercePermissions, ['catalog.manage'])
})

// ─── Update path: existing explicit values survive normalization ───────────────────────────────

test('on update, an existing explicit commercePermissions set is preserved', async () => {
  const data = await runHook({
    actor: superAdmin,
    operation: 'update',
    originalDoc: { id: 50, roles: ['admin'], tenants: [{ tenant: 7, commercePermissions: ['catalog.manage'] }] },
    data: { roles: ['admin'], tenants: [{ tenant: 7, commercePermissions: ['catalog.manage'] }] },
  })
  assert.deepEqual(data.tenants![0].commercePermissions, ['catalog.manage'])
})

test('on update, an unset commercePermissions on a NEW row gets the default', async () => {
  const data = await runHook({
    actor: superAdmin,
    operation: 'update',
    originalDoc: { id: 50, roles: ['admin'], tenants: [{ tenant: 7, commercePermissions: ['catalog.manage'] }] },
    data: {
      roles: ['admin'],
      tenants: [
        { tenant: 7, commercePermissions: ['catalog.manage'] }, // preserved
        { tenant: 8 }, // new row, unset → default
      ],
    },
  })
  assert.deepEqual(data.tenants![0].commercePermissions, ['catalog.manage'])
  assert.deepEqual(data.tenants![1].commercePermissions, [...ALL_COMMERCE_PERMISSIONS])
})

// ─── Edge cases ────────────────────────────────────────────────────────────────────────────────

test('an unknown role yields no default (empty array)', async () => {
  // A user with no recognized role: no default stamped. The row's commercePermissions stays
  // undefined, which effectivePermissions treats as [].
  const data = await runHook({
    actor: superAdmin,
    data: { roles: [], tenants: [{ tenant: 7 }] },
  })
  assert.equal(data.tenants![0].commercePermissions, undefined)
})

test('a user with both admin and editor roles gets the admin default (most permissive)', async () => {
  const data = await runHook({
    actor: superAdmin,
    data: { roles: ['editor', 'admin'], tenants: [{ tenant: 7 }] },
  })
  assert.deepEqual(data.tenants![0].commercePermissions, [...ALL_COMMERCE_PERMISSIONS])
})
