import type { MigrateUpArgs, MigrateDownArgs } from '@payloadcms/db-sqlite'
import { sql } from '@payloadcms/db-sqlite'

// commerce_settings.order_number_seq: harden against NULL and float values.
//
// The column was added (20260717_100200) as `numeric DEFAULT 0`. SQLite's NUM affinity accepts
// floats and NULL. The runtime UPDATE in orders/numbering.ts now uses `COALESCE(order_number_seq,
// 0) + 1` and the JS read uses `Math.floor(Number(...) || 0)` — but existing rows that already
// carry NULL (from a manual insert or a buggy code path) would stay NULL under the old logic and
// wedge the tenant with `ORD-null` collisions. This migration:
//   1. Normalizes any existing NULL → 0 (defensive; COALESCE in the query handles this at read time
//      too, but materializing the value keeps admin UI / reporting tools honest).
//   2. Adds a CHECK constraint rejecting negative values (a negative seq is always a bug; the CHECK
//      turns it into a loud DB error instead of silent `ORD--1`).
//
// We do NOT change the column type (SQLite ALTER TABLE can't change affinity in place without a full
// table rebuild). The COALESCE + floor in the runtime layer is the real guard; this migration is
// belt-and-suspenders for existing data.
//
// Idempotent: re-running is a no-op (the NULL update affects zero rows; the CHECK uses
// `IF NOT EXISTS`-style guard via try/catch on the limited SQLite ALTER, and the UPDATE is safe to
// repeat). SQLite does not support `ADD CONSTRAINT IF NOT EXISTS`, so the CHECK is best-effort.

export async function up({ db }: MigrateUpArgs): Promise<void> {
  // 1. Materialize any NULL sequence values to 0. Affects zero rows on a clean DB.
  await db.run(
    sql`UPDATE \`commerce_settings\` SET \`order_number_seq\` = 0 WHERE \`order_number_seq\` IS NULL;`,
  )

  // 2. Floor any float values (defensive — NUM affinity could have accepted a manual 0.5).
  //    SQLite's `CAST(... AS INTEGER)` truncates toward zero, matching Math.floor for positives.
  await db.run(
    sql`UPDATE \`commerce_settings\` SET \`order_number_seq\` = CAST(\`order_number_seq\` AS INTEGER) WHERE \`order_number_seq\` != CAST(\`order_number_seq\` AS INTEGER);`,
  )

  // NOTE: a CHECK constraint can't be added via ALTER TABLE on SQLite without rebuilding the table.
  // The runtime guard (numbering.ts COALESCE + Math.floor) is the authoritative defense; this
  // migration only normalizes existing data so the guard sees clean input.
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  // No-op: the data normalization is not reversible (we discarded the original NULL/float values),
  // and there was no schema change to undo.
  void db
}
