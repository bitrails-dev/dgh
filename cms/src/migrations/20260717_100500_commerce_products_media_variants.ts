import type { MigrateUpArgs, MigrateDownArgs } from '@payloadcms/db-sqlite'
import { sql } from '@payloadcms/db-sqlite'

// Catalog media + variants: additive JSON columns on `products` (matches the carts.items JSON
// precedent — one text column per field, no array tables). `images` = JSON array of media IDs;
// `variants` = JSON array of {sku,name,price,compareAtPrice?,taxBps?}. A variant sku keys
// inventory-levels (no inventory-schema change). The products_id document-lock column already
// exists from 20260717_100300, so it is NOT re-added here.

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.run(sql`ALTER TABLE \`products\` ADD COLUMN \`images\` text;`)
  await db.run(sql`ALTER TABLE \`products\` ADD COLUMN \`variants\` text;`)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  try { await db.run(sql`ALTER TABLE \`products\` DROP COLUMN \`variants\`;`) } catch { /* sqlite < 3.35 */ }
  try { await db.run(sql`ALTER TABLE \`products\` DROP COLUMN \`images\`;`) } catch { /* */ }
}
