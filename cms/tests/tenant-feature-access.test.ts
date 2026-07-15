import assert from 'node:assert/strict'
import test from 'node:test'
import type { AccessArgs, CollectionSlug } from 'payload'
import configPromise from '../src/payload.config'

const tenantAdmin = {
  id: 2,
  collection: 'users',
  email: 'admin@example.com',
  roles: ['admin'],
  tenants: [{ tenant: 7 }],
} as unknown as NonNullable<AccessArgs['req']['user']>

const superAdmin = {
  id: 1,
  collection: 'users',
  email: 'root@example.com',
  roles: ['super-admin'],
  tenants: [],
} as unknown as NonNullable<AccessArgs['req']['user']>

const makeRequest = ({
  cookie = 'payload-tenant=7',
  features,
  findTenant,
  user = tenantAdmin,
}: {
  cookie?: string
  features: string[]
  findTenant?: () => Promise<{ features?: string[] }>
  user?: AccessArgs['req']['user']
}) => ({
  headers: new Headers(cookie ? { cookie } : undefined),
  payload: {
    db: { defaultIDType: 'number' },
    findByID: findTenant ?? (async () => ({ id: 7, features })),
  },
  user,
}) as unknown as AccessArgs['req']

const accessCollection = async ({
  cookie = 'payload-tenant=7',
  features,
  findTenant,
  operation = 'read',
  slug,
  user = tenantAdmin,
}: {
  cookie?: string
  features: string[]
  findTenant?: () => Promise<{ features?: string[] }>
  operation?: 'create' | 'delete' | 'read' | 'update'
  slug: CollectionSlug
  user?: AccessArgs['req']['user']
}) => {
  const config = await configPromise
  const collection = config.collections.find((candidate) => candidate.slug === slug)
  const access = collection?.access?.[operation]

  if (typeof access !== 'function') {
    throw new TypeError(`${slug}.${operation} access must be a function`)
  }

  return access({
    req: makeRequest({ cookie, features, findTenant, user }),
  } as unknown as AccessArgs)
}

const readCollection = (slug: CollectionSlug, features: string[]) =>
  accessCollection({ features, slug })

test('a tenant admin cannot read or navigate to a collection disabled for the selected tenant', async () => {
  assert.equal(await readCollection('departments', ['articles']), false)
})

test('a tenant admin retains tenant-scoped access to an enabled collection', async () => {
  assert.deepEqual(await readCollection('departments', ['departments']), {
    and: [
      { tenant: { in: [7] } },
      { tenant: { equals: 7 } },
    ],
  })
})

test('an enabled feature is constrained to the selected tenant, not every assigned tenant', async () => {
  const user = {
    ...tenantAdmin,
    tenants: [{ tenant: 7 }, { tenant: 8 }],
  } as unknown as NonNullable<AccessArgs['req']['user']>

  assert.deepEqual(await accessCollection({
    features: ['departments'],
    slug: 'departments',
    user,
  }), {
    and: [
      { tenant: { in: [7, 8] } },
      { tenant: { equals: 7 } },
    ],
  })
})

test('each tenant capability exposes only its related collections', async () => {
  const cases: Array<[CollectionSlug, string]> = [
    ['departments', 'departments'],
    ['doctors', 'team'],
    ['articles', 'articles'],
    ['events', 'events'],
    ['awards', 'awards'],
    ['achievements', 'achievements'],
    ['testimonials', 'testimonials'],
  ]

  for (const [slug, feature] of cases) {
    assert.notEqual(await readCollection(slug, [feature]), false, `${slug} should be enabled`)
    assert.equal(await readCollection(slug, []), false, `${slug} should be disabled`)
  }
})

test('categories are available only when articles or events are enabled', async () => {
  assert.notEqual(await readCollection('categories', ['articles']), false)
  assert.notEqual(await readCollection('categories', ['events']), false)
  assert.equal(await readCollection('categories', ['departments']), false)
})

test('Media is available for general entity settings while Icons follows Departments', async () => {
  assert.notEqual(await readCollection('media', ['articles']), false)
  assert.notEqual(await readCollection('media', []), false)
  assert.equal(await readCollection('icons', ['departments']), true)
  assert.equal(await readCollection('icons', ['articles']), false)
})

test('tenant admins can select shared icons but cannot mutate the platform icon library', async () => {
  for (const operation of ['create', 'update', 'delete'] as const) {
    assert.equal(await accessCollection({
      features: ['departments'],
      operation,
      slug: 'icons',
    }), false)
  }
})

test('disabled capabilities also reject direct write access', async () => {
  for (const operation of ['create', 'update', 'delete'] as const) {
    assert.equal(await accessCollection({
      features: ['articles'],
      operation,
      slug: 'departments',
    }), false)
  }
})

test('direct creates cannot assign an enabled document to a different tenant', async () => {
  const config = await configPromise
  const collection = config.collections.find((candidate) => candidate.slug === 'departments')
  const hook = collection?.hooks?.beforeChange?.at(-1)
  if (!hook) throw new TypeError('departments.beforeChange access hook is required')

  const req = makeRequest({ features: ['departments'] })
  await assert.rejects(
    hook({ data: { tenant: 8 }, operation: 'create', req } as never),
    /Documents can only be managed within the selected tenant/,
  )

  assert.deepEqual(
    await hook({ data: {}, operation: 'create', req } as never),
    { tenant: 7 },
  )
})

test('public reads and super-admin access are unchanged', async () => {
  assert.equal(await accessCollection({ features: [], slug: 'departments', user: null }), true)
  assert.equal(await accessCollection({ features: [], slug: 'departments', user: superAdmin }), true)
})

test('a multi-tenant admin must select a tenant before capability collections are exposed', async () => {
  const user = {
    ...tenantAdmin,
    tenants: [{ tenant: 7 }, { tenant: 8 }],
  } as unknown as NonNullable<AccessArgs['req']['user']>

  assert.equal(await accessCollection({
    cookie: '',
    features: ['departments'],
    slug: 'departments',
    user,
  }), false)
})

test('a stale tenant selection fails closed instead of breaking admin navigation', async () => {
  assert.equal(await accessCollection({
    features: [],
    findTenant: async () => { throw new Error('Tenant no longer exists') },
    slug: 'departments',
  }), false)
})
