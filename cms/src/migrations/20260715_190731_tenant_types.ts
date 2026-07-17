import { MigrateDownArgs, MigrateUpArgs, sql } from '@payloadcms/db-sqlite'

// Replaces the fixed `tenants.type` text column (select: hospital|clinic) with an extensible
// `tenant-types` collection and a required `tenants.type_id` relationship. Data-safe:
//   - Preserves every distinct nonblank legacy `tenants.type` value (not only hospital/clinic).
//   - Seeds hospital/clinic with their current localized labels; unexpected values become a
//     Tenant Type with a normalized unique slug and a readable display name.
//   - Derives each migrated type's `defaultFeatures` conservatively as the union of feature values
//     currently assigned to tenants of that legacy type.
//   - Existing tenant feature rows remain byte/row equivalent after up.
//   - Aborts (CHECK guard) before removing the legacy text column if any tenant cannot be mapped.
// Down restores the legacy type slug from the relationship and removes only the new schema.
// Round-trip up -> down -> up is valid on scratch SQLite.

export async function up({ db }: MigrateUpArgs): Promise<void> {
  // --- 1. Create the tenant-types collection tables (base + localized name + default features). ---
  await db.run(sql`CREATE TABLE \`tenant_types\` (
  	\`id\` integer PRIMARY KEY NOT NULL,
  	\`slug\` text NOT NULL,
  	\`updated_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  	\`created_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
  );
  `)
  await db.run(sql`CREATE UNIQUE INDEX \`tenant_types_slug_idx\` ON \`tenant_types\` (\`slug\`);`)
  await db.run(sql`CREATE INDEX \`tenant_types_updated_at_idx\` ON \`tenant_types\` (\`updated_at\`);`)
  await db.run(sql`CREATE INDEX \`tenant_types_created_at_idx\` ON \`tenant_types\` (\`created_at\`);`)

  await db.run(sql`CREATE TABLE \`tenant_types_locales\` (
  	\`name\` text NOT NULL,
  	\`id\` integer PRIMARY KEY NOT NULL,
  	\`_locale\` text NOT NULL,
  	\`_parent_id\` integer NOT NULL,
  	FOREIGN KEY (\`_parent_id\`) REFERENCES \`tenant_types\`(\`id\`) ON UPDATE no action ON DELETE cascade
  );
  `)
  await db.run(sql`CREATE UNIQUE INDEX \`tenant_types_locales_locale_parent_id_unique\` ON \`tenant_types_locales\` (\`_locale\`,\`_parent_id\`);`)

  await db.run(sql`CREATE TABLE \`tenant_types_default_features\` (
  	\`order\` integer NOT NULL,
  	\`parent_id\` integer NOT NULL,
  	\`value\` text,
  	\`id\` integer PRIMARY KEY NOT NULL,
  	FOREIGN KEY (\`parent_id\`) REFERENCES \`tenant_types\`(\`id\`) ON UPDATE no action ON DELETE cascade
  );
  `)
  await db.run(sql`CREATE INDEX \`tenant_types_default_features_order_idx\` ON \`tenant_types_default_features\` (\`order\`);`)
  await db.run(sql`CREATE INDEX \`tenant_types_default_features_parent_idx\` ON \`tenant_types_default_features\` (\`parent_id\`);`)

  // --- 2. Seed one tenant_types row per distinct nonblank legacy type (slug = lowercased value). ---
  await db.run(sql`INSERT INTO \`tenant_types\` (\`slug\`)
  	SELECT DISTINCT lower(trim(\`type\`))
  	FROM \`tenants\`
  	WHERE trim(coalesce(\`type\`, '')) <> '';`)

  // --- 3. Localized names: hospital/clinic get their known labels; others use the legacy value
  //        (original case) as a readable display name, falling back to the slug. ---
  await db.run(sql`INSERT INTO \`tenant_types_locales\` (\`name\`, \`_locale\`, \`_parent_id\`)
  	SELECT
  		CASE \`tt\`.\`slug\`
  			WHEN 'hospital' THEN 'مستشفى'
  			WHEN 'clinic' THEN 'عيادة'
  			ELSE COALESCE((
  				SELECT \`type\` FROM \`tenants\` WHERE lower(trim(\`type\`)) = \`tt\`.\`slug\` LIMIT 1
  			), \`tt\`.\`slug\`)
  		END,
  		'ar',
  		\`tt\`.\`id\`
  	FROM \`tenant_types\` \`tt\`;`)
  await db.run(sql`INSERT INTO \`tenant_types_locales\` (\`name\`, \`_locale\`, \`_parent_id\`)
  	SELECT
  		CASE \`tt\`.\`slug\`
  			WHEN 'hospital' THEN 'Hospital'
  			WHEN 'clinic' THEN 'Clinic'
  			ELSE COALESCE((
  				SELECT \`type\` FROM \`tenants\` WHERE lower(trim(\`type\`)) = \`tt\`.\`slug\` LIMIT 1
  			), \`tt\`.\`slug\`)
  		END,
  		'en',
  		\`tt\`.\`id\`
  	FROM \`tenant_types\` \`tt\`;`)

  // --- 4. Default feature template per type = union of feature values currently assigned to
  //        tenants of that legacy type (conservative; existing tenant features stay unchanged). ---
  await db.run(sql`INSERT INTO \`tenant_types_default_features\` (\`order\`, \`parent_id\`, \`value\`)
  	SELECT
  		ROW_NUMBER() OVER (PARTITION BY \`pair\`.\`type_id\` ORDER BY \`pair\`.\`value\`) - 1,
  		\`pair\`.\`type_id\`,
  		\`pair\`.\`value\`
  	FROM (
  		SELECT DISTINCT \`tt\`.\`id\` AS \`type_id\`, \`tf\`.\`value\` AS \`value\`
  		FROM \`tenant_types\` \`tt\`
  		JOIN \`tenants\` \`t\` ON lower(trim(\`t\`.\`type\`)) = \`tt\`.\`slug\`
  		JOIN \`tenants_features\` \`tf\` ON \`tf\`.\`parent_id\` = \`t\`.\`id\`
  		WHERE \`tf\`.\`value\` IS NOT NULL AND trim(\`tf\`.\`value\`) <> ''
  	) AS \`pair\`;`)

  // --- 5. Guard: abort before removing the legacy column if any tenant cannot be mapped. ---
  await db.run(sql`CREATE TEMP TABLE \`_tenant_type_backfill_guard\` (
  	\`unresolved\` integer NOT NULL CHECK (\`unresolved\` = 0)
  );`)
  await db.run(sql`INSERT INTO \`_tenant_type_backfill_guard\` (\`unresolved\`)
  	SELECT count(*)
  	FROM \`tenants\`
  	WHERE trim(coalesce(\`type\`, '')) = ''
  		OR NOT EXISTS (
  			SELECT 1 FROM \`tenant_types\` WHERE \`tenant_types\`.\`slug\` = lower(trim(\`tenants\`.\`type\`))
  		);`)
  await db.run(sql`DROP TABLE \`_tenant_type_backfill_guard\`;`)

  // --- 6. Rebuild \`tenants\`: add required \`type_id\` (backfilled from the legacy type), drop the
  //        legacy text \`type\` column. SQLite cannot ADD a NOT NULL column without a default, so the
  //        standard table-rebuild (off during FK-off window) is used, mirroring Payload's pattern. ---
  await db.run(sql`PRAGMA foreign_keys=OFF;`)
  await db.run(sql`CREATE TABLE \`__new_tenants\` (
  	\`id\` integer PRIMARY KEY NOT NULL,
  	\`slug\` text NOT NULL,
  	\`type_id\` integer NOT NULL,
  	\`branding_initials\` text,
  	\`branding_logo_id\` integer,
  	\`branding_theme_color\` text,
  	\`contact_phone\` text,
  	\`contact_emergency_number\` text,
  	\`contact_whatsapp\` text,
  	\`contact_email\` text,
  	\`contact_social_facebook_url\` text,
  	\`contact_social_x_url\` text,
  	\`contact_social_youtube_url\` text,
  	\`updated_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  	\`created_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  	FOREIGN KEY (\`type_id\`) REFERENCES \`tenant_types\`(\`id\`) ON UPDATE no action ON DELETE set null,
  	FOREIGN KEY (\`branding_logo_id\`) REFERENCES \`media\`(\`id\`) ON UPDATE no action ON DELETE set null
  );
  `)
  await db.run(sql`INSERT INTO \`__new_tenants\` ("id", "slug", "type_id", "branding_initials", "branding_logo_id", "branding_theme_color", "contact_phone", "contact_emergency_number", "contact_whatsapp", "contact_email", "contact_social_facebook_url", "contact_social_x_url", "contact_social_youtube_url", "updated_at", "created_at")
  	SELECT "id", "slug",
  		(SELECT \`id\` FROM \`tenant_types\` WHERE \`slug\` = lower(trim(\`type\`))),
  		"branding_initials", "branding_logo_id", "branding_theme_color", "contact_phone", "contact_emergency_number", "contact_whatsapp", "contact_email", "contact_social_facebook_url", "contact_social_x_url", "contact_social_youtube_url", "updated_at", "created_at"
  	FROM \`tenants\`;`)
  await db.run(sql`DROP TABLE \`tenants\`;`)
  await db.run(sql`ALTER TABLE \`__new_tenants\` RENAME TO \`tenants\`;`)
  await db.run(sql`PRAGMA foreign_keys=ON;`)
  await db.run(sql`CREATE UNIQUE INDEX \`tenants_slug_idx\` ON \`tenants\` (\`slug\`);`)
  await db.run(sql`CREATE INDEX \`tenants_type_idx\` ON \`tenants\` (\`type_id\`);`)
  await db.run(sql`CREATE INDEX \`tenants_branding_branding_logo_idx\` ON \`tenants\` (\`branding_logo_id\`);`)
  await db.run(sql`CREATE INDEX \`tenants_updated_at_idx\` ON \`tenants\` (\`updated_at\`);`)
  await db.run(sql`CREATE INDEX \`tenants_created_at_idx\` ON \`tenants\` (\`created_at\`);`)

  // --- 7. Register the new relationship in the document-lock rel table (nullable column). ---
  await db.run(sql`ALTER TABLE \`payload_locked_documents_rels\` ADD \`tenant_types_id\` integer REFERENCES \`tenant_types\`(\`id\`) ON UPDATE no action ON DELETE cascade;`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_tenant_types_id_idx\` ON \`payload_locked_documents_rels\` (\`tenant_types_id\`);`)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  // --- 1. Restore the legacy text \`type\` column from the relationship (slug), dropping type_id,
  //        via a table-rebuild so the column is NOT NULL DEFAULT 'hospital' as before. ---
  await db.run(sql`PRAGMA foreign_keys=OFF;`)
  await db.run(sql`CREATE TABLE \`__new_tenants\` (
  	\`id\` integer PRIMARY KEY NOT NULL,
  	\`slug\` text NOT NULL,
  	\`type\` text DEFAULT 'hospital' NOT NULL,
  	\`branding_initials\` text,
  	\`branding_logo_id\` integer,
  	\`branding_theme_color\` text,
  	\`contact_phone\` text,
  	\`contact_emergency_number\` text,
  	\`contact_whatsapp\` text,
  	\`contact_email\` text,
  	\`contact_social_facebook_url\` text,
  	\`contact_social_x_url\` text,
  	\`contact_social_youtube_url\` text,
  	\`updated_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  	\`created_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  	FOREIGN KEY (\`branding_logo_id\`) REFERENCES \`media\`(\`id\`) ON UPDATE no action ON DELETE set null
  );
  `)
  await db.run(sql`INSERT INTO \`__new_tenants\` ("id", "slug", "type", "branding_initials", "branding_logo_id", "branding_theme_color", "contact_phone", "contact_emergency_number", "contact_whatsapp", "contact_email", "contact_social_facebook_url", "contact_social_x_url", "contact_social_youtube_url", "updated_at", "created_at")
  	SELECT "id", "slug",
  		COALESCE((SELECT \`slug\` FROM \`tenant_types\` WHERE \`id\` = \`tenants\`.\`type_id\`), 'hospital'),
  		"branding_initials", "branding_logo_id", "branding_theme_color", "contact_phone", "contact_emergency_number", "contact_whatsapp", "contact_email", "contact_social_facebook_url", "contact_social_x_url", "contact_social_youtube_url", "updated_at", "created_at"
  	FROM \`tenants\`;`)
  await db.run(sql`DROP TABLE \`tenants\`;`)
  await db.run(sql`ALTER TABLE \`__new_tenants\` RENAME TO \`tenants\`;`)
  await db.run(sql`PRAGMA foreign_keys=ON;`)
  await db.run(sql`CREATE UNIQUE INDEX \`tenants_slug_idx\` ON \`tenants\` (\`slug\`);`)
  await db.run(sql`CREATE INDEX \`tenants_branding_branding_logo_idx\` ON \`tenants\` (\`branding_logo_id\`);`)
  await db.run(sql`CREATE INDEX \`tenants_updated_at_idx\` ON \`tenants\` (\`updated_at\`);`)
  await db.run(sql`CREATE INDEX \`tenants_created_at_idx\` ON \`tenants\` (\`created_at\`);`)

  // --- 2. Remove the new tenant-types schema only (existing tenant feature rows untouched). ---
  // `payload_locked_documents_rels.tenant_types_id` carries a foreign key, so SQLite cannot DROP it
  // in place — rebuild the rel table without the column (mirrors the multi-tenant down pattern).
  await db.run(sql`PRAGMA foreign_keys=OFF;`)
  await db.run(sql`CREATE TABLE \`__new_payload_locked_documents_rels\` (
  	\`id\` integer PRIMARY KEY NOT NULL,
  	\`order\` integer,
  	\`parent_id\` integer NOT NULL,
  	\`path\` text NOT NULL,
  	\`users_id\` integer,
  	\`tenants_id\` integer,
  	\`media_id\` integer,
  	\`icons_id\` integer,
  	\`categories_id\` integer,
  	\`doctors_id\` integer,
  	\`departments_id\` integer,
  	\`articles_id\` integer,
  	\`events_id\` integer,
  	\`awards_id\` integer,
  	\`achievements_id\` integer,
  	\`testimonials_id\` integer,
  	FOREIGN KEY (\`parent_id\`) REFERENCES \`payload_locked_documents\`(\`id\`) ON UPDATE no action ON DELETE cascade,
  	FOREIGN KEY (\`users_id\`) REFERENCES \`users\`(\`id\`) ON UPDATE no action ON DELETE cascade,
  	FOREIGN KEY (\`tenants_id\`) REFERENCES \`tenants\`(\`id\`) ON UPDATE no action ON DELETE cascade,
  	FOREIGN KEY (\`media_id\`) REFERENCES \`media\`(\`id\`) ON UPDATE no action ON DELETE cascade,
  	FOREIGN KEY (\`icons_id\`) REFERENCES \`icons\`(\`id\`) ON UPDATE no action ON DELETE cascade,
  	FOREIGN KEY (\`categories_id\`) REFERENCES \`categories\`(\`id\`) ON UPDATE no action ON DELETE cascade,
  	FOREIGN KEY (\`doctors_id\`) REFERENCES \`doctors\`(\`id\`) ON UPDATE no action ON DELETE cascade,
  	FOREIGN KEY (\`departments_id\`) REFERENCES \`departments\`(\`id\`) ON UPDATE no action ON DELETE cascade,
  	FOREIGN KEY (\`articles_id\`) REFERENCES \`articles\`(\`id\`) ON UPDATE no action ON DELETE cascade,
  	FOREIGN KEY (\`events_id\`) REFERENCES \`events\`(\`id\`) ON UPDATE no action ON DELETE cascade,
  	FOREIGN KEY (\`awards_id\`) REFERENCES \`awards\`(\`id\`) ON UPDATE no action ON DELETE cascade,
  	FOREIGN KEY (\`achievements_id\`) REFERENCES \`achievements\`(\`id\`) ON UPDATE no action ON DELETE cascade,
  	FOREIGN KEY (\`testimonials_id\`) REFERENCES \`testimonials\`(\`id\`) ON UPDATE no action ON DELETE cascade
  );
  `)
  await db.run(sql`INSERT INTO \`__new_payload_locked_documents_rels\` ("id", "order", "parent_id", "path", "users_id", "tenants_id", "media_id", "icons_id", "categories_id", "doctors_id", "departments_id", "articles_id", "events_id", "awards_id", "achievements_id", "testimonials_id")
  	SELECT "id", "order", "parent_id", "path", "users_id", "tenants_id", "media_id", "icons_id", "categories_id", "doctors_id", "departments_id", "articles_id", "events_id", "awards_id", "achievements_id", "testimonials_id"
  	FROM \`payload_locked_documents_rels\`;`)
  await db.run(sql`DROP TABLE \`payload_locked_documents_rels\`;`)
  await db.run(sql`ALTER TABLE \`__new_payload_locked_documents_rels\` RENAME TO \`payload_locked_documents_rels\`;`)
  await db.run(sql`PRAGMA foreign_keys=ON;`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_order_idx\` ON \`payload_locked_documents_rels\` (\`order\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_parent_idx\` ON \`payload_locked_documents_rels\` (\`parent_id\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_path_idx\` ON \`payload_locked_documents_rels\` (\`path\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_users_id_idx\` ON \`payload_locked_documents_rels\` (\`users_id\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_tenants_id_idx\` ON \`payload_locked_documents_rels\` (\`tenants_id\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_media_id_idx\` ON \`payload_locked_documents_rels\` (\`media_id\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_icons_id_idx\` ON \`payload_locked_documents_rels\` (\`icons_id\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_categories_id_idx\` ON \`payload_locked_documents_rels\` (\`categories_id\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_doctors_id_idx\` ON \`payload_locked_documents_rels\` (\`doctors_id\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_departments_id_idx\` ON \`payload_locked_documents_rels\` (\`departments_id\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_articles_id_idx\` ON \`payload_locked_documents_rels\` (\`articles_id\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_events_id_idx\` ON \`payload_locked_documents_rels\` (\`events_id\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_awards_id_idx\` ON \`payload_locked_documents_rels\` (\`awards_id\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_achievements_id_idx\` ON \`payload_locked_documents_rels\` (\`achievements_id\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_testimonials_id_idx\` ON \`payload_locked_documents_rels\` (\`testimonials_id\`);`)

  await db.run(sql`DROP TABLE \`tenant_types_default_features\`;`)
  await db.run(sql`DROP TABLE \`tenant_types_locales\`;`)
  await db.run(sql`DROP TABLE \`tenant_types\`;`)
}
