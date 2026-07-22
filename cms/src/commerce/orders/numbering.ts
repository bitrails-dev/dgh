// Atomic per-tenant order-number allocation. Increments commerce_settings.order_number_seq inside a
// drizzle IMMEDIATE transaction (SQLite serializes writers + busyTimeout waits), so concurrent
// allocations never produce duplicate numbers. Requires the tenant's commerce-settings to exist.
import { sql } from '@payloadcms/db-sqlite'
import type { Payload } from 'payload'

type TxLike = { run: (s: ReturnType<typeof sql>) => Promise<{ rows: any[]; rowsAffected: number }> }
type Drizzle = { transaction: <T>(fn: (tx: TxLike) => Promise<T>) => Promise<T> }
const drizzleOf = (payload: Payload): Drizzle => (payload.db as unknown as { drizzle: Drizzle }).drizzle

const LOCK_ERR = /SQLITE_BUSY|database is locked|cannot start a transaction|transaction.*active/i

export async function allocateOrderNumber(payload: Payload, tenantId: number | string, attempts = 10): Promise<string> {
  let lastErr: unknown
  for (let i = 0; i < attempts; i++) {
    try {
      return await drizzleOf(payload).transaction(async (tx) => {
        // NH1: `order_number_seq` is declared `numeric` (SQLite NUM affinity) and could theoretically
        // hold NULL or a float if an admin mutates the row or migration drift changes the type. The
        // COALESCE below defends against NULL at the increment site, and the Math.floor on the JS
        // read defends against a float sneaking through. Together they keep the emitted order number
        // a stable integer even if the column drifts.
        const upd = await tx.run(sql`UPDATE \`commerce_settings\` SET \`order_number_seq\` = COALESCE(\`order_number_seq\`, 0) + 1 WHERE \`tenant_id\` = ${tenantId}`)
        if (upd.rowsAffected === 0) throw new Error('commerce-settings not initialized for tenant')
        const sel = await tx.run(sql`SELECT \`order_number_seq\`, \`order_number_prefix\` FROM \`commerce_settings\` WHERE \`tenant_id\` = ${tenantId} LIMIT 1`)
        const row = sel.rows[0] as { order_number_seq: number; order_number_prefix?: string } | undefined
        const prefix = row?.order_number_prefix ?? 'ORD-'
        const seq = Math.floor(Number(row?.order_number_seq) || 0)
        return `${prefix}${seq}`
      })
    } catch (err) {
      lastErr = err
      const msg = err instanceof Error ? err.message : String(err)
      // "not initialized" is a real business error, not a lock — propagate immediately.
      if (/not initialized/.test(msg)) throw err
      if (!LOCK_ERR.test(msg)) throw err
      await new Promise((r) => setTimeout(r, Math.min(2 ** i, 50)))
    }
  }
  throw lastErr
}
