// Snapchat's Public Profile API is allowlist-gated (not self-serve): there is no public OAuth/publish
// path to call, so this adapter returns a precise `approval_required` and the operator routes via an
// allowlisted MMSP or posts manually at my.snapchat.com. It is registered so every platform still has
// an explicit adapter outcome (no generic missing-adapter fallback). `not_implemented` remains only as
// a defensive invariant for a genuinely unknown/unregistered platform.
import { platformMeta } from '../platforms'
import type { Platform, PublishResult, SocialAdapter } from '../types'

const deferredAdapter = (platform: Platform): SocialAdapter => {
  const meta = platformMeta(platform)!
  return {
    platform,
    capabilities: meta.capabilities,
    async publish(): Promise<PublishResult> {
      return { outcome: 'skipped', skippedReason: meta.deferredReason ?? 'not_implemented' }
    },
  }
}

export const snapchat = deferredAdapter('snapchat')
