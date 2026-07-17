// X (Twitter) API v2 adapter. Publishes a text + link tweet, and attaches the article image when one
// exists (media/upload v2 → media_id → tweet media_ids). Requires { accessToken }. The X API is
// pay-per-use (free tier closed Feb 2026) — a configured client is billed per request.
import type { AdapterContext, ProviderConnection, PublishInput, PublishResult, SocialAdapter } from '../types'
import { failed, trim } from './util'

const API = 'https://api.x.com/2'

export const x: SocialAdapter = {
  platform: 'x',
  capabilities: { text: true, link: true, image: true, video: false },
  async publish(input: PublishInput, conn: ProviderConnection, ctx: AdapterContext): Promise<PublishResult> {
    const accessToken = conn.credentials.accessToken
    if (!accessToken) return { outcome: 'skipped', skippedReason: 'missing_credentials' }
    const f = ctx.fetch ?? fetch
    const auth = { authorization: `Bearer ${accessToken}` }
    const tweet: { text: string; media?: { media_ids: string[] } } = { text: trim(input.description, 280) }

    if (input.imageUrl) {
      // media/upload v2 (multipart binary) → media_id, attached to the tweet.
      const imgRes = await f(input.imageUrl)
      if (!imgRes.ok) return { outcome: 'failed', errorCode: 'x_image_fetch', errorMessage: 'Could not fetch the article image for upload.', failureKind: 'transient' }
      const form = new FormData()
      form.append('media', new Blob([await imgRes.arrayBuffer()]))
      const mediaRes = await f(`${API}/media/upload`, { method: 'POST', headers: auth, body: form })
      const media = await mediaRes.json().catch(() => undefined)
      const mediaId = media?.data?.id
      if (!mediaRes.ok || !mediaId) return failed('x_media', mediaRes.status, media)
      tweet.media = { media_ids: [String(mediaId)] }
    }

    const res = await f(`${API}/tweets`, { method: 'POST', headers: { ...auth, 'content-type': 'application/json' }, body: JSON.stringify(tweet) })
    const data = await res.json().catch(() => undefined)
    const id = data?.data?.id
    if (!res.ok || !id) return failed('x', res.status, data)
    const idStr = String(id)
    return { outcome: 'published', remoteId: idStr, remoteUrl: `https://x.com/i/web/status/${idStr}` }
  },
}
