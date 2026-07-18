import type { MigrateUpArgs, MigrateDownArgs } from '@payloadcms/db-sqlite'
import { sql } from '@payloadcms/db-sqlite'

// Order-scoped reservations (remediation plan §5 commit 1.2; closes C-01/C-02).
//
// A reservation used to be identity-keyed by (tenant, level, cart_token) while active, so paying one
// order committed EVERY active reservation sharing its cart token (C-01), and a re-reserve for the same
// cart+level silently reused an old hold regardless of quantity (C-02). This migration makes the
// active-reservation uniqueness order-scoped — (tenant, level, order_ref) while active — and keeps
// cart_token around only for correlation/audit. It also adds the order columns commit 1.4 (idempotency
// key + fingerprint) and the expiry timestamp (commit 2.4 / 6.2) need.
//
// All tenant-owned queries constrain tenant_id (plan rule 8). Append-only; the 100000..100500 series
// is frozen. Migrations are wrapped in one IMMEDIATE transaction by the adapter, so a thrown preflight
// error rolls back every DDL change in this file.

export async function up({ db }: MigrateUpArgs): Promise<void> {
  // --- orders: idempotency key + fingerprint (commit 1.4) and unpaid-order expiry (commit 2.4 / 6.2) ---
  await db.run(sql`ALTER TABLE \`orders\` ADD COLUMN \`checkout_key\` text;`)
  await db.run(sql`ALTER TABLE \`orders\` ADD COLUMN \`checkout_fingerprint\` text;`)
  await db.run(sql`ALTER TABLE \`orders\` ADD COLUMN \`expires_at\` text;`)
  await db.run(sql`CREATE UNIQUE INDEX \`orders_tenant_checkout_key_uniq\` ON \`orders\` (\`tenant_id\`, \`checkout_key\`) WHERE \`checkout_key\` IS NOT NULL;`)

  // --- stock_reservations: index by order so commit/release/expire can be order-scoped (commit 1.3) ---
  await db.run(sql`CREATE INDEX \`stock_reservations_tenant_order_status_idx\` ON \`stock_reservations\` (\`tenant_id\`, \`order_ref\`, \`status\`);`)

  // --- Legacy-data preflight: before order_ref becomes part of the active-unique key, every active
  //     reservation must map to exactly one non-terminal order. Commerce is disabled at baseline, so
  //     the expected count is zero. If non-zero, backfill only the unambiguous (single-candidate) carts
  //     and abort hard on anything ambiguous — never guess. ---
  const activeNoOrder = await db.run(sql`SELECT COUNT(*) AS \`c\` FROM \`stock_reservations\` WHERE \`status\` = 'active' AND \`order_ref\` IS NULL;`)
  const outstanding = Number((activeNoOrder.rows[0] as { c?: unknown } | undefined)?.c ?? 0)
  if (outstanding > 0) {
    const groups = await db.run(sql`SELECT DISTINCT \`tenant_id\`, \`cart_token\` FROM \`stock_reservations\` WHERE \`status\` = 'active' AND \`order_ref\` IS NULL;`)
    for (const g of groups.rows) {
      const tid = (g as unknown as { tenant_id: number | string }).tenant_id
      const cart = (g as unknown as { cart_token: string }).cart_token
      const candidates = await db.run(sql`SELECT \`order_number\` FROM \`orders\` WHERE \`tenant_id\` = ${tid} AND \`cart_token\` = ${cart} AND \`status\` NOT IN ('cancelled', 'failed', 'expired');`)
      if (candidates.rows.length !== 1) {
        throw new Error(
          `commerce_order_scoped_reservations: cannot backfill active reservations for tenant=${tid} cart=${cart}: found ${candidates.rows.length} non-terminal candidate order(s) (expected exactly 1). Aborting migration; resolve manually before re-running.`,
        )
      }
      const orderRef = (candidates.rows[0] as unknown as { order_number: string }).order_number
      await db.run(sql`UPDATE \`stock_reservations\` SET \`order_ref\` = ${orderRef} WHERE \`tenant_id\` = ${tid} AND \`cart_token\` = ${cart} AND \`status\` = 'active' AND \`order_ref\` IS NULL;`)
    }
  }

  // --- Swap the active-reservation uniqueness from cart-scoped to order-scoped. cart_token stays for audit. ---
  await db.run(sql`DROP INDEX IF EXISTS \`stock_reservations_active_cart_uniq\`;`)
  await db.run(sql`CREATE UNIQUE INDEX \`stock_reservations_active_order_uniq\` ON \`stock_reservations\` (\`tenant_id\`, \`level_id\`, \`order_ref\`) WHERE \`status\` = 'active';`)
  await db.run(sql`CREATE INDEX \`stock_reservations_tenant_cart_idx\` ON \`stock_reservations\` (\`tenant_id\`, \`cart_token\`);`)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  // Development-only. Once order-scoped reservations exist, restoring the cart-scoped unique is only
  // valid when no two active reservations share a (tenant, level, cart); best-effort, tolerate failure.
  await db.run(sql`DROP INDEX IF EXISTS \`stock_reservations_tenant_cart_idx\`;`)
  await db.run(sql`DROP INDEX IF EXISTS \`stock_reservations_active_order_uniq\`;`)
  try {
    await db.run(sql`CREATE UNIQUE INDEX \`stock_reservations_active_cart_uniq\` ON \`stock_reservations\` (\`tenant_id\`, \`level_id\`, \`cart_token\`) WHERE \`status\` = 'active';`)
  } catch {
    /* data no longer satisfies the old rule once order-scoped reservations exist — leave it absent */
  }
  await db.run(sql`DROP INDEX IF EXISTS \`stock_reservations_tenant_order_status_idx\`;`)
  await db.run(sql`DROP INDEX IF EXISTS \`orders_tenant_checkout_key_uniq\`;`)
  try { await db.run(sql`ALTER TABLE \`orders\` DROP COLUMN \`expires_at\`;`) } catch { /* SQLite < 3.35 lacks DROP COLUMN; tolerate */ }
  try { await db.run(sql`ALTER TABLE \`orders\` DROP COLUMN \`checkout_fingerprint\`;`) } catch { /* tolerate */ }
  try { await db.run(sql`ALTER TABLE \`orders\` DROP COLUMN \`checkout_key\`;`) } catch { /* tolerate */ }
}
