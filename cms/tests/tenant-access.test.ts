import assert from 'node:assert/strict'
import test from 'node:test'
import type { AccessArgs } from 'payload'
import { Tenants } from '../src/collections/Tenants'

const readTenants = async (user: AccessArgs['req']['user']) => {
  const access = Tenants.access?.read
  if (typeof access !== 'function') throw new TypeError('Tenants.read access must be a function')
  return access({ req: { user } } as AccessArgs)
}

const superAdmin = {
  id: 1,
  collection: 'users',
  email: 'root@example.com',
  roles: ['super-admin'],
  tenants: [],
} as unknown as NonNullable<AccessArgs['req']['user']>

const tenantAdmin = {
  id: 2,
  collection: 'users',
  email: 'admin@example.com',
  roles: ['admin'],
  tenants: [{ tenant: 7 }],
} as unknown as NonNullable<AccessArgs['req']['user']>

test('tenant admins can read only their assigned tenants', async () => {
  const result = await readTenants(tenantAdmin)
  assert.deepEqual(result, { id: { in: ['7'] } })
})

test('public tenant resolution and super-admin tenant access remain available', async () => {
  assert.equal(await readTenants(null), true)
  assert.equal(await readTenants(superAdmin), true)
})

test('entity settings are visible and tenant admins can update only assigned entities', async () => {
  assert.equal(Tenants.admin?.hidden, undefined)

  const update = Tenants.access?.update
  if (typeof update !== 'function') throw new TypeError('Tenants.update access must be a function')

  assert.deepEqual(await update({ req: { user: tenantAdmin } } as AccessArgs), {
    id: { in: ['7'] },
  })
  assert.equal(await update({ req: { user: superAdmin } } as AccessArgs), true)
})

test('only super-admins can create or delete tenant records', async () => {
  for (const operation of ['create', 'delete'] as const) {
    const access = Tenants.access?.[operation]
    if (typeof access !== 'function') {
      throw new TypeError(`Tenants.${operation} access must be a function`)
    }
    assert.equal(await access({ req: { user: tenantAdmin } } as AccessArgs), false)
    assert.equal(await access({ req: { user: superAdmin } } as AccessArgs), true)
  }
})

test('tenant admins cannot change platform-controlled routing, capabilities, or the settings entitlement', async () => {
  for (const fieldName of ['slug', 'type', 'domains', 'features', 'settingsEntitlement']) {
    const field = Tenants.fields.find((candidate) => 'name' in candidate && candidate.name === fieldName)
    if (!field || !('access' in field) || typeof field.access?.update !== 'function') {
      throw new TypeError(`${fieldName}.access.update must be a function`)
    }

    assert.equal(await field.access.update({ req: { user: tenantAdmin } } as never), false)
    assert.equal(await field.access.update({ req: { user: superAdmin } } as never), true)
  }
})

test('branding, hero, contact details, and social links remain entity-editable settings', () => {
  for (const fieldName of ['branding', 'hero', 'contact']) {
    const field = Tenants.fields.find((candidate) => 'name' in candidate && candidate.name === fieldName)
    assert.ok(field, `${fieldName} settings must exist`)
    assert.equal('access' in field ? field.access?.update : undefined, undefined)
  }

  const contact = Tenants.fields.find((field) => 'name' in field && field.name === 'contact')
  if (!contact || !('fields' in contact)) throw new TypeError('Contact settings must be a group')
  const social = contact.fields.find((field) => 'name' in field && field.name === 'social')
  if (!social || !('fields' in social)) throw new TypeError('Social settings must be a group')
  assert.deepEqual(
    social.fields.filter((field) => 'name' in field).map((field) => field.name),
    ['facebookUrl', 'instagramUrl', 'xUrl', 'threadsUrl', 'snapchatUrl', 'youtubeUrl', 'linkedinUrl', 'tiktokUrl'],
  )
})
