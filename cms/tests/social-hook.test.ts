// Task 1: the Article create hook enqueues exactly ONE durable job (stable IDs only) when there are
// eligible targets, and zero otherwise. A queue error is swallowed so it can never roll the Article
// back. The hook never calls runPublications directly (no fire-and-forget remains).
import assert from 'node:assert/strict'
import test from 'node:test'
import { queueSocialPublish } from '../src/social/hook'
import { SOCIAL_PUBLISH_TASK_SLUG } from '../src/social/jobs'

type HookArgs = Parameters<typeof queueSocialPublish>[0]
const run = (args: Partial<HookArgs> & { doc: Record<string, unknown>; operation: string }) =>
  queueSocialPublish(args as never) as Promise<Record<string, unknown>>

const tenant = (sp: Record<string, unknown> | null) => ({ id: 7, socialPublishing: sp })
const conn = (platform: string) => ({ id: 1, tenant: 7, platform, status: 'connected' })

const makeReq = (tenants: Record<string, unknown>[], connections: Record<string, unknown>[]) => {
  const queued: Array<{ task: string; queue?: string; input: Record<string, unknown> }> = []
  const req = {
    payload: {
      async findByID({ collection, id }: { collection: string; id: number | string }) {
        if (collection === 'tenants') return tenants.find((t) => String(t.id) === String(id)) ?? null
        return {}
      },
      async find({ collection }: { collection: string }) {
        return { docs: collection === 'social-connections' ? connections : [] }
      },
      jobs: { async queue(a: { task: string; queue?: string; input: Record<string, unknown> }) { queued.push(a); return { id: 1 } } },
    },
  } as never
  return { req, queued }
}

const baseArticle = { id: 5, tenant: 7, autoPublish: true }
const eligible = () => makeReq([tenant({ enabled: true, includedPlatforms: ['facebook'] })], [conn('facebook')])

test('create with eligible targets → enqueues exactly one job on the social-publishing queue with the target snapshot', async () => {
  const { req, queued } = eligible()
  await run({ doc: { ...baseArticle }, operation: 'create', req })
  assert.equal(queued.length, 1)
  assert.equal(queued[0].task, SOCIAL_PUBLISH_TASK_SLUG)
  assert.equal(queued[0].queue, 'social-publishing')
  assert.deepEqual(queued[0].input, { tenantId: 7, articleId: 5, platforms: ['facebook'] })
})

test('update → enqueues zero jobs', async () => {
  const { req, queued } = eligible()
  await run({ doc: { ...baseArticle }, operation: 'update', req })
  assert.equal(queued.length, 0)
})

test('explicit autoPublish:false → enqueues zero jobs', async () => {
  const { req, queued } = eligible()
  await run({ doc: { ...baseArticle, autoPublish: false }, operation: 'create', req })
  assert.equal(queued.length, 0)
})

test('tenant publishing disabled → zero jobs', async () => {
  const { req, queued } = makeReq([tenant({ enabled: false, includedPlatforms: ['facebook'] })], [conn('facebook')])
  await run({ doc: { ...baseArticle }, operation: 'create', req })
  assert.equal(queued.length, 0)
})

test('included platform has no connection → zero jobs', async () => {
  const { req, queued } = makeReq([tenant({ enabled: true, includedPlatforms: ['facebook'] })], [conn('instagram')])
  await run({ doc: { ...baseArticle }, operation: 'create', req })
  assert.equal(queued.length, 0)
})

test('context.skipSocial → zero jobs', async () => {
  const { req, queued } = eligible()
  await run({ doc: { ...baseArticle }, operation: 'create', req, context: { skipSocial: true } })
  assert.equal(queued.length, 0)
})

test('a queue error is swallowed — the Article save is never affected', async () => {
  const req = {
    payload: {
      async findByID() { return tenant({ enabled: true, includedPlatforms: ['facebook'] }) },
      async find() { return { docs: [conn('facebook')] } },
      jobs: { async queue() { throw new Error('db down') } },
    },
  } as never
  const out = await run({ doc: { ...baseArticle }, operation: 'create', req })
  assert.equal(out.id, 5) // doc returned untouched; the error never surfaced
})
