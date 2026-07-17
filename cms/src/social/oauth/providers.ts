// Per-platform OAuth 2.0 config. Each provider declares its scope + builds the authorization URL
// (pure), exchanges the code for tokens (injected fetch), lists ALL publish targets (injected fetch),
// and optionally revokes credentials. X uses PKCE (code_verifier round-tripped through the session).
// All network goes through the injected fetch so it is fully contract-testable without live apps.
import type { Platform } from '../types'

export interface AccountTarget {
  remoteAccountId: string
  remoteAccountLabel: string
  credentials: Record<string, string>
}

export interface OAuthProvider {
  platform: Platform
  scope: string
  /** OAuth 2.0 PKCE: the connect flow generates a code_verifier (stored server-side in the session)
   *  and passes the code_challenge here; the callback passes the verifier to exchangeCode. */
  usePkce?: boolean
  buildAuthUrl(opts: { clientId: string; redirectUri: string; state: string; codeChallenge?: string }): string
  exchangeCode(opts: { code: string; clientId: string; clientSecret: string; redirectUri: string; codeVerifier?: string; fetch?: typeof fetch }): Promise<Record<string, unknown>>
  /** Resolve ALL publishable targets behind the user's token; >1 routes to a selection session. */
  listTargets(opts: { tokens: Record<string, unknown>; clientId: string; clientSecret: string; fetch?: typeof fetch }): Promise<AccountTarget[]>
  /** Optional revocation. Omit when no revoke endpoint exists (disconnect reports local_only). */
  revoke?(opts: { credentials: Record<string, string>; clientId?: string; clientSecret?: string; fetch?: typeof fetch }): Promise<{ revoked: boolean; errorCode?: string }>
  /** Optional refresh for short-lived access tokens (X/TikTok/Threads). Returns the refreshed
   *  credential bag (merged into the stored credentials) and the new expiry; throws on failure so the
   *  caller can fall through to the adapter (which 401s → reconnect_required). */
  refresh?(opts: { credentials: Record<string, string>; clientId?: string; clientSecret?: string; fetch?: typeof fetch }): Promise<{ credentials: Record<string, string>; expiresAt?: string | null }>
}

const enc = encodeURIComponent
const FB_VERSION = 'v25.0'

/** ISO expiry from an `expires_in` seconds value; null when absent/invalid. */
const expiresAtFrom = (seconds: unknown): string | null => {
  const s = Number(seconds)
  if (!Number.isFinite(s) || s <= 0) return null
  return new Date(Date.now() + s * 1000).toISOString()
}
const fbGraph = (path: string) => `https://graph.facebook.com/${FB_VERSION}/${path}`

// --- Facebook (Page photo/link) ---------------------------------------------------------------
const facebook: OAuthProvider = {
  platform: 'facebook',
  // pages_show_list is required to call /me/accounts (list the user's Pages); without it listTargets
  // returns no Pages and a connection can never complete for a multi-Page user.
  scope: 'pages_manage_posts,pages_read_engagement,pages_show_list',
  buildAuthUrl({ clientId, redirectUri, state }) {
    return `https://www.facebook.com/${FB_VERSION}/dialog/oauth?client_id=${enc(clientId)}&redirect_uri=${enc(redirectUri)}&response_type=code&scope=${enc(this.scope)}&state=${enc(state)}`
  },
  async exchangeCode({ code, clientId, clientSecret, redirectUri, fetch: f = fetch }) {
    const url = `${fbGraph('oauth/access_token')}?client_id=${enc(clientId)}&redirect_uri=${enc(redirectUri)}&client_secret=${clientSecret}&code=${enc(code)}`
    const res = await f(url, { method: 'GET' })
    return (await res.json().catch(() => ({}))) as Record<string, unknown>
  },
  async listTargets({ tokens, fetch: f = fetch }) {
    const userToken = String(tokens.access_token ?? '')
    const res = await f(`${fbGraph('me/accounts')}?fields=id,name,access_token&access_token=${enc(userToken)}`)
    const data = await res.json().catch(() => ({})) as { data?: Array<{ id: string; name: string; access_token: string }> }
    return (data.data ?? []).map((page) => ({ remoteAccountId: page.id, remoteAccountLabel: page.name, credentials: { pageId: page.id, accessToken: page.access_token, apiVersion: FB_VERSION } }))
  },
}

