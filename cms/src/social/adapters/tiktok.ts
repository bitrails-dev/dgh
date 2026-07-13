import type { Adapter, PublishInput, PublishResult } from '../types'
import { env, errored, isConfigured, ok, skipped } from '../config'

// TikTok Content Posting API (Direct Post), pulling the video from its public URL.
// The URL's domain must be verified in the TikTok developer portal. Unaudited apps
// can only post as SELF_ONLY (private); an audited app may use PUBLIC_TO_EVERYONE.
// ponytail: init only — TikTok processes async. We record the publish_id; full
// confirmation would poll /post/publish/status/fetch/. Upgrade if a live URL is needed.
async function publish(input: PublishInput): Promise<PublishResult> {
  if (!input.hasVideo || !input.videoUrl) return skipped('tiktok', 'no video')
  if (!isConfigured('tiktok')) return skipped('tiktok', 'not configured')

  try {
    const res = await fetch('https://open.tiktokapis.com/v2/post/publish/video/init/', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env('TIKTOK_ACCESS_TOKEN')!}`,
        'content-type': 'application/json; charset=UTF-8',
      },
      body: JSON.stringify({
        post_info: {
          title: input.description.slice(0, 2200),
          privacy_level: env('TIKTOK_PRIVACY') || 'SELF_ONLY',
          disable_comment: false,
          disable_duet: false,
          disable_stitch: false,
        },
        source_info: {
          source: 'PULL_FROM_URL',
          video_url: input.videoUrl,
        },
      }),
    })
    const j = (await res.json()) as {
      data?: { publish_id?: string }
      error?: { code?: string; message?: string }
    }
    if (!res.ok || j.error?.code !== 'ok' || !j.data?.publish_id) {
      throw new Error(`tiktok init: ${JSON.stringify(j.error ?? j)}`)
    }
    return ok('tiktok', { externalId: j.data.publish_id })
  } catch (e) {
    return errored('tiktok', e)
  }
}

export const tiktok: Adapter = { platform: 'tiktok', publish }
