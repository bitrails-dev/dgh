// Adapter registry (Task D/E). Tier-1 adapters are registered in Tier1Adapters.ts (Task 9); until
// then the registry is empty and the publish job records `skipped: platform_not_implemented`.
// `runPublications` takes the lookup as a dependency so it is unit-testable with mock adapters.
import type { Platform, SocialAdapter } from '../types'

export interface AdapterRegistry {
  get(platform: Platform): SocialAdapter | undefined
  platforms(): Platform[]
}

const adapters = new Map<Platform, SocialAdapter>()

export function registerAdapter(adapter: SocialAdapter): void {
  adapters.set(adapter.platform, adapter)
}

/** Default registry used by the Article trigger in production. */
export const defaultAdapterRegistry: AdapterRegistry = {
  get: (p) => adapters.get(p),
  platforms: () => [...adapters.keys()],
}
