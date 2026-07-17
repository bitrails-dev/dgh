// Builds a provider-agnostic PublishInput from a Payload Article (+ tenant + bases). Pure, no
// provider calls — fully unit-tested. (Task D/E.)
//
// The current Article model has NO owned video uploads: the `youtube` block is an embed link, and
// `thumbnail`/`image` blocks are Media uploads. So every article publishes as text + link (+ image).
// Platforms that require an owned video binary (YouTube upload, TikTok direct video) are therefore
// `skipped: no_owned_video` upstream — never an image-only YouTube upload.
import { createHash } from 'node:crypto'
import type { Locale, Platform, PublishInput } from './types'

const trimTrailing = (s: string): string => s.replace(/\/+$/, '')

/** Pick a localized string from a Payload localized field (`{ar,en}` or scalar), preferring `locale`. */
export function pickLocale(field: unknown, locale: Locale): string {
  if (field == null) return ''
  if (typeof field === 'string') return field
  if (typeof field === 'object') {
    const o = field as Record<string, unknown>
    const primary = o[locale]
    if (typeof primary === 'string' && primary) return primary
    const other = o[locale === 'ar' ? 'en' : 'ar']
    if (typeof other === 'string' && other) return other
  }
  return ''
}

/** Relative URL of a populated Media upload, if any. */
export function mediaUrl(upload: unknown): string | undefined {
  if (!upload || typeof upload !== 'object') return undefined
  const url = (upload as { url?: unknown }).url
  return typeof url === 'string' && url ? url : undefined
}

const isRelative = (u: string): boolean => u.startsWith('/') && !u.startsWith('//')

/** Resolve a URL against a base; absolute URLs are returned untouched. */
export function absoluteUrl(url: string | undefined, base: string): string | undefined {
  if (!url) return undefined
  if (!isRelative(url)) return url
  return `${trimTrailing(base)}${url}`
}

/** The Article model owns no uploadable video — YouTube blocks are embed links. */
export const HAS_OWNED_VIDEO_MODEL = false

export type ArticleLike = {
  id?: number | string
  slug: string
  title?: unknown
  thumbnail?: unknown
  categoryRel?: unknown
  content?: Array<Record<string, unknown>> | null
}

/** First suitable public image: the thumbnail, else the first `image` block's image. */
export function selectImage(article: ArticleLike): string | undefined {
  const thumb = mediaUrl(article.thumbnail)
  if (thumb) return thumb
  const blocks = Array.isArray(article.content) ? article.content : []
  for (const block of blocks) {
    if (block.blockType === 'image') {
      const u = mediaUrl(block.image)
      if (u) return u
    }
  }
  return undefined
}

/** Best-effort excerpt: the first heading block's text. (Avoids a Lexical serializer dependency.) */
export function firstExcerpt(article: ArticleLike, locale: Locale): string {
  const blocks = Array.isArray(article.content) ? article.content : []
  for (const block of blocks) {
    if (block.blockType === 'heading') {
      const t = pickLocale(block.text, locale)
      if (t) return t
    }
  }
  return ''
}

export function truncate(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, Math.max(0, max - 1))}…`
}

/** Sanitize a hashtag: keep Latin/Arabic letters + digits, turn spaces/dashes into underscores. */
export function sanitizeTag(s: string): string {
  return s
    .trim()
    .replace(/[\s-]+/g, '_')
    .replace(/[^\p{L}\p{N}_]/gu, '')
    .replace(/^_+|_+$/g, '')
}

/** Compose the post copy: title + excerpt + canonical link + hashtags (empty parts skipped). */
export function buildDescription(
  title: string,
  excerpt: string,
  link: string,
  tags: string[],
): string {
  const parts: string[] = [title]
  if (excerpt) parts.push(truncate(excerpt, 400))
  parts.push(link)
  const tagLine = tags.filter(Boolean).map((t) => `#${t}`).join(' ')
  if (tagLine) parts.push(tagLine)
  return parts.join('\n')
}

export function buildPublishInput(
  article: ArticleLike,
  opts: {
    tenantId: number | string
    articleId: number | string
    platform: Platform
    locale: Locale
    /** Public site base, e.g. https://dgh.bitrail.dev */
    base: string
    /** Public base for resolving relative image URLs (the CMS/media origin). */
    mediaBase: string
    /** Tenant display name (localized), used to derive one stable hashtag. */
    tenantName?: unknown
  },
): PublishInput {
  const title = pickLocale(article.title, opts.locale) || article.slug
  const titleEn = pickLocale(article.title, 'en') || undefined
  const langPrefix = opts.locale === 'ar' ? '' : 'en/'
  const link = `${trimTrailing(opts.base)}/${langPrefix}articles/${article.slug}`
  const imageUrl = absoluteUrl(selectImage(article), opts.mediaBase)

  const tags = [
    sanitizeTag(pickLocale(article.categoryRel && typeof article.categoryRel === 'object'
      ? (article.categoryRel as { name?: unknown }).name
      : article.categoryRel, opts.locale)),
    sanitizeTag(pickLocale(opts.tenantName, 'en')),
  ].filter(Boolean)

  const description = buildDescription(title, firstExcerpt(article, opts.locale), link, tags)

  return {
    tenantId: opts.tenantId,
    articleId: opts.articleId,
    platform: opts.platform,
    locale: opts.locale,
    slug: article.slug,
    title,
    titleEn,
    description,
    link,
    tags,
    imageUrl,
    hasOwnedVideo: HAS_OWNED_VIDEO_MODEL,
  }
}

/**
 * Canonical SHA-256 over the post-affecting fields of a PublishInput. Excludes ids, locale, slug,
 * secrets, and volatile insertion order: object keys are emitted in a fixed order and tags are
 * sorted, so two semantically identical payloads hash identically. Stored on the publication record
 * to detect content drift (a changed article after enqueue is a new event, not a silent retry).
 */
export function canonicalPublishHash(input: PublishInput): string {
  const canonical = {
    platform: input.platform,
    title: input.title,
    titleEn: input.titleEn ?? '',
    description: input.description,
    link: input.link,
    imageUrl: input.imageUrl ?? '',
    hasOwnedVideo: input.hasOwnedVideo,
    tags: [...input.tags].sort(),
  }
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex')
}
