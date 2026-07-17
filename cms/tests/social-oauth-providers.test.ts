// OAuth provider contract tests: auth URL shape + token exchange + target listing, all mocked.
// listTargets returns ALL publishable targets (every manageable FB Page / IG account); the connect
// flow auto-completes on one and routes many to a selection session.
import assert from 'node:assert/strict'
import test from 'node:test'
import { OAUTH_PROVIDERS } from '../src/social/oauth/providers'

const RI = 'https://cms.example.dev/api/social/callback/facebook'
const mkFetch = (route: (url: string) => { status?: number; body?: unknown }) =>
  (async (url: string | URL | Request) => {
    const u = typeof url === 'string' ? url : url.toString()
    const { status = 200, body } = route(u)
    return { ok: status < 400, status, json: async () => body }
  }) as unknown as typeof fetch

test('facebook auth URL carries client_id, redirect_uri, scope, state', () => {
  const u = OAUTH_PROVIDERS.facebook!.buildAuthUrl({ clientId: 'CID', redirectUri: RI, state: 'ST' })
  assert.ok(u.startsWith('https://www.facebook.com/v25.0/dialog/oauth'))
  assert.ok(u.includes('client_id=CID'))
  assert.ok(u.includes('scope=pages_manage_posts%2Cpages_read_engagement%2Cpages_show_list'))
  assert.ok(u.includes('state=ST'))
})

test('facebook listTargets: one target per manageable Page (ALL of them, never just the first)', async () => {
  const fetch = mkFetch(() => ({ body: { data: [
    { id: 'P1', name: 'Dumyat Hospital', access_token: 'page-tok' },
    { id: 'P2', name: 'Clinic', access_token: 'tok2' },
  ] } }))
  const out = await OAUTH_PROVIDERS.facebook!.listTargets({ tokens: { access_token: 'user-tok' }, clientId: 'CID', clientSecret: 'CS', fetch })
  assert.equal(out.length, 2)
  assert.equal(out[0].remoteAccountId, 'P1')
  assert.equal(out[0].credentials.pageId, 'P1')
  assert.equal(out[0].credentials.accessToken, 'page-tok')
  assert.equal(out[1].remoteAccountId, 'P2')
})

test('facebook listTargets: no manageable Pages → empty list (never a fabricated target)', async () => {
  const fetch = mkFetch(() => ({ body: { data: [] } }))
  const out = await OAUTH_PROVIDERS.facebook!.listTargets({ tokens: { access_token: 'user-tok' }, clientId: 'CID', clientSecret: 'CS', fetch })
  assert.equal(out.length, 0)
})

test('instagram listTargets: one target per Page with a linked IG business account', async () => {
  const fetch = mkFetch(() => ({ body: { data: [
    { id: 'P1', name: 'No IG' },
    { id: 'P2', name: 'With IG', instagram_business_account: { id: 'IG_178' } },
  ] } }))
  const out = await OAUTH_PROVIDERS.instagram!.listTargets({ tokens: { access_token: 'user-tok' }, clientId: 'CID', clientSecret: 'CS', fetch })
  assert.equal(out.length, 1)
  assert.equal(out[0].credentials.igUserId, 'IG_178')
})

test('linkedin auth URL + token exchange POST + member resolution (single target)', async () => {
  const u = OAUTH_PROVIDERS.linkedin!.buildAuthUrl({ clientId: 'CID', redirectUri: RI, state: 'ST' })
  assert.ok(u.startsWith('https://www.linkedin.com/oauth/v2/authorization'))
  assert.ok(u.includes('scope=w_member_social'))
  let posted: string | undefined
  const f = (async (url: string | URL | Request, init?: RequestInit): Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }> => {
    const uu = typeof url === 'string' ? url : url.toString()
    if (uu.endsWith('/accessToken')) { posted = String(init!.body); return { ok: true, status: 200, json: async () => ({ access_token: 'li-tok' }) } }
    return { ok: true, status: 200, json: async () => ({ id: 'MEMBER_1', localizedFirstName: 'Ada' }) }
  }) as unknown as typeof fetch
  const tokens = await OAUTH_PROVIDERS.linkedin!.exchangeCode({ code: 'C', clientId: 'CID', clientSecret: 'CS', redirectUri: RI, fetch: f })
  assert.equal(tokens.access_token, 'li-tok')
  assert.ok(posted!.includes('grant_type=authorization_code'))
  const out = await OAUTH_PROVIDERS.linkedin!.listTargets({ tokens, clientId: 'CID', clientSecret: 'CS', fetch: f })
  assert.equal(out.length, 1)
  assert.equal(out[0].credentials.authorUrn, 'urn:li:person:MEMBER_1')
})

test('youtube: offline+consent in auth URL; listTargets empty without a refresh_token, one with', async () => {
  const u = OAUTH_PROVIDERS.youtube!.buildAuthUrl({ clientId: 'CID', redirectUri: RI, state: 'ST' })
  assert.ok(u.startsWith('https://accounts.google.com/o/oauth2/v2/auth'))
  assert.ok(u.includes('access_type=offline'))
  assert.ok(u.includes('prompt=consent'))
  const none = await OAUTH_PROVIDERS.youtube!.listTargets({ tokens: {}, clientId: 'CID', clientSecret: 'CS' })
  assert.equal(none.length, 0)
  const one = await OAUTH_PROVIDERS.youtube!.listTargets({ tokens: { refresh_token: 'rt' }, clientId: 'CID', clientSecret: 'CS' })
  assert.equal(one.length, 1)
  assert.equal(one[0].credentials.refreshToken, 'rt')
})
