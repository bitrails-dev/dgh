import type { MigrateUpArgs, MigrateDownArgs } from '@payloadcms/db-sqlite'
import { sql } from '@payloadcms/db-sqlite'

// Commerce inventory model: locations, levels, immutable movements, reservations, transfers.
// All tables are tenant-scoped (tenant_id FK) and commerce-gated (feature policy). Quantity counters
// on inventory_levels are written only by the inventory module via overrideAccess; the partial unique
// index on active reservations and the compound unique on (tenant, location, sku) enforce the core
// invariants the module relies on. AUTOINCREMENT PKs honor the commerce no-id-reuse requirement.

export async function up({ db }: MigrateUpArgs): Promise<void> {
  // --- inventory_locations ---
  await db.run(sql`CREATE TABLE \`inventory_locations\` (
  	\`id\` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  	\`name\` text,
  	\`slug\` text,
  	\`is_active\` numeric DEFAULT 1,
  	\`is_fulfillable\` numeric DEFAULT 1,
  	\`address_line1\` text,
  	\`address_city\` text,
  	\`address_country\` text,
  	\`address_postal_code\` text,
  	\`contact_phone\` text,
  	\`tenant_id\` integer REFERENCES \`tenants\`(\`id\`),
  	\`updated_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  	\`created_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
  );
  `)
  await db.run(sql`CREATE INDEX \`inventory_locations_tenant_idx\` ON \`inventory_locations\` (\`tenant_id\`);`)
  await db.run(sql`CREATE INDEX \`inventory_locations_slug_idx\` ON \`inventory_locations\` (\`slug\`);`)
  await db.run(sql`CREATE INDEX \`inventory_locations_updated_at_idx\` ON \`inventory_locations\` (\`updated_at\`);`)
  await db.run(sql`CREATE INDEX \`inventory_locations_created_at_idx\` ON \`inventory_locations\` (\`created_at\`);`)

  // --- inventory_levels (compound unique: one level per tenant+location+sku) ---
  await db.run(sql`CREATE TABLE \`inventory_levels\` (
  	\`id\` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  	\`location_id\` integer REFERENCES \`inventory_locations\`(\`id\`),
  	\`sku\` text NOT NULL,
  	\`variant_sku\` text,
  	\`on_hand\` numeric DEFAULT 0,
  	\`reserved\` numeric DEFAULT 0,
  	\`incoming\` numeric DEFAULT 0,
  	\`damaged\` numeric DEFAULT 0,
  	\`safety_stock\` numeric DEFAULT 0,
  	\`reorder_point\` numeric DEFAULT 0,
  	\`low_stock_threshold\` numeric DEFAULT 0,
  	\`bin\` text,
  	\`tenant_id\` integer REFERENCES \`tenants\`(\`id\`),
  	\`updated_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  	\`created_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
  );
  `)
  await db.run(sql`CREATE UNIQUE INDEX \`inventory_levels_tenant_location_sku_uniq\` ON \`inventory_levels\` (\`tenant_id\`, \`location_id\`, \`sku\`);`)
  await db.run(sql`CREATE INDEX \`inventory_levels_tenant_idx\` ON \`inventory_levels\` (\`tenant_id\`);`)
  await db.run(sql`CREATE INDEX \`inventory_levels_location_idx\` ON \`inventory_levels\` (\`location_id\`);`)
  await db.run(sql`CREATE INDEX \`inventory_levels_sku_idx\` ON \`inventory_levels\` (\`sku\`);`)
  await db.run(sql`CREATE INDEX \`inventory_levels_updated_at_idx\` ON \`inventory_levels\` (\`updated_at\`);`)
  await db.run(sql`CREATE INDEX \`inventory_levels_created_at_idx\` ON \`inventory_levels\` (\`created_at\`);`)

  // --- stock_reservations (partial unique: one ACTIVE hold per tenant+level+cart) ---
  await db.run(sql`CREATE TABLE \`stock_reservations\` (
  	\`id\` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  	\`level_id\` integer REFERENCES \`inventory_levels\`(\`id\`),
  	\`sku\` text NOT NULL,
  	\`quantity\` numeric NOT NULL,
  	\`cart_token\` text NOT NULL,
  	\`status\` text DEFAULT 'active',
  	\`expires_at\` text NOT NULL,
  	\`order_ref\` text,
  	\`source\` text,
  	\`tenant_id\` integer REFERENCES \`tenants\`(\`id\`),
  	\`updated_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  	\`created_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
  );
  `)
  await db.run(sql`CREATE UNIQUE INDEX \`stock_reservations_active_cart_uniq\` ON \`stock_reservations\` (\`tenant_id\`, \`level_id\`, \`cart_token\`) WHERE \`status\` = 'active';`)
  await db.run(sql`CREATE INDEX \`stock_reservations_expiry_idx\` ON \`stock_reservations\` (\`tenant_id\`, \`status\`, \`expires_at\`);`)
  await db.run(sql`CREATE INDEX \`stock_reservations_cart_idx\` ON \`stock_reservations\` (\`cart_token\`);`)
  await db.run(sql`CREATE INDEX \`stock_reservations_tenant_idx\` ON \`stock_reservations\` (\`tenant_id\`);`)
  await db.run(sql`CREATE INDEX \`stock_reservations_updated_at_idx\` ON \`stock_reservations\` (\`updated_at\`);`)
  await db.run(sql`CREATE INDEX \`stock_reservations_created_at_idx\` ON \`stock_reservations\` (\`created_at\`);`)

  // --- inventory_transfers ---
  await db.run(sql`CREATE TABLE \`inventory_transfers\` (
  	\`id\` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  	\`from_location_id\` integer REFERENCES \`inventory_locations\`(\`id\`),
  	\`to_location_id\` integer REFERENCES \`inventory_locations\`(\`id\`),
  	\`sku\` text NOT NULL,
  	\`quantity\` numeric NOT NULL,
  	\`status\` text DEFAULT 'draft',
  	\`dispatch_movement_id\` integer REFERENCES \`stock_movements\`(\`id\`),
  	\`receive_movement_id\` integer REFERENCES \`stock_movements\`(\`id\`),
  	\`note\` text,
  	\`tenant_id\` integer REFERENCES \`tenants\`(\`id\`),
  	\`updated_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  	\`created_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
  );
  `)
  await db.run(sql`CREATE INDEX \`inventory_transfers_tenant_idx\` ON \`inventory_transfers\` (\`tenant_id\`);`)
  await db.run(sql`CREATE INDEX \`inventory_transfers_from_idx\` ON \`inventory_transfers\` (\`from_location_id\`);`)
  await db.run(sql`CREATE INDEX \`inventory_transfers_to_idx\` ON \`inventory_transfers\` (\`to_location_id\`);`)
  await db.run(sql`CREATE INDEX \`inventory_transfers_status_idx\` ON \`inventory_transfers\` (\`status\`);`)
  await db.run(sql`CREATE INDEX \`inventory_transfers_updated_at_idx\` ON \`inventory_transfers\` (\`updated_at\`);`)
  await db.run(sql`CREATE INDEX \`inventory_transfers_created_at_idx\` ON \`inventory_transfers\` (\`created_at\`);`)

  // --- stock_movements (immutable ledger) ---
  await db.run(sql`CREATE TABLE \`stock_movements\` (
  	\`id\` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  	\`level_id\` integer REFERENCES \`inventory_levels\`(\`id\`),
  	\`type\` text NOT NULL,
  	\`quantity\` numeric NOT NULL,
  	\`resulting_on_hand\` numeric,
  	\`reason\` text,
  	\`order_ref\` text,
  	\`reservation_id\` integer REFERENCES \`stock_reservations\`(\`id\`),
  	\`transfer_id\` integer REFERENCES \`inventory_transfers\`(\`id\`),
  	\`actor\` text,
  	\`metadata\` text,
  	\`tenant_id\` integer REFERENCES \`tenants\`(\`id\`),
  	\`updated_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  	\`created_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
  );
  `)
  await db.run(sql`CREATE INDEX \`stock_movements_tenant_level_idx\` ON \`stock_movements\` (\`tenant_id\`, \`level_id\`);`)
  await db.run(sql`CREATE INDEX \`stock_movements_level_idx\` ON \`stock_movements\` (\`level_id\`);`)
  await db.run(sql`CREATE INDEX \`stock_movements_reservation_idx\` ON \`stock_movements\` (\`reservation_id\`);`)
  await db.run(sql`CREATE INDEX \`stock_movements_transfer_idx\` ON \`stock_movements\` (\`transfer_id\`);`)
  await db.run(sql`CREATE INDEX \`stock_movements_created_at_idx\` ON \`stock_movements\` (\`created_at\`);`)

  // Document-locking relationship columns. Payload's lock-check query references one `<slug>_id`
  // column per collection; adding collections without these columns breaks updates globally.
  await db.run(sql`ALTER TABLE \`payload_locked_documents_rels\` ADD \`inventory_locations_id\` integer REFERENCES inventory_locations(id);`)
  await db.run(sql`ALTER TABLE \`payload_locked_documents_rels\` ADD \`inventory_levels_id\` integer REFERENCES inventory_levels(id);`)
  await db.run(sql`ALTER TABLE \`payload_locked_documents_rels\` ADD \`stock_movements_id\` integer REFERENCES stock_movements(id);`)
  await db.run(sql`ALTER TABLE \`payload_locked_documents_rels\` ADD \`stock_reservations_id\` integer REFERENCES stock_reservations(id);`)
  await db.run(sql`ALTER TABLE \`payload_locked_documents_rels\` ADD \`inventory_transfers_id\` integer REFERENCES inventory_transfers(id);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_inventory_locations_id_idx\` ON \`payload_locked_documents_rels\` (\`inventory_locations_id\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_inventory_levels_id_idx\` ON \`payload_locked_documents_rels\` (\`inventory_levels_id\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_stock_movements_id_idx\` ON \`payload_locked_documents_rels\` (\`stock_movements_id\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_stock_reservations_id_idx\` ON \`payload_locked_documents_rels\` (\`stock_reservations_id\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_inventory_transfers_id_idx\` ON \`payload_locked_documents_rels\` (\`inventory_transfers_id\`);`)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.run(sql`ALTER TABLE \`payload_locked_documents_rels\` DROP COLUMN \`inventory_transfers_id\`;`)
  await db.run(sql`ALTER TABLE \`payload_locked_documents_rels\` DROP COLUMN \`stock_reservations_id\`;`)
  await db.run(sql`ALTER TABLE \`payload_locked_documents_rels\` DROP COLUMN \`stock_movements_id\`;`)
  await db.run(sql`ALTER TABLE \`payload_locked_documents_rels\` DROP COLUMN \`inventory_levels_id\`;`)
  await db.run(sql`ALTER TABLE \`payload_locked_documents_rels\` DROP COLUMN \`inventory_locations_id\`;`)
  await db.run(sql`DROP TABLE IF EXISTS \`stock_movements\`;`)
  await db.run(sql`DROP TABLE IF EXISTS \`inventory_transfers\`;`)
  await db.run(sql`DROP TABLE IF EXISTS \`stock_reservations\`;`)
  await db.run(sql`DROP TABLE IF EXISTS \`inventory_levels\`;`)
  await db.run(sql`DROP TABLE IF EXISTS \`inventory_locations\`;`)
}
