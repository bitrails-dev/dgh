import type { MigrateUpArgs, MigrateDownArgs } from '@payloadcms/db-sqlite'
import { sql } from '@payloadcms/db-sqlite'

// Shopper cart + tenant-local customer account. cartToken unique per tenant; customer identity is the
// server-normalized email (unique per tenant) so case/spacing can't create duplicate accounts.

export async function up({ db }: MigrateUpArgs): Promise<void> {
  // --- carts ---
  await db.run(sql`CREATE TABLE \`carts\` (
  	\`id\` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  	\`cart_token\` text NOT NULL,
  	\`customer_id\` integer REFERENCES \`customers\`(\`id\`),
  	\`customer_email\` text,
  	\`items\` text,
  	\`currency\` text,
  	\`status\` text DEFAULT 'active',
  	\`expires_at\` text,
  	\`tenant_id\` integer REFERENCES \`tenants\`(\`id\`),
  	\`updated_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  	\`created_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
  );
  `)
  await db.run(sql`CREATE UNIQUE INDEX \`carts_tenant_token_uniq\` ON \`carts\` (\`tenant_id\`, \`cart_token\`);`)
  await db.run(sql`CREATE INDEX \`carts_tenant_idx\` ON \`carts\` (\`tenant_id\`);`)
  await db.run(sql`CREATE INDEX \`carts_customer_email_idx\` ON \`carts\` (\`customer_email\`);`)
  await db.run(sql`CREATE INDEX \`carts_updated_at_idx\` ON \`carts\` (\`updated_at\`);`)
  await db.run(sql`CREATE INDEX \`carts_created_at_idx\` ON \`carts\` (\`created_at\`);`)

  // --- customers ---
  await db.run(sql`CREATE TABLE \`customers\` (
  	\`id\` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  	\`email\` text NOT NULL,
  	\`normalized_email\` text,
  	\`name\` text,
  	\`phone\` text,
  	\`password_hash\` text,
  	\`password_salt\` text,
  	\`verified\` numeric DEFAULT 0,
  	\`verification_token_hash\` text,
  	\`reset_token_hash\` text,
  	\`status\` text DEFAULT 'active',
  	\`tenant_id\` integer REFERENCES \`tenants\`(\`id\`),
  	\`updated_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  	\`created_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
  );
  `)
  await db.run(sql`CREATE UNIQUE INDEX \`customers_tenant_email_uniq\` ON \`customers\` (\`tenant_id\`, \`normalized_email\`);`)
  await db.run(sql`CREATE INDEX \`customers_tenant_idx\` ON \`customers\` (\`tenant_id\`);`)
  await db.run(sql`CREATE INDEX \`customers_email_idx\` ON \`customers\` (\`email\`);`)
  await db.run(sql`CREATE INDEX \`customers_updated_at_idx\` ON \`customers\` (\`updated_at\`);`)
  await db.run(sql`CREATE INDEX \`customers_created_at_idx\` ON \`customers\` (\`created_at\`);`)

  // --- document-locking relationship columns ---
  await db.run(sql`ALTER TABLE \`payload_locked_documents_rels\` ADD \`carts_id\` integer REFERENCES \`carts\`(id);`)
  await db.run(sql`ALTER TABLE \`payload_locked_documents_rels\` ADD \`customers_id\` integer REFERENCES \`customers\`(id);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_carts_id_idx\` ON \`payload_locked_documents_rels\` (\`carts_id\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_customers_id_idx\` ON \`payload_locked_documents_rels\` (\`customers_id\`);`)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.run(sql`ALTER TABLE \`payload_locked_documents_rels\` DROP COLUMN \`customers_id\`;`)
  await db.run(sql`ALTER TABLE \`payload_locked_documents_rels\` DROP COLUMN \`carts_id\`;`)
  await db.run(sql`DROP TABLE IF EXISTS \`carts\`;`)
  await db.run(sql`DROP TABLE IF EXISTS \`customers\`;`)
}
