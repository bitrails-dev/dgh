export type Platform = 'facebook' | 'youtube' | 'tiktok' | 'instagram' | 'linkedin'

export type PublishStatus = 'success' | 'skipped' | 'error'

// Everything an adapter needs, resolved once from the article. Text is pre-built
// (primary = Arabic, the site default) so adapters never touch Payload internals.
export interface PublishInput {
  articleId: string | number
  slug: string
  title: string
  titleEn?: string
  description: string // caption / long description, article link already appended
  link: string // canonical article URL
  tags: string[] // without '#', platform adapters format as needed
  hasVideo: boolean
  videoUrl?: string // public URL, e.g. https://cms.example.com/uploads/videos/x.mp4
  videoPath?: string // absolute local path, for byte uploads (YouTube)
  thumbnailUrl?: string
}

export interface PublishResult {
  platform: Platform
  status: PublishStatus
  url?: string
  externalId?: string
  reason?: string // why skipped
  error?: string
  at: string // ISO timestamp
}

export interface Adapter {
  platform: Platform
  publish(input: PublishInput): Promise<PublishResult>
}
