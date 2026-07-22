import type { MigrateUpArgs, MigrateDownArgs } from '@payloadcms/db-sqlite'
import { sql } from '@payloadcms/db-sqlite'

// store_products / store_variants: backfill `price_in_e_g_p_enabled = 1` where a price exists but
// the enable checkbox is unset.
//
// The plugin's `priceInEGP` amount input is conditionally hidden via
// `admin.condition: (_, sibling) => Boolean(sibling?.priceInEGPEnabled)` until the checkbox is
// ticked. The backfill migration (commerce/migration/backfill.ts) and any admin/manual inserts that
// wrote `price_in_e_g_p` WITHOUT also setting `price_in_e_g_p_enabled` leave the row priced but with
// the checkbox unticked — the admin UI hides the price input and operators report "I can't add a
// price" (the value is there, just not visible/editable).
//
// This data migration sets `price_in_e_g_p_enabled = 1` for every row that has a non-null, non-zero
// price but a null/false enable flag. Idempotent: re-running affects zero rows after the first pass.
// Applies to BOTH store_products and store_variants (the plugin adds the pair to both collections).
//
// Column names are the Payload snake_case (the plugin emits `priceInEGP` → column `price_in_e_g_p`;
// `priceInEGPEnabled` → `price_in_e_g_p_enabled`). Verified against the additive migration
// (20260719_300000_commerce_plugin_additive.ts) and the generated payload-types.

export async function up({ db }: MigrateUpArgs): Promise<void> {
  // store_products
  await db.run(
    sql`UPDATE \`store_products\` SET \`price_in_e_g_p_enabled\` = 1
        WHERE \`price_in_e_g_p\` IS NOT NULL
          AND \`price_in_e_g_p\` != 0
          AND (\`price_in_e_g_p_enabled\` IS NULL OR \`price_in_e_g_p_enabled\` = 0);`,
  )
  // store_variants
  await db.run(
    sql`UPDATE \`store_variants\` SET \`price_in_e_g_p_enabled\` = 1
        WHERE \`price_in_e_g_p\` IS NOT NULL
          AND \`price_in_e_g_p\` != 0
          AND (\`price_in_e_g_p_enabled\` IS NULL OR \`price_in_e_g_p_enabled\` = 0);`,
  )
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  // No-op: we cannot reconstruct which rows had the flag deliberately unset vs unset-by-omission.
  // Rolling back would risk hiding legitimately-disabled prices.
  void db
}
