import type { Platform, PublishInput, PublishResult } from './types'
import { adapters } from './adapters'
import { errored } from './config'

// Fire every adapter simultaneously. `skip` holds platforms already succeeded so a
// re-save never double-posts (idempotency). One adapter throwing never sinks the rest.
export async function dispatch(
  input: PublishInput,
  skip: Set<Platform> = new Set(),
): Promise<PublishResult[]> {
  const run = adapters.filter((a) => !skip.has(a.platform))
  const settled = await Promise.allSettled(run.map((a) => a.publish(input)))
  return settled.map((r, i) =>
    r.status === 'fulfilled' ? r.value : errored(run[i].platform, r.reason),
  )
}

// Merge a fresh run over prior results: keep every platform's most recent record,
// but never let a later attempt overwrite a recorded success.
export function mergeResults(
  prior: PublishResult[],
  fresh: PublishResult[],
): PublishResult[] {
  const byPlatform = new Map<Platform, PublishResult>()
  for (const r of prior) byPlatform.set(r.platform, r)
  for (const r of fresh) {
    const existing = byPlatform.get(r.platform)
    if (existing?.status === 'success') continue
    byPlatform.set(r.platform, r)
  }
  return [...byPlatform.values()]
}
