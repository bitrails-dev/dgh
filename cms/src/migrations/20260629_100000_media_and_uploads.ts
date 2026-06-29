// Incremental migration: introduce the `media` collection and convert each
// image field from a TEXT url column into an upload relationship (`*_id` FK).
//
// Current DB stores urls as TEXT (doctors.photo, articles.thumbnail,
// awards.badge_image, events.thumbnail, testimonials.avatar, events_gallery.url).
// Target: FK columns referencing `media`. URL data is migrated separately by
// scripts/migrate-images.ts AFTER this migration runs.
//
// events_gallery / events_gallery_locales hold no rows, so they are dropped and
// recreated to match the (localized) target shape exactly.
import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-sqlite'

export async function up({ db }: MigrateUpArgs): Promise<void> {
  // 1. media collection (matches payload-generated-schema.ts)
  await db.run(sql`CREATE TABLE \`media\` (
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
  );`)
  await db.run(sql`CREATE INDEX \`media_updated_at_idx\` ON \`media\` (\`updated_at\`);`)
  await db.run(sql`CREATE INDEX \`media_created_at_idx\` ON \`media\` (\`created_at\`);`)
  await db.run(sql`CREATE UNIQUE INDEX \`media_filename_idx\` ON \`media\` (\`filename\`);`)

  // 2. add upload FK columns + indexes (data-bearing tables)
  await db.run(sql`ALTER TABLE \`doctors\` ADD COLUMN \`photo_id\` integer REFERENCES \`media\`(\`id\`) ON UPDATE no action ON DELETE set null;`)
  await db.run(sql`CREATE INDEX \`doctors_photo_idx\` ON \`doctors\` (\`photo_id\`);`)

  await db.run(sql`ALTER TABLE \`articles\` ADD COLUMN \`thumbnail_id\` integer REFERENCES \`media\`(\`id\`) ON UPDATE no action ON DELETE set null;`)
  await db.run(sql`CREATE INDEX \`articles_thumbnail_idx\` ON \`articles\` (\`thumbnail_id\`);`)

  await db.run(sql`ALTER TABLE \`awards\` ADD COLUMN \`badge_image_id\` integer REFERENCES \`media\`(\`id\`) ON UPDATE no action ON DELETE set null;`)
  await db.run(sql`CREATE INDEX \`awards_badge_image_idx\` ON \`awards\` (\`badge_image_id\`);`)

  await db.run(sql`ALTER TABLE \`events\` ADD COLUMN \`thumbnail_id\` integer REFERENCES \`media\`(\`id\`) ON UPDATE no action ON DELETE set null;`)
  await db.run(sql`CREATE INDEX \`events_thumbnail_idx\` ON \`events\` (\`thumbnail_id\`);`)

  await db.run(sql`ALTER TABLE \`testimonials\` ADD COLUMN \`avatar_id\` integer REFERENCES \`media\`(\`id\`) ON UPDATE no action ON DELETE set null;`)
  await db.run(sql`CREATE INDEX \`testimonials_avatar_idx\` ON \`testimonials\` (\`avatar_id\`);`)

  // 3. drop the old TEXT url columns (data already extracted to image-urls.json)
  await db.run(sql`ALTER TABLE \`doctors\` DROP COLUMN \`photo\`;`)
  await db.run(sql`ALTER TABLE \`articles\` DROP COLUMN \`thumbnail\`;`)
  await db.run(sql`ALTER TABLE \`awards\` DROP COLUMN \`badge_image\`;`)
  await db.run(sql`ALTER TABLE \`events\` DROP COLUMN \`thumbnail\`;`)
  await db.run(sql`ALTER TABLE \`testimonials\` DROP COLUMN \`avatar\`;`)

  // 4. events_gallery: empty, recreate to localized target shape (image_id FK, alt in locales)
  await db.run(sql`DROP TABLE \`events_gallery_locales\`;`)
  await db.run(sql`DROP TABLE \`events_gallery\`;`)
  await db.run(sql`CREATE TABLE \`events_gallery\` (
    \`_order\` integer NOT NULL,
    \`_parent_id\` integer NOT NULL,
    \`id\` text PRIMARY KEY NOT NULL,
    \`image_id\` integer NOT NULL REFERENCES \`media\`(\`id\`) ON UPDATE no action ON DELETE set null,
    FOREIGN KEY (\`_parent_id\`) REFERENCES \`events\`(\`id\`) ON UPDATE no action ON DELETE cascade
  );`)
  await db.run(sql`CREATE INDEX \`events_gallery_order_idx\` ON \`events_gallery\` (\`_order\`);`)
  await db.run(sql`CREATE INDEX \`events_gallery_parent_id_idx\` ON \`events_gallery\` (\`_parent_id\`);`)
  await db.run(sql`CREATE INDEX \`events_gallery_image_idx\` ON \`events_gallery\` (\`image_id\`);`)
  await db.run(sql`CREATE TABLE \`events_gallery_locales\` (
    \`caption\` text,
    \`alt\` text NOT NULL,
    \`id\` integer PRIMARY KEY NOT NULL,
    \`_locale\` text NOT NULL,
    \`_parent_id\` text NOT NULL,
    FOREIGN KEY (\`_parent_id\`) REFERENCES \`events_gallery\`(\`id\`) ON UPDATE no action ON DELETE cascade
  );`)
  await db.run(sql`CREATE UNIQUE INDEX \`events_gallery_locales_locale_parent_id_unique\` ON \`events_gallery_locales\` (\`_locale\`,\`_parent_id\`);`)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  // Restore TEXT url columns and remove media. Image data is NOT restored
  // (urls were extracted to image-urls.json before the up migration).
  await db.run(sql`ALTER TABLE \`doctors\` ADD COLUMN \`photo\` text;`)
  await db.run(sql`ALTER TABLE \`articles\` ADD COLUMN \`thumbnail\` text;`)
  await db.run(sql`ALTER TABLE \`awards\` ADD COLUMN \`badge_image\` text;`)
  await db.run(sql`ALTER TABLE \`events\` ADD COLUMN \`thumbnail\` text;`)
  await db.run(sql`ALTER TABLE \`testimonials\` ADD COLUMN \`avatar\` text;`)

  await db.run(sql`DROP INDEX IF EXISTS \`doctors_photo_idx\`;`)
  await db.run(sql`DROP INDEX IF EXISTS \`articles_thumbnail_idx\`;`)
  await db.run(sql`DROP INDEX IF EXISTS \`awards_badge_image_idx\`;`)
  await db.run(sql`DROP INDEX IF EXISTS \`events_thumbnail_idx\`;`)
  await db.run(sql`DROP INDEX IF EXISTS \`testimonials_avatar_idx\`;`)

  await db.run(sql`ALTER TABLE \`doctors\` DROP COLUMN \`photo_id\`;`)
  await db.run(sql`ALTER TABLE \`articles\` DROP COLUMN \`thumbnail_id\`;`)
  await db.run(sql`ALTER TABLE \`awards\` DROP COLUMN \`badge_image_id\`;`)
  await db.run(sql`ALTER TABLE \`events\` DROP COLUMN \`thumbnail_id\`;`)
  await db.run(sql`ALTER TABLE \`testimonials\` DROP COLUMN \`avatar_id\`;`)

  await db.run(sql`DROP TABLE IF EXISTS \`events_gallery_locales\`;`)
  await db.run(sql`DROP TABLE IF EXISTS \`events_gallery\`;`)
  await db.run(sql`CREATE TABLE \`events_gallery\` (
    \`_order\` integer NOT NULL,
    \`_parent_id\` integer NOT NULL,
    \`id\` text PRIMARY KEY NOT NULL,
    \`url\` text NOT NULL,
    \`alt\` text NOT NULL,
    FOREIGN KEY (\`_parent_id\`) REFERENCES \`events\`(\`id\`) ON UPDATE no action ON DELETE cascade
  );`)
  await db.run(sql`CREATE INDEX \`events_gallery_order_idx\` ON \`events_gallery\` (\`_order\`);`)
  await db.run(sql`CREATE INDEX \`events_gallery_parent_id_idx\` ON \`events_gallery\` (\`_parent_id\`);`)
  await db.run(sql`CREATE TABLE \`events_gallery_locales\` (
    \`caption\` text,
    \`id\` integer PRIMARY KEY NOT NULL,
    \`_locale\` text NOT NULL,
    \`_parent_id\` text NOT NULL,
    FOREIGN KEY (\`_parent_id\`) REFERENCES \`events_gallery\`(\`id\`) ON UPDATE no action ON DELETE cascade
  );`)
  await db.run(sql`CREATE UNIQUE INDEX \`events_gallery_locales_locale_parent_id_unique\` ON \`events_gallery_locales\` (\`_locale\`,\`_parent_id\`);`)

  await db.run(sql`DROP TABLE \`media\`;`)
}
