// YouTube adapter (Tier-1). YouTube publishes ONLY an owned uploaded video binary. The current
// Article model has YouTube embed links, not owned uploads, so every article records an honest
// `skipped: no_owned_video` — never an image-only upload, never a fake success. When the Article
// model gains owned video uploads, the resumable-upload flow goes here.
import type { PublishInput, PublishResult, SocialAdapter } from '../types'

export const youtube: SocialAdapter = {
  platform: 'youtube',
  capabilities: { text: false, link: false, image: false, video: true },
  async publish(input: PublishInput): Promise<PublishResult> {
    void input
    return { outcome: 'skipped', skippedReason: 'no_owned_video' }
  },
}
