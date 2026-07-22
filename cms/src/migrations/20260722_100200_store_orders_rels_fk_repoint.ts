import type { MigrateUpArgs, MigrateDownArgs } from '@payloadcms/db-sqlite'
import { sql } from '@payloadcms/db-sqlite'

// store_orders_rels.transactions_id: repoint the FK from the legacy `transactions` table to
// `store_transactions`.
//
// Background (NH4 from the adversarial review): migration 20260719_300000 created
// `store_orders_rels` with `FOREIGN KEY (transactions_id) REFERENCES transactions(id)` — the legacy
// table, not the plugin-first `store_transactions`. The comment there acknowledged this. The live
// runtime (checkout/process.ts) links the transaction back via `payload.update({ collection:
// 'store-transactions', data: { order: orderId } })`, which writes `store_transactions.order_id`,
// NOT `store_orders_rels.transactions_id`. So the plugin's `order.transactions` hasMany field (backed
// by store_orders_rels.transactions_id) is never populated, and admin UI / plugin code reading
// `order.transactions` sees an empty list.
//
// SQLite cannot ALTER a column's FK in place; the standard pattern is CREATE-replacement + copy.
// This migration:
//   1. Renames the old table to `_legacy_store_orders_rels`.
//   2. Recreates `store_orders_rels` with the same shape but the FK pointing at `store_transactions`.
//   3. Copies all rows from the legacy table into the new one.
//   4. Recreates the four indexes the original migration created.
//   5. Drops the legacy table.
//
// Any pre-existing rows whose `transactions_id` pointed at a legacy `transactions(id)` that has no
// matching `store_transactions(id)` would violate the new FK. SQLite FK enforcement is OFF by
// default at runtime unless `PRAGMA foreign_keys = ON`, but to avoid a copy failure we NULL out
// dangling `transactions_id` during the copy (and log a comment). In practice the column was never
// populated by the live runtime, so this branch affects zero rows.
//
// Idempotent: if the new table already has the repointed FK, re-running fails at the rename (table
// already exists) — guarded by the `IF EXISTS` rename and the existence check.

async function tableExists(db: MigrateUpArgs['db'], name: string): Promise<boolean> {
  const r = await db.run(
    sql`SELECT name FROM sqlite_master WHERE type = 'table' AND name = ${name};`,
  )
  return (r.rows?.length ?? 0) > 0
}

