// Task D/E: the three social collections keep tokens unreachable via the public API, and
// publications/oauth-states enforce their uniqueness/idempotency indexes. `social-connections` is
// admin-visible to managers (super-admin + tenant admin) and tenant-scoped, with the encrypted token
// blob field-locked so it is never shown or writable through the UI / REST / GraphQL.
import assert from 'node:assert/strict'
import test from 'node:test'
import { SocialConnections } from '../src/collections/SocialConnections'
import { SocialPublications } from '../src/collections/SocialPublications'
import { SocialOAuthStates } from '../src/collections/SocialOAuthStates'

type User = { roles?: string[]; tenants?: Array<{ tenant?: number | string }> } | undefined

const accessFor = (access: unknown, op: string, user: User) => {
  const fn = (access as Record<string, (args: { req: { user: User } }) => unknown> | undefined)?.[op]
  assert.equal(typeof fn, 'function', `${op} access must be a function`)
  return fn!({ req: { user } })
}

// For collections whose access is a constant `() => false` (no args read).
const isLocked = (access: unknown, op: string) => {
  const fn = (access as Record<string, () => unknown> | undefined)?.[op]
  assert.equal(typeof fn, 'function', `${op} access must be a function`)
  return fn!()
}

const superAdmin = { roles: ['super-admin'] }
const tenantAdmin = { roles: ['admin'], tenants: [{ tenant: 7 }] }
const editor = { roles: ['editor'], tenants: [{ tenant: 7 }] }

test('social-connections is nav-visible to managers only, tenant-scoped, and never hand-createable', () => {
  // Nav visibility: a function. Managers see it; editors + anonymous do not.
  assert.equal(typeof SocialConnections.admin?.hidden, 'function')
  assert.equal((SocialConnections.admin!.hidden as (a: { user: User }) => boolean)({ user: undefined }), true)
  assert.equal((SocialConnections.admin!.hidden as (a: { user: User }) => boolean)({ user: editor }), true)
  assert.equal((SocialConnections.admin!.hidden as (a: { user: User }) => boolean)({ user: tenantAdmin }), false)
  assert.equal((SocialConnections.admin!.hidden as (a: { user: User }) => boolean)({ user: superAdmin }), false)

  // Read/update: super-admin → all; tenant admin → constrained to own tenants; editor/anonymous → denied.
  assert.equal(accessFor(SocialConnections.access, 'read', undefined), false)
  assert.equal(accessFor(SocialConnections.access, 'read', editor), false)
  assert.equal(accessFor(SocialConnections.access, 'read', superAdmin), true)
  assert.deepEqual(accessFor(SocialConnections.access, 'read', tenantAdmin), { tenant: { in: ['7'] } })
  assert.deepEqual(accessFor(SocialConnections.access, 'update', tenantAdmin), { tenant: { in: ['7'] } })

  // Create is always denied (OAuth connect flow owns creation); delete is always denied (Disconnect
  // endpoint owns removal — and also revokes at the provider).
  for (const op of ['create', 'delete']) {
    assert.equal(accessFor(SocialConnections.access, op, tenantAdmin), false, `${op} must be denied`)
    assert.equal(accessFor(SocialConnections.access, op, superAdmin), false, `${op} must be denied`)
  }
})

test('social-connections encrypted token blob is field-locked and admin-hidden', () => {
  const tokenField = SocialConnections.fields.find(
    (f) => 'name' in f && (f as { name?: string }).name === 'encryptedTokens',
  ) as { access?: Record<string, () => unknown>; admin?: { hidden?: boolean } } | undefined
  assert.ok(tokenField, 'encryptedTokens field must exist')
  assert.equal(tokenField!.admin?.hidden, true, 'token field must be admin-hidden')
  assert.equal(tokenField!.access?.read?.(), false, 'token field read must be denied')
  assert.equal(tokenField!.access?.update?.(), false, 'token field update must be denied')
})

test('social-connections enforces uniqueness on tenant+platform+remoteAccountId', () => {
  const idx = SocialConnections.indexes?.find((i) => i.unique && i.fields.length === 3)
  assert.ok(idx, 'must have a 3-field unique index')
  assert.deepEqual(idx!.fields.sort(), ['platform', 'remoteAccountId', 'tenant'].sort())
})

test('social-publications is hidden, access-locked, and idempotent on article+platform', () => {
  assert.equal(SocialPublications.admin?.hidden, true)
  for (const op of ['read', 'create', 'update', 'delete']) {
    assert.equal(isLocked(SocialPublications.access, op), false, `${op} must be denied`)
  }
  const idx = SocialPublications.indexes?.find((i) => i.unique)
  assert.ok(idx, 'must have a unique idempotency index')
  assert.deepEqual(idx!.fields.sort(), ['article', 'platform'].sort())
})

test('social-oauth-states is hidden, access-locked, with a unique nonce hash', () => {
  assert.equal(SocialOAuthStates.admin?.hidden, true)
  for (const op of ['read', 'create', 'update', 'delete']) {
    assert.equal(isLocked(SocialOAuthStates.access, op), false, `${op} must be denied`)
  }
  const nonce = SocialOAuthStates.fields.find((f) => 'name' in f && (f as { name: string }).name === 'nonceHash') as
    | { unique?: boolean } | undefined
  assert.equal(nonce?.unique, true)
})
