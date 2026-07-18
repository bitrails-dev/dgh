import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-sqlite'

// Additive: convert `customers` to a Payload auth collection (plugin-first plan §3.6 / Wave B2).
// Adds Payload's standard auth columns (username / salt / hash / _verified / _verificationtoken /
// login_attempts / lock_until / reset_password_token / reset_password_expiration), the
// `customers_sessions` table for `auth.useSessions`, and a GLOBAL unique index on the server-derived
// username `<tenantId>:<normalizedEmail>`. Drops the legacy custom credential columns (Payload's auth
// strategy owns hashing + verification now) and the old per-tenant (tenant_id, normalized_email)
// unique index. Additive ONLY — no historical migration is modified, no other table is touched.
export async function up({ db }: MigrateUpArgs): Promise<void> {
  // --- Payload auth columns ---
  await db.run(sql`ALTER TABLE \`customers\` ADD COLUMN \`username\` text NOT NULL DEFAULT '';`)
  await db.run(sql`ALTER TABLE \`customers\` ADD COLUMN \`salt\` text;`)
  await db.run(sql`ALTER TABLE \`customers\` ADD COLUMN \`hash\` text;`)
  await db.run(sql`ALTER TABLE \`customers\` ADD COLUMN \`_verified\` integer;`)
  await db.run(sql`ALTER TABLE \`customers\` ADD COLUMN \`_verificationtoken\` text;`)
  await db.run(sql`ALTER TABLE \`customers\` ADD COLUMN \`login_attempts\` numeric DEFAULT 0;`)
  await db.run(sql`ALTER TABLE \`customers\` ADD COLUMN \`lock_until\` text;`)
  await db.run(sql`ALTER TABLE \`customers\` ADD COLUMN \`reset_password_token\` text;`)
  await db.run(sql`ALTER TABLE \`customers\` ADD COLUMN \`reset_password_expiration\` text;`)

  // --- Legacy custom credential columns (Payload owns these now) ---
  await db.run(sql`ALTER TABLE \`customers\` DROP COLUMN \`password_hash\`;`)
  await db.run(sql`ALTER TABLE \`customers\` DROP COLUMN \`password_salt\`;`)
  await db.run(sql`ALTER TABLE \`customers\` DROP COLUMN \`verified\`;`)
  await db.run(sql`ALTER TABLE \`customers\` DROP COLUMN \`verification_token_hash\`;`)
  await db.run(sql`ALTER TABLE \`customers\` DROP COLUMN \`reset_token_hash\`;`)

  // --- Uniqueness: per-tenant email → globally-unique server-derived username ---
  await db.run(sql`DROP INDEX IF EXISTS \`customers_tenant_email_uniq\`;`)
  await db.run(sql`CREATE UNIQUE INDEX \`customers_username_idx\` ON \`customers\` (\`username\`);`)

  // --- Session store for auth.useSessions ---
  await db.run(sql`CREATE TABLE \`customers_sessions\` (
  	\`_order\` integer NOT NULL,
  	\`_parent_id\` integer NOT NULL,
  	\`id\` text PRIMARY KEY NOT NULL,
  	\`created_at\` text,
  	\`expires_at\` text NOT NULL,
  	FOREIGN KEY (\`_parent_id\`) REFERENCES \`customers\`(\`id\`) ON UPDATE no action ON DELETE cascade
  );`)
  await db.run(sql`CREATE INDEX \`customers_sessions_order_idx\` ON \`customers_sessions\` (\`_order\`);`)
  await db.run(sql`CREATE INDEX \`customers_sessions_parent_id_idx\` ON \`customers_sessions\` (\`_parent_id\`);`)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.run(sql`DROP TABLE IF EXISTS \`customers_sessions\`;`)
  await db.run(sql`DROP INDEX IF EXISTS \`customers_username_idx\`;`)
  await db.run(sql`CREATE UNIQUE INDEX \`customers_tenant_email_uniq\` ON \`customers\` (\`tenant_id\`, \`normalized_email\`);`)
  await db.run(sql`ALTER TABLE \`customers\` ADD COLUMN \`password_hash\` text;`)
  await db.run(sql`ALTER TABLE \`customers\` ADD COLUMN \`password_salt\` text;`)
  await db.run(sql`ALTER TABLE \`customers\` ADD COLUMN \`verified\` numeric DEFAULT 0;`)
  await db.run(sql`ALTER TABLE \`customers\` ADD COLUMN \`verification_token_hash\` text;`)
  await db.run(sql`ALTER TABLE \`customers\` ADD COLUMN \`reset_token_hash\` text;`)
  await db.run(sql`ALTER TABLE \`customers\` DROP COLUMN \`username\`;`)
  await db.run(sql`ALTER TABLE \`customers\` DROP COLUMN \`salt\`;`)
  await db.run(sql`ALTER TABLE \`customers\` DROP COLUMN \`hash\`;`)
  await db.run(sql`ALTER TABLE \`customers\` DROP COLUMN \`_verified\`;`)
  await db.run(sql`ALTER TABLE \`customers\` DROP COLUMN \`_verificationtoken\`;`)
  await db.run(sql`ALTER TABLE \`customers\` DROP COLUMN \`login_attempts\`;`)
  await db.run(sql`ALTER TABLE \`customers\` DROP COLUMN \`lock_until\`;`)
  await db.run(sql`ALTER TABLE \`customers\` DROP COLUMN \`reset_password_token\`;`)
  await db.run(sql`ALTER TABLE \`customers\` DROP COLUMN \`reset_password_expiration\`;`)
}
