// SQL-backed NonceRepo against the `commerce_gateway_nonces` table (Plan §4.1, created by the C1
// migration). The verifier (./verify.ts) calls tryInsert() AFTER a valid signature and BEFORE
// business work; the unique (key_id, nonce_hash) index makes a replay a zero-effect rejection.
//
// This is the production replay ledger. `nonce.ts::InMemoryNonceRepo` remains for unit tests.
//
// The integration owner prunes expired rows from the scheduled commerce sweep (see pruneExpiredNonces
// below) — the table otherwise grows by one row per accepted signed request.

import { sql } from '@payloadcms/db-sqlite'
import type { Payload } from 'payload'
import type { NonceRepo } from './types'

// Nonces are accepted for ±300s (verify.ts TIMESTAMP_WINDOW_SEC); a row held for that full window
// after insertion covers the entire acceptance window for any future replay of the same nonce.
const NONCE_TTL_SEC = 300

type RunResult = { rows: unknown[]; rowsAffected: number; lastInsertRowid: number | bigint }
type Drizzle = { run: (stmt: ReturnType<typeof sql>) => Promise<RunResult> }
const drizzleOf = (payload: Payload): Drizzle =>
  (payload.db as unknown as { drizzle: Drizzle }).drizzle

const toIso = (sec: number): string => new Date(sec * 1000).toISOString()

/**
 * Build a NonceRepo backed by the `commerce_gateway_nonces` table. tryInsert is idempotent on
 * (key_id, nonce_hash): a duplicate insert affects 0 rows → `{ inserted: false }` → the verifier
 * rejects as a replay. expires_at is set NONCE_TTL_SEC ahead so the row outlives the timestamp
 * acceptance window.
 */
export function createSqlNonceRepo(payload: Payload): NonceRepo {
  return {
    async tryInsert({ keyId, nonceHash, nowSec }): Promise<{ inserted: boolean }> {
      const r = await drizzleOf(payload).run(sql`
        INSERT INTO \`commerce_gateway_nonces\`
          (\`key_id\`, \`nonce_hash\`, \`created_at\`, \`expires_at\`)
        VALUES (${keyId}, ${nonceHash}, ${toIso(nowSec)}, ${toIso(nowSec + NONCE_TTL_SEC)})
        ON CONFLICT(\`key_id\`, \`nonce_hash\`) DO NOTHING`)
      return { inserted: r.rowsAffected > 0 }
    },
  }
}

/**
 * Delete every nonce row whose `expires_at` has passed. Called from the scheduled commerce sweep so
 * the replay ledger does not grow unbounded. Returns the number of rows removed.
 */
export async function pruneExpiredNonces(payload: Payload, nowSec?: number): Promise<{ pruned: number }> {
  const cutoff = toIso(nowSec ?? Math.floor(Date.now() / 1000))
  const r = await drizzleOf(payload).run(
    sql`DELETE FROM \`commerce_gateway_nonces\` WHERE \`expires_at\` <= ${cutoff}`,
  )
  return { pruned: r.rowsAffected }
}
