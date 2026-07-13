import type { Adapter, PublishInput, PublishResult } from '../types'
import { env, errored, isConfigured, ok, skipped } from '../config'

// Facebook Page. With a video → native video post (Graph pulls it from the public
// file_url). Without → a link post to the page feed. Either way the description
// carries the article link, so the article is always "forwarded to Facebook".
// Requires a Page access token with pages_manage_posts (+ pages_read_engagement).
async function publish(input: PublishInput): Promise<PublishResult> {
  if (!isConfigured('facebook')) return skipped('facebook', 'not configured')
  const version = env('FB_API_VERSION') || 'v21.0'
  const pageId = env('FB_PAGE_ID')!
  const token = env('FB_PAGE_ACCESS_TOKEN')!

  try {
    if (input.hasVideo && input.videoUrl) {
      const body = new URLSearchParams({
        file_url: input.videoUrl,
        title: input.title.slice(0, 255),
        description: input.description,
        access_token: token,
      })
      const res = await fetch(`https://graph.facebook.com/${version}/${pageId}/videos`, {
        method: 'POST',
        body,
      })
      const j = (await res.json()) as { id?: string; error?: unknown }
      if (!res.ok || !j.id) throw new Error(`fb video: ${JSON.stringify(j.error ?? j)}`)
      return ok('facebook', {
        externalId: j.id,
        url: `https://www.facebook.com/${j.id}`,
      })
    }

    const body = new URLSearchParams({
      message: input.description,
      link: input.link,
      access_token: token,
    })
    const res = await fetch(`https://graph.facebook.com/${version}/${pageId}/feed`, {
      method: 'POST',
      body,
    })
    const j = (await res.json()) as { id?: string; error?: unknown }
    if (!res.ok || !j.id) throw new Error(`fb feed: ${JSON.stringify(j.error ?? j)}`)
    return ok('facebook', { externalId: j.id, url: `https://www.facebook.com/${j.id}` })
  } catch (e) {
    return errored('facebook', e)
  }
}

export const facebook: Adapter = { platform: 'facebook', publish }
