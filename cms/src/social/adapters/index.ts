import type { Adapter } from '../types'
import { facebook } from './facebook'
import { youtube } from './youtube'
import { tiktok } from './tiktok'
import { instagram } from './instagram'
import { linkedin } from './linkedin'

// Order is cosmetic (results are recorded per-platform). All run in parallel.
export const adapters: Adapter[] = [facebook, youtube, tiktok, instagram, linkedin]
