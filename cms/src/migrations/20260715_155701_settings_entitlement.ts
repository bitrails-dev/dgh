import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-sqlite'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.run(sql`CREATE TABLE \`tenants_settings_entitlement\` (
  	\`order\` integer NOT NULL,
  	\`parent_id\` integer NOT NULL,
  	\`value\` text,
  	\`id\` integer PRIMARY KEY NOT NULL,
  	FOREIGN KEY (\`parent_id\`) REFERENCES \`tenants\`(\`id\`) ON UPDATE no action ON DELETE cascade
  );
  `)
  await db.run(sql`CREATE INDEX \`tenants_settings_entitlement_order_idx\` ON \`tenants_settings_entitlement\` (\`order\`);`)
  await db.run(sql`CREATE INDEX \`tenants_settings_entitlement_parent_idx\` ON \`tenants_settings_entitlement\` (\`parent_id\`);`)
  // Backward compatibility: every existing tenant is entitled to all four setting groups so the
  // feature is strictly additive. A super-admin may restrict it afterwards.
  await db.run(sql`INSERT INTO \`tenants_settings_entitlement\` (\`order\`, \`parent_id\`, \`value\`)
  	SELECT grp.\`o\`, \`tenants\`.\`id\`, grp.\`g\`
  	FROM \`tenants\`
  	CROSS JOIN (
  		SELECT 0 AS \`o\`, 'general' AS \`g\`
  		UNION ALL SELECT 1, 'branding'
  		UNION ALL SELECT 2, 'hero'
  		UNION ALL SELECT 3, 'contact'
  	) AS grp;`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.run(sql`DROP TABLE \`tenants_settings_entitlement\`;`)
}
