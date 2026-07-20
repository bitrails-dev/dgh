import type { MigrateUpArgs, MigrateDownArgs } from '@payloadcms/db-sqlite'
import { sql } from '@payloadcms/db-sqlite'

// store-products: add the `name` display column (Wave F2).
//
// The @payloadcms/plugin-ecommerce products collection ships no name/title field, so once the
// storefront catalog was repointed from legacy `products` to `store-products` (Wave F2 Lane A) it
// had no faithful projection target for the name the storefront renders and filters on
// (`ShopCatalog.vue`/`ProductDetail.vue` read `p.name`; the catalog filters `name ~ q`). This adds
// the same single-string `name` the legacy `products` collection carried — Plan §3.5 did not list it
// (the gap was surfaced by the F2 catalog repoint). Additive only; `down()` reverses it. Mirrors the
// style of 20260719_400000 (ALTER ADD COLUMN / DROP COLUMN). Never edits an applied migration.

export async function up({ db }: MigrateUpArgs): Promise<void> {
  // Base table.
  await db.run(sql`ALTER TABLE \`store_products\` ADD COLUMN \`name\` text;`)
  // Versions table: store-products has drafts/autosave on, so each versioned field is mirrored as
  // version_<field> in _<table>_v (see 20260719_300000 _store_products_v: version_slug/version_sku/
  // version_description…). Without version_name, every versioned product save throws
  // "_store_products_v has no column named version_name". name is a scalar → no _v_rels change.
  await db.run(sql`ALTER TABLE \`_store_products_v\` ADD COLUMN \`version_name\` text;`)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.run(sql`ALTER TABLE \`_store_products_v\` DROP COLUMN \`version_name\`;`)
  await db.run(sql`ALTER TABLE \`store_products\` DROP COLUMN \`name\`;`)
}
