// Task 1: multi-account selection is atomic + POST-only. performSelection takes an INJECTED consume
// function; the fake implements a real compare-and-set over the in-memory sessions (first caller wins,
// rest get false), faithfully modelling the production `UPDATE ... WHERE consumed_at IS NULL RETURNING
// *`. Covers read-only GET, valid POST, concurrent replay, expired, already-consumed, cross-tenant,
// tampered target, not-found, and CSRF.
import assert from 'node:assert/strict'
import test from 'node:test'
import { socialEndpoints, performSelection } from '../src/social/oauth/endpoints'
import { encryptToken } from '../src/social/crypto'
import type { ConsumeFn } from '../src/social/oauth/consume'

process.env.PAYLOAD_SECRET = 'selection-test-secret'
process.env.PAYLOAD_PUBLIC_SERVER_URL = 'https://cms.example.dev'
process.env.SOCIAL_REDIRECT_BASE = 'https://cms.example.dev'

const get = socialEndpoints.find((e) => e.path === '/social/select/:sessionKey' && e.method === 'get')!

type Store = Array<Record<string, unknown>>
const targets = [
  { remoteAccountId: 'P1', remoteAccountLabel: 'Main Page', credentials: { pageId: 'P1', accessToken: 'tok1' } },
  { remoteAccountId: 'P2', remoteAccountLabel: 'Clinic Page', credentials: { pageId: 'P2', accessToken: 'tok2' } },
]
const encTargets = encryptToken(JSON.stringify(targets))
const future = new Date(Date.now() + 60_000).toISOString()
const past = new Date(Date.now() - 60_000).toISOString()

// Real compare-and-set over the in-memory sessions — matches the production UPDATE...RETURNING semantics.
const fakeConsume = (sessions: Store): ConsumeFn => async (id, now) => {
  const row = sessions.find((s) => String(s.id) === String(id))
  if (!row || row.consumedAt) return false // gone or already consumed → this caller loses
  row.consumedAt = now
  return true
}

const makeReq = (user: unknown, sessionKey: string, body: string | null, stores: Record<string, Store>, origin = 'https://cms.example.dev', failCreateOn?: string) => ({
  user,
  url: 'https://cms.example.dev/api/social/select/' + sessionKey,
  headers: { get: (k: string) => (k === 'origin' ? origin : null) },
  routeParams: { sessionKey },
  text: async () => body ?? '',
  payload: {
    async find({ collection, where }: { collection: string; where?: unknown }) {
      const w = where as { nonceHash?: { equals: unknown }; and?: Array<Record<string, { equals: unknown }>> } | undefined
      const docs = (stores[collection] ?? []).filter((d) => {
        if (w?.nonceHash) return d.nonceHash === w.nonceHash.equals
        if (w?.and) return w.and.every((cl) => { const [f, c] = Object.entries(cl)[0]; return String(d[f]) === String(c.equals) })
        return true
      })
      return { docs }
    },
    async update({ collection, id, data }: { collection: string; id: number | string; data: Record<string, unknown> }) {
      const s = stores[collection] ?? []; const i = s.findIndex((d) => String(d.id) === String(id)); if (i >= 0) Object.assign(s[i], data); return s[i]
    },
    async create({ collection, data }: { collection: string; data: Record<string, unknown> }) {
      if (failCreateOn && collection === failCreateOn) throw new Error('db down')
      const s = stores[collection] ?? (stores[collection] = []); const doc = { id: s.length + 1, ...data }; s.push(doc); return doc
    },
  },
}) as never

const superAdmin = { roles: ['super-admin'] }
const otherAdmin = { roles: ['admin'], tenants: [{ tenant: 99 }] }
const session = (overrides: Record<string, unknown> = {}): Store => [{
  id: 1, nonceHash: 'SK1', tenant: 7, platform: 'facebook', encryptedCandidates: encTargets,
  expiresAt: future, consumedAt: null, returnTo: null, ...overrides,
}]
const select = (user: unknown, key: string, body: string | null, stores: Record<string, Store>, origin?: string) =>
  performSelection(makeReq(user, key, body, stores, origin), fakeConsume(stores['social-oauth-states'] ?? []))

test('GET is read-only: lists every candidate (incl. non-first), leaks no tokens, stores nothing', async () => {
  const stores: Record<string, Store> = { 'social-oauth-states': session(), 'social-connections': [] }
  const r = await get.handler(makeReq(superAdmin, 'SK1', null, stores)) as Response
  assert.equal(r.status, 200)
  const html = await r.text()
  assert.ok(html.includes('Main Page') && html.includes('Clinic Page'))
  assert.ok(!html.includes('tok1') && !html.includes('tok2'))
  assert.equal(stores['social-connections']!.length, 0)
  assert.equal(stores['social-oauth-states']![0].consumedAt, null)
})

