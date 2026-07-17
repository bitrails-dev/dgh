// Facebook Pages adapter. Publishes a Page PHOTO post when an eligible owned image exists (uploaded
// by URL + re-hosted by Facebook, carrying the caption), otherwise a FEED link post (OG preview
// rendered by the crawler). Requires { pageId, accessToken, apiVersion? }. v25.0 per current Graph API.
import type { AdapterContext, ProviderConnection, PublishInput, PublishResult, SocialAdapter } from '../types'
import { failed } from './util'

const GRAPH = 'https://graph.facebook.com'

async function permalink(f: typeof fetch, version: string, postId: string, accessToken: string): Promise<string | undefined> {
  try {
    const r = await f(`${GRAPH}/${version}/${postId}?fields=permalink_url&access_token=${accessToken}`)
    const d = await r.json().catch(() => undefined)
    return typeof d?.permalink_url === 'string' ? d.permalink_url : undefined
  } catch { return undefined }
}

export const facebook: SocialAdapter = {
  platform: 'facebook',
  capabilities: { text: true, link: true, image: true, video: false },
  async publish(input: PublishInput, conn: ProviderConnection, ctx: AdapterContext): Promise<PublishResult> {
    const { pageId, accessToken } = conn.credentials
    if (!pageId || !accessToken) return { outcome: 'skipped', skippedReason: 'missing_credentials' }
    const version = conn.credentials.apiVersion || 'v25.0'
    const f = ctx.fetch ?? fetch

    if (input.imageUrl) {
      // Photo post: Facebook fetches the public image URL and re-hosts it.
      const body = new URLSearchParams({ url: input.imageUrl, caption: input.description, published: 'true', access_token: accessToken })
      const res = await f(`${GRAPH}/${version}/${pageId}/photos`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body })
      const data = await res.json().catch(() => undefined)
      if (!res.ok || !data?.id) return failed('fb_photo', res.status, data)
      const postId = String(data.post_id ?? data.id)
      return { outcome: 'published', remoteId: postId, remoteUrl: (await permalink(f, version, postId, accessToken)) ?? `https://www.facebook.com/${postId}` }
    }

    // Link post (text + canonical URL; crawler renders the OG preview).
    const body = new URLSearchParams({ message: input.description, link: input.link, access_token: accessToken })
    const res = await f(`${GRAPH}/${version}/${pageId}/feed`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body })
    const data = await res.json().catch(() => undefined)
    if (!res.ok || !data?.id) return failed('fb', res.status, data)
    const id = String(data.id)
    return { outcome: 'published', remoteId: id, remoteUrl: `https://www.facebook.com/${id}` }
  },
}
