import type { MigrateDownArgs, MigrateUpArgs } from '@payloadcms/db-sqlite'
import { sql } from '@payloadcms/db-sqlite'

// Payload names relationship columns from the target slug. Once the order override correctly
// targets `store-transactions`, the relation column is `store_transactions_id` (not the legacy
// `transactions_id`). Rebuild the join table without altering the already-versioned predecessor.
export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.run(sql`ALTER TABLE \`store_orders_rels\` RENAME TO \`_store_orders_rels_pre_plugin_slug\`;`)
  await db.run(sql`CREATE TABLE \`store_orders_rels\` (
    \`id\` integer PRIMARY KEY NOT NULL,
    \`order\` integer,
    \`parent_id\` integer NOT NULL,
    \`path\` text NOT NULL,
    \`store_transactions_id\` integer,
    FOREIGN KEY (\`parent_id\`) REFERENCES \`store_orders\`(\`id\`) ON UPDATE no action ON DELETE cascade,
    FOREIGN KEY (\`store_transactions_id\`) REFERENCES \`store_transactions\`(\`id\`) ON UPDATE no action ON DELETE cascade
  );`)
  await db.run(sql`INSERT INTO \`store_orders_rels\` (\`id\`, \`order\`, \`parent_id\`, \`path\`, \`store_transactions_id\`)
    SELECT \`id\`, \`order\`, \`parent_id\`, \`path\`, \`transactions_id\`
    FROM \`_store_orders_rels_pre_plugin_slug\`;`)
  await db.run(sql`DROP INDEX IF EXISTS \`store_orders_rels_order_idx\`;`)
  await db.run(sql`DROP INDEX IF EXISTS \`store_orders_rels_parent_idx\`;`)
  await db.run(sql`DROP INDEX IF EXISTS \`store_orders_rels_path_idx\`;`)
  await db.run(sql`DROP INDEX IF EXISTS \`store_orders_rels_transactions_id_idx\`;`)
  await db.run(sql`CREATE INDEX \`store_orders_rels_order_idx\` ON \`store_orders_rels\` (\`order\`);`)
  await db.run(sql`CREATE INDEX \`store_orders_rels_parent_idx\` ON \`store_orders_rels\` (\`parent_id\`);`)
  await db.run(sql`CREATE INDEX \`store_orders_rels_path_idx\` ON \`store_orders_rels\` (\`path\`);`)
  await db.run(sql`CREATE INDEX \`store_orders_rels_store_transactions_id_idx\` ON \`store_orders_rels\` (\`store_transactions_id\`);`)
  await db.run(sql`DROP TABLE \`_store_orders_rels_pre_plugin_slug\`;`)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.run(sql`ALTER TABLE \`store_orders_rels\` RENAME TO \`_store_orders_rels_plugin_slug\`;`)
  await db.run(sql`CREATE TABLE \`store_orders_rels\` (
    \`id\` integer PRIMARY KEY NOT NULL,
    \`order\` integer,
    \`parent_id\` integer NOT NULL,
    \`path\` text NOT NULL,
    \`transactions_id\` integer,
    FOREIGN KEY (\`parent_id\`) REFERENCES \`store_orders\`(\`id\`) ON UPDATE no action ON DELETE cascade,
    FOREIGN KEY (\`transactions_id\`) REFERENCES \`store_transactions\`(\`id\`) ON UPDATE no action ON DELETE cascade
  );`)
  await db.run(sql`INSERT INTO \`store_orders_rels\` (\`id\`, \`order\`, \`parent_id\`, \`path\`, \`transactions_id\`)
    SELECT \`id\`, \`order\`, \`parent_id\`, \`path\`, \`store_transactions_id\`
    FROM \`_store_orders_rels_plugin_slug\`;`)
  await db.run(sql`DROP INDEX IF EXISTS \`store_orders_rels_order_idx\`;`)
  await db.run(sql`DROP INDEX IF EXISTS \`store_orders_rels_parent_idx\`;`)
  await db.run(sql`DROP INDEX IF EXISTS \`store_orders_rels_path_idx\`;`)
  await db.run(sql`DROP INDEX IF EXISTS \`store_orders_rels_store_transactions_id_idx\`;`)
  await db.run(sql`CREATE INDEX \`store_orders_rels_order_idx\` ON \`store_orders_rels\` (\`order\`);`)
  await db.run(sql`CREATE INDEX \`store_orders_rels_parent_idx\` ON \`store_orders_rels\` (\`parent_id\`);`)
  await db.run(sql`CREATE INDEX \`store_orders_rels_path_idx\` ON \`store_orders_rels\` (\`path\`);`)
  await db.run(sql`CREATE INDEX \`store_orders_rels_transactions_id_idx\` ON \`store_orders_rels\` (\`transactions_id\`);`)
  await db.run(sql`DROP TABLE \`_store_orders_rels_plugin_slug\`;`)
}
