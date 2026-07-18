import type { MigrateUpArgs, MigrateDownArgs } from '@payloadcms/db-sqlite'
import { sql } from '@payloadcms/db-sqlite'

// Plugin-first commerce additive schema (Wave C1).
//
// Plan refs: §1.1 (installed packages), §3.1 (permanent store-* slugs), §3.10 (policy table
// schemas — field-for-field), §4.1 (`commerce-gateway-nonces`), §5.1–§5.7 (preflight + backfill +
// cutover), §7 C1+C2.
//
// This migration is ADDITIVE ONLY:
//   - creates every `store-*` table the @payloadcms/plugin-ecommerce (3.85.1) generates, matching
//     the schema the plugin's pushDevSchema emits (captured by booting the B4 config against a
//     throwaway DB — see plan §5 input contract #3). The store-* column lists, foreign keys and
//     indexes mirror that capture verbatim so `payload migrate` against a fresh DB produces a
//     schema the plugin can read/write without drift.
//   - creates the §3.10 policy tables (tax-zones, tax-rates, shipping-zones, shipping-methods,
//     promotions, promotion-redemptions, gift-cards, gift-card-ledger). Column-for-column matches
//     the C4 collection configs in `cms/src/commerce/policies/collections/*` so config and DB align
//     at fan-in.
//   - creates the §4.1 `commerce-gateway-nonces` table (key_id + sha256 nonce_hash, unique pair,
//     expiry index) consumed by the retained gateway replay ledger.
//   - appends the matching `store_*_id` + policy `_id` columns to payload_locked_documents_rels so
//     Payload's document-lock query (which now spans the store-* and policy collections after B4)
//     does not throw the lock-status SQL error that currently fails the integration suite.
//
// It NEVER drops legacy `products`/`carts`/`orders`/`transactions`/inventory tables (plan §5.7.10
// "retain legacy tables read-only for one release"). `down()` reverses only what `up()` added.
//
// Rerunnable contract: `payload migrate` is a no-op once this is recorded in payload_migrations;
// the SQL itself does not use IF NOT EXISTS, matching the style of every existing hand-written
// commerce migration in this repo.

