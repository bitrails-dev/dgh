// Task 4: disconnect revokes provider credentials where supported (Google/YouTube RFC 7009), keeps
// the local connection on revocation FAILURE so the operator can retry, and reports `local_only`
// honestly for providers with no revoke endpoint (FB/IG/LinkedIn). No token ever reaches the result.
import assert from 'node:assert/strict'
import test from 'node:test'
import { socialEndpoints } from '../src/social/oauth/endpoints'
import { OAUTH_PROVIDERS } from '../src/social/oauth/providers'
import { encryptToken } from '../src/social/crypto'

process.env.PAYLOAD_SECRET = 'disconnect-test-secret'

const disconnect = socialEndpoints.find((e) => e.path === '/social/disconnect')!

type Store = Array<Record<string, unknown>>
const makeReq = (user: unknown, body: unknown, stores: Record<string, Store>, origin = 'https://cms.example.dev') => ({
  user,
  url: 'https://cms.example.dev/api/social/disconnect',
  headers: { get: (k: string) => (k === 'origin' ? origin : null) },
  json: async () => body,
  payload: {
    async find({ collection, where }: { collection: string; where?: unknown }) {
      const w = where as { and?: Array<Record<string, { equals: unknown }>> } | undefined
      const docs = (stores[collection] ?? []).filter((d) => {
        if (!w?.and) return true
        return w.and.every((cl) => { const [f, c] = Object.entries(cl)[0]; return String(d[f]) === String(c.equals) })
      })
      return { docs }
    },
    async update({ collection, id, data }: { collection: string; id: number | string; data: Record<string, unknown> }) {
      const s = stores[collection] ?? []; const i = s.findIndex((d) => String(d.id) === String(id)); if (i >= 0) Object.assign(s[i], data); return s[i]
    },
    async delete({ collection, id }: { collection: string; id: number | string }) {
      const s = stores[collection] ?? []; const i = s.findIndex((d) => String(d.id) === String(id)); if (i >= 0) s.splice(i, 1); return { id }
    },
  },
}) as never

const superAdmin = { roles: ['super-admin'] }
const conn = (platform: string, enc: string) => ({ id: 1, tenant: 7, platform, status: 'connected', encryptedTokens: enc })
const resJson = async (r: Response) => ({ status: r.status, body: await r.json() })
const patchFetch = (fn: typeof fetch): [typeof fetch, () => void] => {
  const orig = globalThis.fetch
  globalThis.fetch = fn
  return [orig, () => { globalThis.fetch = orig }]
}

test('youtube revoke posts to oauth2.googleapis.com/revoke with the token', async () => {
  let calledUrl = ''
  const f = (async (url: string | URL | Request) => { calledUrl = String(url); return { ok: true, status: 200 } }) as unknown as typeof fetch
  const r = await OAUTH_PROVIDERS.youtube!.revoke!({ credentials: { refreshToken: 'yt-refresh' }, fetch: f })
  assert.equal(r.revoked, true)
  assert.ok(calledUrl.startsWith('https://oauth2.googleapis.com/revoke?token=yt-refresh'))
})

test('youtube disconnect: revoke success → revoked, local connection deleted', async () => {
  const [, restore] = patchFetch((async () => ({ ok: true, status: 200 })) as unknown as typeof fetch)
  try {
    const stores: Record<string, Store> = { 'social-connections': [conn('youtube', encryptToken(JSON.stringify({ refreshToken: 'yt-refresh' })))] }
    const { status, body } = await resJson(await disconnect.handler(makeReq(superAdmin, { tenant: 7, platform: 'youtube' }, stores)) as Response)
    assert.equal(status, 200); assert.equal(body.disconnected, true); assert.equal(body.revoked, 'revoked')
    assert.equal(stores['social-connections']!.length, 0)
  } finally { restore() }
})

test('youtube disconnect: provider 500 → failed, local connection KEPT for retry', async () => {
  const [, restore] = patchFetch((async () => ({ ok: false, status: 500 })) as unknown as typeof fetch)
  try {
    const stores: Record<string, Store> = { 'social-connections': [conn('youtube', encryptToken(JSON.stringify({ refreshToken: 'yt-refresh' })))] }
    const { status, body } = await resJson(await disconnect.handler(makeReq(superAdmin, { tenant: 7, platform: 'youtube' }, stores)) as Response)
    assert.equal(status, 502); assert.equal(body.disconnected, false); assert.equal(body.revoked, 'failed')
    assert.equal(stores['social-connections']!.length, 1)
    assert.equal(stores['social-connections']![0].status, 'error')
  } finally { restore() }
})

test('facebook has no revoke endpoint → local_only, local connection deleted (no provider call)', async () => {
  assert.equal(typeof OAUTH_PROVIDERS.facebook!.revoke, 'undefined')
  let called = false
  const [, restore] = patchFetch((async () => { called = true; return { ok: true, status: 200 } }) as unknown as typeof fetch)
  try {
    const stores: Record<string, Store> = { 'social-connections': [conn('facebook', encryptToken(JSON.stringify({ pageId: '1', accessToken: 'tok' })))] }
    const { status, body } = await resJson(await disconnect.handler(makeReq(superAdmin, { tenant: 7, platform: 'facebook' }, stores)) as Response)
    assert.equal(status, 200); assert.equal(body.disconnected, true); assert.equal(body.revoked, 'local_only')
    assert.equal(stores['social-connections']!.length, 0)
    assert.equal(called, false)
  } finally { restore() }
})

test('disconnect by a tenant the user cannot manage → 403, nothing deleted', async () => {
  const otherTenantAdmin = { roles: ['admin'], tenants: [{ tenant: 99 }] }
  const stores: Record<string, Store> = { 'social-connections': [conn('facebook', encryptToken('{}'))] }
  const r = await disconnect.handler(makeReq(otherTenantAdmin, { tenant: 7, platform: 'facebook' }, stores)) as Response
  assert.equal(r.status, 403)
  assert.equal(stores['social-connections']!.length, 1)
})

test('cross-origin disconnect (CSRF) → 403, nothing deleted', async () => {
  // Round-3: the disconnect POST is now CSRF-guarded like selection/retry.
  const stores: Record<string, Store> = { 'social-connections': [conn('facebook', encryptToken('{}'))] }
  const r = await disconnect.handler(makeReq(superAdmin, { tenant: 7, platform: 'facebook' }, stores, 'https://evil.example')) as Response
  assert.equal(r.status, 403)
  assert.equal(stores['social-connections']!.length, 1)
})