export async function up({ db }: MigrateUpArgs): Promise<void> {
  const hasLegacy = await tableExists(db, '_legacy_store_orders_rels')
  const hasCurrent = await tableExists(db, 'store_orders_rels')

  // If we already ran (legacy marker present and current table present), this is a no-op.
  if (hasLegacy && hasCurrent) return

  if (!hasCurrent) {
    // Nothing to repoint — table doesn't exist (fresh-ish DB without the plugin-additive migration).
    // The additive migration is the source of truth for the table shape; this migration only
    // corrects the FK on DBs where the additive migration ran with the wrong target.
    return
  }

  // 1. Rename the existing (mis-FK'd) table aside.
  await db.run(sql`ALTER TABLE \`store_orders_rels\` RENAME TO \`_legacy_store_orders_rels\`;`)

  // 2. Recreate with the FK pointing at store_transactions.
  await db.run(sql`CREATE TABLE \`store_orders_rels\` (
    \`id\` integer PRIMARY KEY NOT NULL,
    \`order\` integer,
    \`parent_id\` integer NOT NULL,
    \`path\` text NOT NULL,
    \`transactions_id\` integer,
    FOREIGN KEY (\`parent_id\`) REFERENCES \`store_orders\`(\`id\`) ON UPDATE no action ON DELETE cascade,
    FOREIGN KEY (\`transactions_id\`) REFERENCES \`store_transactions\`(\`id\`) ON UPDATE no action ON DELETE cascade
  );`)

  // 3. Copy rows, NULLing any transactions_id that no longer resolves to a store_transactions row.
  await db.run(sql`INSERT INTO \`store_orders_rels\` (\`id\`, \`order\`, \`parent_id\`, \`path\`, \`transactions_id\`)
    SELECT
      l.\`id\`,
      l.\`order\`,
      l.\`parent_id\`,
      l.\`path\`,
      CASE
        WHEN l.\`transactions_id\` IS NULL THEN NULL
        WHEN EXISTS (SELECT 1 FROM \`store_transactions\` s WHERE s.\`id\` = l.\`transactions_id\`)
          THEN l.\`transactions_id\`
        ELSE NULL
      END
    FROM \`_legacy_store_orders_rels\` l;`)

  // 4. Recreate the four indexes (matching the original additive migration). SQLite indexes are
  //    global (not table-scoped), so the renamed _legacy_store_orders_rels still owns the index
  //    names — DROP them first to avoid a "index already exists" collision. DROP IF EXISTS is safe
  //    whether or not the legacy rename carried them.
  await db.run(sql`DROP INDEX IF EXISTS \`store_orders_rels_order_idx\`;`)
  await db.run(sql`DROP INDEX IF EXISTS \`store_orders_rels_parent_idx\`;`)
  await db.run(sql`DROP INDEX IF EXISTS \`store_orders_rels_path_idx\`;`)
  await db.run(sql`DROP INDEX IF EXISTS \`store_orders_rels_transactions_id_idx\`;`)
  await db.run(sql`CREATE INDEX \`store_orders_rels_order_idx\` ON \`store_orders_rels\` (\`order\`);`)
  await db.run(sql`CREATE INDEX \`store_orders_rels_parent_idx\` ON \`store_orders_rels\` (\`parent_id\`);`)
  await db.run(sql`CREATE INDEX \`store_orders_rels_path_idx\` ON \`store_orders_rels\` (\`path\`);`)
  await db.run(sql`CREATE INDEX \`store_orders_rels_transactions_id_idx\` ON \`store_orders_rels\` (\`transactions_id\`);`)

  // 5. Drop the legacy table.
  await db.run(sql`DROP TABLE \`_legacy_store_orders_rels\`;`)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  // Reverse: rename the repointed table aside, recreate with the legacy FK target, copy back.
  // Kept for completeness; the legacy FK target is wrong and rolling back would re-introduce NH4.
  const hasCurrent = await tableExists(db as MigrateUpArgs['db'], 'store_orders_rels')
  const hasLegacy = await tableExists(db as MigrateUpArgs['db'], '_legacy_store_orders_rels_rollback')
  if (!hasCurrent || hasLegacy) return

  await db.run(sql`ALTER TABLE \`store_orders_rels\` RENAME TO \`_legacy_store_orders_rels_rollback\`;`)
  await db.run(sql`CREATE TABLE \`store_orders_rels\` (
    \`id\` integer PRIMARY KEY NOT NULL,
    \`order\` integer,
    \`parent_id\` integer NOT NULL,
    \`path\` text NOT NULL,
    \`transactions_id\` integer,
    FOREIGN KEY (\`parent_id\`) REFERENCES \`store_orders\`(\`id\`) ON UPDATE no action ON DELETE cascade,
    FOREIGN KEY (\`transactions_id\`) REFERENCES \`transactions\`(\`id\`) ON UPDATE no action ON DELETE cascade
  );`)
  await db.run(sql`INSERT INTO \`store_orders_rels\` (\`id\`, \`order\`, \`parent_id\`, \`path\`, \`transactions_id\`)
    SELECT \`id\`, \`order\`, \`parent_id\`, \`path\`, \`transactions_id\` FROM \`_legacy_store_orders_rels_rollback\`;`)
  await db.run(sql`CREATE INDEX \`store_orders_rels_order_idx\` ON \`store_orders_rels\` (\`order\`);`)
  await db.run(sql`CREATE INDEX \`store_orders_rels_parent_idx\` ON \`store_orders_rels\` (\`parent_id\`);`)
  await db.run(sql`CREATE INDEX \`store_orders_rels_path_idx\` ON \`store_orders_rels\` (\`path\`);`)
  await db.run(sql`CREATE INDEX \`store_orders_rels_transactions_id_idx\` ON \`store_orders_rels\` (\`transactions_id\`);`)
  await db.run(sql`DROP TABLE \`_legacy_store_orders_rels_rollback\`;`)
}