export async function up({ db }: MigrateUpArgs): Promise<void> {
  // ============================================================================
  // store-products (plugin default + B1 extension fields; matches plugin push verbatim)
  // ============================================================================
  await db.run(sql`CREATE TABLE \`store_products\` (
  	\`id\` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  	\`tenant_id\` integer,
  	\`enable_variants\` integer,
  	\`price_in_e_g_p_enabled\` integer,
  	\`price_in_e_g_p\` numeric,
  	\`slug\` text,
  	\`description\` text,
  	\`sku\` text,
  	\`track_inventory\` integer DEFAULT true,
  	\`tax_class\` text DEFAULT 'standard',
  	\`tax_bps\` numeric,
  	\`legacy_product_id\` numeric,
  	\`updated_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  	\`created_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  	\`deleted_at\` text,
  	\`_status\` text DEFAULT 'draft',
  	FOREIGN KEY (\`tenant_id\`) REFERENCES \`tenants\`(\`id\`) ON UPDATE no action ON DELETE set null
  );
  `)
  await db.run(sql`CREATE INDEX \`store_products__status_idx\` ON \`store_products\` (\`_status\`);`)
  await db.run(sql`CREATE INDEX \`store_products_created_at_idx\` ON \`store_products\` (\`created_at\`);`)
  await db.run(sql`CREATE INDEX \`store_products_deleted_at_idx\` ON \`store_products\` (\`deleted_at\`);`)
  await db.run(sql`CREATE INDEX \`store_products_legacy_product_id_idx\` ON \`store_products\` (\`legacy_product_id\`);`)
  await db.run(sql`CREATE INDEX \`store_products_sku_idx\` ON \`store_products\` (\`sku\`);`)
  await db.run(sql`CREATE INDEX \`store_products_slug_idx\` ON \`store_products\` (\`slug\`);`)
  await db.run(sql`CREATE INDEX \`store_products_tenant_idx\` ON \`store_products\` (\`tenant_id\`);`)
  await db.run(sql`CREATE INDEX \`store_products_updated_at_idx\` ON \`store_products\` (\`updated_at\`);`)
  // Plan §3.4 raw unique indexes: (tenant_id, sku) WHERE sku IS NOT NULL — non-null product SKUs
  // identify simple products; variant-bearing products have null SKU and the variant SKUs live on
  // store_variants. Partial unique so the NULL-bearing rows do not collide.
  await db.run(sql`CREATE UNIQUE INDEX \`store_products_tenant_sku_uniq\` ON \`store_products\` (\`tenant_id\`, \`sku\`) WHERE \`sku\` IS NOT NULL;`)

  await db.run(sql`CREATE TABLE \`store_products_rels\` (
  	\`id\` integer PRIMARY KEY NOT NULL,
  	\`order\` integer,
  	\`parent_id\` integer NOT NULL,
  	\`path\` text NOT NULL,
  	\`store_variant_types_id\` integer,
  	\`media_id\` integer,
  	FOREIGN KEY (\`parent_id\`) REFERENCES \`store_products\`(\`id\`) ON UPDATE no action ON DELETE cascade,
  	FOREIGN KEY (\`store_variant_types_id\`) REFERENCES \`store_variant_types\`(\`id\`) ON UPDATE no action ON DELETE cascade,
  	FOREIGN KEY (\`media_id\`) REFERENCES \`media\`(\`id\`) ON UPDATE no action ON DELETE cascade
  );
  `)
  await db.run(sql`CREATE INDEX \`store_products_rels_media_id_idx\` ON \`store_products_rels\` (\`media_id\`);`)
  await db.run(sql`CREATE INDEX \`store_products_rels_order_idx\` ON \`store_products_rels\` (\`order\`);`)
  await db.run(sql`CREATE INDEX \`store_products_rels_parent_idx\` ON \`store_products_rels\` (\`parent_id\`);`)
  await db.run(sql`CREATE INDEX \`store_products_rels_path_idx\` ON \`store_products_rels\` (\`path\`);`)
  await db.run(sql`CREATE INDEX \`store_products_rels_store_variant_types_id_idx\` ON \`store_products_rels\` (\`store_variant_types_id\`);`)

  // Versions table for store_products (the plugin sets versions.drafts.autosave=true on products).
  // Every versioned field becomes `version_<field>`; the parent link, snapshot ref, latest/autosave
  // flags, and standard timestamps round out the schema. Mirrors what pushDevSchema emits.
  await db.run(sql`CREATE TABLE \`_store_products_v\` (
  	\`id\` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  	\`parent_id\` integer,
  	\`version_tenant_id\` integer,
  	\`version_enable_variants\` integer,
  	\`version_price_in_e_g_p_enabled\` integer,
  	\`version_price_in_e_g_p\` numeric,
  	\`version_slug\` text,
  	\`version_description\` text,
  	\`version_sku\` text,
  	\`version_track_inventory\` integer DEFAULT true,
  	\`version_tax_class\` text DEFAULT 'standard',
  	\`version_tax_bps\` numeric,
  	\`version_legacy_product_id\` numeric,
  	\`version_updated_at\` text,
  	\`version_created_at\` text,
  	\`version_deleted_at\` text,
  	\`version__status\` text DEFAULT 'draft',
  	\`created_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  	\`updated_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  	\`snapshot\` integer,
  	\`published_locale\` text,
  	\`latest\` integer,
  	\`autosave\` integer,
  	FOREIGN KEY (\`parent_id\`) REFERENCES \`store_products\`(\`id\`) ON UPDATE no action ON DELETE set null,
  	FOREIGN KEY (\`version_tenant_id\`) REFERENCES \`tenants\`(\`id\`) ON UPDATE no action ON DELETE set null
  );
  `)
  await db.run(sql`CREATE INDEX \`_store_products_v_autosave_idx\` ON \`_store_products_v\` (\`autosave\`);`)
  await db.run(sql`CREATE INDEX \`_store_products_v_created_at_idx\` ON \`_store_products_v\` (\`created_at\`);`)
  await db.run(sql`CREATE INDEX \`_store_products_v_latest_idx\` ON \`_store_products_v\` (\`latest\`);`)
  await db.run(sql`CREATE INDEX \`_store_products_v_parent_idx\` ON \`_store_products_v\` (\`parent_id\`);`)
  await db.run(sql`CREATE INDEX \`_store_products_v_published_locale_idx\` ON \`_store_products_v\` (\`published_locale\`);`)
  await db.run(sql`CREATE INDEX \`_store_products_v_snapshot_idx\` ON \`_store_products_v\` (\`snapshot\`);`)
  await db.run(sql`CREATE INDEX \`_store_products_v_updated_at_idx\` ON \`_store_products_v\` (\`updated_at\`);`)
  await db.run(sql`CREATE INDEX \`_store_products_v_version_version__status_idx\` ON \`_store_products_v\` (\`version__status\`);`)
  await db.run(sql`CREATE INDEX \`_store_products_v_version_version_created_at_idx\` ON \`_store_products_v\` (\`version_created_at\`);`)
  await db.run(sql`CREATE INDEX \`_store_products_v_version_version_deleted_at_idx\` ON \`_store_products_v\` (\`version_deleted_at\`);`)
  await db.run(sql`CREATE INDEX \`_store_products_v_version_version_legacy_product_id_idx\` ON \`_store_products_v\` (\`version_legacy_product_id\`);`)
  await db.run(sql`CREATE INDEX \`_store_products_v_version_version_sku_idx\` ON \`_store_products_v\` (\`version_sku\`);`)
  await db.run(sql`CREATE INDEX \`_store_products_v_version_version_slug_idx\` ON \`_store_products_v\` (\`version_slug\`);`)
  await db.run(sql`CREATE INDEX \`_store_products_v_version_version_tenant_idx\` ON \`_store_products_v\` (\`version_tenant_id\`);`)
  await db.run(sql`CREATE INDEX \`_store_products_v_version_version_updated_at_idx\` ON \`_store_products_v\` (\`version_updated_at\`);`)

  await db.run(sql`CREATE TABLE \`_store_products_v_rels\` (
  	\`id\` integer PRIMARY KEY NOT NULL,
  	\`order\` integer,
  	\`parent_id\` integer NOT NULL,
  	\`path\` text NOT NULL,
  	\`store_variant_types_id\` integer,
  	\`media_id\` integer,
  	FOREIGN KEY (\`parent_id\`) REFERENCES \`_store_products_v\`(\`id\`) ON UPDATE no action ON DELETE cascade,
  	FOREIGN KEY (\`store_variant_types_id\`) REFERENCES \`store_variant_types\`(\`id\`) ON UPDATE no action ON DELETE cascade,
  	FOREIGN KEY (\`media_id\`) REFERENCES \`media\`(\`id\`) ON UPDATE no action ON DELETE cascade
  );
  `)
  await db.run(sql`CREATE INDEX \`_store_products_v_rels_media_id_idx\` ON \`_store_products_v_rels\` (\`media_id\`);`)
  await db.run(sql`CREATE INDEX \`_store_products_v_rels_order_idx\` ON \`_store_products_v_rels\` (\`order\`);`)
  await db.run(sql`CREATE INDEX \`_store_products_v_rels_parent_idx\` ON \`_store_products_v_rels\` (\`parent_id\`);`)
  await db.run(sql`CREATE INDEX \`_store_products_v_rels_path_idx\` ON \`_store_products_v_rels\` (\`path\`);`)
  await db.run(sql`CREATE INDEX \`_store_products_v_rels_store_variant_types_id_idx\` ON \`_store_products_v_rels\` (\`store_variant_types_id\`);`)

  // ============================================================================
  // store-variant-types (plugin default, re-slugged)
  // ============================================================================
  await db.run(sql`CREATE TABLE \`store_variant_types\` (
  	\`id\` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  	\`tenant_id\` integer,
  	\`label\` text NOT NULL,
  	\`name\` text NOT NULL,
  	\`updated_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  	\`created_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  	\`deleted_at\` text,
  	FOREIGN KEY (\`tenant_id\`) REFERENCES \`tenants\`(\`id\`) ON UPDATE no action ON DELETE set null
  );
  `)
  await db.run(sql`CREATE INDEX \`store_variant_types_created_at_idx\` ON \`store_variant_types\` (\`created_at\`);`)
  await db.run(sql`CREATE INDEX \`store_variant_types_deleted_at_idx\` ON \`store_variant_types\` (\`deleted_at\`);`)
  await db.run(sql`CREATE INDEX \`store_variant_types_tenant_idx\` ON \`store_variant_types\` (\`tenant_id\`);`)
  await db.run(sql`CREATE INDEX \`store_variant_types_updated_at_idx\` ON \`store_variant_types\` (\`updated_at\`);`)

  // ============================================================================
  // store-variant-options (plugin default, re-slugged)
  // ============================================================================
  await db.run(sql`CREATE TABLE \`store_variant_options\` (
  	\`id\` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  	\`_store_variant_options_options_order\` text,
  	\`tenant_id\` integer,
  	\`variant_type_id\` integer NOT NULL,
  	\`label\` text NOT NULL,
  	\`value\` text NOT NULL,
  	\`updated_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  	\`created_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  	\`deleted_at\` text,
  	FOREIGN KEY (\`tenant_id\`) REFERENCES \`tenants\`(\`id\`) ON UPDATE no action ON DELETE set null,
  	FOREIGN KEY (\`variant_type_id\`) REFERENCES \`store_variant_types\`(\`id\`) ON UPDATE no action ON DELETE set null
  );
  `)
  await db.run(sql`CREATE INDEX \`store_variant_options__store_variant_options_options_ord_idx\` ON \`store_variant_options\` (\`_store_variant_options_options_order\`);`)
  await db.run(sql`CREATE INDEX \`store_variant_options_created_at_idx\` ON \`store_variant_options\` (\`created_at\`);`)
  await db.run(sql`CREATE INDEX \`store_variant_options_deleted_at_idx\` ON \`store_variant_options\` (\`deleted_at\`);`)
  await db.run(sql`CREATE INDEX \`store_variant_options_tenant_idx\` ON \`store_variant_options\` (\`tenant_id\`);`)
  await db.run(sql`CREATE INDEX \`store_variant_options_updated_at_idx\` ON \`store_variant_options\` (\`updated_at\`);`)
  await db.run(sql`CREATE INDEX \`store_variant_options_variant_type_idx\` ON \`store_variant_options\` (\`variant_type_id\`);`)

  // ============================================================================
  // store-variants (plugin default + B1 extension fields)
  // ============================================================================
  await db.run(sql`CREATE TABLE \`store_variants\` (
  	\`id\` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  	\`tenant_id\` integer,
  	\`title\` text,
  	\`product_id\` integer,
  	\`price_in_e_g_p_enabled\` integer,
  	\`price_in_e_g_p\` numeric,
  	\`sku\` text,
  	\`legacy_variant_key\` text,
  	\`updated_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  	\`created_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  	\`deleted_at\` text,
  	\`_status\` text DEFAULT 'draft',
  	FOREIGN KEY (\`tenant_id\`) REFERENCES \`tenants\`(\`id\`) ON UPDATE no action ON DELETE set null,
  	FOREIGN KEY (\`product_id\`) REFERENCES \`store_products\`(\`id\`) ON UPDATE no action ON DELETE set null
  );
  `)
  await db.run(sql`CREATE INDEX \`store_variants__status_idx\` ON \`store_variants\` (\`_status\`);`)
  await db.run(sql`CREATE INDEX \`store_variants_created_at_idx\` ON \`store_variants\` (\`created_at\`);`)
  await db.run(sql`CREATE INDEX \`store_variants_deleted_at_idx\` ON \`store_variants\` (\`deleted_at\`);`)
  await db.run(sql`CREATE INDEX \`store_variants_legacy_variant_key_idx\` ON \`store_variants\` (\`legacy_variant_key\`);`)
  await db.run(sql`CREATE INDEX \`store_variants_product_idx\` ON \`store_variants\` (\`product_id\`);`)
  await db.run(sql`CREATE INDEX \`store_variants_sku_idx\` ON \`store_variants\` (\`sku\`);`)
  await db.run(sql`CREATE INDEX \`store_variants_tenant_idx\` ON \`store_variants\` (\`tenant_id\`);`)
  await db.run(sql`CREATE INDEX \`store_variants_updated_at_idx\` ON \`store_variants\` (\`updated_at\`);`)
  // Plan §3.4 raw unique index: (tenant_id, sku) for non-null variant SKUs — variant SKU is the
  // immutable inventory key, unique per tenant.
  await db.run(sql`CREATE UNIQUE INDEX \`store_variants_tenant_sku_uniq\` ON \`store_variants\` (\`tenant_id\`, \`sku\`) WHERE \`sku\` IS NOT NULL;`)

  await db.run(sql`CREATE TABLE \`store_variants_rels\` (
  	\`id\` integer PRIMARY KEY NOT NULL,
  	\`order\` integer,
  	\`parent_id\` integer NOT NULL,
  	\`path\` text NOT NULL,
  	\`store_variant_options_id\` integer,
  	\`media_id\` integer,
  	FOREIGN KEY (\`parent_id\`) REFERENCES \`store_variants\`(\`id\`) ON UPDATE no action ON DELETE cascade,
  	FOREIGN KEY (\`store_variant_options_id\`) REFERENCES \`store_variant_options\`(\`id\`) ON UPDATE no action ON DELETE cascade,
  	FOREIGN KEY (\`media_id\`) REFERENCES \`media\`(\`id\`) ON UPDATE no action ON DELETE cascade
  );
  `)
  await db.run(sql`CREATE INDEX \`store_variants_rels_media_id_idx\` ON \`store_variants_rels\` (\`media_id\`);`)
  await db.run(sql`CREATE INDEX \`store_variants_rels_order_idx\` ON \`store_variants_rels\` (\`order\`);`)
  await db.run(sql`CREATE INDEX \`store_variants_rels_parent_idx\` ON \`store_variants_rels\` (\`parent_id\`);`)
  await db.run(sql`CREATE INDEX \`store_variants_rels_path_idx\` ON \`store_variants_rels\` (\`path\`);`)
  await db.run(sql`CREATE INDEX \`store_variants_rels_store_variant_options_id_idx\` ON \`store_variants_rels\` (\`store_variant_options_id\`);`)

  // Versions table for store_variants (plugin sets versions.drafts.autosave=true on variants).
  await db.run(sql`CREATE TABLE \`_store_variants_v\` (
  	\`id\` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  	\`parent_id\` integer,
  	\`version_tenant_id\` integer,
  	\`version_title\` text,
  	\`version_product_id\` integer,
  	\`version_price_in_e_g_p_enabled\` integer,
  	\`version_price_in_e_g_p\` numeric,
  	\`version_sku\` text,
  	\`version_legacy_variant_key\` text,
  	\`version_updated_at\` text,
  	\`version_created_at\` text,
  	\`version_deleted_at\` text,
  	\`version__status\` text DEFAULT 'draft',
  	\`created_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  	\`updated_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  	\`snapshot\` integer,
  	\`published_locale\` text,
  	\`latest\` integer,
  	\`autosave\` integer,
  	FOREIGN KEY (\`parent_id\`) REFERENCES \`store_variants\`(\`id\`) ON UPDATE no action ON DELETE set null,
  	FOREIGN KEY (\`version_tenant_id\`) REFERENCES \`tenants\`(\`id\`) ON UPDATE no action ON DELETE set null,
  	FOREIGN KEY (\`version_product_id\`) REFERENCES \`store_products\`(\`id\`) ON UPDATE no action ON DELETE set null
  );
  `)
  await db.run(sql`CREATE INDEX \`_store_variants_v_autosave_idx\` ON \`_store_variants_v\` (\`autosave\`);`)
  await db.run(sql`CREATE INDEX \`_store_variants_v_created_at_idx\` ON \`_store_variants_v\` (\`created_at\`);`)
  await db.run(sql`CREATE INDEX \`_store_variants_v_latest_idx\` ON \`_store_variants_v\` (\`latest\`);`)
  await db.run(sql`CREATE INDEX \`_store_variants_v_parent_idx\` ON \`_store_variants_v\` (\`parent_id\`);`)
  await db.run(sql`CREATE INDEX \`_store_variants_v_published_locale_idx\` ON \`_store_variants_v\` (\`published_locale\`);`)
  await db.run(sql`CREATE INDEX \`_store_variants_v_snapshot_idx\` ON \`_store_variants_v\` (\`snapshot\`);`)
  await db.run(sql`CREATE INDEX \`_store_variants_v_updated_at_idx\` ON \`_store_variants_v\` (\`updated_at\`);`)
  await db.run(sql`CREATE INDEX \`_store_variants_v_version_version__status_idx\` ON \`_store_variants_v\` (\`version__status\`);`)
  await db.run(sql`CREATE INDEX \`_store_variants_v_version_version_created_at_idx\` ON \`_store_variants_v\` (\`version_created_at\`);`)
  await db.run(sql`CREATE INDEX \`_store_variants_v_version_version_deleted_at_idx\` ON \`_store_variants_v\` (\`version_deleted_at\`);`)
  await db.run(sql`CREATE INDEX \`_store_variants_v_version_version_legacy_variant_key_idx\` ON \`_store_variants_v\` (\`version_legacy_variant_key\`);`)
  await db.run(sql`CREATE INDEX \`_store_variants_v_version_version_product_idx\` ON \`_store_variants_v\` (\`version_product_id\`);`)
  await db.run(sql`CREATE INDEX \`_store_variants_v_version_version_sku_idx\` ON \`_store_variants_v\` (\`version_sku\`);`)
  await db.run(sql`CREATE INDEX \`_store_variants_v_version_version_tenant_idx\` ON \`_store_variants_v\` (\`version_tenant_id\`);`)
  await db.run(sql`CREATE INDEX \`_store_variants_v_version_version_updated_at_idx\` ON \`_store_variants_v\` (\`version_updated_at\`);`)

  await db.run(sql`CREATE TABLE \`_store_variants_v_rels\` (
  	\`id\` integer PRIMARY KEY NOT NULL,
  	\`order\` integer,
  	\`parent_id\` integer NOT NULL,
  	\`path\` text NOT NULL,
  	\`store_variant_options_id\` integer,
  	\`media_id\` integer,
  	FOREIGN KEY (\`parent_id\`) REFERENCES \`_store_variants_v\`(\`id\`) ON UPDATE no action ON DELETE cascade,
  	FOREIGN KEY (\`store_variant_options_id\`) REFERENCES \`store_variant_options\`(\`id\`) ON UPDATE no action ON DELETE cascade,
  	FOREIGN KEY (\`media_id\`) REFERENCES \`media\`(\`id\`) ON UPDATE no action ON DELETE cascade
  );
  `)
  await db.run(sql`CREATE INDEX \`_store_variants_v_rels_media_id_idx\` ON \`_store_variants_v_rels\` (\`media_id\`);`)
  await db.run(sql`CREATE INDEX \`_store_variants_v_rels_order_idx\` ON \`_store_variants_v_rels\` (\`order\`);`)
  await db.run(sql`CREATE INDEX \`_store_variants_v_rels_parent_idx\` ON \`_store_variants_v_rels\` (\`parent_id\`);`)
  await db.run(sql`CREATE INDEX \`_store_variants_v_rels_path_idx\` ON \`_store_variants_v_rels\` (\`path\`);`)
  await db.run(sql`CREATE INDEX \`_store_variants_v_rels_store_variant_options_id_idx\` ON \`_store_variants_v_rels\` (\`store_variant_options_id\`);`)

  // ============================================================================
  // store-addresses (plugin default, re-slugged)
  // ============================================================================
  await db.run(sql`CREATE TABLE \`store_addresses\` (
  	\`id\` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  	\`tenant_id\` integer,
  	\`customer_id\` integer,
  	\`title\` text,
  	\`first_name\` text,
  	\`last_name\` text,
  	\`company\` text,
  	\`address_line1\` text,
  	\`address_line2\` text,
  	\`city\` text,
  	\`state\` text,
  	\`postal_code\` text,
  	\`country\` text DEFAULT 'EG' NOT NULL,
  	\`phone\` text,
  	\`updated_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  	\`created_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  	FOREIGN KEY (\`tenant_id\`) REFERENCES \`tenants\`(\`id\`) ON UPDATE no action ON DELETE set null,
  	FOREIGN KEY (\`customer_id\`) REFERENCES \`customers\`(\`id\`) ON UPDATE no action ON DELETE set null
  );
  `)
  await db.run(sql`CREATE INDEX \`store_addresses_created_at_idx\` ON \`store_addresses\` (\`created_at\`);`)
  await db.run(sql`CREATE INDEX \`store_addresses_customer_idx\` ON \`store_addresses\` (\`customer_id\`);`)
  await db.run(sql`CREATE INDEX \`store_addresses_tenant_idx\` ON \`store_addresses\` (\`tenant_id\`);`)
  await db.run(sql`CREATE INDEX \`store_addresses_updated_at_idx\` ON \`store_addresses\` (\`updated_at\`);`)

  // ============================================================================
  // store-carts (plugin default + B1 extension fields; HTTP endpoints removed by B1 override)
  // ============================================================================
  await db.run(sql`CREATE TABLE \`store_carts\` (
  	\`id\` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  	\`tenant_id\` integer,
  	\`secret\` text,
  	\`customer_id\` integer,
  	\`purchased_at\` text,
  	\`subtotal\` numeric,
  	\`currency\` text DEFAULT 'EGP',
  	\`gift_card_token_hash\` text,
  	\`quote_version\` numeric DEFAULT 1,
  	\`updated_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  	\`created_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  	FOREIGN KEY (\`tenant_id\`) REFERENCES \`tenants\`(\`id\`) ON UPDATE no action ON DELETE set null,
  	FOREIGN KEY (\`customer_id\`) REFERENCES \`customers\`(\`id\`) ON UPDATE no action ON DELETE set null
  );
  `)
  await db.run(sql`CREATE INDEX \`store_carts_created_at_idx\` ON \`store_carts\` (\`created_at\`);`)
  await db.run(sql`CREATE INDEX \`store_carts_customer_idx\` ON \`store_carts\` (\`customer_id\`);`)
  await db.run(sql`CREATE INDEX \`store_carts_secret_idx\` ON \`store_carts\` (\`secret\`);`)
  await db.run(sql`CREATE INDEX \`store_carts_tenant_idx\` ON \`store_carts\` (\`tenant_id\`);`)
  await db.run(sql`CREATE INDEX \`store_carts_updated_at_idx\` ON \`store_carts\` (\`updated_at\`);`)

  // Cart items array (plugin default; keyed by _parent_id + _order, id is the plugin-generated
  // nanoid for the array row). product/variant are nullable single-relationship columns.
  await db.run(sql`CREATE TABLE \`store_carts_items\` (
  	\`_order\` integer NOT NULL,
  	\`_parent_id\` integer NOT NULL,
  	\`id\` text PRIMARY KEY NOT NULL,
  	\`product_id\` integer,
  	\`variant_id\` integer,
  	\`quantity\` numeric DEFAULT 1 NOT NULL,
  	FOREIGN KEY (\`product_id\`) REFERENCES \`store_products\`(\`id\`) ON UPDATE no action ON DELETE set null,
  	FOREIGN KEY (\`variant_id\`) REFERENCES \`store_variants\`(\`id\`) ON UPDATE no action ON DELETE set null,
  	FOREIGN KEY (\`_parent_id\`) REFERENCES \`store_carts\`(\`id\`) ON UPDATE no action ON DELETE cascade
  );
  `)
  await db.run(sql`CREATE INDEX \`store_carts_items_order_idx\` ON \`store_carts_items\` (\`_order\`);`)
  await db.run(sql`CREATE INDEX \`store_carts_items_parent_id_idx\` ON \`store_carts_items\` (\`_parent_id\`);`)
  await db.run(sql`CREATE INDEX \`store_carts_items_product_idx\` ON \`store_carts_items\` (\`product_id\`);`)
  await db.run(sql`CREATE INDEX \`store_carts_items_variant_idx\` ON \`store_carts_items\` (\`variant_id\`);`)

  // Cart promotion codes array (B1 extension). One row per applied code; maxRows=10 enforced at
  // the field level. `_parent_id` cascades with the parent cart.
  await db.run(sql`CREATE TABLE \`store_carts_promotion_codes\` (
  	\`_order\` integer NOT NULL,
  	\`_parent_id\` integer NOT NULL,
  	\`id\` text PRIMARY KEY NOT NULL,
  	\`code\` text NOT NULL,
  	FOREIGN KEY (\`_parent_id\`) REFERENCES \`store_carts\`(\`id\`) ON UPDATE no action ON DELETE cascade
  );
  `)
  await db.run(sql`CREATE INDEX \`store_carts_promotion_codes_order_idx\` ON \`store_carts_promotion_codes\` (\`_order\`);`)
  await db.run(sql`CREATE INDEX \`store_carts_promotion_codes_parent_id_idx\` ON \`store_carts_promotion_codes\` (\`_parent_id\`);`)

  // ============================================================================
  // store-orders (plugin default + B1 extension fields)
  // ============================================================================
  await db.run(sql`CREATE TABLE \`store_orders\` (
  	\`id\` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  	\`tenant_id\` integer,
  	\`shipping_address_title\` text,
  	\`shipping_address_first_name\` text,
  	\`shipping_address_last_name\` text,
  	\`shipping_address_company\` text,
  	\`shipping_address_address_line1\` text,
  	\`shipping_address_address_line2\` text,
  	\`shipping_address_city\` text,
  	\`shipping_address_state\` text,
  	\`shipping_address_postal_code\` text,
  	\`shipping_address_country\` text,
  	\`shipping_address_phone\` text,
  	\`customer_id\` integer,
  	\`customer_email\` text,
  	\`status\` text DEFAULT 'processing',
  	\`amount\` numeric,
  	\`currency\` text DEFAULT 'EGP',
  	\`order_number\` text NOT NULL,
  	\`checkout_key\` text,
  	\`checkout_fingerprint\` text,
  	\`payment_state\` text DEFAULT 'pending',
  	\`fulfillment_state\` text DEFAULT 'unfulfilled',
  	\`customer_phone\` text,
  	\`subtotal\` numeric,
  	\`total_discount\` numeric DEFAULT 0,
  	\`shipping_price\` numeric DEFAULT 0,
  	\`total_tax\` numeric DEFAULT 0,
  	\`gift_card_applied\` numeric DEFAULT 0,
  	\`amount_due\` numeric,
  	\`quote_hash\` text,
  	\`quote_snapshot\` text,
  	\`billing_address_id\` integer,
  	\`placed_at\` text,
  	\`expires_at\` text,
  	\`provider_reference\` text,
  	\`legacy_order_id\` numeric,
  	\`updated_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  	\`created_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  	FOREIGN KEY (\`tenant_id\`) REFERENCES \`tenants\`(\`id\`) ON UPDATE no action ON DELETE set null,
  	FOREIGN KEY (\`customer_id\`) REFERENCES \`customers\`(\`id\`) ON UPDATE no action ON DELETE set null,
  	FOREIGN KEY (\`billing_address_id\`) REFERENCES \`store_addresses\`(\`id\`) ON UPDATE no action ON DELETE set null
  );
  `)
  await db.run(sql`CREATE INDEX \`store_orders_billing_address_idx\` ON \`store_orders\` (\`billing_address_id\`);`)
  await db.run(sql`CREATE INDEX \`store_orders_checkout_key_idx\` ON \`store_orders\` (\`checkout_key\`);`)
  await db.run(sql`CREATE INDEX \`store_orders_created_at_idx\` ON \`store_orders\` (\`created_at\`);`)
  await db.run(sql`CREATE INDEX \`store_orders_customer_idx\` ON \`store_orders\` (\`customer_id\`);`)
  await db.run(sql`CREATE INDEX \`store_orders_legacy_order_id_idx\` ON \`store_orders\` (\`legacy_order_id\`);`)
  await db.run(sql`CREATE INDEX \`store_orders_order_number_idx\` ON \`store_orders\` (\`order_number\`);`)
  await db.run(sql`CREATE INDEX \`store_orders_provider_reference_idx\` ON \`store_orders\` (\`provider_reference\`);`)
  await db.run(sql`CREATE INDEX \`store_orders_tenant_idx\` ON \`store_orders\` (\`tenant_id\`);`)
  await db.run(sql`CREATE INDEX \`store_orders_updated_at_idx\` ON \`store_orders\` (\`updated_at\`);`)
  // Plan §3.8: unique (tenant_id, order_number) and partial unique (tenant_id, checkout_key) WHERE
  // checkout_key IS NOT NULL. Idempotent checkout requires checkout_key uniqueness among in-flight
  // checkouts; null checkout_key (drafts) must not collide.
  await db.run(sql`CREATE UNIQUE INDEX \`store_orders_tenant_order_number_uniq\` ON \`store_orders\` (\`tenant_id\`, \`order_number\`);`)
  await db.run(sql`CREATE UNIQUE INDEX \`store_orders_tenant_checkout_key_uniq\` ON \`store_orders\` (\`tenant_id\`, \`checkout_key\`) WHERE \`checkout_key\` IS NOT NULL;`)

  // Order items array.
  await db.run(sql`CREATE TABLE \`store_orders_items\` (
  	\`_order\` integer NOT NULL,
  	\`_parent_id\` integer NOT NULL,
  	\`id\` text PRIMARY KEY NOT NULL,
  	\`product_id\` integer,
  	\`variant_id\` integer,
  	\`quantity\` numeric DEFAULT 1 NOT NULL,
  	FOREIGN KEY (\`product_id\`) REFERENCES \`store_products\`(\`id\`) ON UPDATE no action ON DELETE set null,
  	FOREIGN KEY (\`variant_id\`) REFERENCES \`store_variants\`(\`id\`) ON UPDATE no action ON DELETE set null,
  	FOREIGN KEY (\`_parent_id\`) REFERENCES \`store_orders\`(\`id\`) ON UPDATE no action ON DELETE cascade
  );
  `)
  await db.run(sql`CREATE INDEX \`store_orders_items_order_idx\` ON \`store_orders_items\` (\`_order\`);`)
  await db.run(sql`CREATE INDEX \`store_orders_items_parent_id_idx\` ON \`store_orders_items\` (\`_parent_id\`);`)
  await db.run(sql`CREATE INDEX \`store_orders_items_product_idx\` ON \`store_orders_items\` (\`product_id\`);`)
  await db.run(sql`CREATE INDEX \`store_orders_items_variant_idx\` ON \`store_orders_items\` (\`variant_id\`);`)

  // store_orders_rels: the plugin's orders.transactions relationship field. slugMap rewires the
  // transactions collection slug, but the plugin's `transactions` field on orders keeps its
  // default `transactions_id` column name (verified via the schema probe). The FK target matches
  // what the plugin emits — the legacy `transactions` table. (At fan-in the integration owner
  // decides whether to repoint this; for C1 we mirror what pushDevSchema emits.)
  await db.run(sql`CREATE TABLE \`store_orders_rels\` (
  	\`id\` integer PRIMARY KEY NOT NULL,
  	\`order\` integer,
  	\`parent_id\` integer NOT NULL,
  	\`path\` text NOT NULL,
  	\`transactions_id\` integer,
  	FOREIGN KEY (\`parent_id\`) REFERENCES \`store_orders\`(\`id\`) ON UPDATE no action ON DELETE cascade,
  	FOREIGN KEY (\`transactions_id\`) REFERENCES \`transactions\`(\`id\`) ON UPDATE no action ON DELETE cascade
  );
  `)
  await db.run(sql`CREATE INDEX \`store_orders_rels_order_idx\` ON \`store_orders_rels\` (\`order\`);`)
  await db.run(sql`CREATE INDEX \`store_orders_rels_parent_idx\` ON \`store_orders_rels\` (\`parent_id\`);`)
  await db.run(sql`CREATE INDEX \`store_orders_rels_path_idx\` ON \`store_orders_rels\` (\`path\`);`)
  await db.run(sql`CREATE INDEX \`store_orders_rels_transactions_id_idx\` ON \`store_orders_rels\` (\`transactions_id\`);`)

  // ============================================================================
  // store-transactions (plugin default + B1 extension fields)
  // ============================================================================
  await db.run(sql`CREATE TABLE \`store_transactions\` (
  	\`id\` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  	\`tenant_id\` integer,
  	\`billing_address_title\` text,
  	\`billing_address_first_name\` text,
  	\`billing_address_last_name\` text,
  	\`billing_address_company\` text,
  	\`billing_address_address_line1\` text,
  	\`billing_address_address_line2\` text,
  	\`billing_address_city\` text,
  	\`billing_address_state\` text,
  	\`billing_address_postal_code\` text,
  	\`billing_address_country\` text,
  	\`billing_address_phone\` text,
  	\`status\` text DEFAULT 'pending' NOT NULL,
  	\`customer_id\` integer,
  	\`customer_email\` text,
  	\`order_id\` integer,
  	\`cart_id\` integer,
  	\`amount\` numeric,
  	\`currency\` text DEFAULT 'EGP',
  	\`provider_transaction_id\` text,
  	\`provider_order_reference\` text,
  	\`captured_amount\` numeric DEFAULT 0,
  	\`refunded_amount\` numeric DEFAULT 0,
  	\`last_provider_status\` text,
  	\`last_provider_event_timestamp\` text,
  	\`reconciliation_status\` text DEFAULT 'pending',
  	\`raw_payload_hash\` text,
  	\`legacy_transaction_id\` numeric,
  	\`updated_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  	\`created_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  	FOREIGN KEY (\`tenant_id\`) REFERENCES \`tenants\`(\`id\`) ON UPDATE no action ON DELETE set null,
  	FOREIGN KEY (\`customer_id\`) REFERENCES \`customers\`(\`id\`) ON UPDATE no action ON DELETE set null,
  	FOREIGN KEY (\`order_id\`) REFERENCES \`store_orders\`(\`id\`) ON UPDATE no action ON DELETE set null,
  	FOREIGN KEY (\`cart_id\`) REFERENCES \`store_carts\`(\`id\`) ON UPDATE no action ON DELETE set null
  );
  `)
  await db.run(sql`CREATE INDEX \`store_transactions_cart_idx\` ON \`store_transactions\` (\`cart_id\`);`)
  await db.run(sql`CREATE INDEX \`store_transactions_created_at_idx\` ON \`store_transactions\` (\`created_at\`);`)
  await db.run(sql`CREATE INDEX \`store_transactions_customer_idx\` ON \`store_transactions\` (\`customer_id\`);`)
  await db.run(sql`CREATE INDEX \`store_transactions_legacy_transaction_id_idx\` ON \`store_transactions\` (\`legacy_transaction_id\`);`)
  await db.run(sql`CREATE INDEX \`store_transactions_order_idx\` ON \`store_transactions\` (\`order_id\`);`)
  await db.run(sql`CREATE INDEX \`store_transactions_provider_order_reference_idx\` ON \`store_transactions\` (\`provider_order_reference\`);`)
  await db.run(sql`CREATE INDEX \`store_transactions_provider_transaction_id_idx\` ON \`store_transactions\` (\`provider_transaction_id\`);`)
  await db.run(sql`CREATE INDEX \`store_transactions_tenant_idx\` ON \`store_transactions\` (\`tenant_id\`);`)
  await db.run(sql`CREATE INDEX \`store_transactions_updated_at_idx\` ON \`store_transactions\` (\`updated_at\`);`)

  // Transaction items array.
  await db.run(sql`CREATE TABLE \`store_transactions_items\` (
  	\`_order\` integer NOT NULL,
  	\`_parent_id\` integer NOT NULL,
  	\`id\` text PRIMARY KEY NOT NULL,
  	\`product_id\` integer,
  	\`variant_id\` integer,
  	\`quantity\` numeric DEFAULT 1 NOT NULL,
  	FOREIGN KEY (\`product_id\`) REFERENCES \`store_products\`(\`id\`) ON UPDATE no action ON DELETE set null,
  	FOREIGN KEY (\`variant_id\`) REFERENCES \`store_variants\`(\`id\`) ON UPDATE no action ON DELETE set null,
  	FOREIGN KEY (\`_parent_id\`) REFERENCES \`store_transactions\`(\`id\`) ON UPDATE no action ON DELETE cascade
  );
  `)
  await db.run(sql`CREATE INDEX \`store_transactions_items_order_idx\` ON \`store_transactions_items\` (\`_order\`);`)
  await db.run(sql`CREATE INDEX \`store_transactions_items_parent_id_idx\` ON \`store_transactions_items\` (\`_parent_id\`);`)
  await db.run(sql`CREATE INDEX \`store_transactions_items_product_idx\` ON \`store_transactions_items\` (\`product_id\`);`)
  await db.run(sql`CREATE INDEX \`store_transactions_items_variant_idx\` ON \`store_transactions_items\` (\`variant_id\`);`)

  // ============================================================================
  // Policy tables (Plan §3.10 — field-for-field match to the C4 collection configs in
  // cms/src/commerce/policies/collections/*.ts). All money = integer minor units; rates = integer
  // basis points. Group fields flatten into the parent table as `<group>_<subfield>` (per the
  // repo convention established in commerce_settings, see migration 20260717_100100).
  // ============================================================================

  // --- tax_zones (Plan §3.10) ---
  // Columns derived from TaxZones.ts: code, name{en,ar}, country, priority, enabled + the
  // `regions` and `postalPrefixes` array child tables.
  await db.run(sql`CREATE TABLE \`tax_zones\` (
  	\`id\` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  	\`tenant_id\` integer REFERENCES \`tenants\`(\`id\`),
  	\`code\` text NOT NULL,
  	\`name_en\` text NOT NULL,
  	\`name_ar\` text NOT NULL,
  	\`country\` text,
  	\`priority\` numeric DEFAULT 0,
  	\`enabled\` numeric DEFAULT 1,
  	\`updated_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  	\`created_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
  );
  `)
  await db.run(sql`CREATE UNIQUE INDEX \`tax_zones_tenant_code_uniq\` ON \`tax_zones\` (\`tenant_id\`, \`code\`);`)
  await db.run(sql`CREATE INDEX \`tax_zones_tenant_idx\` ON \`tax_zones\` (\`tenant_id\`);`)
  await db.run(sql`CREATE INDEX \`tax_zones_code_idx\` ON \`tax_zones\` (\`code\`);`)
  await db.run(sql`CREATE INDEX \`tax_zones_country_idx\` ON \`tax_zones\` (\`country\`);`)
  await db.run(sql`CREATE INDEX \`tax_zones_priority_idx\` ON \`tax_zones\` (\`priority\`);`)
  await db.run(sql`CREATE INDEX \`tax_zones_enabled_idx\` ON \`tax_zones\` (\`enabled\`);`)
  await db.run(sql`CREATE INDEX \`tax_zones_updated_at_idx\` ON \`tax_zones\` (\`updated_at\`);`)
  await db.run(sql`CREATE INDEX \`tax_zones_created_at_idx\` ON \`tax_zones\` (\`created_at\`);`)

  // tax_zones_regions array child table.
  await db.run(sql`CREATE TABLE \`tax_zones_regions\` (
  	\`_order\` integer NOT NULL,
  	\`_parent_id\` integer NOT NULL,
  	\`id\` text PRIMARY KEY NOT NULL,
  	\`code\` text NOT NULL,
  	FOREIGN KEY (\`_parent_id\`) REFERENCES \`tax_zones\`(\`id\`) ON UPDATE no action ON DELETE cascade
  );
  `)
  await db.run(sql`CREATE INDEX \`tax_zones_regions_order_idx\` ON \`tax_zones_regions\` (\`_order\`);`)
  await db.run(sql`CREATE INDEX \`tax_zones_regions_parent_id_idx\` ON \`tax_zones_regions\` (\`_parent_id\`);`)

  // tax_zones_postal_prefixes array child table.
  await db.run(sql`CREATE TABLE \`tax_zones_postal_prefixes\` (
  	\`_order\` integer NOT NULL,
  	\`_parent_id\` integer NOT NULL,
  	\`id\` text PRIMARY KEY NOT NULL,
  	\`prefix\` text NOT NULL,
  	FOREIGN KEY (\`_parent_id\`) REFERENCES \`tax_zones\`(\`id\`) ON UPDATE no action ON DELETE cascade
  );
  `)
  await db.run(sql`CREATE INDEX \`tax_zones_postal_prefixes_order_idx\` ON \`tax_zones_postal_prefixes\` (\`_order\`);`)
  await db.run(sql`CREATE INDEX \`tax_zones_postal_prefixes_parent_id_idx\` ON \`tax_zones_postal_prefixes\` (\`_parent_id\`);`)

  // --- tax_rates (Plan §3.10) ---
  // Interval-overlap cannot be expressed as a SQLite unique index; the rejectOverlappingRates
  // beforeChange hook in TaxRates.ts enforces it. Here we provide the resolution index the
  // resolver uses at quote time.
  await db.run(sql`CREATE TABLE \`tax_rates\` (
  	\`id\` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  	\`tenant_id\` integer REFERENCES \`tenants\`(\`id\`),
  	\`zone_id\` integer REFERENCES \`tax_zones\`(\`id\`),
  	\`tax_class\` text NOT NULL DEFAULT 'standard',
  	\`rate_bps\` numeric NOT NULL,
  	\`prices_include_tax\` numeric DEFAULT 0,
  	\`effective_from\` text NOT NULL,
  	\`effective_to\` text,
  	\`enabled\` numeric DEFAULT 1,
  	\`updated_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  	\`created_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
  );
  `)
  await db.run(sql`CREATE INDEX \`tax_rates_tenant_zone_class_enabled_idx\` ON \`tax_rates\` (\`tenant_id\`, \`zone_id\`, \`tax_class\`, \`enabled\`);`)
  await db.run(sql`CREATE INDEX \`tax_rates_tenant_idx\` ON \`tax_rates\` (\`tenant_id\`);`)
  await db.run(sql`CREATE INDEX \`tax_rates_zone_idx\` ON \`tax_rates\` (\`zone_id\`);`)
  await db.run(sql`CREATE INDEX \`tax_rates_tax_class_idx\` ON \`tax_rates\` (\`tax_class\`);`)
  await db.run(sql`CREATE INDEX \`tax_rates_enabled_idx\` ON \`tax_rates\` (\`enabled\`);`)
  await db.run(sql`CREATE INDEX \`tax_rates_effective_from_idx\` ON \`tax_rates\` (\`effective_from\`);`)
  await db.run(sql`CREATE INDEX \`tax_rates_effective_to_idx\` ON \`tax_rates\` (\`effective_to\`);`)
  await db.run(sql`CREATE INDEX \`tax_rates_updated_at_idx\` ON \`tax_rates\` (\`updated_at\`);`)
  await db.run(sql`CREATE INDEX \`tax_rates_created_at_idx\` ON \`tax_rates\` (\`created_at\`);`)

  // --- shipping_zones (Plan §3.10) — same shape as tax_zones ---
  await db.run(sql`CREATE TABLE \`shipping_zones\` (
  	\`id\` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  	\`tenant_id\` integer REFERENCES \`tenants\`(\`id\`),
  	\`code\` text NOT NULL,
  	\`name_en\` text NOT NULL,
  	\`name_ar\` text NOT NULL,
  	\`country\` text,
  	\`priority\` numeric DEFAULT 0,
  	\`enabled\` numeric DEFAULT 1,
  	\`updated_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  	\`created_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
  );
  `)
  await db.run(sql`CREATE UNIQUE INDEX \`shipping_zones_tenant_code_uniq\` ON \`shipping_zones\` (\`tenant_id\`, \`code\`);`)
  await db.run(sql`CREATE INDEX \`shipping_zones_tenant_idx\` ON \`shipping_zones\` (\`tenant_id\`);`)
  await db.run(sql`CREATE INDEX \`shipping_zones_code_idx\` ON \`shipping_zones\` (\`code\`);`)
  await db.run(sql`CREATE INDEX \`shipping_zones_country_idx\` ON \`shipping_zones\` (\`country\`);`)
  await db.run(sql`CREATE INDEX \`shipping_zones_priority_idx\` ON \`shipping_zones\` (\`priority\`);`)
  await db.run(sql`CREATE INDEX \`shipping_zones_enabled_idx\` ON \`shipping_zones\` (\`enabled\`);`)
  await db.run(sql`CREATE INDEX \`shipping_zones_updated_at_idx\` ON \`shipping_zones\` (\`updated_at\`);`)
  await db.run(sql`CREATE INDEX \`shipping_zones_created_at_idx\` ON \`shipping_zones\` (\`created_at\`);`)

  await db.run(sql`CREATE TABLE \`shipping_zones_regions\` (
  	\`_order\` integer NOT NULL,
  	\`_parent_id\` integer NOT NULL,
  	\`id\` text PRIMARY KEY NOT NULL,
  	\`code\` text NOT NULL,
  	FOREIGN KEY (\`_parent_id\`) REFERENCES \`shipping_zones\`(\`id\`) ON UPDATE no action ON DELETE cascade
  );
  `)
  await db.run(sql`CREATE INDEX \`shipping_zones_regions_order_idx\` ON \`shipping_zones_regions\` (\`_order\`);`)
  await db.run(sql`CREATE INDEX \`shipping_zones_regions_parent_id_idx\` ON \`shipping_zones_regions\` (\`_parent_id\`);`)

  await db.run(sql`CREATE TABLE \`shipping_zones_postal_prefixes\` (
  	\`_order\` integer NOT NULL,
  	\`_parent_id\` integer NOT NULL,
  	\`id\` text PRIMARY KEY NOT NULL,
  	\`prefix\` text NOT NULL,
  	FOREIGN KEY (\`_parent_id\`) REFERENCES \`shipping_zones\`(\`id\`) ON UPDATE no action ON DELETE cascade
  );
  `)
  await db.run(sql`CREATE INDEX \`shipping_zones_postal_prefixes_order_idx\` ON \`shipping_zones_postal_prefixes\` (\`_order\`);`)
  await db.run(sql`CREATE INDEX \`shipping_zones_postal_prefixes_parent_id_idx\` ON \`shipping_zones_postal_prefixes\` (\`_parent_id\`);`)

  // --- shipping_methods (Plan §3.10) ---
  await db.run(sql`CREATE TABLE \`shipping_methods\` (
  	\`id\` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  	\`tenant_id\` integer REFERENCES \`tenants\`(\`id\`),
  	\`zone_id\` integer REFERENCES \`shipping_zones\`(\`id\`),
  	\`code\` text NOT NULL,
  	\`name_en\` text NOT NULL,
  	\`name_ar\` text NOT NULL,
  	\`base_price\` numeric NOT NULL,
  	\`free_above_subtotal\` numeric NOT NULL DEFAULT 0,
  	\`minimum_subtotal\` numeric,
  	\`maximum_subtotal\` numeric,
  	\`enabled\` numeric DEFAULT 1,
  	\`updated_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  	\`created_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
  );
  `)
  await db.run(sql`CREATE UNIQUE INDEX \`shipping_methods_tenant_code_uniq\` ON \`shipping_methods\` (\`tenant_id\`, \`code\`);`)
  await db.run(sql`CREATE INDEX \`shipping_methods_tenant_zone_enabled_idx\` ON \`shipping_methods\` (\`tenant_id\`, \`zone_id\`, \`enabled\`);`)
  await db.run(sql`CREATE INDEX \`shipping_methods_tenant_idx\` ON \`shipping_methods\` (\`tenant_id\`);`)
  await db.run(sql`CREATE INDEX \`shipping_methods_zone_idx\` ON \`shipping_methods\` (\`zone_id\`);`)
  await db.run(sql`CREATE INDEX \`shipping_methods_enabled_idx\` ON \`shipping_methods\` (\`enabled\`);`)
  await db.run(sql`CREATE INDEX \`shipping_methods_updated_at_idx\` ON \`shipping_methods\` (\`updated_at\`);`)
  await db.run(sql`CREATE INDEX \`shipping_methods_created_at_idx\` ON \`shipping_methods\` (\`created_at\`);`)

  // --- promotions (Plan §3.10) ---
  // `eligibleProducts` and `eligibleVariants` are hasMany relationships → `promotions_rels` table.
  await db.run(sql`CREATE TABLE \`promotions\` (
  	\`id\` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  	\`tenant_id\` integer REFERENCES \`tenants\`(\`id\`),
  	\`code\` text NOT NULL,
  	\`type\` text NOT NULL,
  	\`value\` numeric NOT NULL,
  	\`minimum_subtotal\` numeric NOT NULL DEFAULT 0,
  	\`maximum_discount\` numeric,
  	\`starts_at\` text NOT NULL,
  	\`ends_at\` text,
  	\`total_usage_limit\` numeric,
  	\`per_customer_limit\` numeric,
  	\`exclusive\` numeric DEFAULT 0,
  	\`enabled\` numeric DEFAULT 1,
  	\`updated_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  	\`created_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
  );
  `)
  await db.run(sql`CREATE UNIQUE INDEX \`promotions_tenant_code_uniq\` ON \`promotions\` (\`tenant_id\`, \`code\`);`)
  await db.run(sql`CREATE INDEX \`promotions_tenant_idx\` ON \`promotions\` (\`tenant_id\`);`)
  await db.run(sql`CREATE INDEX \`promotions_code_idx\` ON \`promotions\` (\`code\`);`)
  await db.run(sql`CREATE INDEX \`promotions_type_idx\` ON \`promotions\` (\`type\`);`)
  await db.run(sql`CREATE INDEX \`promotions_enabled_idx\` ON \`promotions\` (\`enabled\`);`)
  await db.run(sql`CREATE INDEX \`promotions_exclusive_idx\` ON \`promotions\` (\`exclusive\`);`)
  await db.run(sql`CREATE INDEX \`promotions_starts_at_idx\` ON \`promotions\` (\`starts_at\`);`)
  await db.run(sql`CREATE INDEX \`promotions_ends_at_idx\` ON \`promotions\` (\`ends_at\`);`)
  await db.run(sql`CREATE INDEX \`promotions_updated_at_idx\` ON \`promotions\` (\`updated_at\`);`)
  await db.run(sql`CREATE INDEX \`promotions_created_at_idx\` ON \`promotions\` (\`created_at\`);`)

  // promotions_rels: holds the eligibleProducts / eligibleVariants hasMany relationships.
  // Column-naming follows the plugin convention: `<target_slug_as_snake>_id`.
  await db.run(sql`CREATE TABLE \`promotions_rels\` (
  	\`id\` integer PRIMARY KEY NOT NULL,
  	\`order\` integer,
  	\`parent_id\` integer NOT NULL,
  	\`path\` text NOT NULL,
  	\`store_products_id\` integer,
  	\`store_variants_id\` integer,
  	FOREIGN KEY (\`parent_id\`) REFERENCES \`promotions\`(\`id\`) ON UPDATE no action ON DELETE cascade,
  	FOREIGN KEY (\`store_products_id\`) REFERENCES \`store_products\`(\`id\`) ON UPDATE no action ON DELETE cascade,
  	FOREIGN KEY (\`store_variants_id\`) REFERENCES \`store_variants\`(\`id\`) ON UPDATE no action ON DELETE cascade
  );
  `)
  await db.run(sql`CREATE INDEX \`promotions_rels_order_idx\` ON \`promotions_rels\` (\`order\`);`)
  await db.run(sql`CREATE INDEX \`promotions_rels_parent_idx\` ON \`promotions_rels\` (\`parent_id\`);`)
  await db.run(sql`CREATE INDEX \`promotions_rels_path_idx\` ON \`promotions_rels\` (\`path\`);`)
  await db.run(sql`CREATE INDEX \`promotions_rels_store_products_id_idx\` ON \`promotions_rels\` (\`store_products_id\`);`)
  await db.run(sql`CREATE INDEX \`promotions_rels_store_variants_id_idx\` ON \`promotions_rels\` (\`store_variants_id\`);`)

  // --- promotion_redemptions (Plan §3.10) ---
  // Uniqueness on (promotion_id, order_id) enforces "a single order can redeem a given promotion
  // at most once" (§3.10 DB constraints). The (promotion_id, customer_identity_hash) index backs
  // the perCustomerLimit query the promotions policy module runs at checkout.
  await db.run(sql`CREATE TABLE \`promotion_redemptions\` (
  	\`id\` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  	\`tenant_id\` integer REFERENCES \`tenants\`(\`id\`),
  	\`promotion_id\` integer REFERENCES \`promotions\`(\`id\`),
  	\`order_id\` integer REFERENCES \`store_orders\`(\`id\`),
  	\`customer_identity_hash\` text NOT NULL,
  	\`discount_amount\` numeric NOT NULL,
  	\`redeemed_at\` text NOT NULL,
  	\`updated_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  	\`created_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
  );
  `)
  await db.run(sql`CREATE UNIQUE INDEX \`promotion_redemptions_promotion_order_uniq\` ON \`promotion_redemptions\` (\`promotion_id\`, \`order_id\`);`)
  await db.run(sql`CREATE INDEX \`promotion_redemptions_promotion_customer_idx\` ON \`promotion_redemptions\` (\`promotion_id\`, \`customer_identity_hash\`);`)
  await db.run(sql`CREATE INDEX \`promotion_redemptions_tenant_idx\` ON \`promotion_redemptions\` (\`tenant_id\`);`)
  await db.run(sql`CREATE INDEX \`promotion_redemptions_promotion_idx\` ON \`promotion_redemptions\` (\`promotion_id\`);`)
  await db.run(sql`CREATE INDEX \`promotion_redemptions_order_idx\` ON \`promotion_redemptions\` (\`order_id\`);`)
  await db.run(sql`CREATE INDEX \`promotion_redemptions_redeemed_at_idx\` ON \`promotion_redemptions\` (\`redeemed_at\`);`)
  await db.run(sql`CREATE INDEX \`promotion_redemptions_updated_at_idx\` ON \`promotion_redemptions\` (\`updated_at\`);`)
  await db.run(sql`CREATE INDEX \`promotion_redemptions_created_at_idx\` ON \`promotion_redemptions\` (\`created_at\`);`)

  // --- gift_cards (Plan §3.10) ---
  // codeHash is GLOBALLY unique (not tenant-scoped) so a gift-card code cannot collide across
  // tenants. balance is a CACHED value kept in lock-step with the append-only ledger; direct
  // writes are denied by the C4 collection access policy.
  await db.run(sql`CREATE TABLE \`gift_cards\` (
  	\`id\` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  	\`tenant_id\` integer REFERENCES \`tenants\`(\`id\`),
  	\`code_hash\` text NOT NULL,
  	\`last_four\` text NOT NULL,
  	\`currency\` text NOT NULL DEFAULT 'EGP',
  	\`initial_balance\` numeric NOT NULL,
  	\`balance\` numeric NOT NULL DEFAULT 0,
  	\`status\` text NOT NULL DEFAULT 'active',
  	\`expires_at\` text,
  	\`updated_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  	\`created_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
  );
  `)
  await db.run(sql`CREATE UNIQUE INDEX \`gift_cards_code_hash_uniq\` ON \`gift_cards\` (\`code_hash\`);`)
  await db.run(sql`CREATE INDEX \`gift_cards_tenant_status_idx\` ON \`gift_cards\` (\`tenant_id\`, \`status\`);`)
  await db.run(sql`CREATE INDEX \`gift_cards_tenant_idx\` ON \`gift_cards\` (\`tenant_id\`);`)
  await db.run(sql`CREATE INDEX \`gift_cards_last_four_idx\` ON \`gift_cards\` (\`last_four\`);`)
  await db.run(sql`CREATE INDEX \`gift_cards_status_idx\` ON \`gift_cards\` (\`status\`);`)
  await db.run(sql`CREATE INDEX \`gift_cards_expires_at_idx\` ON \`gift_cards\` (\`expires_at\`);`)
  await db.run(sql`CREATE INDEX \`gift_cards_updated_at_idx\` ON \`gift_cards\` (\`updated_at\`);`)
  await db.run(sql`CREATE INDEX \`gift_cards_created_at_idx\` ON \`gift_cards\` (\`created_at\`);`)

  // --- gift_card_ledger (Plan §3.10) ---
  // Append-only. `amount` is SIGNED integer minor units. `idempotency_key` is unique per tenant
  // so a retried checkout cannot double-redeem / double-refund. The GiftCardLedger.ts collection
  // declares a user field `createdAt`; Payload's auto-timestamp also writes `created_at` — they
  // share the column, with the user field's required-non-null behavior winning.
  await db.run(sql`CREATE TABLE \`gift_card_ledger\` (
  	\`id\` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  	\`tenant_id\` integer REFERENCES \`tenants\`(\`id\`),
  	\`gift_card_id\` integer REFERENCES \`gift_cards\`(\`id\`),
  	\`order_id\` integer REFERENCES \`store_orders\`(\`id\`),
  	\`kind\` text NOT NULL,
  	\`amount\` numeric NOT NULL,
  	\`idempotency_key\` text NOT NULL,
  	\`created_at\` text NOT NULL,
  	\`updated_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
  );
  `)
  await db.run(sql`CREATE UNIQUE INDEX \`gift_card_ledger_tenant_idempotency_key_uniq\` ON \`gift_card_ledger\` (\`tenant_id\`, \`idempotency_key\`);`)
  await db.run(sql`CREATE INDEX \`gift_card_ledger_gift_card_created_at_idx\` ON \`gift_card_ledger\` (\`gift_card_id\`, \`created_at\`);`)
  await db.run(sql`CREATE INDEX \`gift_card_ledger_tenant_idx\` ON \`gift_card_ledger\` (\`tenant_id\`);`)
  await db.run(sql`CREATE INDEX \`gift_card_ledger_gift_card_idx\` ON \`gift_card_ledger\` (\`gift_card_id\`);`)
  await db.run(sql`CREATE INDEX \`gift_card_ledger_order_idx\` ON \`gift_card_ledger\` (\`order_id\`);`)
  await db.run(sql`CREATE INDEX \`gift_card_ledger_kind_idx\` ON \`gift_card_ledger\` (\`kind\`);`)
  await db.run(sql`CREATE INDEX \`gift_card_ledger_idempotency_key_idx\` ON \`gift_card_ledger\` (\`idempotency_key\`);`)
  await db.run(sql`CREATE INDEX \`gift_card_ledger_created_at_idx\` ON \`gift_card_ledger\` (\`created_at\`);`)

  // ============================================================================
  // commerce_gateway_nonces (Plan §4.1)
  // ============================================================================
  // Gateway replay-protection ledger. Not a Payload collection — the gateway SQL NonceRepo reads
  // and writes this directly. nonce_hash is SHA-256 hex of the raw v4 UUID nonce (see
  // cms/src/commerce/gateway/nonce.ts); storing the hash keeps the column fixed-width and avoids
  // any raw-nonce persistence. The scheduled commerce sweep deletes rows whose expires_at has
  // passed (the expiry index backs that scan).
  await db.run(sql`CREATE TABLE \`commerce_gateway_nonces\` (
  	\`id\` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  	\`key_id\` text NOT NULL,
  	\`nonce_hash\` text NOT NULL,
  	\`created_at\` text NOT NULL,
  	\`expires_at\` text NOT NULL
  );
  `)
  await db.run(sql`CREATE UNIQUE INDEX \`commerce_gateway_nonces_key_nonce_uniq\` ON \`commerce_gateway_nonces\` (\`key_id\`, \`nonce_hash\`);`)
  await db.run(sql`CREATE INDEX \`commerce_gateway_nonces_expires_at_idx\` ON \`commerce_gateway_nonces\` (\`expires_at\`);`)
  await db.run(sql`CREATE INDEX \`commerce_gateway_nonces_created_at_idx\` ON \`commerce_gateway_nonces\` (\`created_at\`);`)

  // ============================================================================
  // payload_locked_documents_rels additions
  // ============================================================================
  // Plan §5 input contract #2 (CRITICAL-PATH): Payload's document-lock query spans every
  // collection, including the new store-* and policy collections. Missing `<slug>_id` columns
  // surface as a SQL error on the very first write through the Local API (currently fails the
  // integration suite against commerce-settings). Mirror the pattern from the existing commerce
  // migrations: explicit ADD COLUMN + index per slug (literal identifiers — the sql tagged
  // template parameterizes `${...}` expressions, which would turn identifiers into `?` placeholders
  // and SQLite does not allow parameter binding for DDL identifiers, so each statement is written
  // out literally as in 20260717_100000_commerce_inventory.ts).
  await db.run(sql`ALTER TABLE \`payload_locked_documents_rels\` ADD \`store_addresses_id\` integer REFERENCES \`store_addresses\`(\`id\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_store_addresses_id_idx\` ON \`payload_locked_documents_rels\` (\`store_addresses_id\`);`)
  await db.run(sql`ALTER TABLE \`payload_locked_documents_rels\` ADD \`store_variants_id\` integer REFERENCES \`store_variants\`(\`id\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_store_variants_id_idx\` ON \`payload_locked_documents_rels\` (\`store_variants_id\`);`)
  await db.run(sql`ALTER TABLE \`payload_locked_documents_rels\` ADD \`store_variant_types_id\` integer REFERENCES \`store_variant_types\`(\`id\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_store_variant_types_id_idx\` ON \`payload_locked_documents_rels\` (\`store_variant_types_id\`);`)
  await db.run(sql`ALTER TABLE \`payload_locked_documents_rels\` ADD \`store_variant_options_id\` integer REFERENCES \`store_variant_options\`(\`id\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_store_variant_options_id_idx\` ON \`payload_locked_documents_rels\` (\`store_variant_options_id\`);`)
  await db.run(sql`ALTER TABLE \`payload_locked_documents_rels\` ADD \`store_products_id\` integer REFERENCES \`store_products\`(\`id\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_store_products_id_idx\` ON \`payload_locked_documents_rels\` (\`store_products_id\`);`)
  await db.run(sql`ALTER TABLE \`payload_locked_documents_rels\` ADD \`store_carts_id\` integer REFERENCES \`store_carts\`(\`id\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_store_carts_id_idx\` ON \`payload_locked_documents_rels\` (\`store_carts_id\`);`)
  await db.run(sql`ALTER TABLE \`payload_locked_documents_rels\` ADD \`store_orders_id\` integer REFERENCES \`store_orders\`(\`id\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_store_orders_id_idx\` ON \`payload_locked_documents_rels\` (\`store_orders_id\`);`)
  await db.run(sql`ALTER TABLE \`payload_locked_documents_rels\` ADD \`store_transactions_id\` integer REFERENCES \`store_transactions\`(\`id\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_store_transactions_id_idx\` ON \`payload_locked_documents_rels\` (\`store_transactions_id\`);`)
  await db.run(sql`ALTER TABLE \`payload_locked_documents_rels\` ADD \`tax_zones_id\` integer REFERENCES \`tax_zones\`(\`id\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_tax_zones_id_idx\` ON \`payload_locked_documents_rels\` (\`tax_zones_id\`);`)
  await db.run(sql`ALTER TABLE \`payload_locked_documents_rels\` ADD \`tax_rates_id\` integer REFERENCES \`tax_rates\`(\`id\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_tax_rates_id_idx\` ON \`payload_locked_documents_rels\` (\`tax_rates_id\`);`)
  await db.run(sql`ALTER TABLE \`payload_locked_documents_rels\` ADD \`shipping_zones_id\` integer REFERENCES \`shipping_zones\`(\`id\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_shipping_zones_id_idx\` ON \`payload_locked_documents_rels\` (\`shipping_zones_id\`);`)
  await db.run(sql`ALTER TABLE \`payload_locked_documents_rels\` ADD \`shipping_methods_id\` integer REFERENCES \`shipping_methods\`(\`id\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_shipping_methods_id_idx\` ON \`payload_locked_documents_rels\` (\`shipping_methods_id\`);`)
  await db.run(sql`ALTER TABLE \`payload_locked_documents_rels\` ADD \`promotions_id\` integer REFERENCES \`promotions\`(\`id\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_promotions_id_idx\` ON \`payload_locked_documents_rels\` (\`promotions_id\`);`)
  await db.run(sql`ALTER TABLE \`payload_locked_documents_rels\` ADD \`promotion_redemptions_id\` integer REFERENCES \`promotion_redemptions\`(\`id\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_promotion_redemptions_id_idx\` ON \`payload_locked_documents_rels\` (\`promotion_redemptions_id\`);`)
  await db.run(sql`ALTER TABLE \`payload_locked_documents_rels\` ADD \`gift_cards_id\` integer REFERENCES \`gift_cards\`(\`id\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_gift_cards_id_idx\` ON \`payload_locked_documents_rels\` (\`gift_cards_id\`);`)
  await db.run(sql`ALTER TABLE \`payload_locked_documents_rels\` ADD \`gift_card_ledger_id\` integer REFERENCES \`gift_card_ledger\`(\`id\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_gift_card_ledger_id_idx\` ON \`payload_locked_documents_rels\` (\`gift_card_ledger_id\`);`)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  // Reverse the rels additions first (they reference the tables we're about to drop). Drop indexes
  // and columns explicitly — the sql tagged template parameterizes `${...}` expressions which
  // SQLite rejects for DDL identifiers, so each statement is literal.
  const dropRels = [
    'gift_card_ledger', 'gift_cards', 'promotion_redemptions', 'promotions',
    'shipping_methods', 'shipping_zones', 'tax_rates', 'tax_zones',
    'store_transactions', 'store_orders', 'store_carts', 'store_products',
    'store_variant_options', 'store_variant_types', 'store_variants', 'store_addresses',
  ]
  for (const slug of dropRels) {
    const col = `${slug}_id`
    const idx = `payload_locked_documents_rels_${col}_idx`
    try { await db.run(sql.raw(`DROP INDEX IF EXISTS \`${idx}\`;`)) } catch { /* best effort */ }
    try { await db.run(sql.raw(`ALTER TABLE \`payload_locked_documents_rels\` DROP COLUMN \`${col}\`;`)) } catch { /* best effort */ }
  }

  // Drop nonce + policy + store-* tables. Order matters for FK references: dependent tables first.
  await db.run(sql`DROP TABLE IF EXISTS \`commerce_gateway_nonces\`;`)

  await db.run(sql`DROP TABLE IF EXISTS \`gift_card_ledger\`;`)
  await db.run(sql`DROP TABLE IF EXISTS \`gift_cards\`;`)
  await db.run(sql`DROP TABLE IF EXISTS \`promotion_redemptions\`;`)
  await db.run(sql`DROP TABLE IF EXISTS \`promotions_rels\`;`)
  await db.run(sql`DROP TABLE IF EXISTS \`promotions\`;`)
  await db.run(sql`DROP TABLE IF EXISTS \`shipping_methods\`;`)
  await db.run(sql`DROP TABLE IF EXISTS \`shipping_zones_postal_prefixes\`;`)
  await db.run(sql`DROP TABLE IF EXISTS \`shipping_zones_regions\`;`)
  await db.run(sql`DROP TABLE IF EXISTS \`shipping_zones\`;`)
  await db.run(sql`DROP TABLE IF EXISTS \`tax_rates\`;`)
  await db.run(sql`DROP TABLE IF EXISTS \`tax_zones_postal_prefixes\`;`)
  await db.run(sql`DROP TABLE IF EXISTS \`tax_zones_regions\`;`)
  await db.run(sql`DROP TABLE IF EXISTS \`tax_zones\`;`)

  await db.run(sql`DROP TABLE IF EXISTS \`store_transactions_items\`;`)
  await db.run(sql`DROP TABLE IF EXISTS \`store_transactions\`;`)
  await db.run(sql`DROP TABLE IF EXISTS \`store_orders_items\`;`)
  await db.run(sql`DROP TABLE IF EXISTS \`store_orders_rels\`;`)
  await db.run(sql`DROP TABLE IF EXISTS \`store_orders\`;`)
  await db.run(sql`DROP TABLE IF EXISTS \`store_carts_promotion_codes\`;`)
  await db.run(sql`DROP TABLE IF EXISTS \`store_carts_items\`;`)
  await db.run(sql`DROP TABLE IF EXISTS \`store_carts\`;`)
  await db.run(sql`DROP TABLE IF EXISTS \`store_addresses\`;`)
  await db.run(sql`DROP TABLE IF EXISTS \`_store_variants_v_rels\`;`)
  await db.run(sql`DROP TABLE IF EXISTS \`_store_variants_v\`;`)
  await db.run(sql`DROP TABLE IF EXISTS \`store_variants_rels\`;`)
  await db.run(sql`DROP TABLE IF EXISTS \`store_variants\`;`)
  await db.run(sql`DROP TABLE IF EXISTS \`store_variant_options\`;`)
  await db.run(sql`DROP TABLE IF EXISTS \`store_variant_types\`;`)
  await db.run(sql`DROP TABLE IF EXISTS \`_store_products_v_rels\`;`)
  await db.run(sql`DROP TABLE IF EXISTS \`_store_products_v\`;`)
  await db.run(sql`DROP TABLE IF EXISTS \`store_products_rels\`;`)
  await db.run(sql`DROP TABLE IF EXISTS \`store_products\`;`)

  // Note: legacy commerce tables (products, carts, orders, transactions, customers, inventory_*,
  // commerce_settings, payment_events) are intentionally NOT dropped — plan §0.14 / §5.7.10.
}
