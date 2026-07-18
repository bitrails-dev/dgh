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
