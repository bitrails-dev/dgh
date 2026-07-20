import type { MigrateUpArgs, MigrateDownArgs } from '@payloadcms/db-sqlite'
import { sql } from '@payloadcms/db-sqlite'

// payload_preferences_rels: add customers_id (mirrors users_id) — closes the Wave B2 gap.
//
// fresh_schema created payload_preferences_rels with only `users_id` (the only auth collection at
// the time was `users`). Wave B2 made `customers` a Payload auth collection, so the preferences
// `user` relationship can now also point at a customer — but the B2 migration added auth columns to
// `customers` WITHOUT the matching `customers_id` rels column, and db.push:false means nothing ever
// generated it. Result: every migration-built DB (local dev + production fresh-DB) is missing the
// column, and /admin throws "no such column: customers_id" on the user-preferences query. This
// additive migration adds the column + index. (The FK can't be added via SQLite ALTER TABLE — it's
// cosmetic cascade-delete only; the query needs just the column + index.) Mirrors users_id verbatim.

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.run(sql`ALTER TABLE \`payload_preferences_rels\` ADD COLUMN \`customers_id\` integer;`)
  await db.run(sql`CREATE INDEX \`payload_preferences_rels_customers_id_idx\` ON \`payload_preferences_rels\` (\`customers_id\`);`)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.run(sql`DROP INDEX IF EXISTS \`payload_preferences_rels_customers_id_idx\`;`)
  await db.run(sql`ALTER TABLE \`payload_preferences_rels\` DROP COLUMN \`customers_id\`;`)
}
