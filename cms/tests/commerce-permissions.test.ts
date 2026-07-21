import assert from 'node:assert/strict'
import test from 'node:test'

import {
  ALL_COMMERCE_PERMISSIONS,
  effectivePermissions,
  hasPermission,
  type CommerceAssignmentRow,
  type CommerceUser,
} from '../src/commerce/permissions'

test('super-admin implicitly holds every commerce permission, independent of tenant rows', () => {
  const superAdmin: CommerceUser = { roles: ['super-admin'], tenants: [] }
  const granted = effectivePermissions(superAdmin, 5)
  assert.equal(granted.size, ALL_COMMERCE_PERMISSIONS.length)
  for (const p of ALL_COMMERCE_PERMISSIONS) assert.ok(hasPermission(granted, p), `missing ${p}`)
})

test('a tenant-scoped user gets only the permissions on the matching assignment row', () => {
  const editor: CommerceUser = {
    roles: ['editor'],
    tenants: [{ tenant: 5, commercePermissions: ['catalog.manage', 'orders.read'] } as CommerceAssignmentRow],
  }
  const granted = effectivePermissions(editor, 5)
  assert.ok(hasPermission(granted, 'catalog.manage'))
  assert.ok(hasPermission(granted, 'orders.read'))
  assert.ok(!hasPermission(granted, 'orders.manage'))
  assert.ok(!hasPermission(granted, 'payments.refund'))
})

test('a user with no matching tenant row gets no permissions', () => {
  const editor: CommerceUser = {
    roles: ['editor'],
    tenants: [{ tenant: 5, commercePermissions: ['catalog.manage'] } as CommerceAssignmentRow],
  }
  assert.equal(effectivePermissions(editor, 999).size, 0)
})

test('unknown permission strings on a row are filtered out, not silently granted', () => {
  const user: CommerceUser = {
    roles: ['admin'],
    tenants: [{ tenant: 7, commercePermissions: ['catalog.manage', 'not.a.real.permission'] } as CommerceAssignmentRow],
  }
  const granted = effectivePermissions(user, 7)
  assert.equal(granted.size, 1)
  assert.ok(hasPermission(granted, 'catalog.manage'))
})

test('an unauthenticated / null user gets no permissions', () => {
  assert.equal(effectivePermissions(null, 5).size, 0)
})

// ─── Real-schema regression guard ──────────────────────────────────────────────────────────────
// The original bug: `commercePermissions` was referenced by this reader but never declared as a
// field, so real persisted users had rows WITHOUT the property at all (not even `[]`). The reader
// treated `undefined` as `[]` and every non-super-admin got an empty set → `isCommerceAdmin()`
// returned false → no commerce-admin UI. This test pins the reader's behaviour against the
// real persisted shape (a row with no `commercePermissions` key) so a future schema regression
// doesn't silently re-introduce the empty-set bug. The companion test
// (user-commerce-permissions-defaults.test.ts) covers the hook that now STAMPS the default so
// real rows are never unset in the first place after a create/update.

test('a real persisted admin row WITHOUT a commercePermissions key reads as having no permissions (pre-fix shape)', () => {
  // This is the SHAPE that existed before the fix: the row has `tenant` but no `commercePermissions`
  // sibling (because the field didn't exist). The reader must return an empty set, NOT throw —
  // and the reader alone cannot fix the bug; the stamping hook in enforceUserScope is what ensures
  // new rows are never persisted in this shape.
  const adminRowMissingField = { tenant: 5 } as CommerceAssignmentRow
  const admin: CommerceUser = { roles: ['admin'], tenants: [adminRowMissingField] }
  assert.equal(effectivePermissions(admin, 5).size, 0)
})

test('after the stamping hook runs, an admin row carries ALL_COMMERCE_PERMISSIONS and reads correctly', () => {
  // Post-fix shape: enforceUserScope stamps the default, so the row reads with full permissions.
  const adminRowStamped = {
    tenant: 5,
    commercePermissions: [...ALL_COMMERCE_PERMISSIONS],
  } as CommerceAssignmentRow
  const admin: CommerceUser = { roles: ['admin'], tenants: [adminRowStamped] }
  const granted = effectivePermissions(admin, 5)
  assert.equal(granted.size, ALL_COMMERCE_PERMISSIONS.length)
  for (const p of ALL_COMMERCE_PERMISSIONS) assert.ok(hasPermission(granted, p), `missing ${p}`)
})

test('the inlined default list in userAccess.ts stays in sync with ALL_COMMERCE_PERMISSIONS', async () => {
  // The role-default list is duplicated in userAccess.ts (to avoid a module-init cycle with this
  // module). This test pins that the duplication stays in sync: driving enforceUserScope with an
  // admin user must stamp EXACTLY ALL_COMMERCE_PERMISSIONS, no more, no less. If either list drifts
  // (a permission added here but not there, or vice versa), this test fails.
  const { enforceUserScope } = await import('../src/access/userAccess')
  const superAdmin = { id: 1, roles: ['super-admin'], tenants: [] }
  const req = { user: superAdmin, headers: new Headers(), payload: { db: { defaultIDType: 'number' as const } } }
  const result = (await enforceUserScope({
    data: { roles: ['admin'], tenants: [{ tenant: 7 }] },
    operation: 'create',
    req,
  } as never)) as { tenants?: Array<{ commercePermissions?: string[] }> }

  const stamped = result.tenants?.[0]?.commercePermissions ?? []
  assert.deepEqual(
    [...stamped].sort(),
    [...ALL_COMMERCE_PERMISSIONS].sort(),
    'enforceUserScope admin default must equal ALL_COMMERCE_PERMISSIONS exactly (the inlined list in userAccess.ts has drifted)',
  )
})
