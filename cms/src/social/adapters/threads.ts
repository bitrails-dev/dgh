// Threads API adapter (GA). Two-step Graph flow: create a media container (IMAGE when an eligible
// image exists, else TEXT), then publish it. Image uses a public image_url (Meta fetches it — no
// binary upload). Requires { userId, accessToken }. App Review needed for threads_content_publish.
import type { AdapterContext, ProviderConnection, PublishInput, PublishResult, SocialAdapter } from '../types'
import { failed, trim } from './util'

const API = 'https://graph.threads.net/v1.0'

export const threads: SocialAdapter = {
  platform: 'threads',
  capabilities: { text: true, link: true, image: true, video: false },
  async publish(input: PublishInput, conn: ProviderConnection, ctx: AdapterContext): Promise<PublishResult> {
    const userId = conn.credentials.userId
    const accessToken = conn.credentials.accessToken
    if (!userId || !accessToken) return { outcome: 'skipped', skippedReason: 'missing_credentials' }
    const f = ctx.fetch ?? fetch

    // 1) create the media container.
    const create = new URLSearchParams({ access_token: accessToken, media_type: input.imageUrl ? 'IMAGE' : 'TEXT', text: trim(input.description, 500) })
    if (input.imageUrl) create.set('image_url', input.imageUrl)
    const createRes = await f(`${API}/${userId}/threads`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: create })
    const created = await createRes.json().catch(() => undefined)
    if (!createRes.ok || !created?.id) return failed('th_create', createRes.status, created)

    // 2) publish the container.
    const pubRes = await f(`${API}/${userId}/threads_publish`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ creation_id: String(created.id), access_token: accessToken }) })
    const published = await pubRes.json().catch(() => undefined)
    if (!pubRes.ok || !published?.id) return failed('th_publish', pubRes.status, published)
    const id = String(published.id)
    // Fetch the REAL permalink rather than fabricating one from numeric ids (a `@{numericId}` URL does
    // not resolve). Best-effort: Threads occasionally needs a beat to materialize it — if absent, we
    // record the remote id only and never return a guessed URL.
    let remoteUrl: string | undefined
    try {
      const meta = await f(`${API}/${id}?fields=permalink&access_token=${accessToken}`)
      const md = await meta.json().catch(() => undefined) as { permalink?: string } | undefined
      if (md?.permalink) remoteUrl = String(md.permalink)
    } catch { /* permalink lookup is best-effort; the publish itself succeeded */ }
    return { outcome: 'published', remoteId: id, remoteUrl }
  },
}
