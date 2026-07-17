// Instagram professional-account adapter (Tier-1). Publishes a single IMAGE (the Article model owns
// no video, so REELS is never used). Two-step Graph flow: create container → media_publish. Single-
// image containers publish immediately (no FINISHED poll — that is only for video). Requires a
// connected account carrying { igUserId, accessToken, apiVersion? }. Skips without an eligible image.
import type { AdapterContext, ProviderConnection, PublishInput, PublishResult, SocialAdapter } from '../types'
import { failed, trim } from './util'

const GRAPH = 'https://graph.facebook.com'

export const instagram: SocialAdapter = {
  platform: 'instagram',
  capabilities: { text: true, link: false, image: true, video: false },
  async publish(input: PublishInput, conn: ProviderConnection, ctx: AdapterContext): Promise<PublishResult> {
    const { igUserId, accessToken } = conn.credentials
    if (!igUserId || !accessToken) return { outcome: 'skipped', skippedReason: 'missing_credentials' }
    if (!input.imageUrl) return { outcome: 'skipped', skippedReason: 'no_eligible_media' }
    const version = conn.credentials.apiVersion || 'v21.0'
    const base = `${GRAPH}/${version}`
    const f = ctx.fetch ?? fetch

    // 1) create the media container (single image)
    const createRes = await f(`${base}/${igUserId}/media`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        image_url: input.imageUrl,
        caption: trim(input.description, 2200),
        access_token: accessToken,
      }),
    })
    const created = await createRes.json().catch(() => undefined)
    if (!createRes.ok || !created?.id) return failed('ig_create', createRes.status, created)

    // 2) publish the container
    const publishRes = await f(`${base}/${igUserId}/media_publish`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ creation_id: String(created.id), access_token: accessToken }),
    })
    const published = await publishRes.json().catch(() => undefined)
    if (!publishRes.ok || !published?.id) return failed('ig_publish', publishRes.status, published)

    // 3) permalink (best-effort; never blocks a successful publish)
    let permalink: string | undefined
    try {
      const r = await f(`${base}/${published.id}?fields=permalink&access_token=${accessToken}`)
      const d = await r.json().catch(() => undefined)
      if (typeof d?.permalink === 'string') permalink = d.permalink
    } catch { /* best-effort */ }

    return { outcome: 'published', remoteId: String(published.id), remoteUrl: permalink }
  },
}
