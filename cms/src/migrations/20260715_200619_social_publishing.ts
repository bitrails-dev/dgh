import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-sqlite'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.run(sql`CREATE TABLE \`tenants_social_publishing_included_platforms\` (
  	\`order\` integer NOT NULL,
  	\`parent_id\` integer NOT NULL,
  	\`value\` text,
  	\`id\` integer PRIMARY KEY NOT NULL,
  	FOREIGN KEY (\`parent_id\`) REFERENCES \`tenants\`(\`id\`) ON UPDATE no action ON DELETE cascade
  );
  `)
  await db.run(sql`CREATE INDEX \`tenants_social_publishing_included_platforms_order_idx\` ON \`tenants_social_publishing_included_platforms\` (\`order\`);`)
  await db.run(sql`CREATE INDEX \`tenants_social_publishing_included_platforms_parent_idx\` ON \`tenants_social_publishing_included_platforms\` (\`parent_id\`);`)
  await db.run(sql`ALTER TABLE \`tenants\` ADD \`contact_social_instagram_url\` text;`)
  await db.run(sql`ALTER TABLE \`tenants\` ADD \`contact_social_threads_url\` text;`)
  await db.run(sql`ALTER TABLE \`tenants\` ADD \`contact_social_snapchat_url\` text;`)
  await db.run(sql`ALTER TABLE \`tenants\` ADD \`contact_social_linkedin_url\` text;`)
  await db.run(sql`ALTER TABLE \`tenants\` ADD \`contact_social_tiktok_url\` text;`)
  await db.run(sql`ALTER TABLE \`tenants\` ADD \`social_publishing_enabled\` integer DEFAULT false;`)
  await db.run(sql`ALTER TABLE \`tenants\` ADD \`social_publishing_default_auto_publish\` integer DEFAULT false;`)

  // Backfill the new `socialPublishing` setting entitlement ONLY for tenants that previously had
  // the complete prior set (general+branding+hero+contact). Intentionally restricted tenants (a
  // platform operator withheld some groups) are left untouched. Idempotent: skip any tenant that
  // already has the group. New tenants get it via the field's default (ALL_TENANT_SETTING_GROUPS).
  await db.run(sql`INSERT INTO \`tenants_settings_entitlement\` (\`order\`, \`parent_id\`, \`value\`)
  	SELECT
  		COALESCE((SELECT MAX(e2.\`order\`) + 1 FROM \`tenants_settings_entitlement\` e2 WHERE e2.\`parent_id\` = \`tenants\`.\`id\`), 0),
  		\`tenants\`.\`id\`,
  		'socialPublishing'
  	FROM \`tenants\`
  	WHERE NOT EXISTS (SELECT 1 FROM \`tenants_settings_entitlement\` e WHERE e.\`parent_id\` = \`tenants\`.\`id\` AND e.\`value\` = 'socialPublishing')
  		AND EXISTS (SELECT 1 FROM \`tenants_settings_entitlement\` e WHERE e.\`parent_id\` = \`tenants\`.\`id\` AND e.\`value\` = 'general')
  		AND EXISTS (SELECT 1 FROM \`tenants_settings_entitlement\` e WHERE e.\`parent_id\` = \`tenants\`.\`id\` AND e.\`value\` = 'branding')
  		AND EXISTS (SELECT 1 FROM \`tenants_settings_entitlement\` e WHERE e.\`parent_id\` = \`tenants\`.\`id\` AND e.\`value\` = 'hero')
  		AND EXISTS (SELECT 1 FROM \`tenants_settings_entitlement\` e WHERE e.\`parent_id\` = \`tenants\`.\`id\` AND e.\`value\` = 'contact');`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  // Remove only the backfilled group; leave every tenant's original entitlement intact.
  await db.run(sql`DELETE FROM \`tenants_settings_entitlement\` WHERE \`value\` = 'socialPublishing';`)
  await db.run(sql`DROP TABLE \`tenants_social_publishing_included_platforms\`;`)
  await db.run(sql`ALTER TABLE \`tenants\` DROP COLUMN \`contact_social_instagram_url\`;`)
  await db.run(sql`ALTER TABLE \`tenants\` DROP COLUMN \`contact_social_threads_url\`;`)
  await db.run(sql`ALTER TABLE \`tenants\` DROP COLUMN \`contact_social_snapchat_url\`;`)
  await db.run(sql`ALTER TABLE \`tenants\` DROP COLUMN \`contact_social_linkedin_url\`;`)
  await db.run(sql`ALTER TABLE \`tenants\` DROP COLUMN \`contact_social_tiktok_url\`;`)
  await db.run(sql`ALTER TABLE \`tenants\` DROP COLUMN \`social_publishing_enabled\`;`)
  await db.run(sql`ALTER TABLE \`tenants\` DROP COLUMN \`social_publishing_default_auto_publish\`;`)
}