// --- Instagram (image) ------------------------------------------------------------------------
const instagram: OAuthProvider = {
  platform: 'instagram',
  // Instagram Business accounts live behind a Facebook Page; /me/accounts (used to discover them)
  // needs pages_show_list too.
  scope: 'instagram_basic,instagram_content_publish,pages_show_list',
  buildAuthUrl({ clientId, redirectUri, state }) {
    return `https://www.facebook.com/${FB_VERSION}/dialog/oauth?client_id=${enc(clientId)}&redirect_uri=${enc(redirectUri)}&response_type=code&scope=${enc(this.scope)}&state=${enc(state)}`
  },
  async exchangeCode({ code, clientId, clientSecret, redirectUri, fetch: f = fetch }) {
    const url = `${fbGraph('oauth/access_token')}?client_id=${enc(clientId)}&redirect_uri=${enc(redirectUri)}&client_secret=${clientSecret}&code=${enc(code)}`
    const res = await f(url, { method: 'GET' })
    return (await res.json().catch(() => ({}))) as Record<string, unknown>
  },
  async listTargets({ tokens, fetch: f = fetch }) {
    const userToken = String(tokens.access_token ?? '')
    const res = await f(`${fbGraph('me/accounts')}?fields=id,name,instagram_business_account&access_token=${enc(userToken)}`)
    const data = await res.json().catch(() => ({})) as { data?: Array<{ id: string; name: string; instagram_business_account?: { id: string } }> }
    return (data.data ?? []).filter((p) => p.instagram_business_account?.id).map((page) => {
      const igId = page.instagram_business_account!.id
      return { remoteAccountId: igId, remoteAccountLabel: page.name ?? 'Instagram', credentials: { igUserId: igId, accessToken: userToken, apiVersion: FB_VERSION } }
    })
  },
}

// --- LinkedIn (member share) ------------------------------------------------------------------
const linkedin: OAuthProvider = {
  platform: 'linkedin',
  scope: 'w_member_social',
  buildAuthUrl({ clientId, redirectUri, state }) {
    return `https://www.linkedin.com/oauth/v2/authorization?response_type=code&client_id=${enc(clientId)}&redirect_uri=${enc(redirectUri)}&scope=${enc(this.scope)}&state=${enc(state)}`
  },
  async exchangeCode({ code, clientId, clientSecret, redirectUri, fetch: f = fetch }) {
    const res = await f('https://www.linkedin.com/oauth/v2/accessToken', {
      method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: redirectUri, client_id: clientId, client_secret: clientSecret }),
    })
    return (await res.json().catch(() => ({}))) as Record<string, unknown>
  },
  async listTargets({ tokens, fetch: f = fetch }) {
    const accessToken = String(tokens.access_token ?? '')
    const res = await f('https://api.linkedin.com/v2/me', { headers: { authorization: `Bearer ${accessToken}` } })
    const me = await res.json().catch(() => ({})) as { id?: string; localizedFirstName?: string; localizedLastName?: string }
    if (!me.id) return []
    return [{ remoteAccountId: me.id, remoteAccountLabel: [me.localizedFirstName, me.localizedLastName].filter(Boolean).join(' '), credentials: { authorUrn: `urn:li:person:${me.id}`, accessToken } }]
  },
}

// --- YouTube (owned-video; publish skipped until owned uploads exist) -------------------------
const youtube: OAuthProvider = {
  platform: 'youtube',
  scope: 'https://www.googleapis.com/auth/youtube.upload',
  buildAuthUrl({ clientId, redirectUri, state }) {
    return `https://accounts.google.com/o/oauth2/v2/auth?response_type=code&client_id=${enc(clientId)}&redirect_uri=${enc(redirectUri)}&scope=${enc(this.scope)}&access_type=offline&prompt=consent&state=${enc(state)}`
  },
  async exchangeCode({ code, clientId, clientSecret, redirectUri, fetch: f = fetch }) {
    const res = await f('https://oauth2.googleapis.com/token', {
      method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: redirectUri, client_id: clientId, client_secret: clientSecret }),
    })
    return (await res.json().catch(() => ({}))) as Record<string, unknown>
  },
  async listTargets({ tokens, clientId, clientSecret }) {
    const refreshToken = String(tokens.refresh_token ?? '')
    if (!refreshToken) return []
    return [{ remoteAccountId: 'youtube', remoteAccountLabel: 'YouTube', credentials: { refreshToken, clientId, clientSecret } }]
  },
  async revoke({ credentials, fetch: f = fetch }) {
    const token = credentials.refreshToken
    if (!token) return { revoked: true }
    const res = await f(`https://oauth2.googleapis.com/revoke?token=${enc(token)}`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' } })
    return { revoked: !!res.ok, errorCode: res.ok ? undefined : `google_${res.status}` }
  },
}