test('POST selects the chosen (non-first) target, consumes the session, stores one connection', async () => {
  const stores: Record<string, Store> = { 'social-oauth-states': session(), 'social-connections': [] }
  const r = await select(superAdmin, 'SK1', 'targetId=P2', stores) as Response
  assert.equal(r.status, 302)
  assert.equal(stores['social-connections']!.length, 1)
  assert.equal(stores['social-connections']![0].remoteAccountId, 'P2')
  assert.ok(!!stores['social-oauth-states']![0].consumedAt)
})

test('two concurrent POSTs → exactly one wins; one replay rejection; one connection stored', async () => {
  const stores: Record<string, Store> = { 'social-oauth-states': session(), 'social-connections': [] }
  const [a, b] = await Promise.all([
    select(superAdmin, 'SK1', 'targetId=P1', stores) as Promise<Response>,
    select(superAdmin, 'SK1', 'targetId=P2', stores) as Promise<Response>,
  ])
  assert.deepEqual([a.status, b.status].sort(), [302, 410])
  assert.equal(stores['social-connections']!.length, 1)
})

test('expired session → 410, nothing stored', async () => {
  const stores: Record<string, Store> = { 'social-oauth-states': session({ expiresAt: past }), 'social-connections': [] }
  assert.equal((await select(superAdmin, 'SK1', 'targetId=P1', stores) as Response).status, 410)
  assert.equal(stores['social-connections']!.length, 0)
})

test('already-consumed session → 410 (replay rejected)', async () => {
  const stores: Record<string, Store> = { 'social-oauth-states': session({ consumedAt: past }), 'social-connections': [] }
  assert.equal((await select(superAdmin, 'SK1', 'targetId=P1', stores) as Response).status, 410)
})

test('cross-tenant user → 403, session NOT consumed, nothing stored', async () => {
  const stores: Record<string, Store> = { 'social-oauth-states': session(), 'social-connections': [] }
  assert.equal((await select(otherAdmin, 'SK1', 'targetId=P1', stores) as Response).status, 403)
  assert.equal(stores['social-oauth-states']![0].consumedAt, null)
  assert.equal(stores['social-connections']!.length, 0)
})

test('tampered targetId → 400, session NOT consumed (no partial state)', async () => {
  const stores: Record<string, Store> = { 'social-oauth-states': session(), 'social-connections': [] }
  assert.equal((await select(superAdmin, 'SK1', 'targetId=PEVIL', stores) as Response).status, 400)
  assert.equal(stores['social-oauth-states']![0].consumedAt, null)
  assert.equal(stores['social-connections']!.length, 0)
})

test('unknown session key → 404', async () => {
  const stores: Record<string, Store> = { 'social-oauth-states': session(), 'social-connections': [] }
  assert.equal((await select(superAdmin, 'UNKNOWN', 'targetId=P1', stores) as Response).status, 404)
})

test('cross-origin POST (CSRF) → 403', async () => {
  const stores: Record<string, Store> = { 'social-oauth-states': session(), 'social-connections': [] }
  assert.equal((await select(superAdmin, 'SK1', 'targetId=P1', stores, 'https://evil.example') as Response).status, 403)
})

test('storage failure after a won consume releases the session (no partial state)', async () => {
  // Round-3: the consume wins, then storeConnection throws. Compensation must release the session so
  // it is reusable — no consumed-with-no-connection partial state. Goes through performSelection with
  // an injected release (in-memory), rigging connection storage to fail.
  const stores: Record<string, Store> = { 'social-oauth-states': session(), 'social-connections': [] }
  let released = 0
  const release = async (id: number | string) => {
    released++
    const row = stores['social-oauth-states']!.find((s) => String(s.id) === String(id))
    if (row) row.consumedAt = null
  }
  const req = makeReq(superAdmin, 'SK1', 'targetId=P1', stores, undefined, 'social-connections')
  const r = await performSelection(req, fakeConsume(stores['social-oauth-states'] ?? []), release) as Response
  assert.equal(r.status, 500)
  assert.equal(released, 1, 'compensation released the session')
  assert.equal(stores['social-connections']!.length, 0, 'no connection stored')
  assert.equal(stores['social-oauth-states']![0].consumedAt, null, 'session un-consumed → reusable')
})
