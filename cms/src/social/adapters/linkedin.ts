import type { Adapter, PublishInput, PublishResult } from '../types'
import { env, errored, isConfigured, ok, skipped } from '../config'

// LinkedIn share of the article link (ugcPosts). Works for both video and non-video
// articles — LinkedIn always gets the article as a link share (native video upload is
// a separate multi-step flow we deliberately skip). LINKEDIN_AUTHOR_URN is either
// urn:li:organization:<id> (Page) or urn:li:person:<id>.
async function publish(input: PublishInput): Promise<PublishResult> {
  if (!isConfigured('linkedin')) return skipped('linkedin', 'not configured')
  const token = env('LINKEDIN_ACCESS_TOKEN')!
  const author = env('LINKEDIN_AUTHOR_URN')!

  try {
    const res = await fetch('https://api.linkedin.com/v2/ugcPosts', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        'X-Restli-Protocol-Version': '2.0.0',
      },
      body: JSON.stringify({
        author,
        lifecycleState: 'PUBLISHED',
        specificContent: {
          'com.linkedin.ugc.ShareContent': {
            shareCommentary: { text: input.description },
            shareMediaCategory: 'ARTICLE',
            media: [
              {
                status: 'READY',
                originalUrl: input.link,
                title: { text: input.title.slice(0, 200) },
              },
            ],
          },
        },
        visibility: { 'com.linkedin.ugc.MemberNetworkVisibility': 'PUBLIC' },
      }),
    })
    const j = (await res.json().catch(() => ({}))) as { id?: string }
    const id = j.id || res.headers.get('x-restli-id') || undefined
    if (!res.ok || !id) throw new Error(`linkedin: ${res.status} ${JSON.stringify(j)}`)
    return ok('linkedin', {
      externalId: id,
      url: `https://www.linkedin.com/feed/update/${id}`,
    })
  } catch (e) {
    return errored('linkedin', e)
  }
}

export const linkedin: Adapter = { platform: 'linkedin', publish }
