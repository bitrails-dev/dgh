import path from 'node:path'
import type { PublishInput } from './types'
import { env, mediaBase, siteBase } from './config'

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '')

// Collapse any Lexical richText value to plain text (best-effort, structure-agnostic).
export function lexicalToText(value: unknown): string {
  const root = (value as { root?: unknown })?.root as { children?: unknown[] } | undefined
  if (!root) return ''
  const walk = (node: unknown): string => {
    const n = node as { text?: unknown; children?: unknown[] }
    if (typeof n?.text === 'string') return n.text
    const kids = Array.isArray(n?.children) ? n.children : []
    return kids.map(walk).join('')
  }
  const blocks = Array.isArray(root.children) ? root.children : []
  return blocks
    .map(walk)
    .join('\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{2,}/g, '\n')
    .trim()
}

// First readable prose in the article body, for an auto-excerpt.
export function firstProse(content: unknown, locale: 'ar' | 'en'): string {
  const blocks = Array.isArray(content) ? content : []
  for (const b of blocks as Array<Record<string, any>>) {
    if (b?.blockType === 'heading' && str(b?.text?.[locale])) return str(b.text[locale])
    if (b?.blockType === 'richText') {
      const t = lexicalToText(b?.richText?.[locale])
      if (t) return t
    }
  }
  return ''
}

export function truncate(s: string, max: number): string {
  if (s.length <= max) return s
  const cut = s.slice(0, max)
  const lastSpace = cut.lastIndexOf(' ')
  return (lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd() + '…'
}

const hashify = (s: string): string =>
  s.replace(/#/g, '').trim().replace(/[\s-]+/g, '_')

export function buildDescription(
  title: string,
  excerpt: string,
  link: string,
  tags: string[],
): string {
  const parts = [title]
  if (excerpt) parts.push(truncate(excerpt, 400))
  parts.push(`📖 ${link}`)
  if (tags.length) parts.push(tags.map((t) => '#' + t).join(' '))
  return parts.join('\n\n')
}

// Absolute on-disk path of an uploaded video, for byte uploads (YouTube). The CMS
// process runs with cwd = cms/, and Videos.staticDir is ../public/uploads/videos.
export function videoLocalPath(filename: string): string {
  const dir = env('MEDIA_VIDEOS_DIR') || path.resolve(process.cwd(), '..', 'public', 'uploads', 'videos')
  return path.join(dir, filename)
}

// Resolve a populated article doc (fetched with locale: 'all', depth: 1) into the
// flat PublishInput the adapters consume. Arabic is primary; English is a hint.
export function buildPublishInput(a: Record<string, any>): PublishInput {
  const title = str(a?.title?.ar) || str(a?.title?.en) || str(a?.slug) || 'مقال'
  const titleEn = str(a?.title?.en) || undefined
  const link = `${siteBase()}/articles/${a.slug}`
  const catName = str(a?.categoryRel?.name?.ar) || str(a?.category)
  const tags = [catName, 'مستشفى_دمياط_العام', 'DumyatHospital'].filter(Boolean).map(hashify)
  const excerpt = firstProse(a?.content, 'ar') || firstProse(a?.content, 'en')
  const override = str(a?.social?.caption)
  const description = override ? `${override}\n\n📖 ${link}` : buildDescription(title, excerpt, link, tags)

  const video = a?.video && typeof a.video === 'object' ? a.video : null
  const hasVideo = !!video?.filename
  const thumb = a?.thumbnail && typeof a.thumbnail === 'object' ? a.thumbnail : null

  return {
    articleId: a.id,
    slug: a.slug,
    title,
    titleEn,
    description,
    link,
    tags,
    hasVideo,
    videoUrl: hasVideo ? `${mediaBase()}${video.url}` : undefined,
    videoPath: hasVideo ? videoLocalPath(video.filename) : undefined,
    thumbnailUrl: thumb?.url ? `${mediaBase()}${thumb.url}` : undefined,
  }
}
