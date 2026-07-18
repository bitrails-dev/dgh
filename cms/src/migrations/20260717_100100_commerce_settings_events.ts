import type { MigrateUpArgs, MigrateDownArgs } from '@payloadcms/db-sqlite'
import { sql } from '@payloadcms/db-sqlite'

// commerce-settings (one per tenant; gateway secrets stored encrypted by the app layer) and
// payment-events (idempotent webhook ledger; compound unique on tenant+gateway+providerEventId).
// AUTOINCREMENT PKs; standard timestamps. Group fields flatten into the parent table.

export async function up({ db }: MigrateUpArgs): Promise<void> {
  // --- commerce_settings (unique on tenant_id → one doc per tenant) ---
  await db.run(sql`CREATE TABLE \`commerce_settings\` (
  	\`id\` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  	\`status\` text DEFAULT 'setup',
  	\`currency\` text DEFAULT 'EGP',
  	\`timezone\` text DEFAULT 'Africa/Cairo',
  	\`tax_mode\` text DEFAULT 'exclusive',
  	\`sandbox\` numeric DEFAULT 1,
  	\`reservation_ttl_minutes\` numeric DEFAULT 15,
  	\`order_number_prefix\` text DEFAULT 'ORD-',
  	\`paymob_enabled\` numeric DEFAULT 0,
  	\`paymob_merchant_id\` text,
  	\`paymob_iframe_id\` text,
  	\`paymob_integration_id\` text,
  	\`paymob_api_key\` text,
  	\`paymob_hmac_secret\` text,
  	\`kashier_enabled\` numeric DEFAULT 0,
  	\`kashier_merchant_id\` text,
  	\`kashier_api_key\` text,
  	\`kashier_webhook_secret\` text,
  	\`cod_enabled\` numeric DEFAULT 0,
  	\`cod_min_subtotal\` numeric,
  	\`cod_fee\` numeric DEFAULT 0,
  	\`bank_transfer_enabled\` numeric DEFAULT 0,
  	\`bank_transfer_instructions\` text,
  	\`bank_transfer_account_details\` text,
  	\`tenant_id\` integer REFERENCES \`tenants\`(\`id\`),
  	\`updated_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  	\`created_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
  );
  `)
  await db.run(sql`CREATE UNIQUE INDEX \`commerce_settings_tenant_uniq\` ON \`commerce_settings\` (\`tenant_id\`);`)
  await db.run(sql`CREATE INDEX \`commerce_settings_updated_at_idx\` ON \`commerce_settings\` (\`updated_at\`);`)
  await db.run(sql`CREATE INDEX \`commerce_settings_created_at_idx\` ON \`commerce_settings\` (\`created_at\`);`)

  // --- payment_events (unique on tenant+gateway+provider_event_id → idempotent ingest) ---
  await db.run(sql`CREATE TABLE \`payment_events\` (
  	\`id\` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  	\`gateway\` text NOT NULL,
  	\`provider_event_id\` text NOT NULL,
  	\`merchant_reference\` text,
  	\`target_state\` text,
  	\`amount\` numeric,
  	\`folded_state\` text,
  	\`processed\` numeric DEFAULT 0,
  	\`raw_redacted\` text,
  	\`received_at\` text NOT NULL,
  	\`tenant_id\` integer REFERENCES \`tenants\`(\`id\`),
  	\`updated_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  	\`created_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
  );
  `)
  await db.run(sql`CREATE UNIQUE INDEX \`payment_events_tenant_gateway_event_uniq\` ON \`payment_events\` (\`tenant_id\`, \`gateway\`, \`provider_event_id\`);`)
  await db.run(sql`CREATE INDEX \`payment_events_tenant_gateway_idx\` ON \`payment_events\` (\`tenant_id\`, \`gateway\`);`)
  await db.run(sql`CREATE INDEX \`payment_events_merchant_ref_idx\` ON \`payment_events\` (\`merchant_reference\`);`)
  await db.run(sql`CREATE INDEX \`payment_events_processed_idx\` ON \`payment_events\` (\`tenant_id\`, \`processed\`);`)
  await db.run(sql`CREATE INDEX \`payment_events_created_at_idx\` ON \`payment_events\` (\`created_at\`);`)

  // Document-locking relationship columns (see the inventory migration for rationale).
  await db.run(sql`ALTER TABLE \`payload_locked_documents_rels\` ADD \`commerce_settings_id\` integer REFERENCES commerce_settings(id);`)
  await db.run(sql`ALTER TABLE \`payload_locked_documents_rels\` ADD \`payment_events_id\` integer REFERENCES payment_events(id);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_commerce_settings_id_idx\` ON \`payload_locked_documents_rels\` (\`commerce_settings_id\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_payment_events_id_idx\` ON \`payload_locked_documents_rels\` (\`payment_events_id\`);`)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.run(sql`ALTER TABLE \`payload_locked_documents_rels\` DROP COLUMN \`payment_events_id\`;`)
  await db.run(sql`ALTER TABLE \`payload_locked_documents_rels\` DROP COLUMN \`commerce_settings_id\`;`)
  await db.run(sql`DROP TABLE IF EXISTS \`payment_events\`;`)
  await db.run(sql`DROP TABLE IF EXISTS \`commerce_settings\`;`)
}
