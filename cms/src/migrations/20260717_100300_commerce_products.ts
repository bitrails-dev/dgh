import type { MigrateUpArgs, MigrateDownArgs } from '@payloadcms/db-sqlite'
import { sql } from '@payloadcms/db-sqlite'

// Catalog MVP: products (sku unique per tenant). Variants/categories/brands layer on later.

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.run(sql`CREATE TABLE \`products\` (
  	\`id\` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  	\`name\` text,
  	\`slug\` text,
  	\`sku\` text NOT NULL,
  	\`description\` text,
  	\`price\` numeric NOT NULL,
  	\`compare_at_price\` numeric,
  	\`tax_class\` text DEFAULT 'standard',
  	\`tax_bps\` numeric DEFAULT 0,
  	\`status\` text DEFAULT 'active',
  	\`product_kind\` text DEFAULT 'physical',
  	\`track_inventory\` numeric DEFAULT 1,
  	\`tenant_id\` integer REFERENCES \`tenants\`(\`id\`),
  	\`updated_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  	\`created_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
  );
  `)
  await db.run(sql`CREATE UNIQUE INDEX \`products_tenant_sku_uniq\` ON \`products\` (\`tenant_id\`, \`sku\`);`)
  await db.run(sql`CREATE INDEX \`products_tenant_idx\` ON \`products\` (\`tenant_id\`);`)
  await db.run(sql`CREATE INDEX \`products_sku_idx\` ON \`products\` (\`sku\`);`)
  await db.run(sql`CREATE INDEX \`products_status_idx\` ON \`products\` (\`status\`);`)
  await db.run(sql`CREATE INDEX \`products_updated_at_idx\` ON \`products\` (\`updated_at\`);`)
  await db.run(sql`CREATE INDEX \`products_created_at_idx\` ON \`products\` (\`created_at\`);`)

  await db.run(sql`ALTER TABLE \`payload_locked_documents_rels\` ADD \`products_id\` integer REFERENCES \`products\`(id);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_products_id_idx\` ON \`payload_locked_documents_rels\` (\`products_id\`);`)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.run(sql`ALTER TABLE \`payload_locked_documents_rels\` DROP COLUMN \`products_id\`;`)
  await db.run(sql`DROP TABLE IF EXISTS \`products\`;`)
}