// --- X (Twitter) API v2 — OAuth 2.0 PKCE ------------------------------------------------------
const x: OAuthProvider = {
  platform: 'x',
  scope: 'tweet.read tweet.write users.read media.write offline.access',
  usePkce: true,
  buildAuthUrl({ clientId, redirectUri, state, codeChallenge }) {
    const params = new URLSearchParams({ response_type: 'code', client_id: clientId, redirect_uri: redirectUri, scope: this.scope, state, code_challenge_method: 'S256' })
    if (codeChallenge) params.set('code_challenge', codeChallenge)
    return `https://x.com/i/oauth2/authorize?${params}`
  },
  async exchangeCode({ code, clientId, clientSecret, redirectUri, codeVerifier, fetch: f = fetch }) {
    const res = await f('https://api.x.com/2/oauth2/token', {
      method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: redirectUri, code_verifier: codeVerifier ?? '', client_id: clientId, client_secret: clientSecret }),
    })
    return (await res.json().catch(() => ({}))) as Record<string, unknown>
  },
  async listTargets({ tokens, fetch: f = fetch }) {
    const accessToken = String(tokens.access_token ?? '')
    if (!accessToken) return []
    const res = await f('https://api.x.com/2/users/me', { headers: { authorization: `Bearer ${accessToken}` } })
    const me = await res.json().catch(() => ({})) as { data?: { id?: string; name?: string; username?: string } }
    if (!me.data?.id) return []
    return [{ remoteAccountId: String(me.data.id), remoteAccountLabel: me.data.name ?? me.data.username ?? 'X', credentials: { userId: String(me.data.id), accessToken, refreshToken: String(tokens.refresh_token ?? ''), expiresAt: expiresAtFrom(tokens.expires_in) ?? '' } }]
  },
  async revoke({ credentials, clientId, fetch: f = fetch }) {
    const token = credentials.accessToken
    if (!token) return { revoked: true }
    const res = await f('https://api.x.com/2/oauth2/revoke', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ token, client_id: clientId ?? '' }) })
    return { revoked: !!res.ok, errorCode: res.ok ? undefined : `x_${res.status}` }
  },
  async refresh({ credentials, clientId, fetch: f = fetch }) {
    const refreshToken = credentials.refreshToken
    if (!refreshToken || !clientId) return { credentials } // nothing to refresh with → leave token as-is
    const res = await f('https://api.x.com/2/oauth2/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken, client_id: clientId }) })
    const t = (await res.json().catch(() => ({}))) as { access_token?: string; refresh_token?: string; expires_in?: number }
    if (!t.access_token) throw new Error('X token refresh failed')
    return { credentials: { ...credentials, accessToken: String(t.access_token), refreshToken: t.refresh_token ?? refreshToken }, expiresAt: expiresAtFrom(t.expires_in) }
  },
}

