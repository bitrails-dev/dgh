import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-sqlite'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.run(sql`CREATE TABLE \`social_connections\` (
  	\`id\` integer PRIMARY KEY NOT NULL,
  	\`tenant_id\` integer NOT NULL,
  	\`platform\` text NOT NULL,
  	\`remote_account_id\` text NOT NULL,
  	\`remote_account_label\` text,
  	\`status\` text DEFAULT 'connected',
  	\`encrypted_tokens\` text NOT NULL,
  	\`token_expires_at\` text,
  	\`scope\` text,
  	\`last_publish_status\` text,
  	\`last_publish_at\` text,
  	\`last_publish_url\` text,
  	\`last_error_code\` text,
  	\`updated_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  	\`created_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  	FOREIGN KEY (\`tenant_id\`) REFERENCES \`tenants\`(\`id\`) ON UPDATE no action ON DELETE set null
  );
  `)
  await db.run(sql`CREATE INDEX \`social_connections_tenant_idx\` ON \`social_connections\` (\`tenant_id\`);`)
  await db.run(sql`CREATE INDEX \`social_connections_platform_idx\` ON \`social_connections\` (\`platform\`);`)
  await db.run(sql`CREATE INDEX \`social_connections_status_idx\` ON \`social_connections\` (\`status\`);`)
  await db.run(sql`CREATE INDEX \`social_connections_updated_at_idx\` ON \`social_connections\` (\`updated_at\`);`)
  await db.run(sql`CREATE INDEX \`social_connections_created_at_idx\` ON \`social_connections\` (\`created_at\`);`)
  await db.run(sql`CREATE UNIQUE INDEX \`tenant_platform_remoteAccountId_idx\` ON \`social_connections\` (\`tenant_id\`,\`platform\`,\`remote_account_id\`);`)
  await db.run(sql`CREATE TABLE \`social_publications\` (
  	\`id\` integer PRIMARY KEY NOT NULL,
  	\`tenant_id\` integer NOT NULL,
  	\`article_id\` integer NOT NULL,
  	\`platform\` text NOT NULL,
  	\`locale\` text,
  	\`status\` text DEFAULT 'pending' NOT NULL,
  	\`attempts\` numeric DEFAULT 0,
  	\`payload_hash\` text,
  	\`remote_id\` text,
  	\`remote_url\` text,
  	\`error_code\` text,
  	\`error_message\` text,
  	\`failure_kind\` text,
  	\`skipped_reason\` text,
  	\`updated_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  	\`created_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  	FOREIGN KEY (\`tenant_id\`) REFERENCES \`tenants\`(\`id\`) ON UPDATE no action ON DELETE set null,
  	FOREIGN KEY (\`article_id\`) REFERENCES \`articles\`(\`id\`) ON UPDATE no action ON DELETE set null
  );
  `)
  await db.run(sql`CREATE INDEX \`social_publications_tenant_idx\` ON \`social_publications\` (\`tenant_id\`);`)
  await db.run(sql`CREATE INDEX \`social_publications_article_idx\` ON \`social_publications\` (\`article_id\`);`)
  await db.run(sql`CREATE INDEX \`social_publications_status_idx\` ON \`social_publications\` (\`status\`);`)
  await db.run(sql`CREATE INDEX \`social_publications_updated_at_idx\` ON \`social_publications\` (\`updated_at\`);`)
  await db.run(sql`CREATE INDEX \`social_publications_created_at_idx\` ON \`social_publications\` (\`created_at\`);`)
  await db.run(sql`CREATE UNIQUE INDEX \`article_platform_idx\` ON \`social_publications\` (\`article_id\`,\`platform\`);`)
  await db.run(sql`CREATE TABLE \`social_oauth_states\` (
  	\`id\` integer PRIMARY KEY NOT NULL,
  	\`nonce_hash\` text NOT NULL,
  	\`tenant_id\` integer NOT NULL,
  	\`platform\` text NOT NULL,
  	\`expires_at\` text NOT NULL,
  	\`consumed_at\` text,
  	\`updated_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  	\`created_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  	FOREIGN KEY (\`tenant_id\`) REFERENCES \`tenants\`(\`id\`) ON UPDATE no action ON DELETE set null
  );
  `)
  await db.run(sql`CREATE UNIQUE INDEX \`social_oauth_states_nonce_hash_idx\` ON \`social_oauth_states\` (\`nonce_hash\`);`)
  await db.run(sql`CREATE INDEX \`social_oauth_states_tenant_idx\` ON \`social_oauth_states\` (\`tenant_id\`);`)
  await db.run(sql`CREATE INDEX \`social_oauth_states_updated_at_idx\` ON \`social_oauth_states\` (\`updated_at\`);`)
  await db.run(sql`CREATE INDEX \`social_oauth_states_created_at_idx\` ON \`social_oauth_states\` (\`created_at\`);`)
  await db.run(sql`ALTER TABLE \`payload_locked_documents_rels\` ADD \`social_connections_id\` integer REFERENCES social_connections(id);`)
  await db.run(sql`ALTER TABLE \`payload_locked_documents_rels\` ADD \`social_publications_id\` integer REFERENCES social_publications(id);`)
  await db.run(sql`ALTER TABLE \`payload_locked_documents_rels\` ADD \`social_oauth_states_id\` integer REFERENCES social_oauth_states(id);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_social_connections_id_idx\` ON \`payload_locked_documents_rels\` (\`social_connections_id\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_social_publications_id_idx\` ON \`payload_locked_documents_rels\` (\`social_publications_id\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_social_oauth_states_id_idx\` ON \`payload_locked_documents_rels\` (\`social_oauth_states_id\`);`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.run(sql`DROP TABLE \`social_connections\`;`)
  await db.run(sql`DROP TABLE \`social_publications\`;`)
  await db.run(sql`DROP TABLE \`social_oauth_states\`;`)
  await db.run(sql`PRAGMA foreign_keys=OFF;`)
  await db.run(sql`CREATE TABLE \`__new_payload_locked_documents_rels\` (
  	\`id\` integer PRIMARY KEY NOT NULL,
  	\`order\` integer,
  	\`parent_id\` integer NOT NULL,
  	\`path\` text NOT NULL,
  	\`users_id\` integer,
  	\`tenants_id\` integer,
  	\`tenant_types_id\` integer,
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
  	FOREIGN KEY (\`tenant_types_id\`) REFERENCES \`tenant_types\`(\`id\`) ON UPDATE no action ON DELETE cascade,
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
  await db.run(sql`INSERT INTO \`__new_payload_locked_documents_rels\`("id", "order", "parent_id", "path", "users_id", "tenants_id", "tenant_types_id", "media_id", "icons_id", "categories_id", "doctors_id", "departments_id", "articles_id", "events_id", "awards_id", "achievements_id", "testimonials_id") SELECT "id", "order", "parent_id", "path", "users_id", "tenants_id", "tenant_types_id", "media_id", "icons_id", "categories_id", "doctors_id", "departments_id", "articles_id", "events_id", "awards_id", "achievements_id", "testimonials_id" FROM \`payload_locked_documents_rels\`;`)
  await db.run(sql`DROP TABLE \`payload_locked_documents_rels\`;`)
  await db.run(sql`ALTER TABLE \`__new_payload_locked_documents_rels\` RENAME TO \`payload_locked_documents_rels\`;`)
  await db.run(sql`PRAGMA foreign_keys=ON;`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_order_idx\` ON \`payload_locked_documents_rels\` (\`order\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_parent_idx\` ON \`payload_locked_documents_rels\` (\`parent_id\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_path_idx\` ON \`payload_locked_documents_rels\` (\`path\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_users_id_idx\` ON \`payload_locked_documents_rels\` (\`users_id\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_tenants_id_idx\` ON \`payload_locked_documents_rels\` (\`tenants_id\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_tenant_types_id_idx\` ON \`payload_locked_documents_rels\` (\`tenant_types_id\`);`)
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
