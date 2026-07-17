// LinkedIn adapter. Publishes an IMAGE share when an eligible image exists (registerUpload → fetch +
// PUT the public image bytes → ugcPosts IMAGE; LinkedIn does NOT fetch the URL), otherwise an ARTICLE
// link share. Requires { authorUrn, accessToken }. Scopes: w_member_social (or w_organization_social).
import type { AdapterContext, ProviderConnection, PublishInput, PublishResult, SocialAdapter } from '../types'
import { failed, trim } from './util'

const API = 'https://api.linkedin.com/v2'
const headersFor = (accessToken: string) => ({ authorization: `Bearer ${accessToken}`, 'content-type': 'application/json', 'X-Restli-Protocol-Version': '2.0.0' })

function ugcBody(author: string, input: PublishInput, media: unknown, category: 'ARTICLE' | 'IMAGE') {
  return {
    author,
    lifecycleState: 'PUBLISHED',
    specificContent: { 'com.linkedin.ugc.ShareContent': { shareCommentary: { text: input.description }, shareMediaCategory: category, media } },
    visibility: { 'com.linkedin.ugc.MemberNetworkVisibility': 'PUBLIC' },
  }
}

export const linkedin: SocialAdapter = {
  platform: 'linkedin',
  capabilities: { text: true, link: true, image: true, video: false },
  async publish(input: PublishInput, conn: ProviderConnection, ctx: AdapterContext): Promise<PublishResult> {
    const { authorUrn, accessToken } = conn.credentials
    if (!authorUrn || !accessToken) return { outcome: 'skipped', skippedReason: 'missing_credentials' }
    const f = ctx.fetch ?? fetch
    const headers = headersFor(accessToken)

    if (input.imageUrl) {
      // 1) register the upload → uploadUrl + asset URN.
      const regRes = await f(`${API}/assets?action=registerUpload`, { method: 'POST', headers, body: JSON.stringify({ registerUploadRequest: { owner: authorUrn, recipes: ['urn:li:digitalmediaRecipe:feedshare-image'], serviceRelationships: [{ identifier: 'urn:li:userGeneratedContent', relationshipType: 'OWNER' }], supportedUploadMechanism: ['SYNCHRONOUS_UPLOAD'] } }) })
      const reg = await regRes.json().catch(() => undefined)
      const uploadUrl = reg?.value?.uploadMechanism?.['com.linkedin.digitalmedia.uploading.MediaUploadHttpRequest']?.uploadUrl
      const asset = reg?.value?.asset
      if (!regRes.ok || !uploadUrl || !asset) return failed('li_register', regRes.status, reg)
      // 2) LinkedIn does not pull the URL — fetch the bytes and PUT them with the bearer token.
      const imgRes = await f(input.imageUrl)
      if (!imgRes.ok) return { outcome: 'failed', errorCode: 'li_image_fetch', errorMessage: 'Could not fetch the article image for upload.', failureKind: 'transient' }
      const putRes = await f(uploadUrl, { method: 'PUT', headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/octet-stream' }, body: Buffer.from(await imgRes.arrayBuffer()) })
      if (!putRes.ok) return failed('li_upload', putRes.status, undefined)
      // 3) publish the IMAGE share referencing the asset.
      const res = await f(`${API}/ugcPosts`, { method: 'POST', headers, body: JSON.stringify(ugcBody(authorUrn, input, [{ status: 'READY', media: asset, description: { text: trim(input.title, 200) } }], 'IMAGE')) })
      const data = await res.json().catch(() => undefined)
      const id = data?.id ?? res.headers.get('x-restli-id')
      if (!res.ok || !id) return failed('li_image', res.status, data)
      return published(String(id))
    }

    // Link share (ARTICLE; crawler renders the OG preview from the canonical URL).
    const res = await f(`${API}/ugcPosts`, { method: 'POST', headers, body: JSON.stringify(ugcBody(authorUrn, input, [{ status: 'READY', originalUrl: input.link, title: { text: trim(input.title, 200) } }], 'ARTICLE')) })
    const data = await res.json().catch(() => undefined)
    const id = data?.id ?? res.headers.get('x-restli-id')
    if (!res.ok || !id) return failed('li', res.status, data)
    return published(String(id))
  },
}

const published = (id: string): PublishResult => ({ outcome: 'published', remoteId: id, remoteUrl: `https://www.linkedin.com/feed/update/${encodeURIComponent(id)}/` })
