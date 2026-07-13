import type { Adapter, PublishInput, PublishResult } from '../types'
import { env, errored, isConfigured, ok, skipped, sleep } from '../config'

// Instagram Reels via the Graph API on an IG Business/Creator account linked to a
// Facebook Page. Three steps: create a REELS container from the public video_url,
// poll until it finishes processing, then publish. Requires instagram_content_publish.
async function publish(input: PublishInput): Promise<PublishResult> {
  if (!input.hasVideo || !input.videoUrl) return skipped('instagram', 'no video')
  if (!isConfigured('instagram')) return skipped('instagram', 'not configured')

  const version = env('FB_API_VERSION') || 'v21.0'
  const igUserId = env('IG_USER_ID')!
  const token = env('IG_ACCESS_TOKEN')!
  const base = `https://graph.facebook.com/${version}`

  try {
    const create = await fetch(`${base}/${igUserId}/media`, {
      method: 'POST',
      body: new URLSearchParams({
        media_type: 'REELS',
        video_url: input.videoUrl,
        caption: input.description.slice(0, 2000),
        access_token: token,
      }),
    })
    const created = (await create.json()) as { id?: string; error?: unknown }
    if (!create.ok || !created.id) throw new Error(`ig container: ${JSON.stringify(created.error ?? created)}`)

    // Poll container status (video processing). ~2 min max.
    let ready = false
    for (let i = 0; i < 24; i++) {
      await sleep(5000)
      const st = await fetch(
        `${base}/${created.id}?fields=status_code&access_token=${encodeURIComponent(token)}`,
      )
      const sj = (await st.json()) as { status_code?: string }
      if (sj.status_code === 'FINISHED') {
        ready = true
        break
      }
      if (sj.status_code === 'ERROR') throw new Error('ig container processing ERROR')
    }
    if (!ready) throw new Error('ig container not ready after timeout')

    const pub = await fetch(`${base}/${igUserId}/media_publish`, {
      method: 'POST',
      body: new URLSearchParams({ creation_id: created.id, access_token: token }),
    })
    const published = (await pub.json()) as { id?: string; error?: unknown }
    if (!pub.ok || !published.id) throw new Error(`ig publish: ${JSON.stringify(published.error ?? published)}`)

    // Fetch the permalink (best-effort).
    let url: string | undefined
    try {
      const pl = await fetch(
        `${base}/${published.id}?fields=permalink&access_token=${encodeURIComponent(token)}`,
      )
      const plj = (await pl.json()) as { permalink?: string }
      url = plj.permalink
    } catch {
      /* permalink is optional */
    }
    return ok('instagram', { externalId: published.id, url })
  } catch (e) {
    return errored('instagram', e)
  }
}

export const instagram: Adapter = { platform: 'instagram', publish }
