// Pure publish-decision + retry-classification logic (Task D/E). No DB, no provider — fully tested.
import type { FailureKind, Platform } from './types'

/**
 * Decide whether an Article should be queued for social publishing, and to which platforms.
 * Returns the intersection of the tenant's included platforms with its connected platforms, or
 * `null` when nothing should be queued (publishing disabled, article not auto-publish, no targets).
 *
 * A platform with no connection is silently dropped here — the publish job records `skipped:
 * not_connected` for any included platform that lacks a connection at runtime, but the queue is
 * only enqueued when at least one target is reachable. UI visibility never broadens API access.
 */
export function shouldQueueArticle(opts: {
  tenantEnabled: boolean
  articleAutoPublish: boolean
  includedPlatforms: Platform[]
  connectedPlatforms: Platform[]
}): Platform[] | null {
  if (!opts.tenantEnabled || !opts.articleAutoPublish) return null
  if (!opts.includedPlatforms.length) return null
  const connected = new Set(opts.connectedPlatforms)
  const targets = opts.includedPlatforms.filter((p) => connected.has(p))
  return targets.length ? targets : null
}

/**
 * Classify a provider error for retry. Transient (429, 5xx, network/timeout) → bounded retry;
 * permanent (4xx auth/validation/not-found, or unknown) → stop. Unknown defaults to permanent so a
 * novel error never causes a retry storm.
 */
export function classifyFailure(status: number | undefined, errorCode?: string): FailureKind {
  if (errorCode === 'network' || errorCode === 'timeout') return 'transient'
  if (typeof status === 'number') {
    if (status === 429 || status >= 500) return 'transient'
    return 'permanent'
  }
  return 'permanent'
}

/** Which existing publication records are still actionable (not published, not intentionally skipped). */
export function outstandingPlatforms(
  records: Array<{ platform: Platform; status: string }>,
): Platform[] {
  return records
    .filter((r) => r.status !== 'published' && r.status !== 'skipped')
    .map((r) => r.platform)
}

/** Bounded exponential backoff for transient retries (seconds). Caps at maxSeconds. */
export function backoffSeconds(attempt: number, maxSeconds = 3600): number {
  const s = Math.min(2 ** attempt, maxSeconds)
  return s
}

/** Auth/scope failure (401/403) or an undecryptable stored token → the connection must reconnect. */
export const isReconnectRequired = (r: { outcome: string; errorCode?: string }): boolean => {
  if (r.outcome !== 'failed') return false
  const code = r.errorCode ?? ''
  return code === 'token_decrypt_failed' || /_(401|403)$/.test(code)
}
