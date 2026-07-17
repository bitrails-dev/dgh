// TikTok Content Posting API adapter. Publishes a PHOTO direct post via PULL_FROM_URL (the only photo
// source; requires domain verification). Video needs an owned uploaded binary the Article model lacks,
// so a no-image Article is skipped (no_eligible_media). Requires { accessToken }. Unaudited apps force
// SELF_ONLY posts — surfaced by the API, classified by the shared classifier.
//
// Two round-3 correctness points:
//   - privacy_level is chosen from the creator's ALLOWED options (Creator Info). Hardcoding
//     PUBLIC_TO_EVERYONE is rejected for creators restricted to SELF_ONLY/MUTUAL_FOLLOW.
//   - TikTok processes posts ASYNCHRONOUSLY: content/init's publish_id means processing STARTED, not
//     success. We poll /post/publish/status/fetch/ and only report `published` on PUBLISHED.
import type { AdapterContext, ProviderConnection, PublishInput, PublishResult, SocialAdapter } from '../types'
import { failed, trim } from './util'

const API = 'https://open.tiktokapis.com/v2'
const AUTH = (t: string): Record<string, string> => ({ authorization: `Bearer ${t}`, 'content-type': 'application/json; charset=UTF-8' })

// Most-public-first preference; pick the most public level the creator is ALLOWED to use.
const PRIVACY_PREF = ['PUBLIC_TO_EVERYONE', 'MUTUAL_FOLLOW_FRIENDS', 'FOLLOWER_OF_CREATOR', 'SELF_ONLY']
const pickPrivacy = (options: string[] | undefined): string => {
  if (!options || !options.length) return 'PUBLIC_TO_EVERYONE' // unknown → try public; the API rejects if disallowed
  for (const p of PRIVACY_PREF) if (options.includes(p)) return p
  return options[0]
}

const DEFAULT_POLL_MAX = 10
const DEFAULT_POLL_INTERVAL_MS = 2000

/** Poll the async publish to a terminal state. PUBLISHED → published; FAILED → permanent; still
 *  PROCESSING after the budget → transient so the durable job re-attempts and catches the final state. */
async function pollStatus(f: typeof fetch, accessToken: string, publishId: string, pollMax: number, intervalMs: number): Promise<PublishResult> {
  for (let attempt = 0; attempt < pollMax; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, intervalMs))
    let status: string | undefined
    let permalink: string | undefined
    try {
      const sr = await f(`${API}/post/publish/status/fetch/`, { method: 'POST', headers: AUTH(accessToken), body: JSON.stringify({ publish_id: publishId }) })
      const sd = (await sr.json().catch(() => undefined)) as
        { data?: { status?: string; permalink?: string; deep_linked_post_permalink?: string; share_url?: string } } | undefined
      status = sd?.data?.status
      permalink = sd?.data?.permalink ?? sd?.data?.deep_linked_post_permalink ?? sd?.data?.share_url
    } catch {
      return { outcome: 'failed', errorCode: 'tt_status_network', errorMessage: 'TikTok status fetch failed', failureKind: 'transient' }
    }
    if (status === 'PUBLISHED') return permalink ? { outcome: 'published', remoteId: publishId, remoteUrl: permalink } : { outcome: 'published', remoteId: publishId }
    if (status === 'FAILED') return { outcome: 'failed', errorCode: 'tt_publish_failed', errorMessage: 'TikTok rejected the post', failureKind: 'permanent' }
    // PROCESSING (or an unexpected non-terminal value) → keep polling
  }
  return { outcome: 'failed', errorCode: 'tt_async_pending', errorMessage: 'TikTok post still processing after the poll budget', failureKind: 'transient' }
}

export const tiktok: SocialAdapter = {
  platform: 'tiktok',
  capabilities: { text: true, link: true, image: true, video: true },
  async publish(input: PublishInput, conn: ProviderConnection, ctx: AdapterContext): Promise<PublishResult> {
    const accessToken = conn.credentials.accessToken
    if (!accessToken) return { outcome: 'skipped', skippedReason: 'missing_credentials' }
    if (!input.imageUrl) return { outcome: 'skipped', skippedReason: 'no_eligible_media' }
    const f = ctx.fetch ?? fetch

    // 1) Creator Info → the privacy levels this creator may use. Best-effort: on failure, fall back to
    //    PUBLIC_TO_EVERYONE and let the API reject it (classified) rather than guessing wrong silently.
    let privacyLevel = 'PUBLIC_TO_EVERYONE'
    try {
      const ciRes = await f(`${API}/user/info/details/`, { method: 'POST', headers: AUTH(accessToken), body: JSON.stringify({ fields: ['privacy_level_options'] }) })
      const ci = (await ciRes.json().catch(() => undefined)) as { data?: { privacy_level_options?: string[] } } | undefined
      privacyLevel = pickPrivacy(ci?.data?.privacy_level_options)
    } catch { /* creator-info is best-effort */ }

    // 2) init the async photo post with the chosen privacy level.
    const body = {
      post_mode: 'DIRECT_POST',
      media_type: 'PHOTO',
      post_info: { title: trim(input.title, 100), description: trim(input.description, 2000), privacy_level: privacyLevel, disable_comment: false, auto_add_music: true },
      source_info: { source: 'PULL_FROM_URL', photo_cover_index: 0, photo_images: [input.imageUrl] },
    }
    const res = await f(`${API}/post/publish/content/init/`, { method: 'POST', headers: AUTH(accessToken), body: JSON.stringify(body) })
    const data = (await res.json().catch(() => undefined)) as { data?: { publish_id?: string } } | undefined
    const publishId = data?.data?.publish_id
    if (!res.ok || !publishId) return failed('tt', res.status, data)

    // 3) poll the async status to a terminal state — never report success on init alone.
    return pollStatus(f, accessToken, String(publishId), ctx.ttPollMax ?? DEFAULT_POLL_MAX, ctx.ttPollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS)
  },
}
