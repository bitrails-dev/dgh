import type { MigrateDownArgs, MigrateUpArgs } from '@payloadcms/db-sqlite'
import { sql } from '@payloadcms/db-sqlite'

// Move customer-facing product content into Payload's locale tables. Existing scalar values are
// preserved as Arabic (the configured default locale); English reads may use Payload fallback until
// an editor supplies an English translation. Versions receive the same treatment so drafts and
// autosaves remain valid.
export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.run(sql`CREATE TABLE \`store_products_locales\` (
    \`name\` text,
    \`description\` text,
    \`id\` integer PRIMARY KEY NOT NULL,
    \`_locale\` text NOT NULL,
    \`_parent_id\` integer NOT NULL,
    FOREIGN KEY (\`_parent_id\`) REFERENCES \`store_products\`(\`id\`) ON UPDATE no action ON DELETE cascade
  );`)
  await db.run(sql`CREATE UNIQUE INDEX \`store_products_locales_locale_parent_id_unique\` ON \`store_products_locales\` (\`_locale\`, \`_parent_id\`);`)
  await db.run(sql`INSERT INTO \`store_products_locales\` (\`name\`, \`description\`, \`_locale\`, \`_parent_id\`)
    SELECT \`name\`, \`description\`, 'ar', \`id\` FROM \`store_products\`
    WHERE \`name\` IS NOT NULL OR \`description\` IS NOT NULL;`)

  await db.run(sql`CREATE TABLE \`_store_products_v_locales\` (
    \`version_name\` text,
    \`version_description\` text,
    \`id\` integer PRIMARY KEY NOT NULL,
    \`_locale\` text NOT NULL,
    \`_parent_id\` integer NOT NULL,
    FOREIGN KEY (\`_parent_id\`) REFERENCES \`_store_products_v\`(\`id\`) ON UPDATE no action ON DELETE cascade
  );`)
  await db.run(sql`CREATE UNIQUE INDEX \`_store_products_v_locales_locale_parent_id_unique\` ON \`_store_products_v_locales\` (\`_locale\`, \`_parent_id\`);`)
  await db.run(sql`INSERT INTO \`_store_products_v_locales\` (\`version_name\`, \`version_description\`, \`_locale\`, \`_parent_id\`)
    SELECT \`version_name\`, \`version_description\`, 'ar', \`id\` FROM \`_store_products_v\`
    WHERE \`version_name\` IS NOT NULL OR \`version_description\` IS NOT NULL;`)

  await db.run(sql`ALTER TABLE \`store_products\` DROP COLUMN \`name\`;`)
  await db.run(sql`ALTER TABLE \`store_products\` DROP COLUMN \`description\`;`)
  await db.run(sql`ALTER TABLE \`_store_products_v\` DROP COLUMN \`version_name\`;`)
  await db.run(sql`ALTER TABLE \`_store_products_v\` DROP COLUMN \`version_description\`;`)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.run(sql`ALTER TABLE \`store_products\` ADD COLUMN \`name\` text;`)
  await db.run(sql`ALTER TABLE \`store_products\` ADD COLUMN \`description\` text;`)
  await db.run(sql`UPDATE \`store_products\` SET
    \`name\` = COALESCE(
      (SELECT \`name\` FROM \`store_products_locales\` WHERE \`_parent_id\` = \`store_products\`.\`id\` AND \`_locale\` = 'ar'),
      (SELECT \`name\` FROM \`store_products_locales\` WHERE \`_parent_id\` = \`store_products\`.\`id\` LIMIT 1)
    ),
    \`description\` = COALESCE(
      (SELECT \`description\` FROM \`store_products_locales\` WHERE \`_parent_id\` = \`store_products\`.\`id\` AND \`_locale\` = 'ar'),
      (SELECT \`description\` FROM \`store_products_locales\` WHERE \`_parent_id\` = \`store_products\`.\`id\` LIMIT 1)
    );`)

  await db.run(sql`ALTER TABLE \`_store_products_v\` ADD COLUMN \`version_name\` text;`)
  await db.run(sql`ALTER TABLE \`_store_products_v\` ADD COLUMN \`version_description\` text;`)
  await db.run(sql`UPDATE \`_store_products_v\` SET
    \`version_name\` = COALESCE(
      (SELECT \`version_name\` FROM \`_store_products_v_locales\` WHERE \`_parent_id\` = \`_store_products_v\`.\`id\` AND \`_locale\` = 'ar'),
      (SELECT \`version_name\` FROM \`_store_products_v_locales\` WHERE \`_parent_id\` = \`_store_products_v\`.\`id\` LIMIT 1)
    ),
    \`version_description\` = COALESCE(
      (SELECT \`version_description\` FROM \`_store_products_v_locales\` WHERE \`_parent_id\` = \`_store_products_v\`.\`id\` AND \`_locale\` = 'ar'),
      (SELECT \`version_description\` FROM \`_store_products_v_locales\` WHERE \`_parent_id\` = \`_store_products_v\`.\`id\` LIMIT 1)
    );`)

  await db.run(sql`DROP TABLE \`_store_products_v_locales\`;`)
  await db.run(sql`DROP TABLE \`store_products_locales\`;`)
}
