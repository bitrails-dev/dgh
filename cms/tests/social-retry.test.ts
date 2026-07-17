// Task 3: authorized explicit publication retry. Only `failed` records are retryable; the durable job
// is re-enqueued on the social-publishing queue with the [platform] snapshot, reusing the existing
// record. Authorization, invalid statuses, not-found, cross-tenant, and CSRF are all rejected.
import assert from 'node:assert/strict'
import test from 'node:test'
import { socialEndpoints } from '../src/social/oauth/endpoints'

process.env.PAYLOAD_PUBLIC_SERVER_URL = 'https://cms.example.dev'

const retry = socialEndpoints.find((e) => e.path === '/social/retry-publication')!

type Store = Array<Record<string, unknown>>
const makeReq = (user: unknown, body: unknown, pubs: Store, origin = 'https://cms.example.dev') => {
  const queued: Array<{ task: string; queue?: string; input: Record<string, unknown> }> = []
  const req = {
    user,
    url: 'https://cms.example.dev/api/social/retry-publication',
    headers: { get: (k: string) => (k === 'origin' ? origin : null) },
    json: async () => body,
    payload: {
      async find({ collection, where }: { collection: string; where?: unknown }) {
        const w = where as { and?: Array<Record<string, { equals: unknown }>> } | undefined
        const docs = (collection === 'social-publications' ? pubs : []).filter((d) =>
          w?.and ? w.and.every((cl) => { const [f, c] = Object.entries(cl)[0]; return String(d[f]) === String(c.equals) }) : true,
        )
        return { docs }
      },
      jobs: { async queue(a: { task: string; queue?: string; input: Record<string, unknown> }) { queued.push(a); return { id: 1 } } },
    },
  } as never
  return { req, queued }
}

const superAdmin = { roles: ['super-admin'] }
const otherAdmin = { roles: ['admin'], tenants: [{ tenant: 99 }] }
const pub = (status: string): Store => [{ id: 1, tenant: 7, article: 5, platform: 'facebook', status }]

test('retry a failed publication → enqueues on social-publishing with the [platform] snapshot', async () => {
  const { req, queued } = makeReq(superAdmin, { tenantId: 7, articleId: 5, platform: 'facebook' }, pub('failed'))
  const r = await retry.handler(req) as Response
  assert.equal(r.status, 200)
  assert.equal(queued.length, 1)
  assert.equal(queued[0].queue, 'social-publishing')
  assert.deepEqual(queued[0].input, { tenantId: 7, articleId: 5, platforms: ['facebook'] })
})

test('a published publication is not retryable → 400, not enqueued', async () => {
  const { req, queued } = makeReq(superAdmin, { tenantId: 7, articleId: 5, platform: 'facebook' }, pub('published'))
  assert.equal((await retry.handler(req) as Response).status, 400)
  assert.equal(queued.length, 0)
})

test('a skipped publication is not retryable → 400', async () => {
  const { req } = makeReq(superAdmin, { tenantId: 7, articleId: 5, platform: 'facebook' }, pub('skipped'))
  assert.equal((await retry.handler(req) as Response).status, 400)
})

test('no record found → 404, not enqueued', async () => {
  const { req, queued } = makeReq(superAdmin, { tenantId: 7, articleId: 5, platform: 'facebook' }, [])
  assert.equal((await retry.handler(req) as Response).status, 404)
  assert.equal(queued.length, 0)
})

test('cross-tenant user → 403, not enqueued', async () => {
  const { req, queued } = makeReq(otherAdmin, { tenantId: 7, articleId: 5, platform: 'facebook' }, pub('failed'))
  assert.equal((await retry.handler(req) as Response).status, 403)
  assert.equal(queued.length, 0)
})

test('cross-origin (CSRF) → 403', async () => {
  const { req } = makeReq(superAdmin, { tenantId: 7, articleId: 5, platform: 'facebook' }, pub('failed'), 'https://evil.example')
  assert.equal((await retry.handler(req) as Response).status, 403)
})

test('unknown platform → 400', async () => {
  const { req } = makeReq(superAdmin, { tenantId: 7, articleId: 5, platform: 'not-a-platform' }, pub('failed'))
  assert.equal((await retry.handler(req) as Response).status, 400)
})

test('unauthenticated → 401', async () => {
  const { req } = makeReq(null, { tenantId: 7, articleId: 5, platform: 'facebook' }, pub('failed'))
  assert.equal((await retry.handler(req) as Response).status, 401)
})