// --- Threads API (GA) -------------------------------------------------------------------------
const threads: OAuthProvider = {
  platform: 'threads',
  scope: 'threads_basic,threads_content_publish',
  buildAuthUrl({ clientId, redirectUri, state }) {
    return `https://threads.net/oauth/authorize?${new URLSearchParams({ client_id: clientId, redirect_uri: redirectUri, scope: this.scope, response_type: 'code', state })}`
  },
  async exchangeCode({ code, clientId, clientSecret, redirectUri, fetch: f = fetch }) {
    const res = await f('https://graph.threads.net/oauth/access_token', {
      method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, grant_type: 'authorization_code', redirect_uri: redirectUri, code }),
    })
    const short = (await res.json().catch(() => ({}))) as { access_token?: string }
    if (!short.access_token) return short
    // exchange the short-lived token for a long-lived (60d) one.
    const longRes = await f(`https://graph.threads.net/access_token?grant_type=th_exchange_token&client_secret=${clientSecret}&access_token=${short.access_token}`)
    const long = await longRes.json().catch(() => ({})) as Record<string, unknown>
    return (long as { access_token?: string }).access_token ? long : short
  },
  async listTargets({ tokens, fetch: f = fetch }) {
    const accessToken = String(tokens.access_token ?? '')
    if (!accessToken) return []
    const res = await f(`https://graph.threads.net/v1.0/me?fields=id,username,name&access_token=${accessToken}`)
    const me = await res.json().catch(() => ({})) as { id?: string; username?: string; name?: string }
    if (!me.id) return []
    return [{ remoteAccountId: String(me.id), remoteAccountLabel: me.username ?? me.name ?? 'Threads', credentials: { userId: String(me.id), accessToken, refreshToken: '', expiresAt: expiresAtFrom(tokens.expires_in) ?? '' } }]
  },
  async refresh({ credentials, fetch: f = fetch }) {
    const accessToken = credentials.accessToken
    if (!accessToken) return { credentials }
    const res = await f(`https://graph.threads.net/refresh_access_token?grant_type=th_refresh_token&access_token=${enc(accessToken)}`)
    const t = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: number }
    if (!t.access_token) throw new Error('Threads token refresh failed')
    return { credentials: { ...credentials, accessToken: String(t.access_token) }, expiresAt: expiresAtFrom(t.expires_in) }
  },
}

// --- TikTok Content Posting API ---------------------------------------------------------------
const tiktok: OAuthProvider = {
  platform: 'tiktok',
  scope: 'user.info.basic,video.publish',
  buildAuthUrl({ clientId, redirectUri, state }) {
    return `https://www.tiktok.com/v2/auth/authorize/?${new URLSearchParams({ client_key: clientId, scope: this.scope, response_type: 'code', redirect_uri: redirectUri, state })}`
  },
  async exchangeCode({ code, clientId, clientSecret, redirectUri, fetch: f = fetch }) {
    const res = await f('https://open.tiktokapis.com/v2/oauth/token/', {
      method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_key: clientId, client_secret: clientSecret, grant_type: 'authorization_code', redirect_uri: redirectUri, code }),
    })
    return (await res.json().catch(() => ({}))) as Record<string, unknown>
  },
  async listTargets({ tokens }) {
    const accessToken = String(tokens.access_token ?? '')
    const openId = String(tokens.open_id ?? '')
    if (!accessToken || !openId) return []
    return [{ remoteAccountId: openId, remoteAccountLabel: 'TikTok', credentials: { accessToken, openId, refreshToken: String(tokens.refresh_token ?? ''), expiresAt: expiresAtFrom(tokens.expires_in) ?? '' } }]
  },
  async revoke({ credentials, clientId, clientSecret, fetch: f = fetch }) {
    const token = credentials.accessToken
    if (!token) return { revoked: true }
    const res = await f('https://open.tiktokapis.com/v2/oauth/revoke/', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_key: clientId ?? '', client_secret: clientSecret ?? '', token }) })
    return { revoked: !!res.ok, errorCode: res.ok ? undefined : `tt_${res.status}` }
  },
  async refresh({ credentials, clientId, clientSecret, fetch: f = fetch }) {
    const refreshToken = credentials.refreshToken
    if (!refreshToken || !clientId || !clientSecret) return { credentials }
    const res = await f('https://open.tiktokapis.com/v2/oauth/token/', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_key: clientId, client_secret: clientSecret, grant_type: 'refresh_token', refresh_token: refreshToken }) })
    const t = (await res.json().catch(() => ({}))) as { access_token?: string; refresh_token?: string; expires_in?: number }
    if (!t.access_token) throw new Error('TikTok token refresh failed')
    return { credentials: { ...credentials, accessToken: String(t.access_token), refreshToken: t.refresh_token ?? refreshToken }, expiresAt: expiresAtFrom(t.expires_in) }
  },
}

export const OAUTH_PROVIDERS: Partial<Record<Platform, OAuthProvider>> = {
  facebook, instagram, linkedin, youtube, x, threads, tiktok,
}

export const getOAuthProvider = (platform: Platform): OAuthProvider | undefined => OAUTH_PROVIDERS[platform]
