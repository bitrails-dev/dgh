import type { MigrateUpArgs, MigrateDownArgs } from '@payloadcms/db-sqlite'
import { sql } from '@payloadcms/db-sqlite'

// Additive: backfill two `store-*` columns the C1 additive migration
// (20260719_300000_commerce_plugin_additive) missed when it captured the plugin schema.
//
//   1. `store_carts.selected_shipping_method_id` — the C4 `overrideStoreCarts` extension field
//      `selectedShippingMethod` (relationship → shipping-methods, Plan §3.7) was added to the
//      collection override after C1's capture, so `store_carts` never gained the column the live
//      config emits.
//   2. `store_transactions.payment_method` — the plugin's base transactions collection carries a
//      `paymentMethod` select (paymob/kashier); C1's `store_transactions` table omits the column.
//
// D4 is the first path that creates `store-carts` and `store-transactions` documents through the
// Local API, so it is the first to surface both: drizzle emits these columns from the live config
// and the inserts fail with "no such column". This migration adds both so commerce writes succeed.
//
// Additive only; never touches legacy tables. `down()` reverses exactly what `up()` added. Migrations
// are wrapped in one IMMEDIATE transaction by the adapter.

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.run(sql`ALTER TABLE \`store_carts\` ADD COLUMN \`selected_shipping_method_id\` integer;`)
  await db.run(sql`CREATE INDEX \`store_carts_selected_shipping_method_idx\` ON \`store_carts\` (\`selected_shipping_method_id\`);`)
  await db.run(sql`ALTER TABLE \`store_transactions\` ADD COLUMN \`payment_method\` text;`)
  await db.run(sql`CREATE INDEX \`store_transactions_payment_method_idx\` ON \`store_transactions\` (\`payment_method\`);`)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.run(sql`DROP INDEX IF EXISTS \`store_transactions_payment_method_idx\`;`)
  await db.run(sql`ALTER TABLE \`store_transactions\` DROP COLUMN \`payment_method\`;`)
  await db.run(sql`DROP INDEX IF EXISTS \`store_carts_selected_shipping_method_idx\`;`)
  await db.run(sql`ALTER TABLE \`store_carts\` DROP COLUMN \`selected_shipping_method_id\`;`)
}
