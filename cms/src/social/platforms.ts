// Single source of truth for the eight publishable social platforms. Every consumer derives from
// this table: collection select options, OAuth env-var names, adapter capabilities, admin/UI labels,
// and the public-site parity test. WhatsApp is a contact channel only and is NOT a publish target.
//
// Tier 1 = OAuth connect flow + publish adapter shipped today (facebook, instagram, linkedin,
// youtube). Tier 2 = deferred: no OAuth/approval path yet — connecting or including them yields a
// precise honest outcome (not_implemented / approval_required), never a fake publish.
import type { Capabilities, Platform } from './types'

export type PlatformTier = 1 | 2

export interface PlatformMeta {
  key: Platform
  /** English label. */
  label: string
  labelAr: string
  tier: PlatformTier
  /** Env-var stem → SOCIAL_<STEM>_CLIENT_ID / _SECRET. Empty for tier 2 (no OAuth client). */
  envStem: string
  capabilities: Capabilities
  /** Set on tier-2 platforms; surfaced as an honest skipped/approval outcome. */
  deferredReason?: 'not_implemented' | 'approval_required'
  /** Operator-facing note explaining what the platform needs before it can publish. */
  approvalNote?: string
}

export const PLATFORMS: PlatformMeta[] = [
  // Display order matches the original contact.social field + footer order (UX-stable). Tier is
  // independent of position; TIER_1_PLATFORMS is derived by filtering on `tier`.
  { key: 'facebook',  label: 'Facebook',  labelAr: 'فيسبوك',     tier: 1, envStem: 'FB',       capabilities: { text: true, link: true, image: true, video: false } },
  { key: 'instagram', label: 'Instagram', labelAr: 'إنستغرام',   tier: 1, envStem: 'IG',       capabilities: { text: true, link: false, image: true, video: false } },
  { key: 'x',         label: 'X',         labelAr: 'إكس',         tier: 1, envStem: 'X',        capabilities: { text: true, link: true, image: true, video: false }, approvalNote: 'OAuth 2.0 PKCE. The X API is pay-per-use (free tier closed); posts are billed per request.' },
  { key: 'threads',   label: 'Threads',   labelAr: 'ثريدز',       tier: 1, envStem: 'THREADS',  capabilities: { text: true, link: true, image: true, video: false }, approvalNote: 'Threads API (GA). App Review required for the threads_content_publish scope.' },
  { key: 'snapchat',  label: 'Snapchat',  labelAr: 'سناب شات',    tier: 2, envStem: '',         capabilities: { text: true, link: true, image: true, video: true }, deferredReason: 'approval_required', approvalNote: 'The Snapchat Public Profile API is allowlist-gated (not self-serve). Route via an allowlisted MMSP, or post manually at my.snapchat.com.' },
  { key: 'youtube',   label: 'YouTube',   labelAr: 'يوتيوب',     tier: 1, envStem: 'YOUTUBE',  capabilities: { text: false, link: false, image: false, video: true } },
  { key: 'linkedin',  label: 'LinkedIn',  labelAr: 'لينكد إن',   tier: 1, envStem: 'LINKEDIN', capabilities: { text: true, link: true, image: true, video: false } },
  { key: 'tiktok',    label: 'TikTok',    labelAr: 'تيك توك',     tier: 1, envStem: 'TIKTOK',   capabilities: { text: true, link: true, image: true, video: true }, approvalNote: 'TikTok Content Posting API. Needs domain verification + app audit; unaudited posts are forced SELF_ONLY.' },
]

const byKey = new Map<Platform, PlatformMeta>(PLATFORMS.map((p) => [p.key, p]))

export const platformMeta = (key: Platform): PlatformMeta | undefined => byKey.get(key)

export const ALL_PLATFORMS: Platform[] = PLATFORMS.map((p) => p.key)
export const TIER_1_PLATFORMS: Platform[] = PLATFORMS.filter((p) => p.tier === 1).map((p) => p.key)
export const DEFERRED_PLATFORMS: Platform[] = PLATFORMS.filter((p) => p.tier === 2).map((p) => p.key)

/** Payload select options for internal collections (hidden; English labels suffice). */
export const PLATFORM_SELECT_OPTIONS = PLATFORMS.map((p) => ({ value: p.key, label: p.label }))

/** OAuth client env-var keys for a tier-1 platform, or null if it has no OAuth flow. */
export const envCredKeys = (key: Platform): [string, string] | null => {
  const m = byKey.get(key)
  if (!m?.envStem) return null
  return [`SOCIAL_${m.envStem}_CLIENT_ID`, `SOCIAL_${m.envStem}_CLIENT_SECRET`]
}

/** Localized display label for a platform. */
export const platformLabel = (key: Platform, locale: 'ar' | 'en'): string => {
  const m = byKey.get(key)
  return m ? (locale === 'ar' ? m.labelAr : m.label) : String(key)
}

/** Whether a platform has a shipped OAuth connect flow + publish adapter (tier 1). */
export const hasOAuth = (key: Platform): boolean => byKey.get(key)?.tier === 1
