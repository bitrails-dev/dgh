// Social-publishing type contracts (Task D/E). Provider-agnostic; adapters implement `SocialAdapter`.
//
// Platform set: the eight public-feed targets matching the tenant `socialPublishing.includedPlatforms`
// select. Tier-1 adapters (facebook, instagram, linkedin, youtube) are implemented now; the rest are
// deferred and surface as `skipped: platform_not_implemented` until their adapter + approval exist.
// WhatsApp is a contact channel, not a publish target.

export type Platform =
  | 'facebook'
  | 'instagram'
  | 'linkedin'
  | 'youtube'
  | 'x'
  | 'threads'
  | 'snapchat'
  | 'tiktok'

// The platform catalogue + the derived ALL_PLATFORMS / TIER_1_PLATFORMS / PLATFORM_SELECT_OPTIONS
// lists live in `./platforms` (single source of truth). This file keeps only the type contracts.

export type Locale = 'ar' | 'en'

export interface Capabilities {
  text: boolean
  link: boolean
  image: boolean
  video: boolean
}

// Everything an adapter needs to publish one article to one platform. Field names match the
// salvageable remote adapters so FB/LinkedIn port with minimal change.
export interface PublishInput {
  tenantId: number | string
  articleId: number | string
  platform: Platform
  locale: Locale
  slug: string
  title: string
  titleEn?: string
  /** Post copy: excerpt + canonical link + hashtags. Adapters trim to the platform limit. */
  description: string
  /** Canonical article URL (also the OG/link target). */
  link: string
  /** Hashtags without the leading '#'. */
  tags: string[]
  /** Absolute public URL of the first suitable image (thumbnail or image block). */
  imageUrl?: string
  /** Whether the article owns an uploadable video binary. Always false in the current model. */
  hasOwnedVideo: boolean
}

export type PublishOutcome = 'published' | 'failed' | 'skipped'
export type FailureKind = 'transient' | 'permanent'

export interface PublishResult {
  outcome: PublishOutcome
  /** Provider's id for the created post. Required when outcome === 'published'. */
  remoteId?: string
  /** Permalink to the created post. Required when outcome === 'published'. */
  remoteUrl?: string
  /** Stable, sanitized error code (no tokens, no full auth response). */
  errorCode?: string
  errorMessage?: string
  skippedReason?: string
  /** Set only on `failed`; classifies retry behaviour (transient → bounded retry, permanent → stop). */
  failureKind?: FailureKind
}

export interface ProviderConnection {
  platform: Platform
  /** Decrypted credential bag (adapter-specific), e.g. `{ pageId, accessToken }`. */
  credentials: Record<string, string>
}

/** Refreshes a short-lived access token just-in-time before a publish. Returns the refreshed credential
 *  bag (merged into the stored credentials) and the new expiry. */
export type TokenRefresher = (opts: { credentials: Record<string, string>; fetch?: typeof fetch }) => Promise<{ credentials: Record<string, string>; expiresAt?: string | null }>

export interface AdapterContext {
  /** Injected so tests use a mocked fetch; defaults to global fetch in production. */
  fetch?: typeof fetch
  /** TikTok publishes asynchronously; these override the status-poll budget/interval so tests do not
   *  wait on real timers. Production defaults live in the adapter. */
  ttPollMax?: number
  ttPollIntervalMs?: number
}

export interface SocialAdapter {
  platform: Platform
  capabilities: Capabilities
  publish(input: PublishInput, conn: ProviderConnection, ctx: AdapterContext): Promise<PublishResult>
}
