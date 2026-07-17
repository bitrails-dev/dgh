import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-sqlite'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.run(sql`ALTER TABLE \`social_oauth_states\` ADD \`encrypted_candidates\` text;`)
  await db.run(sql`ALTER TABLE \`social_oauth_states\` ADD \`return_to\` text;`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.run(sql`ALTER TABLE \`social_oauth_states\` DROP COLUMN \`encrypted_candidates\`;`)
  await db.run(sql`ALTER TABLE \`social_oauth_states\` DROP COLUMN \`return_to\`;`)
}
