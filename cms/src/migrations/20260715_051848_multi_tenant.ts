import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-sqlite'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.run(sql`CREATE TABLE \`users_roles\` (
  	\`order\` integer NOT NULL,
  	\`parent_id\` integer NOT NULL,
  	\`value\` text,
  	\`id\` integer PRIMARY KEY NOT NULL,
  	FOREIGN KEY (\`parent_id\`) REFERENCES \`users\`(\`id\`) ON UPDATE no action ON DELETE cascade
  );
  `)
  await db.run(sql`CREATE INDEX \`users_roles_order_idx\` ON \`users_roles\` (\`order\`);`)
  await db.run(sql`CREATE INDEX \`users_roles_parent_idx\` ON \`users_roles\` (\`parent_id\`);`)
  await db.run(sql`CREATE TABLE \`tenants_features\` (
  	\`order\` integer NOT NULL,
  	\`parent_id\` integer NOT NULL,
  	\`value\` text,
  	\`id\` integer PRIMARY KEY NOT NULL,
  	FOREIGN KEY (\`parent_id\`) REFERENCES \`tenants\`(\`id\`) ON UPDATE no action ON DELETE cascade
  );
  `)
  await db.run(sql`CREATE INDEX \`tenants_features_order_idx\` ON \`tenants_features\` (\`order\`);`)
  await db.run(sql`CREATE INDEX \`tenants_features_parent_idx\` ON \`tenants_features\` (\`parent_id\`);`)
  await db.run(sql`CREATE TABLE \`tenants_contact_hours\` (
  	\`_order\` integer NOT NULL,
  	\`_parent_id\` integer NOT NULL,
  	\`id\` text PRIMARY KEY NOT NULL,
  	FOREIGN KEY (\`_parent_id\`) REFERENCES \`tenants\`(\`id\`) ON UPDATE no action ON DELETE cascade
  );
  `)
  await db.run(sql`CREATE INDEX \`tenants_contact_hours_order_idx\` ON \`tenants_contact_hours\` (\`_order\`);`)
  await db.run(sql`CREATE INDEX \`tenants_contact_hours_parent_id_idx\` ON \`tenants_contact_hours\` (\`_parent_id\`);`)
  await db.run(sql`CREATE TABLE \`tenants_contact_hours_locales\` (
  	\`day\` text NOT NULL,
  	\`time\` text NOT NULL,
  	\`id\` integer PRIMARY KEY NOT NULL,
  	\`_locale\` text NOT NULL,
  	\`_parent_id\` text NOT NULL,
  	FOREIGN KEY (\`_parent_id\`) REFERENCES \`tenants_contact_hours\`(\`id\`) ON UPDATE no action ON DELETE cascade
  );
  `)
  await db.run(sql`CREATE UNIQUE INDEX \`tenants_contact_hours_locales_locale_parent_id_unique\` ON \`tenants_contact_hours_locales\` (\`_locale\`,\`_parent_id\`);`)
  await db.run(sql`CREATE TABLE \`tenants\` (
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
  await db.run(sql`CREATE UNIQUE INDEX \`tenants_slug_idx\` ON \`tenants\` (\`slug\`);`)
  await db.run(sql`CREATE INDEX \`tenants_branding_branding_logo_idx\` ON \`tenants\` (\`branding_logo_id\`);`)
  await db.run(sql`CREATE INDEX \`tenants_updated_at_idx\` ON \`tenants\` (\`updated_at\`);`)
  await db.run(sql`CREATE INDEX \`tenants_created_at_idx\` ON \`tenants\` (\`created_at\`);`)
  await db.run(sql`CREATE TABLE \`tenants_locales\` (
  	\`name\` text NOT NULL,
  	\`branding_tagline\` text,
  	\`branding_established\` text,
  	\`hero_years_value\` text NOT NULL,
  	\`hero_years_unit\` text,
  	\`hero_departments_value\` text NOT NULL,
  	\`hero_departments_unit\` text,
  	\`hero_patients_value\` text NOT NULL,
  	\`hero_patients_unit\` text,
  	\`hero_staff_value\` text NOT NULL,
  	\`hero_staff_unit\` text,
  	\`contact_address\` text,
  	\`id\` integer PRIMARY KEY NOT NULL,
  	\`_locale\` text NOT NULL,
  	\`_parent_id\` integer NOT NULL,
  	FOREIGN KEY (\`_parent_id\`) REFERENCES \`tenants\`(\`id\`) ON UPDATE no action ON DELETE cascade
  );
  `)
  await db.run(sql`CREATE UNIQUE INDEX \`tenants_locales_locale_parent_id_unique\` ON \`tenants_locales\` (\`_locale\`,\`_parent_id\`);`)
  await db.run(sql`CREATE TABLE \`tenants_texts\` (
  	\`id\` integer PRIMARY KEY NOT NULL,
  	\`order\` integer NOT NULL,
  	\`parent_id\` integer NOT NULL,
  	\`path\` text NOT NULL,
  	\`text\` text,
  	FOREIGN KEY (\`parent_id\`) REFERENCES \`tenants\`(\`id\`) ON UPDATE no action ON DELETE cascade
  );
  `)
  await db.run(sql`CREATE INDEX \`tenants_texts_order_parent\` ON \`tenants_texts\` (\`order\`,\`parent_id\`);`)
  await db.run(sql`DROP TABLE \`hospital_settings_contact_hours_locales\`;`)
  await db.run(sql`DROP TABLE \`hospital_settings\`;`)
  await db.run(sql`DROP TABLE \`hospital_settings_locales\`;`)
  await db.run(sql`DROP TABLE \`hospital_settings_contact_hours\`;`)
  await db.run(sql`PRAGMA foreign_keys=OFF;`)
  await db.run(sql`CREATE TABLE \`__new_users_tenants\` (
  	\`_order\` integer NOT NULL,
  	\`_parent_id\` integer NOT NULL,
  	\`id\` text PRIMARY KEY NOT NULL,
  	\`tenant_id\` integer NOT NULL,
  	FOREIGN KEY (\`tenant_id\`) REFERENCES \`tenants\`(\`id\`) ON UPDATE no action ON DELETE set null,
  	FOREIGN KEY (\`_parent_id\`) REFERENCES \`users\`(\`id\`) ON UPDATE no action ON DELETE cascade
  );
  `)
  await db.run(sql`ALTER TABLE \`__new_users_tenants\` RENAME TO \`users_tenants\`;`)
  await db.run(sql`PRAGMA foreign_keys=ON;`)
  await db.run(sql`CREATE INDEX \`users_tenants_order_idx\` ON \`users_tenants\` (\`_order\`);`)
  await db.run(sql`CREATE INDEX \`users_tenants_parent_id_idx\` ON \`users_tenants\` (\`_parent_id\`);`)
  await db.run(sql`CREATE INDEX \`users_tenants_tenant_idx\` ON \`users_tenants\` (\`tenant_id\`);`)
  await db.run(sql`ALTER TABLE \`media\` ADD \`tenant_id\` integer REFERENCES tenants(id);`)
  await db.run(sql`CREATE INDEX \`media_tenant_idx\` ON \`media\` (\`tenant_id\`);`)
  await db.run(sql`ALTER TABLE \`categories\` ADD \`tenant_id\` integer REFERENCES tenants(id);`)
  await db.run(sql`CREATE INDEX \`categories_tenant_idx\` ON \`categories\` (\`tenant_id\`);`)
  await db.run(sql`ALTER TABLE \`doctors\` ADD \`tenant_id\` integer REFERENCES tenants(id);`)
  await db.run(sql`CREATE INDEX \`doctors_tenant_idx\` ON \`doctors\` (\`tenant_id\`);`)
  await db.run(sql`ALTER TABLE \`departments\` ADD \`tenant_id\` integer REFERENCES tenants(id);`)
  await db.run(sql`CREATE INDEX \`departments_tenant_idx\` ON \`departments\` (\`tenant_id\`);`)
  await db.run(sql`ALTER TABLE \`articles\` ADD \`tenant_id\` integer REFERENCES tenants(id);`)
  await db.run(sql`CREATE INDEX \`articles_tenant_idx\` ON \`articles\` (\`tenant_id\`);`)
  await db.run(sql`ALTER TABLE \`events\` ADD \`tenant_id\` integer REFERENCES tenants(id);`)
  await db.run(sql`CREATE INDEX \`events_tenant_idx\` ON \`events\` (\`tenant_id\`);`)
  await db.run(sql`ALTER TABLE \`awards\` ADD \`tenant_id\` integer REFERENCES tenants(id);`)
  await db.run(sql`CREATE INDEX \`awards_tenant_idx\` ON \`awards\` (\`tenant_id\`);`)
  await db.run(sql`ALTER TABLE \`achievements\` ADD \`tenant_id\` integer REFERENCES tenants(id);`)
  await db.run(sql`CREATE INDEX \`achievements_tenant_idx\` ON \`achievements\` (\`tenant_id\`);`)
  await db.run(sql`ALTER TABLE \`testimonials\` ADD \`tenant_id\` integer REFERENCES tenants(id);`)
  await db.run(sql`CREATE INDEX \`testimonials_tenant_idx\` ON \`testimonials\` (\`tenant_id\`);`)
  await db.run(sql`ALTER TABLE \`payload_locked_documents_rels\` ADD \`tenants_id\` integer REFERENCES tenants(id);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_tenants_id_idx\` ON \`payload_locked_documents_rels\` (\`tenants_id\`);`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.run(sql`CREATE TABLE \`hospital_settings_contact_hours\` (
  	\`_order\` integer NOT NULL,
  	\`_parent_id\` integer NOT NULL,
  	\`id\` text PRIMARY KEY NOT NULL,
  	FOREIGN KEY (\`_parent_id\`) REFERENCES \`hospital_settings\`(\`id\`) ON UPDATE no action ON DELETE cascade
  );
  `)
  await db.run(sql`CREATE INDEX \`hospital_settings_contact_hours_order_idx\` ON \`hospital_settings_contact_hours\` (\`_order\`);`)
  await db.run(sql`CREATE INDEX \`hospital_settings_contact_hours_parent_id_idx\` ON \`hospital_settings_contact_hours\` (\`_parent_id\`);`)
  await db.run(sql`CREATE TABLE \`hospital_settings_contact_hours_locales\` (
  	\`day\` text NOT NULL,
  	\`time\` text NOT NULL,
  	\`id\` integer PRIMARY KEY NOT NULL,
  	\`_locale\` text NOT NULL,
  	\`_parent_id\` text NOT NULL,
  	FOREIGN KEY (\`_parent_id\`) REFERENCES \`hospital_settings_contact_hours\`(\`id\`) ON UPDATE no action ON DELETE cascade
  );
  `)
  await db.run(sql`CREATE UNIQUE INDEX \`hospital_settings_contact_hours_locales_locale_parent_id_uni\` ON \`hospital_settings_contact_hours_locales\` (\`_locale\`,\`_parent_id\`);`)
  await db.run(sql`CREATE TABLE \`hospital_settings\` (
  	\`id\` integer PRIMARY KEY NOT NULL,
  	\`contact_phone\` text,
  	\`contact_emergency_number\` text,
  	\`contact_whatsapp\` text,
  	\`contact_email\` text,
  	\`contact_social_facebook_url\` text,
  	\`contact_social_x_url\` text,
  	\`contact_social_youtube_url\` text,
  	\`updated_at\` text,
  	\`created_at\` text
  );
  `)
  await db.run(sql`CREATE TABLE \`hospital_settings_locales\` (
  	\`hero_years_value\` text NOT NULL,
  	\`hero_years_unit\` text,
  	\`hero_departments_value\` text NOT NULL,
  	\`hero_departments_unit\` text,
  	\`hero_patients_value\` text NOT NULL,
  	\`hero_patients_unit\` text,
  	\`hero_staff_value\` text NOT NULL,
  	\`hero_staff_unit\` text,
  	\`contact_address\` text,
  	\`id\` integer PRIMARY KEY NOT NULL,
  	\`_locale\` text NOT NULL,
  	\`_parent_id\` integer NOT NULL,
  	FOREIGN KEY (\`_parent_id\`) REFERENCES \`hospital_settings\`(\`id\`) ON UPDATE no action ON DELETE cascade
  );
  `)
  await db.run(sql`CREATE UNIQUE INDEX \`hospital_settings_locales_locale_parent_id_unique\` ON \`hospital_settings_locales\` (\`_locale\`,\`_parent_id\`);`)
  await db.run(sql`DROP TABLE \`users_roles\`;`)
  await db.run(sql`DROP TABLE \`users_tenants\`;`)
  await db.run(sql`DROP TABLE \`tenants_features\`;`)
  await db.run(sql`DROP TABLE \`tenants_contact_hours\`;`)
  await db.run(sql`DROP TABLE \`tenants_contact_hours_locales\`;`)
  await db.run(sql`DROP TABLE \`tenants\`;`)
  await db.run(sql`DROP TABLE \`tenants_locales\`;`)
  await db.run(sql`DROP TABLE \`tenants_texts\`;`)
  await db.run(sql`PRAGMA foreign_keys=OFF;`)
  await db.run(sql`CREATE TABLE \`__new_media\` (
  	\`id\` integer PRIMARY KEY NOT NULL,
  	\`alt\` text,
  	\`updated_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  	\`created_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  	\`url\` text,
  	\`thumbnail_u_r_l\` text,
  	\`filename\` text,
  	\`mime_type\` text,
  	\`filesize\` numeric,
  	\`width\` numeric,
  	\`height\` numeric,
  	\`focal_x\` numeric,
  	\`focal_y\` numeric
  );
  `)
  await db.run(sql`INSERT INTO \`__new_media\`("id", "alt", "updated_at", "created_at", "url", "thumbnail_u_r_l", "filename", "mime_type", "filesize", "width", "height", "focal_x", "focal_y") SELECT "id", "alt", "updated_at", "created_at", "url", "thumbnail_u_r_l", "filename", "mime_type", "filesize", "width", "height", "focal_x", "focal_y" FROM \`media\`;`)
  await db.run(sql`DROP TABLE \`media\`;`)
  await db.run(sql`ALTER TABLE \`__new_media\` RENAME TO \`media\`;`)
  await db.run(sql`PRAGMA foreign_keys=ON;`)
  await db.run(sql`CREATE INDEX \`media_updated_at_idx\` ON \`media\` (\`updated_at\`);`)
  await db.run(sql`CREATE INDEX \`media_created_at_idx\` ON \`media\` (\`created_at\`);`)
  await db.run(sql`CREATE UNIQUE INDEX \`media_filename_idx\` ON \`media\` (\`filename\`);`)
  await db.run(sql`CREATE TABLE \`__new_categories\` (
  	\`id\` integer PRIMARY KEY NOT NULL,
  	\`slug\` text NOT NULL,
  	\`color\` text DEFAULT 'ink',
  	\`updated_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  	\`created_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
  );
  `)
  await db.run(sql`INSERT INTO \`__new_categories\`("id", "slug", "color", "updated_at", "created_at") SELECT "id", "slug", "color", "updated_at", "created_at" FROM \`categories\`;`)
  await db.run(sql`DROP TABLE \`categories\`;`)
  await db.run(sql`ALTER TABLE \`__new_categories\` RENAME TO \`categories\`;`)
  await db.run(sql`CREATE UNIQUE INDEX \`categories_slug_idx\` ON \`categories\` (\`slug\`);`)
  await db.run(sql`CREATE INDEX \`categories_updated_at_idx\` ON \`categories\` (\`updated_at\`);`)
  await db.run(sql`CREATE INDEX \`categories_created_at_idx\` ON \`categories\` (\`created_at\`);`)
  await db.run(sql`CREATE TABLE \`__new_doctors\` (
  	\`id\` integer PRIMARY KEY NOT NULL,
  	\`slug\` text NOT NULL,
  	\`photo_id\` integer,
  	\`department_rel_id\` integer,
  	\`department\` text,
  	\`certified\` integer DEFAULT false,
  	\`featured\` integer DEFAULT false,
  	\`order\` numeric,
  	\`updated_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  	\`created_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  	FOREIGN KEY (\`photo_id\`) REFERENCES \`media\`(\`id\`) ON UPDATE no action ON DELETE set null,
  	FOREIGN KEY (\`department_rel_id\`) REFERENCES \`departments\`(\`id\`) ON UPDATE no action ON DELETE set null
  );
  `)
  await db.run(sql`INSERT INTO \`__new_doctors\`("id", "slug", "photo_id", "department_rel_id", "department", "certified", "featured", "order", "updated_at", "created_at") SELECT "id", "slug", "photo_id", "department_rel_id", "department", "certified", "featured", "order", "updated_at", "created_at" FROM \`doctors\`;`)
  await db.run(sql`DROP TABLE \`doctors\`;`)
  await db.run(sql`ALTER TABLE \`__new_doctors\` RENAME TO \`doctors\`;`)
  await db.run(sql`CREATE UNIQUE INDEX \`doctors_slug_idx\` ON \`doctors\` (\`slug\`);`)
  await db.run(sql`CREATE INDEX \`doctors_photo_idx\` ON \`doctors\` (\`photo_id\`);`)
  await db.run(sql`CREATE INDEX \`doctors_department_rel_idx\` ON \`doctors\` (\`department_rel_id\`);`)
  await db.run(sql`CREATE INDEX \`doctors_updated_at_idx\` ON \`doctors\` (\`updated_at\`);`)
  await db.run(sql`CREATE INDEX \`doctors_created_at_idx\` ON \`doctors\` (\`created_at\`);`)
  await db.run(sql`CREATE TABLE \`__new_departments\` (
  	\`id\` integer PRIMARY KEY NOT NULL,
  	\`slug\` text NOT NULL,
  	\`icon_ref_id\` integer,
  	\`icon\` text,
  	\`center_of_excellence\` integer DEFAULT false,
  	\`updated_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  	\`created_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  	FOREIGN KEY (\`icon_ref_id\`) REFERENCES \`icons\`(\`id\`) ON UPDATE no action ON DELETE set null
  );
  `)
  await db.run(sql`INSERT INTO \`__new_departments\`("id", "slug", "icon_ref_id", "icon", "center_of_excellence", "updated_at", "created_at") SELECT "id", "slug", "icon_ref_id", "icon", "center_of_excellence", "updated_at", "created_at" FROM \`departments\`;`)
  await db.run(sql`DROP TABLE \`departments\`;`)
  await db.run(sql`ALTER TABLE \`__new_departments\` RENAME TO \`departments\`;`)
  await db.run(sql`CREATE UNIQUE INDEX \`departments_slug_idx\` ON \`departments\` (\`slug\`);`)
  await db.run(sql`CREATE INDEX \`departments_icon_ref_idx\` ON \`departments\` (\`icon_ref_id\`);`)
  await db.run(sql`CREATE INDEX \`departments_updated_at_idx\` ON \`departments\` (\`updated_at\`);`)
  await db.run(sql`CREATE INDEX \`departments_created_at_idx\` ON \`departments\` (\`created_at\`);`)
  await db.run(sql`CREATE TABLE \`__new_articles\` (
  	\`id\` integer PRIMARY KEY NOT NULL,
  	\`slug\` text NOT NULL,
  	\`date\` text NOT NULL,
  	\`author\` text NOT NULL,
  	\`category_rel_id\` integer,
  	\`category\` text,
  	\`thumbnail_id\` integer,
  	\`featured\` integer DEFAULT false,
  	\`body\` text,
  	\`updated_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  	\`created_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  	FOREIGN KEY (\`category_rel_id\`) REFERENCES \`categories\`(\`id\`) ON UPDATE no action ON DELETE set null,
  	FOREIGN KEY (\`thumbnail_id\`) REFERENCES \`media\`(\`id\`) ON UPDATE no action ON DELETE set null
  );
  `)
  await db.run(sql`INSERT INTO \`__new_articles\`("id", "slug", "date", "author", "category_rel_id", "category", "thumbnail_id", "featured", "body", "updated_at", "created_at") SELECT "id", "slug", "date", "author", "category_rel_id", "category", "thumbnail_id", "featured", "body", "updated_at", "created_at" FROM \`articles\`;`)
  await db.run(sql`DROP TABLE \`articles\`;`)
  await db.run(sql`ALTER TABLE \`__new_articles\` RENAME TO \`articles\`;`)
  await db.run(sql`CREATE UNIQUE INDEX \`articles_slug_idx\` ON \`articles\` (\`slug\`);`)
  await db.run(sql`CREATE INDEX \`articles_category_rel_idx\` ON \`articles\` (\`category_rel_id\`);`)
  await db.run(sql`CREATE INDEX \`articles_thumbnail_idx\` ON \`articles\` (\`thumbnail_id\`);`)
  await db.run(sql`CREATE INDEX \`articles_updated_at_idx\` ON \`articles\` (\`updated_at\`);`)
  await db.run(sql`CREATE INDEX \`articles_created_at_idx\` ON \`articles\` (\`created_at\`);`)
  await db.run(sql`CREATE TABLE \`__new_events\` (
  	\`id\` integer PRIMARY KEY NOT NULL,
  	\`slug\` text NOT NULL,
  	\`date\` text NOT NULL,
  	\`category\` text NOT NULL,
  	\`thumbnail_id\` integer,
  	\`featured\` integer DEFAULT false,
  	\`youtube_url\` text,
  	\`body\` text,
  	\`updated_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  	\`created_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  	FOREIGN KEY (\`thumbnail_id\`) REFERENCES \`media\`(\`id\`) ON UPDATE no action ON DELETE set null
  );
  `)
  await db.run(sql`INSERT INTO \`__new_events\`("id", "slug", "date", "category", "thumbnail_id", "featured", "youtube_url", "body", "updated_at", "created_at") SELECT "id", "slug", "date", "category", "thumbnail_id", "featured", "youtube_url", "body", "updated_at", "created_at" FROM \`events\`;`)
  await db.run(sql`DROP TABLE \`events\`;`)
  await db.run(sql`ALTER TABLE \`__new_events\` RENAME TO \`events\`;`)
  await db.run(sql`CREATE UNIQUE INDEX \`events_slug_idx\` ON \`events\` (\`slug\`);`)
  await db.run(sql`CREATE INDEX \`events_thumbnail_idx\` ON \`events\` (\`thumbnail_id\`);`)
  await db.run(sql`CREATE INDEX \`events_updated_at_idx\` ON \`events\` (\`updated_at\`);`)
  await db.run(sql`CREATE INDEX \`events_created_at_idx\` ON \`events\` (\`created_at\`);`)
  await db.run(sql`CREATE TABLE \`__new_awards\` (
  	\`id\` integer PRIMARY KEY NOT NULL,
  	\`slug\` text NOT NULL,
  	\`year\` numeric NOT NULL,
  	\`badge_image_id\` integer,
  	\`updated_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  	\`created_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  	FOREIGN KEY (\`badge_image_id\`) REFERENCES \`media\`(\`id\`) ON UPDATE no action ON DELETE set null
  );
  `)
  await db.run(sql`INSERT INTO \`__new_awards\`("id", "slug", "year", "badge_image_id", "updated_at", "created_at") SELECT "id", "slug", "year", "badge_image_id", "updated_at", "created_at" FROM \`awards\`;`)
  await db.run(sql`DROP TABLE \`awards\`;`)
  await db.run(sql`ALTER TABLE \`__new_awards\` RENAME TO \`awards\`;`)
  await db.run(sql`CREATE UNIQUE INDEX \`awards_slug_idx\` ON \`awards\` (\`slug\`);`)
  await db.run(sql`CREATE INDEX \`awards_badge_image_idx\` ON \`awards\` (\`badge_image_id\`);`)
  await db.run(sql`CREATE INDEX \`awards_updated_at_idx\` ON \`awards\` (\`updated_at\`);`)
  await db.run(sql`CREATE INDEX \`awards_created_at_idx\` ON \`awards\` (\`created_at\`);`)
  await db.run(sql`CREATE TABLE \`__new_achievements\` (
  	\`id\` integer PRIMARY KEY NOT NULL,
  	\`slug\` text NOT NULL,
  	\`year\` numeric NOT NULL,
  	\`icon\` text,
  	\`updated_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  	\`created_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
  );
  `)
  await db.run(sql`INSERT INTO \`__new_achievements\`("id", "slug", "year", "icon", "updated_at", "created_at") SELECT "id", "slug", "year", "icon", "updated_at", "created_at" FROM \`achievements\`;`)
  await db.run(sql`DROP TABLE \`achievements\`;`)
  await db.run(sql`ALTER TABLE \`__new_achievements\` RENAME TO \`achievements\`;`)
  await db.run(sql`CREATE UNIQUE INDEX \`achievements_slug_idx\` ON \`achievements\` (\`slug\`);`)
  await db.run(sql`CREATE INDEX \`achievements_updated_at_idx\` ON \`achievements\` (\`updated_at\`);`)
  await db.run(sql`CREATE INDEX \`achievements_created_at_idx\` ON \`achievements\` (\`created_at\`);`)
  await db.run(sql`CREATE TABLE \`__new_testimonials\` (
  	\`id\` integer PRIMARY KEY NOT NULL,
  	\`slug\` text NOT NULL,
  	\`avatar_id\` integer,
  	\`featured\` integer DEFAULT false,
  	\`updated_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  	\`created_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  	FOREIGN KEY (\`avatar_id\`) REFERENCES \`media\`(\`id\`) ON UPDATE no action ON DELETE set null
  );
  `)
  await db.run(sql`INSERT INTO \`__new_testimonials\`("id", "slug", "avatar_id", "featured", "updated_at", "created_at") SELECT "id", "slug", "avatar_id", "featured", "updated_at", "created_at" FROM \`testimonials\`;`)
  await db.run(sql`DROP TABLE \`testimonials\`;`)
  await db.run(sql`ALTER TABLE \`__new_testimonials\` RENAME TO \`testimonials\`;`)
  await db.run(sql`CREATE UNIQUE INDEX \`testimonials_slug_idx\` ON \`testimonials\` (\`slug\`);`)
  await db.run(sql`CREATE INDEX \`testimonials_avatar_idx\` ON \`testimonials\` (\`avatar_id\`);`)
  await db.run(sql`CREATE INDEX \`testimonials_updated_at_idx\` ON \`testimonials\` (\`updated_at\`);`)
  await db.run(sql`CREATE INDEX \`testimonials_created_at_idx\` ON \`testimonials\` (\`created_at\`);`)
  await db.run(sql`CREATE TABLE \`__new_payload_locked_documents_rels\` (
  	\`id\` integer PRIMARY KEY NOT NULL,
  	\`order\` integer,
  	\`parent_id\` integer NOT NULL,
  	\`path\` text NOT NULL,
  	\`users_id\` integer,
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
  await db.run(sql`INSERT INTO \`__new_payload_locked_documents_rels\`("id", "order", "parent_id", "path", "users_id", "media_id", "icons_id", "categories_id", "doctors_id", "departments_id", "articles_id", "events_id", "awards_id", "achievements_id", "testimonials_id") SELECT "id", "order", "parent_id", "path", "users_id", "media_id", "icons_id", "categories_id", "doctors_id", "departments_id", "articles_id", "events_id", "awards_id", "achievements_id", "testimonials_id" FROM \`payload_locked_documents_rels\`;`)
  await db.run(sql`DROP TABLE \`payload_locked_documents_rels\`;`)
  await db.run(sql`ALTER TABLE \`__new_payload_locked_documents_rels\` RENAME TO \`payload_locked_documents_rels\`;`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_order_idx\` ON \`payload_locked_documents_rels\` (\`order\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_parent_idx\` ON \`payload_locked_documents_rels\` (\`parent_id\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_path_idx\` ON \`payload_locked_documents_rels\` (\`path\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_users_id_idx\` ON \`payload_locked_documents_rels\` (\`users_id\`);`)
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
}
