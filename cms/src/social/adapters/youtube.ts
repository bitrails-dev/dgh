import { readFile } from 'node:fs/promises'
import type { Adapter, PublishInput, PublishResult } from '../types'
import { env, errored, isConfigured, ok, skipped } from '../config'

// Exchange the long-lived refresh token for a short-lived access token.
async function accessToken(): Promise<string> {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: env('YT_CLIENT_ID')!,
      client_secret: env('YT_CLIENT_SECRET')!,
      refresh_token: env('YT_REFRESH_TOKEN')!,
      grant_type: 'refresh_token',
    }),
  })
  const j = (await res.json()) as { access_token?: string }
  if (!res.ok || !j.access_token) throw new Error(`yt token: ${JSON.stringify(j)}`)
  return j.access_token
}

// YouTube Data API v3 resumable upload. Requires OAuth (youtube.upload scope).
// ponytail: reads the whole file into memory — fine for typical hospital clips;
// switch to a streamed PUT if multi-GB uploads ever matter.
async function publish(input: PublishInput): Promise<PublishResult> {
  if (!input.hasVideo || !input.videoPath) return skipped('youtube', 'no video')
  if (!isConfigured('youtube')) return skipped('youtube', 'not configured')

  try {
    const token = await accessToken()
    const meta = {
      snippet: {
        title: input.title.slice(0, 95),
        description: input.description.slice(0, 4900),
        tags: input.tags.slice(0, 15),
        categoryId: env('YT_CATEGORY_ID') || '22', // People & Blogs
      },
      status: {
        privacyStatus: env('YT_PRIVACY') || 'public',
        selfDeclaredMadeForKids: false,
      },
    }
    const bytes = await readFile(input.videoPath)
    const init = await fetch(
      'https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'content-type': 'application/json; charset=UTF-8',
          'X-Upload-Content-Type': 'video/*',
          'X-Upload-Content-Length': String(bytes.length),
        },
        body: JSON.stringify(meta),
      },
    )
    if (!init.ok) throw new Error(`yt init: ${await init.text()}`)
    const uploadUrl = init.headers.get('location')
    if (!uploadUrl) throw new Error('yt init: no upload URL returned')

    const up = await fetch(uploadUrl, {
      method: 'PUT',
      headers: { 'content-type': 'video/*' },
      body: bytes,
    })
    const j = (await up.json()) as { id?: string }
    if (!up.ok || !j.id) throw new Error(`yt upload: ${JSON.stringify(j)}`)
    return ok('youtube', { externalId: j.id, url: `https://youtu.be/${j.id}` })
  } catch (e) {
    return errored('youtube', e)
  }
}

export const youtube: Adapter = { platform: 'youtube', publish }
