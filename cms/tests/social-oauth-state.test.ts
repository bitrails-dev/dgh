// OAuth one-time state: create/consume + replay/signature rejection. Mock payload; no live calls.
import assert from 'node:assert/strict'
import test from 'node:test'
import { createOAuthState, consumeOAuthState } from '../src/social/oauth/state'
import { signState } from '../src/social/crypto'

process.env.PAYLOAD_SECRET = 'oauth-state-test-secret'

const matchWhere = (doc: Record<string, unknown>, where: unknown): boolean => {
  if (!where || typeof where !== 'object') return true
  const w = where as Record<string, unknown>
  if (Array.isArray(w.and)) return (w.and as unknown[]).every((cl) => matchWhere(doc, cl))
  for (const [field, cond] of Object.entries(w)) {
    if (field === 'and' || field === 'or') continue
    if (cond && typeof cond === 'object' && 'equals' in (cond as Record<string, unknown>)) {
      if (String(doc[field]) !== String((cond as { equals: unknown }).equals)) return false
    }
  }
  return true
}

const makePayload = (stores: Record<string, Array<Record<string, unknown>>>) => ({
  async find({ collection, where, limit }: { collection: string; where?: unknown; limit?: number }) {
    let docs = (stores[collection] ?? []).filter((d) => matchWhere(d, where))
    if (limit) docs = docs.slice(0, limit)
    return { docs }
  },
  async findByID() { return {} },
  async create({ collection, data }: { collection: string; data: Record<string, unknown> }) {
    const store = stores[collection] ?? (stores[collection] = [])
    const doc = { id: store.length + 1, ...data }
    store.push(doc)
    return doc
  },
  async update({ collection, id, data }: { collection: string; id: number | string; data: Record<string, unknown> }) {
    const store = stores[collection] ?? []
    const i = store.findIndex((d) => String(d.id) === String(id))
    return Object.assign(store[i], data)
  },
})

test('createOAuthState stores a nonce hash + expiry and returns a signed token', async () => {
  const stores: Record<string, Array<Record<string, unknown>>> = {}
  const payload = makePayload(stores)
  const token = await createOAuthState(payload, { tenantId: 7, platform: 'facebook', now: () => 1_000 })
  const rows = stores['social-oauth-states']!
  assert.equal(rows.length, 1)
  assert.ok(rows[0].nonceHash, 'nonce hash stored')
  assert.equal(rows[0].consumedAt, null)
  assert.ok(rows[0].expiresAt)
  assert.ok(token.includes('.'), 'signed token shape')
})

test('two states get different nonces', async () => {
  const stores: Record<string, Array<Record<string, unknown>>> = {}
  const payload = makePayload(stores)
  await createOAuthState(payload, { tenantId: 7, platform: 'facebook', now: () => 1 })
  await createOAuthState(payload, { tenantId: 7, platform: 'facebook', now: () => 2 })
  const hashes = stores['social-oauth-states']!.map((r) => r.nonceHash)
  assert.notEqual(hashes[0], hashes[1])
})

test('consumeOAuthState returns the payload and marks the nonce consumed', async () => {
  const stores: Record<string, Array<Record<string, unknown>>> = {}
  const payload = makePayload(stores)
  const token = await createOAuthState(payload, { tenantId: 7, platform: 'linkedin', returnTo: '/admin/collections/tenants/7', now: () => Date.now() })
  const consumed = await consumeOAuthState(payload, token)
  assert.equal(consumed.tenantId, 7)
  assert.equal(consumed.platform, 'linkedin')
  assert.equal(consumed.returnTo, '/admin/collections/tenants/7')
  assert.ok(stores['social-oauth-states']![0].consumedAt, 'marked consumed')
})

test('a state cannot be consumed twice (replay rejected)', async () => {
  const stores: Record<string, Array<Record<string, unknown>>> = {}
  const payload = makePayload(stores)
  const token = await createOAuthState(payload, { tenantId: 7, platform: 'facebook', now: () => Date.now() })
  await consumeOAuthState(payload, token)
  await assert.rejects(() => consumeOAuthState(payload, token), /already used|replay/i)
})

test('a bad signature is rejected before any DB write', async () => {
  const stores: Record<string, Array<Record<string, unknown>>> = {}
  const payload = makePayload(stores)
  const forged = signState({ tenantId: 7, platform: 'facebook', nonce: 'x', exp: Date.now() + 1000 }, 'wrong-secret')
  await assert.rejects(() => consumeOAuthState(payload, forged), /signature/i)
})

test('a valid signature with no stored nonce is rejected', async () => {
  const stores: Record<string, Array<Record<string, unknown>>> = {} // no rows
  const payload = makePayload(stores)
  const real = signState({ tenantId: 7, platform: 'facebook', nonce: 'ghost', exp: Date.now() + 1000 })
  await assert.rejects(() => consumeOAuthState(payload, real), /unknown/i)
})
