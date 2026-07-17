// Registers every platform adapter (7 real + Snapchat honest allowlist-gated) into the default
// registry. Imported for its side effect in payload.config.ts. After this, each of the eight planned
// platforms resolves to a typed adapter with an explicit, honest outcome — no generic fallback.
import { registerAdapter } from './index'
import { facebook } from './facebook'
import { instagram } from './instagram'
import { linkedin } from './linkedin'
import { youtube } from './youtube'
import { x } from './x'
import { threads } from './threads'
import { tiktok } from './tiktok'
import { snapchat } from './deferred'

registerAdapter(facebook)
registerAdapter(instagram)
registerAdapter(linkedin)
registerAdapter(youtube)
registerAdapter(x)
registerAdapter(threads)
registerAdapter(tiktok)
registerAdapter(snapchat)

export { facebook, instagram, linkedin, youtube, x, threads, tiktok, snapchat }
