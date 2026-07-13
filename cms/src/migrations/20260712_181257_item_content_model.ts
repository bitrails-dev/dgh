import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-sqlite'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.run(sql`CREATE TABLE \`icons\` (
  	\`id\` integer PRIMARY KEY NOT NULL,
  	\`label\` text NOT NULL,
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
  await db.run(sql`CREATE INDEX \`icons_updated_at_idx\` ON \`icons\` (\`updated_at\`);`)
  await db.run(sql`CREATE INDEX \`icons_created_at_idx\` ON \`icons\` (\`created_at\`);`)
  await db.run(sql`CREATE UNIQUE INDEX \`icons_filename_idx\` ON \`icons\` (\`filename\`);`)
  await db.run(sql`CREATE TABLE \`categories\` (
  	\`id\` integer PRIMARY KEY NOT NULL,
  	\`slug\` text NOT NULL,
  	\`color\` text DEFAULT 'ink',
  	\`updated_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  	\`created_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
  );
  `)
  await db.run(sql`CREATE UNIQUE INDEX \`categories_slug_idx\` ON \`categories\` (\`slug\`);`)
  await db.run(sql`CREATE INDEX \`categories_updated_at_idx\` ON \`categories\` (\`updated_at\`);`)
  await db.run(sql`CREATE INDEX \`categories_created_at_idx\` ON \`categories\` (\`created_at\`);`)
  await db.run(sql`CREATE TABLE \`categories_locales\` (
  	\`name\` text NOT NULL,
  	\`id\` integer PRIMARY KEY NOT NULL,
  	\`_locale\` text NOT NULL,
  	\`_parent_id\` integer NOT NULL,
  	FOREIGN KEY (\`_parent_id\`) REFERENCES \`categories\`(\`id\`) ON UPDATE no action ON DELETE cascade
  );
  `)
  await db.run(sql`CREATE UNIQUE INDEX \`categories_locales_locale_parent_id_unique\` ON \`categories_locales\` (\`_locale\`,\`_parent_id\`);`)
  await db.run(sql`CREATE TABLE \`articles_blocks_rich_text\` (
  	\`_order\` integer NOT NULL,
  	\`_parent_id\` integer NOT NULL,
  	\`_path\` text NOT NULL,
  	\`id\` text PRIMARY KEY NOT NULL,
  	\`block_name\` text,
  	FOREIGN KEY (\`_parent_id\`) REFERENCES \`articles\`(\`id\`) ON UPDATE no action ON DELETE cascade
  );
  `)
  await db.run(sql`CREATE INDEX \`articles_blocks_rich_text_order_idx\` ON \`articles_blocks_rich_text\` (\`_order\`);`)
  await db.run(sql`CREATE INDEX \`articles_blocks_rich_text_parent_id_idx\` ON \`articles_blocks_rich_text\` (\`_parent_id\`);`)
  await db.run(sql`CREATE INDEX \`articles_blocks_rich_text_path_idx\` ON \`articles_blocks_rich_text\` (\`_path\`);`)
  await db.run(sql`CREATE TABLE \`articles_blocks_rich_text_locales\` (
  	\`rich_text\` text,
  	\`id\` integer PRIMARY KEY NOT NULL,
  	\`_locale\` text NOT NULL,
  	\`_parent_id\` text NOT NULL,
  	FOREIGN KEY (\`_parent_id\`) REFERENCES \`articles_blocks_rich_text\`(\`id\`) ON UPDATE no action ON DELETE cascade
  );
  `)
  await db.run(sql`CREATE UNIQUE INDEX \`articles_blocks_rich_text_locales_locale_parent_id_unique\` ON \`articles_blocks_rich_text_locales\` (\`_locale\`,\`_parent_id\`);`)
  await db.run(sql`CREATE TABLE \`articles_blocks_heading\` (
  	\`_order\` integer NOT NULL,
  	\`_parent_id\` integer NOT NULL,
  	\`_path\` text NOT NULL,
  	\`id\` text PRIMARY KEY NOT NULL,
  	\`level\` text DEFAULT 'h2',
  	\`block_name\` text,
  	FOREIGN KEY (\`_parent_id\`) REFERENCES \`articles\`(\`id\`) ON UPDATE no action ON DELETE cascade
  );
  `)
  await db.run(sql`CREATE INDEX \`articles_blocks_heading_order_idx\` ON \`articles_blocks_heading\` (\`_order\`);`)
  await db.run(sql`CREATE INDEX \`articles_blocks_heading_parent_id_idx\` ON \`articles_blocks_heading\` (\`_parent_id\`);`)
  await db.run(sql`CREATE INDEX \`articles_blocks_heading_path_idx\` ON \`articles_blocks_heading\` (\`_path\`);`)
  await db.run(sql`CREATE TABLE \`articles_blocks_heading_locales\` (
  	\`text\` text NOT NULL,
  	\`id\` integer PRIMARY KEY NOT NULL,
  	\`_locale\` text NOT NULL,
  	\`_parent_id\` text NOT NULL,
  	FOREIGN KEY (\`_parent_id\`) REFERENCES \`articles_blocks_heading\`(\`id\`) ON UPDATE no action ON DELETE cascade
  );
  `)
  await db.run(sql`CREATE UNIQUE INDEX \`articles_blocks_heading_locales_locale_parent_id_unique\` ON \`articles_blocks_heading_locales\` (\`_locale\`,\`_parent_id\`);`)
  await db.run(sql`CREATE TABLE \`articles_blocks_image\` (
  	\`_order\` integer NOT NULL,
  	\`_parent_id\` integer NOT NULL,
  	\`_path\` text NOT NULL,
  	\`id\` text PRIMARY KEY NOT NULL,
  	\`image_id\` integer NOT NULL,
  	\`block_name\` text,
  	FOREIGN KEY (\`image_id\`) REFERENCES \`media\`(\`id\`) ON UPDATE no action ON DELETE set null,
  	FOREIGN KEY (\`_parent_id\`) REFERENCES \`articles\`(\`id\`) ON UPDATE no action ON DELETE cascade
  );
  `)
  await db.run(sql`CREATE INDEX \`articles_blocks_image_order_idx\` ON \`articles_blocks_image\` (\`_order\`);`)
  await db.run(sql`CREATE INDEX \`articles_blocks_image_parent_id_idx\` ON \`articles_blocks_image\` (\`_parent_id\`);`)
  await db.run(sql`CREATE INDEX \`articles_blocks_image_path_idx\` ON \`articles_blocks_image\` (\`_path\`);`)
  await db.run(sql`CREATE INDEX \`articles_blocks_image_image_idx\` ON \`articles_blocks_image\` (\`image_id\`);`)
  await db.run(sql`CREATE TABLE \`articles_blocks_image_locales\` (
  	\`alt\` text,
  	\`caption\` text,
  	\`id\` integer PRIMARY KEY NOT NULL,
  	\`_locale\` text NOT NULL,
  	\`_parent_id\` text NOT NULL,
  	FOREIGN KEY (\`_parent_id\`) REFERENCES \`articles_blocks_image\`(\`id\`) ON UPDATE no action ON DELETE cascade
  );
  `)
  await db.run(sql`CREATE UNIQUE INDEX \`articles_blocks_image_locales_locale_parent_id_unique\` ON \`articles_blocks_image_locales\` (\`_locale\`,\`_parent_id\`);`)
  await db.run(sql`CREATE TABLE \`articles_blocks_youtube\` (
  	\`_order\` integer NOT NULL,
  	\`_parent_id\` integer NOT NULL,
  	\`_path\` text NOT NULL,
  	\`id\` text PRIMARY KEY NOT NULL,
  	\`url\` text NOT NULL,
  	\`block_name\` text,
  	FOREIGN KEY (\`_parent_id\`) REFERENCES \`articles\`(\`id\`) ON UPDATE no action ON DELETE cascade
  );
  `)
  await db.run(sql`CREATE INDEX \`articles_blocks_youtube_order_idx\` ON \`articles_blocks_youtube\` (\`_order\`);`)
  await db.run(sql`CREATE INDEX \`articles_blocks_youtube_parent_id_idx\` ON \`articles_blocks_youtube\` (\`_parent_id\`);`)
  await db.run(sql`CREATE INDEX \`articles_blocks_youtube_path_idx\` ON \`articles_blocks_youtube\` (\`_path\`);`)
  await db.run(sql`CREATE TABLE \`articles_blocks_youtube_locales\` (
  	\`caption\` text,
  	\`id\` integer PRIMARY KEY NOT NULL,
  	\`_locale\` text NOT NULL,
  	\`_parent_id\` text NOT NULL,
  	FOREIGN KEY (\`_parent_id\`) REFERENCES \`articles_blocks_youtube\`(\`id\`) ON UPDATE no action ON DELETE cascade
  );
  `)
  await db.run(sql`CREATE UNIQUE INDEX \`articles_blocks_youtube_locales_locale_parent_id_unique\` ON \`articles_blocks_youtube_locales\` (\`_locale\`,\`_parent_id\`);`)
  await db.run(sql`CREATE TABLE \`articles_blocks_testimonial\` (
  	\`_order\` integer NOT NULL,
  	\`_parent_id\` integer NOT NULL,
  	\`_path\` text NOT NULL,
  	\`id\` text PRIMARY KEY NOT NULL,
  	\`image_id\` integer,
  	\`block_name\` text,
  	FOREIGN KEY (\`image_id\`) REFERENCES \`media\`(\`id\`) ON UPDATE no action ON DELETE set null,
  	FOREIGN KEY (\`_parent_id\`) REFERENCES \`articles\`(\`id\`) ON UPDATE no action ON DELETE cascade
  );
  `)
  await db.run(sql`CREATE INDEX \`articles_blocks_testimonial_order_idx\` ON \`articles_blocks_testimonial\` (\`_order\`);`)
  await db.run(sql`CREATE INDEX \`articles_blocks_testimonial_parent_id_idx\` ON \`articles_blocks_testimonial\` (\`_parent_id\`);`)
  await db.run(sql`CREATE INDEX \`articles_blocks_testimonial_path_idx\` ON \`articles_blocks_testimonial\` (\`_path\`);`)
  await db.run(sql`CREATE INDEX \`articles_blocks_testimonial_image_idx\` ON \`articles_blocks_testimonial\` (\`image_id\`);`)
  await db.run(sql`CREATE TABLE \`articles_blocks_testimonial_locales\` (
  	\`text\` text NOT NULL,
  	\`caption\` text,
  	\`id\` integer PRIMARY KEY NOT NULL,
  	\`_locale\` text NOT NULL,
  	\`_parent_id\` text NOT NULL,
  	FOREIGN KEY (\`_parent_id\`) REFERENCES \`articles_blocks_testimonial\`(\`id\`) ON UPDATE no action ON DELETE cascade
  );
  `)
  await db.run(sql`CREATE UNIQUE INDEX \`articles_blocks_testimonial_locales_locale_parent_id_unique\` ON \`articles_blocks_testimonial_locales\` (\`_locale\`,\`_parent_id\`);`)
  await db.run(sql`PRAGMA foreign_keys=OFF;`)
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
  // ponytail fix: Payload's generator wrongly SELECTs the new (not-yet-existing) icon_ref_id from
  // the old table. Omit it — the new nullable FK starts NULL and is populated by the backfill script.
  await db.run(sql`INSERT INTO \`__new_departments\`("id", "slug", "icon", "center_of_excellence", "updated_at", "created_at") SELECT "id", "slug", "icon", "center_of_excellence", "updated_at", "created_at" FROM \`departments\`;`)
  await db.run(sql`DROP TABLE \`departments\`;`)
  await db.run(sql`ALTER TABLE \`__new_departments\` RENAME TO \`departments\`;`)
  await db.run(sql`PRAGMA foreign_keys=ON;`)
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
  // ponytail fix: same generator bug — omit the new category_rel_id (backfill populates it).
  await db.run(sql`INSERT INTO \`__new_articles\`("id", "slug", "date", "author", "category", "thumbnail_id", "featured", "body", "updated_at", "created_at") SELECT "id", "slug", "date", "author", "category", "thumbnail_id", "featured", "body", "updated_at", "created_at" FROM \`articles\`;`)
  await db.run(sql`DROP TABLE \`articles\`;`)
  await db.run(sql`ALTER TABLE \`__new_articles\` RENAME TO \`articles\`;`)
  await db.run(sql`CREATE UNIQUE INDEX \`articles_slug_idx\` ON \`articles\` (\`slug\`);`)
  await db.run(sql`CREATE INDEX \`articles_category_rel_idx\` ON \`articles\` (\`category_rel_id\`);`)
  await db.run(sql`CREATE INDEX \`articles_thumbnail_idx\` ON \`articles\` (\`thumbnail_id\`);`)
  await db.run(sql`CREATE INDEX \`articles_updated_at_idx\` ON \`articles\` (\`updated_at\`);`)
  await db.run(sql`CREATE INDEX \`articles_created_at_idx\` ON \`articles\` (\`created_at\`);`)
  await db.run(sql`ALTER TABLE \`doctors\` ADD \`department_rel_id\` integer REFERENCES departments(id);`)
  await db.run(sql`CREATE INDEX \`doctors_department_rel_idx\` ON \`doctors\` (\`department_rel_id\`);`)
  await db.run(sql`ALTER TABLE \`payload_locked_documents_rels\` ADD \`icons_id\` integer REFERENCES icons(id);`)
  await db.run(sql`ALTER TABLE \`payload_locked_documents_rels\` ADD \`categories_id\` integer REFERENCES categories(id);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_icons_id_idx\` ON \`payload_locked_documents_rels\` (\`icons_id\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_categories_id_idx\` ON \`payload_locked_documents_rels\` (\`categories_id\`);`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.run(sql`DROP TABLE \`icons\`;`)
  await db.run(sql`DROP TABLE \`categories\`;`)
  await db.run(sql`DROP TABLE \`categories_locales\`;`)
  await db.run(sql`DROP TABLE \`articles_blocks_rich_text\`;`)
  await db.run(sql`DROP TABLE \`articles_blocks_rich_text_locales\`;`)
  await db.run(sql`DROP TABLE \`articles_blocks_heading\`;`)
  await db.run(sql`DROP TABLE \`articles_blocks_heading_locales\`;`)
  await db.run(sql`DROP TABLE \`articles_blocks_image\`;`)
  await db.run(sql`DROP TABLE \`articles_blocks_image_locales\`;`)
  await db.run(sql`DROP TABLE \`articles_blocks_youtube\`;`)
  await db.run(sql`DROP TABLE \`articles_blocks_youtube_locales\`;`)
  await db.run(sql`DROP TABLE \`articles_blocks_testimonial\`;`)
  await db.run(sql`DROP TABLE \`articles_blocks_testimonial_locales\`;`)
  await db.run(sql`PRAGMA foreign_keys=OFF;`)
  await db.run(sql`CREATE TABLE \`__new_doctors\` (
  	\`id\` integer PRIMARY KEY NOT NULL,
  	\`slug\` text NOT NULL,
  	\`photo_id\` integer,
  	\`department\` text,
  	\`certified\` integer DEFAULT false,
  	\`featured\` integer DEFAULT false,
  	\`order\` numeric,
  	\`updated_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  	\`created_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  	FOREIGN KEY (\`photo_id\`) REFERENCES \`media\`(\`id\`) ON UPDATE no action ON DELETE set null
  );
  `)
  await db.run(sql`INSERT INTO \`__new_doctors\`("id", "slug", "photo_id", "department", "certified", "featured", "order", "updated_at", "created_at") SELECT "id", "slug", "photo_id", "department", "certified", "featured", "order", "updated_at", "created_at" FROM \`doctors\`;`)
  await db.run(sql`DROP TABLE \`doctors\`;`)
  await db.run(sql`ALTER TABLE \`__new_doctors\` RENAME TO \`doctors\`;`)
  await db.run(sql`PRAGMA foreign_keys=ON;`)
  await db.run(sql`CREATE UNIQUE INDEX \`doctors_slug_idx\` ON \`doctors\` (\`slug\`);`)
  await db.run(sql`CREATE INDEX \`doctors_photo_idx\` ON \`doctors\` (\`photo_id\`);`)
  await db.run(sql`CREATE INDEX \`doctors_updated_at_idx\` ON \`doctors\` (\`updated_at\`);`)
  await db.run(sql`CREATE INDEX \`doctors_created_at_idx\` ON \`doctors\` (\`created_at\`);`)
  await db.run(sql`CREATE TABLE \`__new_departments\` (
  	\`id\` integer PRIMARY KEY NOT NULL,
  	\`slug\` text NOT NULL,
  	\`icon\` text NOT NULL,
  	\`center_of_excellence\` integer DEFAULT false,
  	\`updated_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  	\`created_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
  );
  `)
  await db.run(sql`INSERT INTO \`__new_departments\`("id", "slug", "icon", "center_of_excellence", "updated_at", "created_at") SELECT "id", "slug", "icon", "center_of_excellence", "updated_at", "created_at" FROM \`departments\`;`)
  await db.run(sql`DROP TABLE \`departments\`;`)
  await db.run(sql`ALTER TABLE \`__new_departments\` RENAME TO \`departments\`;`)
  await db.run(sql`CREATE UNIQUE INDEX \`departments_slug_idx\` ON \`departments\` (\`slug\`);`)
  await db.run(sql`CREATE INDEX \`departments_updated_at_idx\` ON \`departments\` (\`updated_at\`);`)
  await db.run(sql`CREATE INDEX \`departments_created_at_idx\` ON \`departments\` (\`created_at\`);`)
  await db.run(sql`CREATE TABLE \`__new_articles\` (
  	\`id\` integer PRIMARY KEY NOT NULL,
  	\`slug\` text NOT NULL,
  	\`date\` text NOT NULL,
  	\`author\` text NOT NULL,
  	\`category\` text NOT NULL,
  	\`thumbnail_id\` integer,
  	\`featured\` integer DEFAULT false,
  	\`body\` text,
  	\`updated_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  	\`created_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  	FOREIGN KEY (\`thumbnail_id\`) REFERENCES \`media\`(\`id\`) ON UPDATE no action ON DELETE set null
  );
  `)
  await db.run(sql`INSERT INTO \`__new_articles\`("id", "slug", "date", "author", "category", "thumbnail_id", "featured", "body", "updated_at", "created_at") SELECT "id", "slug", "date", "author", "category", "thumbnail_id", "featured", "body", "updated_at", "created_at" FROM \`articles\`;`)
  await db.run(sql`DROP TABLE \`articles\`;`)
  await db.run(sql`ALTER TABLE \`__new_articles\` RENAME TO \`articles\`;`)
  await db.run(sql`CREATE UNIQUE INDEX \`articles_slug_idx\` ON \`articles\` (\`slug\`);`)
  await db.run(sql`CREATE INDEX \`articles_thumbnail_idx\` ON \`articles\` (\`thumbnail_id\`);`)
  await db.run(sql`CREATE INDEX \`articles_updated_at_idx\` ON \`articles\` (\`updated_at\`);`)
  await db.run(sql`CREATE INDEX \`articles_created_at_idx\` ON \`articles\` (\`created_at\`);`)
  await db.run(sql`CREATE TABLE \`__new_payload_locked_documents_rels\` (
  	\`id\` integer PRIMARY KEY NOT NULL,
  	\`order\` integer,
  	\`parent_id\` integer NOT NULL,
  	\`path\` text NOT NULL,
  	\`users_id\` integer,
  	\`media_id\` integer,
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
  	FOREIGN KEY (\`doctors_id\`) REFERENCES \`doctors\`(\`id\`) ON UPDATE no action ON DELETE cascade,
  	FOREIGN KEY (\`departments_id\`) REFERENCES \`departments\`(\`id\`) ON UPDATE no action ON DELETE cascade,
  	FOREIGN KEY (\`articles_id\`) REFERENCES \`articles\`(\`id\`) ON UPDATE no action ON DELETE cascade,
  	FOREIGN KEY (\`events_id\`) REFERENCES \`events\`(\`id\`) ON UPDATE no action ON DELETE cascade,
  	FOREIGN KEY (\`awards_id\`) REFERENCES \`awards\`(\`id\`) ON UPDATE no action ON DELETE cascade,
  	FOREIGN KEY (\`achievements_id\`) REFERENCES \`achievements\`(\`id\`) ON UPDATE no action ON DELETE cascade,
  	FOREIGN KEY (\`testimonials_id\`) REFERENCES \`testimonials\`(\`id\`) ON UPDATE no action ON DELETE cascade
  );
  `)
  await db.run(sql`INSERT INTO \`__new_payload_locked_documents_rels\`("id", "order", "parent_id", "path", "users_id", "media_id", "doctors_id", "departments_id", "articles_id", "events_id", "awards_id", "achievements_id", "testimonials_id") SELECT "id", "order", "parent_id", "path", "users_id", "media_id", "doctors_id", "departments_id", "articles_id", "events_id", "awards_id", "achievements_id", "testimonials_id" FROM \`payload_locked_documents_rels\`;`)
  await db.run(sql`DROP TABLE \`payload_locked_documents_rels\`;`)
  await db.run(sql`ALTER TABLE \`__new_payload_locked_documents_rels\` RENAME TO \`payload_locked_documents_rels\`;`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_order_idx\` ON \`payload_locked_documents_rels\` (\`order\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_parent_idx\` ON \`payload_locked_documents_rels\` (\`parent_id\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_path_idx\` ON \`payload_locked_documents_rels\` (\`path\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_users_id_idx\` ON \`payload_locked_documents_rels\` (\`users_id\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_media_id_idx\` ON \`payload_locked_documents_rels\` (\`media_id\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_doctors_id_idx\` ON \`payload_locked_documents_rels\` (\`doctors_id\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_departments_id_idx\` ON \`payload_locked_documents_rels\` (\`departments_id\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_articles_id_idx\` ON \`payload_locked_documents_rels\` (\`articles_id\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_events_id_idx\` ON \`payload_locked_documents_rels\` (\`events_id\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_awards_id_idx\` ON \`payload_locked_documents_rels\` (\`awards_id\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_achievements_id_idx\` ON \`payload_locked_documents_rels\` (\`achievements_id\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_testimonials_id_idx\` ON \`payload_locked_documents_rels\` (\`testimonials_id\`);`)
}
