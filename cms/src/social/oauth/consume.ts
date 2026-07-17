// Atomic, one-time consumption of a multi-account selection session (Task 1). The race the previous
// implementation had: it stored the connection, THEN set consumedAt, swallowing update errors — so two
// concurrent selections could both win and store different connections.
//
// Fix: consumption is a single conditional `UPDATE ... WHERE consumed_at IS NULL RETURNING *`. SQLite
// evaluates the WHERE + write atomically, so exactly one concurrent caller gets a returned row; the
// rest get zero rows and are rejected. The connection is stored ONLY after the caller wins. The
// consume function is injectable so the win/lose decision is unit-testable without a live database.
import { sql } from '@payloadcms/db-sqlite'
import type { PayloadRequest } from 'payload'
import type { Platform } from '../types'

export type SelectionSession = {
  id: number | string
  tenant: number | string
  platform: Platform
  encryptedCandidates: string
  expiresAt?: string | null
  consumedAt?: string | null
  returnTo?: string | null
}

type Finder = (a: { collection: string; where?: unknown; limit?: number; overrideAccess?: boolean }) => Promise<{ docs: Array<Record<string, unknown>> }>
export type ConsumeFn = (id: number | string, nowIso: string) => Promise<boolean>

/** Read-only lookup of a selection session by its key, validating existence + expiry (NOT consumed —
 *  the atomic consume decides that). Returns the row so the caller can authorize + render. */
export async function findSelectionSession(payload: { find: Finder }, sessionKey: string): Promise<{ status: 'not_found' | 'expired' | 'ok'; row?: SelectionSession }> {
  const found = await payload.find({
    collection: 'social-oauth-states',
    where: { nonceHash: { equals: sessionKey } },
    overrideAccess: true, limit: 1,
  })
  const row = found.docs[0] as SelectionSession | undefined
  if (!row || !row.encryptedCandidates) return { status: 'not_found' }
  if (row.expiresAt && Date.parse(String(row.expiresAt)) < Date.now()) return { status: 'expired' }
  return { status: 'ok', row }
}

/** Atomic compare-and-set. `true` = this caller exclusively consumed the session; `false` = a
 *  concurrent caller already did (replay rejected). Errors propagate (never swallowed). */
export const consumeSession = (consume: ConsumeFn, id: number | string): Promise<boolean> => consume(id, new Date().toISOString())

/** Production compare-and-set via the SQLite adapter's drizzle executor: one atomic statement. */
export const drizzleConsume = (req: PayloadRequest): ConsumeFn => async (id, nowIso) => {
  const drizzle = (req.payload.db as unknown as { drizzle: { all: (q: unknown) => Promise<unknown[]> } }).drizzle
  const rows = await drizzle.all(sql`UPDATE "social_oauth_states" SET "consumed_at" = ${nowIso} WHERE "id" = ${id} AND "consumed_at" IS NULL RETURNING *`)
  return Array.isArray(rows) && rows.length === 1
}

/** Compensating release: un-consume a session (consumed_at = NULL) when connection storage fails
 *  AFTER a caller won the consume. Payload's Local API exposes no cross-collection transaction, so a
 *  saga-style compensation is how we honor the spec's "a failure while storing the connection leaves
 *  no partially consumed or partially connected state" — the session becomes reusable, and because
 *  storage threw, no connection row exists. Errors propagate; callers wrap in .catch() for best-effort use. */
export const releaseSession = (req: PayloadRequest): ((id: number | string) => Promise<void>) =>
  async (id) => {
    const drizzle = (req.payload.db as unknown as { drizzle: { all: (q: unknown) => Promise<unknown[]> } }).drizzle
    await drizzle.all(sql`UPDATE "social_oauth_states" SET "consumed_at" = NULL WHERE "id" = ${id} AND "consumed_at" IS NOT NULL`)
  }
