import type { Platform, PublishResult } from './types'

// Read an env var, treating blank/whitespace as unset.
export const env = (k: string): string | undefined => {
  const v = process.env[k]
  const t = v?.trim()
  return t ? t : undefined
}

// Public origin of the Astro site — used to build the article link that gets
// attached to every post. Falls back to the CMS origin, then localhost.
export const siteBase = (): string =>
  (env('SITE_URL') || env('PAYLOAD_PUBLIC_SERVER_URL') || 'http://localhost:3001').replace(/\/+$/, '')

// Public origin that serves /uploads/videos/* so the pull-from-URL APIs can fetch
// the file. Defaults to the CMS origin (which serves the uploads).
export const mediaBase = (): string =>
  (env('PUBLIC_MEDIA_BASE') || env('PAYLOAD_PUBLIC_SERVER_URL') || 'http://localhost:3001').replace(/\/+$/, '')

// Which platforms have enough env configured to attempt a real publish. Adapters
// also self-check, but this drives clearer "skipped: not configured" reasons and
// lets a startup log tell the operator what's live.
export const requiredEnv: Record<Platform, string[]> = {
  facebook: ['FB_PAGE_ID', 'FB_PAGE_ACCESS_TOKEN'],
  youtube: ['YT_CLIENT_ID', 'YT_CLIENT_SECRET', 'YT_REFRESH_TOKEN'],
  tiktok: ['TIKTOK_ACCESS_TOKEN'],
  instagram: ['IG_USER_ID', 'IG_ACCESS_TOKEN'],
  linkedin: ['LINKEDIN_ACCESS_TOKEN', 'LINKEDIN_AUTHOR_URN'],
}

export const isConfigured = (platform: Platform): boolean =>
  requiredEnv[platform].every((k) => !!env(k))

export const now = (): string => new Date().toISOString()

export const skipped = (platform: Platform, reason: string): PublishResult => ({
  platform,
  status: 'skipped',
  reason,
  at: now(),
})

export const errored = (platform: Platform, error: unknown): PublishResult => ({
  platform,
  status: 'error',
  error: error instanceof Error ? error.message : String(error),
  at: now(),
})

export const ok = (
  platform: Platform,
  extra: Partial<PublishResult> = {},
): PublishResult => ({ platform, status: 'success', at: now(), ...extra })

export const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))
