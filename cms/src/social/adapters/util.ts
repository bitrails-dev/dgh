// Shared adapter helpers. Errors are sanitized (never tokens or full auth responses) and classified
// for retry via the central classifyFailure rule.
import { classifyFailure } from '../decide'
import type { PublishResult } from '../types'

export const trim = (s: string, max: number): string =>
  s.length <= max ? s : `${s.slice(0, Math.max(0, max - 1))}…`

/** Best-effort, safe provider error message (capped; no tokens). */
export const safeMessage = (data: unknown): string => {
  if (!data || typeof data !== 'object') return typeof data === 'string' ? data.slice(0, 300) : ''
  const d = data as Record<string, unknown>
  const err = d.error
  const m = typeof err === 'object' && err !== null
    ? (err as Record<string, unknown>).message
    : d.message
  return typeof m === 'string' ? m.slice(0, 300) : ''
}

export const failed = (code: string, status: number | undefined, data: unknown): PublishResult => ({
  outcome: 'failed',
  errorCode: typeof status === 'number' ? `${code}_${status}` : code,
  errorMessage: safeMessage(data),
  failureKind: classifyFailure(status),
})
