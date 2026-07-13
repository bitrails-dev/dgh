import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-sqlite'

// Additive migration for social auto-publishing:
//  - new `videos` upload collection
//  - `articles.video_id` (FK → videos) + `articles.social_*` columns
//  - `payload_locked_documents_rels.videos_id` (FK → videos)
//
// All pure additions (CREATE TABLE / ADD COLUMN) — no table rebuild in `up`, so it
// avoids the migrate:create FK-nullable bug this project hit before. Hand-written;
// column names/shapes mirror the `icons` upload collection from the prior migration.
// Copy-test before applying to the real DB (see SETUP-social-publishing.md).
export async function up({ db }: MigrateUpArgs): Promise<void> {
  // --- videos upload collection (mirrors the `icons` upload table shape) ---
  await db.run(sql`CREATE TABLE \`videos\` (
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
  await db.run(sql`CREATE INDEX \`videos_updated_at_idx\` ON \`videos\` (\`updated_at\`);`)
  await db.run(sql`CREATE INDEX \`videos_created_at_idx\` ON \`videos\` (\`created_at\`);`)
  await db.run(sql`CREATE UNIQUE INDEX \`videos_filename_idx\` ON \`videos\` (\`filename\`);`)

  // --- articles: video relation + social fields ---
  await db.run(sql`ALTER TABLE \`articles\` ADD \`video_id\` integer REFERENCES videos(id);`)
  await db.run(sql`CREATE INDEX \`articles_video_idx\` ON \`articles\` (\`video_id\`);`)
  await db.run(sql`ALTER TABLE \`articles\` ADD \`social_auto_publish\` integer DEFAULT true;`)
  await db.run(sql`ALTER TABLE \`articles\` ADD \`social_caption\` text;`)
  await db.run(sql`ALTER TABLE \`articles\` ADD \`social_results\` text;`)

  // --- polymorphic locked-documents relation for the new collection ---
  await db.run(sql`ALTER TABLE \`payload_locked_documents_rels\` ADD \`videos_id\` integer REFERENCES videos(id);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_videos_id_idx\` ON \`payload_locked_documents_rels\` (\`videos_id\`);`)
}

// Best-effort reverse. This project runs up-only in practice; down rebuilds the two
// tables that gained FK columns (which SQLite can't DROP COLUMN directly) and drops
// the videos table.
export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.run(sql`PRAGMA foreign_keys=OFF;`)

  // articles → drop video_id + social_* by rebuild
  await db.run(sql`DROP INDEX IF EXISTS \`articles_video_idx\`;`)
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

  // payload_locked_documents_rels → drop videos_id by rebuild (keeps icons_id/categories_id)
  await db.run(sql`DROP INDEX IF EXISTS \`payload_locked_documents_rels_videos_id_idx\`;`)
  await db.run(sql`CREATE TABLE \`__new_pld_rels\` (
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
  await db.run(sql`INSERT INTO \`__new_pld_rels\`("id", "order", "parent_id", "path", "users_id", "media_id", "icons_id", "categories_id", "doctors_id", "departments_id", "articles_id", "events_id", "awards_id", "achievements_id", "testimonials_id") SELECT "id", "order", "parent_id", "path", "users_id", "media_id", "icons_id", "categories_id", "doctors_id", "departments_id", "articles_id", "events_id", "awards_id", "achievements_id", "testimonials_id" FROM \`payload_locked_documents_rels\`;`)
  await db.run(sql`DROP TABLE \`payload_locked_documents_rels\`;`)
  await db.run(sql`ALTER TABLE \`__new_pld_rels\` RENAME TO \`payload_locked_documents_rels\`;`)
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

  await db.run(sql`PRAGMA foreign_keys=ON;`)
  await db.run(sql`DROP TABLE IF EXISTS \`videos\`;`)
}
