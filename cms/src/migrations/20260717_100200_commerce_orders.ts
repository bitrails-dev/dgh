import type { MigrateUpArgs, MigrateDownArgs } from '@payloadcms/db-sqlite'
import { sql } from '@payloadcms/db-sqlite'

// Own-collection order/transaction model (WP10 path A — the ecommerce plugin does not compose with
// multi-tenant). Orders carry immutable JSON snapshots; orderNumber is unique per tenant. Atomic
// per-tenant sequence counters are added to commerce_settings for order/invoice numbering.

export async function up({ db }: MigrateUpArgs): Promise<void> {
  // --- orders ---
  await db.run(sql`CREATE TABLE \`orders\` (
  	\`id\` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  	\`order_number\` text NOT NULL,
  	\`cart_token\` text,
  	\`customer_email\` text,
  	\`customer_phone\` text,
  	\`status\` text DEFAULT 'pending',
  	\`payment_state\` text DEFAULT 'pending',
  	\`fulfillment_state\` text DEFAULT 'unfulfilled',
  	\`currency\` text NOT NULL,
  	\`subtotal\` numeric,
  	\`total_discount\` numeric DEFAULT 0,
  	\`shipping_price\` numeric DEFAULT 0,
  	\`total_tax\` numeric DEFAULT 0,
  	\`grand_total\` numeric NOT NULL,
  	\`gift_card_applied\` numeric DEFAULT 0,
  	\`amount_due\` numeric NOT NULL,
  	\`quote_hash\` text,
  	\`quote_snapshot\` text,
  	\`items\` text,
  	\`shipping_address\` text,
  	\`billing_address\` text,
  	\`placed_at\` text,
  	\`notes\` text,
  	\`tenant_id\` integer REFERENCES \`tenants\`(\`id\`),
  	\`updated_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  	\`created_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
  );
  `)
  await db.run(sql`CREATE UNIQUE INDEX \`orders_tenant_number_uniq\` ON \`orders\` (\`tenant_id\`, \`order_number\`);`)
  await db.run(sql`CREATE INDEX \`orders_tenant_idx\` ON \`orders\` (\`tenant_id\`);`)
  await db.run(sql`CREATE INDEX \`orders_customer_email_idx\` ON \`orders\` (\`customer_email\`);`)
  await db.run(sql`CREATE INDEX \`orders_status_idx\` ON \`orders\` (\`status\`);`)
  await db.run(sql`CREATE INDEX \`orders_updated_at_idx\` ON \`orders\` (\`updated_at\`);`)
  await db.run(sql`CREATE INDEX \`orders_created_at_idx\` ON \`orders\` (\`created_at\`);`)

  // --- transactions ---
  await db.run(sql`CREATE TABLE \`transactions\` (
  	\`id\` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  	\`order_id\` integer REFERENCES \`orders\`(\`id\`),
  	\`gateway\` text NOT NULL,
  	\`provider_transaction_id\` text,
  	\`amount\` numeric NOT NULL,
  	\`state\` text DEFAULT 'pending',
  	\`captured_amount\` numeric DEFAULT 0,
  	\`refunded_amount\` numeric DEFAULT 0,
  	\`notes\` text,
  	\`tenant_id\` integer REFERENCES \`tenants\`(\`id\`),
  	\`updated_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  	\`created_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
  );
  `)
  await db.run(sql`CREATE INDEX \`transactions_order_idx\` ON \`transactions\` (\`order_id\`);`)
  await db.run(sql`CREATE INDEX \`transactions_tenant_idx\` ON \`transactions\` (\`tenant_id\`);`)
  await db.run(sql`CREATE INDEX \`transactions_provider_idx\` ON \`transactions\` (\`provider_transaction_id\`);`)
  await db.run(sql`CREATE INDEX \`transactions_updated_at_idx\` ON \`transactions\` (\`updated_at\`);`)
  await db.run(sql`CREATE INDEX \`transactions_created_at_idx\` ON \`transactions\` (\`created_at\`);`)

  // --- commerce_settings: per-tenant sequence counters ---
  await db.run(sql`ALTER TABLE \`commerce_settings\` ADD COLUMN \`order_number_seq\` numeric DEFAULT 0;`)
  await db.run(sql`ALTER TABLE \`commerce_settings\` ADD COLUMN \`invoice_number_seq\` numeric DEFAULT 0;`)

  // --- document-locking relationship columns (mandatory; see inventory migration) ---
  await db.run(sql`ALTER TABLE \`payload_locked_documents_rels\` ADD \`orders_id\` integer REFERENCES \`orders\`(id);`)
  await db.run(sql`ALTER TABLE \`payload_locked_documents_rels\` ADD \`transactions_id\` integer REFERENCES \`transactions\`(id);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_orders_id_idx\` ON \`payload_locked_documents_rels\` (\`orders_id\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_transactions_id_idx\` ON \`payload_locked_documents_rels\` (\`transactions_id\`);`)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.run(sql`ALTER TABLE \`payload_locked_documents_rels\` DROP COLUMN \`transactions_id\`;`)
  await db.run(sql`ALTER TABLE \`payload_locked_documents_rels\` DROP COLUMN \`orders_id\`;`)
  // SQLite cannot easily DROP COLUMN before 3.35; counters are harmless if left. Best-effort:
  try { await db.run(sql`ALTER TABLE \`commerce_settings\` DROP COLUMN \`invoice_number_seq\`;`) } catch { /* */ }
  try { await db.run(sql`ALTER TABLE \`commerce_settings\` DROP COLUMN \`order_number_seq\`;`) } catch { /* */ }
  await db.run(sql`DROP TABLE IF EXISTS \`transactions\`;`)
  await db.run(sql`DROP TABLE IF EXISTS \`orders\`;`)
}
