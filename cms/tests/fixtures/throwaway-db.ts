// Throwaway commerce DB factory for migration fixtures (plan §7 B3).
//
// Mirrors the temp-DB pattern in `cms/tests/helpers/commerce.ts` but stays fixture-local so the B3
// lane never edits the shared helper. Each call produces a freshly migrated throwaway SQLite file
// with every legacy commerce table in place and zero rows — i.e. the empty-database fixture
// described in plan §5.1 / §7 B3. The copied-schema fixture layers seed data on top of this.
//
// One Payload instance per file is the established pattern (Windows + libSQL isolation — see
// `cms/scripts/run-commerce-integration-tests.mjs`). The caller schedules `cleanup()` in test.after.

import { rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { sql } from '@payloadcms/db-sqlite'

import type { Payload } from 'payload'
import type { DB } from './legacy-seed'

export type ThrowawayCommerceDb = {
  payload: Payload
  db: DB
  tempDbPath: string
  cleanup: () => Promise<void>
}

// Mints a unique temp SQLite path. The caller sets `process.env.DATABASE_URI = \`file:${path}\``
// BEFORE dynamically importing `../src/payload.config` so the sqliteAdapter picks it up.
export function makeTempDbPath(label: string): string {
  return join(tmpdir(), `${label}-${process.pid}-${Date.now()}.db`)
}

// Extract the drizzle handle from a Payload instance. This is the same `db` Payload passes to
// migrations, so any SQL run through it matches what the migration backfill will see at cutover.
export function drizzleFrom(payload: Payload): DB {
  return (payload as unknown as { db: { drizzle: DB } }).db.drizzle
}

// Build a freshly migrated throwaway DB from an already-imported Payload config.
export async function buildThrowawayDb(
  config: Parameters<typeof import('payload')['getPayload']>[0]['config'],
): Promise<ThrowawayCommerceDb> {
  const { getPayload } = await import('payload')
  const payload = (await getPayload({ config })) as unknown as Payload
  await payload.db.migrate()
  const db = drizzleFrom(payload)
  const tempDbPath = (process.env.DATABASE_URI ?? '').replace(/^file:/, '')
  const cleanup = async () => {
    try { await payload.destroy() } catch { /* disposable */ }
    if (tempDbPath) {
      try { rmSync(tempDbPath, { force: true }) } catch { /* ignore */ }
    }
  }
  return { payload, db, tempDbPath, cleanup }
}

// Legacy commerce tables that exist after every migration and carry a tenant_id column. The count
// helpers below only ever embed names from this allowlist, so identifier injection is impossible.
export const TENANT_TABLES = [
  'products',
  'orders',
  'transactions',
  'customers',
  'carts',
] as const
export type TenantTable = (typeof TENANT_TABLES)[number]

const ALLOWED = new Set<string>(TENANT_TABLES)

function assertTable(table: TenantTable): void {
  if (!ALLOWED.has(table)) throw new Error(`unknown legacy table: ${table}`)
}

// SELECT COUNT(*) FROM <table>. Counts the whole table (no tenant filter).
export async function countAll(db: DB, table: TenantTable): Promise<number> {
  assertTable(table)
  // Identifier is allowlist-validated; `sql.identifier` escapes it for the active driver.
  const res = await db.run(sql`SELECT COUNT(*) AS \`v\` FROM ${sql.identifier(table)};`)
  return Number((res.rows[0] as { v?: unknown } | undefined)?.v ?? 0)
}

// SELECT COUNT(*) FROM <table> WHERE tenant_id = ?. Per-tenant count.
export async function countForTenant(
  db: DB,
  table: TenantTable,
  tenantId: number | string,
): Promise<number> {
  assertTable(table)
  const res = await db.run(
    sql`SELECT COUNT(*) AS \`v\` FROM ${sql.identifier(table)} WHERE \`tenant_id\` = ${tenantId};`,
  )
  return Number((res.rows[0] as { v?: unknown } | undefined)?.v ?? 0)
}
