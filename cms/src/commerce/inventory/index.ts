// Inventory domain module — the single authoritative implementation of stock reservation, commit,
// release, expiry, and on-hand adjustment. Every quantity change runs inside a drizzle IMMEDIATE
// transaction (the adapter is configured with transactionOptions.behavior='immediate' + a 5s busy
// timeout) and writes both the cached counter and an immutable stock-movements row, so the ledger
// always reconstructs the level.
//
// Oversell is impossible by construction: reservation uses an atomic conditional UPDATE
//   UPDATE inventory_levels SET reserved = reserved + ? WHERE id = ? AND (on_hand - reserved) >= ?
// which the database evaluates atomically under its serialized writer lock. SQLite serializes all
// writes, so N concurrent reserves for a single unit award exactly one winner; the rest read
// rowsAffected = 0 and get INSUFFICIENT_STOCK. No application-level lock is needed.
//
// stock_reservations carries a partial unique index (tenant, level, order_ref) WHERE status='active'
// so a re-reserve for the same order+level is idempotent (exact sku+qty match, else CONFLICT). The
// browser never sees order_ref; checkout always sets it (cart_token stays for audit only). Movement
// tables are append-only at the API layer; only this module writes them (overrideAccess).

import { sql } from '@payloadcms/db-sqlite'
import type { Payload } from 'payload'

export const DEFAULT_RESERVATION_TTL_MS = 15 * 60 * 1000

type RunResult = {
  rows: Array<Record<string, unknown>>
  rowsAffected: number
  lastInsertRowid: number | bigint
}
type TxLike = { run: (stmt: ReturnType<typeof sql>) => Promise<RunResult> }
type DrizzleLike = { transaction: <T>(fn: (tx: TxLike) => Promise<T>) => Promise<T> }

const drizzleOf = (payload: Payload): DrizzleLike =>
  (payload.db as unknown as { drizzle: DrizzleLike }).drizzle

// Under heavy write contention even a 5s busy_timeout can surface SQLITE_BUSY, and a single libSQL
// connection serializes interactive transactions. Retry the whole transaction on a lock error with a
// tiny backoff. Safe because the callbacks are idempotent under re-run: the conditional UPDATE
// re-evaluates availability, the existing-reservation check short-circuits duplicates, and status
// guards make commit/release no-ops on a second pass.
// ponytail: global small backoff; raise attempts/cap if a high-throughput worker shows retries exhausted.
const LOCK_ERR = /SQLITE_BUSY|database is locked|cannot start a transaction|transaction.*active|writer.*lock/i

async function runTx<T>(payload: Payload, fn: (tx: TxLike) => Promise<T>, attempts = 10): Promise<T> {
  let lastErr: unknown
  for (let i = 0; i < attempts; i++) {
    try {
      return await drizzleOf(payload).transaction(fn)
    } catch (err) {
      lastErr = err
      const msg = err instanceof Error ? err.message : String(err)
      if (!LOCK_ERR.test(msg)) throw err
      await new Promise((resolve) => setTimeout(resolve, Math.min(2 ** i, 50)))
    }
  }
  throw lastErr
}

const toId = (v: unknown): number => Number(v)
const requirePositiveInt = (q: number): void => {
  if (!Number.isInteger(q) || q <= 0) throw new Error(`quantity must be a positive integer, got ${q}`)
}

// --- reservation --------------------------------------------------------------------------

export type ReserveOk = { ok: true; reservationId: number; levelId: number }
export type ReserveErr = { ok: false; code: 'NOT_FOUND' | 'INSUFFICIENT_STOCK' | 'CONFLICT' }
export type ReserveResult = ReserveOk | ReserveErr

export interface ReserveInput {
  payload: Payload
  tenantId: number | string
  locationId: number | string
  sku: string
  quantity: number
  cartToken: string
  // Order-scoped identity. When set (checkout always sets it), reserve is idempotent on an exact
  // (order, level, sku, quantity) match and returns CONFLICT on a mismatch (changed quantity) —
  // closing C-02. When unset, a fresh reservation is created (legacy / direct test calls).
  orderRef?: string
  ttlMs?: number
  actor?: string
  source?: string
}

export async function reserve(input: ReserveInput): Promise<ReserveResult> {
  const { payload, tenantId, locationId, sku, quantity, cartToken } = input
  requirePositiveInt(quantity)
  const orderRef = input.orderRef ?? null
  const ttl = input.ttlMs ?? DEFAULT_RESERVATION_TTL_MS
  const expiresAt = new Date(Date.now() + ttl).toISOString()
  const actor = input.actor ?? null
  const source = input.source ?? null

  return runTx(payload, async (tx) => {
    const levelRes = await tx.run(sql`SELECT \`id\` FROM \`inventory_levels\`
      WHERE \`tenant_id\` = ${tenantId} AND \`location_id\` = ${locationId} AND \`sku\` = ${sku} LIMIT 1`)
    const level = levelRes.rows[0]
    if (!level) return { ok: false, code: 'NOT_FOUND' } as const
    const levelId = toId(level.id)

    // Order-scoped idempotency (C-02): when an orderRef is given and an active hold already exists for
    // this (tenant, level, order), return it unchanged ONLY on an exact sku+quantity match. A mismatch
    // (the cart's quantity changed) is a CONFLICT that changes no counters — the caller must release
    // and re-reserve. Without an orderRef (legacy / direct test calls) this check is skipped.
    if (orderRef !== null) {
      const existing = await tx.run(sql`SELECT \`id\`, \`sku\`, \`quantity\` FROM \`stock_reservations\`
        WHERE \`tenant_id\` = ${tenantId} AND \`level_id\` = ${levelId} AND \`order_ref\` = ${orderRef}
          AND \`status\` = 'active' LIMIT 1`)
      const ex = existing.rows[0]
      if (ex) {
        if (toId(ex.quantity) === quantity && String(ex.sku) === sku) {
          return { ok: true, reservationId: toId(ex.id), levelId } as const
        }
        return { ok: false, code: 'CONFLICT' } as const
      }
    }

    // Atomic oversell guard.
    const upd = await tx.run(sql`UPDATE \`inventory_levels\` SET \`reserved\` = \`reserved\` + ${quantity}
      WHERE \`id\` = ${levelId} AND (\`on_hand\` - \`reserved\`) >= ${quantity}`)
    if (upd.rowsAffected === 0) return { ok: false, code: 'INSUFFICIENT_STOCK' } as const

    const ins = await tx.run(sql`INSERT INTO \`stock_reservations\`
      (\`level_id\`, \`sku\`, \`quantity\`, \`cart_token\`, \`status\`, \`expires_at\`, \`order_ref\`, \`source\`, \`tenant_id\`)
      VALUES (${levelId}, ${sku}, ${quantity}, ${cartToken}, 'active', ${expiresAt}, ${orderRef}, ${source}, ${tenantId})`)
    const reservationId = toId(ins.lastInsertRowid)

    await tx.run(sql`INSERT INTO \`stock_movements\`
      (\`level_id\`, \`type\`, \`quantity\`, \`reason\`, \`reservation_id\`, \`actor\`, \`tenant_id\`)
      VALUES (${levelId}, 'reserve', ${quantity}, ${'reserve'}, ${reservationId}, ${actor}, ${tenantId})`)
    return { ok: true, reservationId, levelId } as const
  })
}

export type CommitResult =
  | { ok: true; levelId: number; idempotent?: boolean }
  | { ok: false; code: 'NOT_FOUND' | 'INVALID_STATE' }

export async function commitReservation(input: {
  payload: Payload
  tenantId: number | string
  reservationId: number | string
  orderRef?: string
  actor?: string
}): Promise<CommitResult> {
  const { payload, tenantId, reservationId, orderRef, actor } = input
  return runTx(payload, async (tx) => {
    const r = await tx.run(sql`SELECT \`level_id\`, \`quantity\`, \`status\` FROM \`stock_reservations\`
      WHERE \`id\` = ${reservationId} AND \`tenant_id\` = ${tenantId} LIMIT 1`)
    const res = r.rows[0]
    if (!res) return { ok: false, code: 'NOT_FOUND' } as const
    const levelId = toId(res.level_id)
    const qty = toId(res.quantity)
    if (res.status === 'committed') return { ok: true, levelId, idempotent: true } as const
    if (res.status !== 'active') return { ok: false, code: 'INVALID_STATE' } as const

    // Consume: stock leaves on-hand and the hold is fulfilled (both counters drop by qty).
    // NM13: guard on on_hand too — without it, a concurrent admin adjustOnHand (which can drive
    // on_hand below the reserved qty) would let this commit push on_hand negative. Requiring both
    // reserved >= qty AND on_hand >= qty makes an impossible concurrent split surface as
    // INVALID_STATE instead of corrupting the level.
    const upd = await tx.run(sql`UPDATE \`inventory_levels\`
      SET \`on_hand\` = \`on_hand\` - ${qty}, \`reserved\` = \`reserved\` - ${qty}
      WHERE \`id\` = ${levelId} AND \`reserved\` >= ${qty} AND \`on_hand\` >= ${qty}`)
    if (upd.rowsAffected === 0) return { ok: false, code: 'INVALID_STATE' } as const

    const after = await tx.run(sql`SELECT \`on_hand\` FROM \`inventory_levels\` WHERE \`id\` = ${levelId}`)
    const resultingOnHand = toId((after.rows[0] ?? {}).on_hand ?? 0)

    await tx.run(sql`UPDATE \`stock_reservations\` SET \`status\` = 'committed', \`order_ref\` = ${orderRef ?? null}
      WHERE \`id\` = ${reservationId}`)
    await tx.run(sql`INSERT INTO \`stock_movements\`
      (\`level_id\`, \`type\`, \`quantity\`, \`resulting_on_hand\`, \`reason\`, \`reservation_id\`, \`order_ref\`, \`actor\`, \`tenant_id\`)
      VALUES (${levelId}, 'commit', ${-qty}, ${resultingOnHand}, ${'commit'}, ${reservationId}, ${orderRef ?? null}, ${actor ?? null}, ${tenantId})`)
    return { ok: true, levelId } as const
  })
}

export type ReleaseResult =
  | { ok: true; idempotent?: boolean }
  | { ok: false; code: 'NOT_FOUND' }

async function settleReservation(
  tx: TxLike,
  mode: 'released' | 'expired',
  ctx: { tenantId: number | string; reservationId: number | string; reason?: string; actor?: string },
): Promise<ReleaseResult> {
  const r = await tx.run(sql`SELECT \`level_id\`, \`quantity\`, \`status\` FROM \`stock_reservations\`
    WHERE \`id\` = ${ctx.reservationId} AND \`tenant_id\` = ${ctx.tenantId} LIMIT 1`)
  const res = r.rows[0]
  if (!res) return { ok: false, code: 'NOT_FOUND' } as const
  if (res.status !== 'active') return { ok: true, idempotent: true } as const
  const levelId = toId(res.level_id)
  const qty = toId(res.quantity)
  await tx.run(sql`UPDATE \`inventory_levels\` SET \`reserved\` = \`reserved\` - ${qty}
    WHERE \`id\` = ${levelId} AND \`reserved\` >= ${qty}`)
  await tx.run(sql`UPDATE \`stock_reservations\` SET \`status\` = ${mode} WHERE \`id\` = ${ctx.reservationId}`)
  await tx.run(sql`INSERT INTO \`stock_movements\`
    (\`level_id\`, \`type\`, \`quantity\`, \`reason\`, \`reservation_id\`, \`actor\`, \`tenant_id\`)
    VALUES (${levelId}, 'release', ${-qty}, ${ctx.reason ?? mode}, ${ctx.reservationId}, ${ctx.actor ?? null}, ${ctx.tenantId})`)
  return { ok: true } as const
}

export async function releaseReservation(input: {
  payload: Payload
  tenantId: number | string
  reservationId: number | string
  reason?: string
  actor?: string
}): Promise<ReleaseResult> {
  return runTx(input.payload, (tx) => settleReservation(tx, 'released', input))
}

export async function releaseCart(input: {
  payload: Payload
  tenantId: number | string
  cartToken: string
  reason?: string
  actor?: string
}): Promise<{ released: number }> {
  return runTx(input.payload, async (tx) => {
    const rows = await tx.run(sql`SELECT \`id\` FROM \`stock_reservations\`
      WHERE \`tenant_id\` = ${input.tenantId} AND \`cart_token\` = ${input.cartToken} AND \`status\` = 'active'`)
    let released = 0
    for (const row of rows.rows) {
      const r = await settleReservation(tx, 'released', {
        tenantId: input.tenantId,
        reservationId: toId(row.id),
        reason: input.reason,
        actor: input.actor,
      })
      if (r.ok && !r.idempotent) released += 1
    }
    return { released }
  })
}

// Commit every active reservation belonging to an ORDER — the capture-side counterpart to the
// order-scoped reserve. Closing C-01: committing one order consumes only that order's reservations,
// even when another order shares the cart token. Atomic + idempotent (only `active` rows are selected,
// so a re-run after commit is a no-op).
//
// NM14: a per-reservation commit that hits the conditional UPDATE's rowsAffected === 0 (e.g. a
// concurrent adjustOnHand drove on_hand below qty) is NO LONGER a silent `continue`. We surface those
// reservation ids in `skipped` so callers (the D3 payment job, admin confirm) can audit the drift and
// reconcile. We do NOT throw — the other reservations still committed, and the order's capture is
// otherwise durable. A subsequent commitOrder re-run will retry the skipped rows idempotently.
export async function commitOrder(input: {
  payload: Payload
  tenantId: number | string
  orderNumber: string
  actor?: string
}): Promise<{ committed: number; skipped: Array<number | string> }> {
  return runTx(input.payload, async (tx) => {
    const rows = await tx.run(sql`SELECT \`id\`, \`level_id\`, \`quantity\` FROM \`stock_reservations\`
      WHERE \`tenant_id\` = ${input.tenantId} AND \`order_ref\` = ${input.orderNumber} AND \`status\` = 'active'`)
    let committed = 0
    const skipped: Array<number | string> = []
    for (const row of rows.rows) {
      const reservationId = toId(row.id)
      const levelId = toId(row.level_id)
      const qty = toId(row.quantity)
      const upd = await tx.run(sql`UPDATE \`inventory_levels\`
        SET \`on_hand\` = \`on_hand\` - ${qty}, \`reserved\` = \`reserved\` - ${qty}
        WHERE \`id\` = ${levelId} AND \`reserved\` >= ${qty} AND \`on_hand\` >= ${qty}`)
      if (upd.rowsAffected === 0) {
        skipped.push(reservationId)
        continue
      }
      const after = await tx.run(sql`SELECT \`on_hand\` FROM \`inventory_levels\` WHERE \`id\` = ${levelId}`)
      const resultingOnHand = toId((after.rows[0] ?? {}).on_hand ?? 0)
      await tx.run(sql`UPDATE \`stock_reservations\` SET \`status\` = 'committed' WHERE \`id\` = ${reservationId}`)
      await tx.run(sql`INSERT INTO \`stock_movements\`
        (\`level_id\`, \`type\`, \`quantity\`, \`resulting_on_hand\`, \`reason\`, \`reservation_id\`, \`order_ref\`, \`actor\`, \`tenant_id\`)
        VALUES (${levelId}, 'commit', ${-qty}, ${resultingOnHand}, ${'commit'}, ${reservationId}, ${input.orderNumber}, ${input.actor ?? null}, ${input.tenantId})`)
      committed += 1
    }
    return { committed, skipped }
  })
}

// Release every active reservation belonging to an ORDER (checkout compensation / unpaid-order
// release). Order-scoped, so releasing one order never releases another order's reservation (C-01).
export async function releaseOrder(input: {
  payload: Payload
  tenantId: number | string
  orderNumber: string
  reason?: string
  actor?: string
}): Promise<{ released: number }> {
  return runTx(input.payload, async (tx) => {
    const rows = await tx.run(sql`SELECT \`id\` FROM \`stock_reservations\`
      WHERE \`tenant_id\` = ${input.tenantId} AND \`order_ref\` = ${input.orderNumber} AND \`status\` = 'active'`)
    let released = 0
    for (const row of rows.rows) {
      const r = await settleReservation(tx, 'released', {
        tenantId: input.tenantId,
        reservationId: toId(row.id),
        reason: input.reason,
        actor: input.actor,
      })
      if (r.ok && !r.idempotent) released += 1
    }
    return { released }
  })
}

// NC4 (default): restore previously-committed stock back to on_hand on a full refund. This is the
// inverse of commitOrder: for a given order, find every reservation whose status is `committed`,
// increment on_hand by each qty, flip the reservation to a new `restored` status, and insert a
// `restore` movement. Idempotent via the status guard — only `committed` rows are touched, so a
// re-run after a successful restore is a no-op (mirrors commitOrder's contract).
//
// Default scope: ONLY full refunds restore stock. Partial refunds (`partially_refunded`) are a
// documented no-op in the payment job because partial restore requires per-line amount arithmetic
// (which refund event amount to map to which SKU) that the refund event does not yet carry. Follow-
// up: when partial refunds need stock restore, extend restoreOrder with an amount/sku allocation
// input and wire it from a folded-state branch in payments/job.ts.
export async function restoreOrder(input: {
  payload: Payload
  tenantId: number | string
  orderNumber: string
  reason?: string
  actor?: string
}): Promise<{ restored: number }> {
  return runTx(input.payload, async (tx) => {
    const rows = await tx.run(sql`SELECT \`id\`, \`level_id\`, \`quantity\` FROM \`stock_reservations\`
      WHERE \`tenant_id\` = ${input.tenantId} AND \`order_ref\` = ${input.orderNumber} AND \`status\` = 'committed'`)
    let restored = 0
    for (const row of rows.rows) {
      const reservationId = toId(row.id)
      const levelId = toId(row.level_id)
      const qty = toId(row.quantity)
      // Add the qty back to on_hand. reserved is already 0 for a committed row (commit decremented
      // both counters), so there is nothing to subtract there. The level is updated unconditionally;
      // on_hand is a cached counter and the append-only stock_movements row is the audit source of
      // truth, so even a counter that drifted (e.g. a concurrent adjustOnHand) is corrected back to
      // the post-restore level the movement ledger reconstructs.
      await tx.run(sql`UPDATE \`inventory_levels\` SET \`on_hand\` = \`on_hand\` + ${qty}
        WHERE \`id\` = ${levelId}`)
      const after = await tx.run(sql`SELECT \`on_hand\` FROM \`inventory_levels\` WHERE \`id\` = ${levelId}`)
      const resultingOnHand = toId((after.rows[0] ?? {}).on_hand ?? 0)
      await tx.run(sql`UPDATE \`stock_reservations\` SET \`status\` = 'restored' WHERE \`id\` = ${reservationId}`)
      await tx.run(sql`INSERT INTO \`stock_movements\`
        (\`level_id\`, \`type\`, \`quantity\`, \`resulting_on_hand\`, \`reason\`, \`reservation_id\`, \`order_ref\`, \`actor\`, \`tenant_id\`)
        VALUES (${levelId}, 'restore', ${qty}, ${resultingOnHand}, ${input.reason ?? 'restore'}, ${reservationId}, ${input.orderNumber}, ${input.actor ?? null}, ${input.tenantId})`)
      restored += 1
    }
    return { restored }
  })
}

export async function expireDue(input: {
  payload: Payload
  now?: Date
  tenantId?: number | string
}): Promise<{ expired: number }> {
  const nowIso = (input.now ?? new Date()).toISOString()
  return runTx(input.payload, async (tx) => {
    const rows = input.tenantId
      ? await tx.run(sql`SELECT \`id\`, \`tenant_id\` FROM \`stock_reservations\`
          WHERE \`status\` = 'active' AND \`expires_at\` <= ${nowIso} AND \`tenant_id\` = ${input.tenantId}`)
      : await tx.run(sql`SELECT \`id\`, \`tenant_id\` FROM \`stock_reservations\`
          WHERE \`status\` = 'active' AND \`expires_at\` <= ${nowIso}`)
    let expired = 0
    for (const row of rows.rows) {
      const r = await settleReservation(tx, 'expired', {
        tenantId: row.tenant_id as number | string,
        reservationId: toId(row.id),
        reason: 'expired',
      })
      if (r.ok && !r.idempotent) expired += 1
    }
    return { expired }
  })
}

// --- on-hand adjustment (receive / damage / adjust / count) -------------------------------

const ON_HAND_MOVEMENT_TYPES = new Set(['receive', 'damage', 'adjust', 'count'])

export type AdjustResult =
  | { ok: true; resultingOnHand: number }
  | { ok: false; code: 'NOT_FOUND' | 'INSUFFICIENT_STOCK' | 'INVALID_TYPE' }

export async function adjustOnHand(input: {
  payload: Payload
  tenantId: number | string
  levelId: number | string
  delta: number
  type: 'receive' | 'damage' | 'adjust' | 'count'
  reason?: string
  actor?: string
}): Promise<AdjustResult> {
  const { payload, tenantId, levelId, delta, type } = input
  if (!Number.isInteger(delta)) throw new Error(`delta must be an integer, got ${delta}`)
  if (!ON_HAND_MOVEMENT_TYPES.has(type)) return { ok: false, code: 'INVALID_TYPE' }

  return runTx(payload, async (tx) => {
    const upd = await tx.run(sql`UPDATE \`inventory_levels\` SET \`on_hand\` = \`on_hand\` + ${delta}
      WHERE \`id\` = ${levelId} AND \`tenant_id\` = ${tenantId} AND \`on_hand\` + ${delta} >= 0`)
    if (upd.rowsAffected === 0) {
      const lvl = await tx.run(sql`SELECT \`id\` FROM \`inventory_levels\`
        WHERE \`id\` = ${levelId} AND \`tenant_id\` = ${tenantId}`)
      return lvl.rows[0] ? { ok: false, code: 'INSUFFICIENT_STOCK' } : { ok: false, code: 'NOT_FOUND' }
    }
    const after = await tx.run(sql`SELECT \`on_hand\` FROM \`inventory_levels\` WHERE \`id\` = ${levelId}`)
    const resultingOnHand = toId((after.rows[0] ?? {}).on_hand ?? 0)
    await tx.run(sql`INSERT INTO \`stock_movements\`
      (\`level_id\`, \`type\`, \`quantity\`, \`resulting_on_hand\`, \`reason\`, \`actor\`, \`tenant_id\`)
      VALUES (${levelId}, ${type}, ${delta}, ${resultingOnHand}, ${input.reason ?? type}, ${input.actor ?? null}, ${tenantId})`)
    return { ok: true, resultingOnHand }
  })
}

// --- reads ---------------------------------------------------------------------------------

export interface InventoryLevelRow {
  id: number
  onHand: number
  reserved: number
  available: number
  incoming: number
  damaged: number
}

export async function getLevel(input: {
  payload: Payload
  tenantId: number | string
  locationId: number | string
  sku: string
}): Promise<InventoryLevelRow | null> {
  return runTx(input.payload, async (tx) => {
    const r = await tx.run(sql`SELECT \`id\`, \`on_hand\`, \`reserved\`, \`incoming\`, \`damaged\`
      FROM \`inventory_levels\`
      WHERE \`tenant_id\` = ${input.tenantId} AND \`location_id\` = ${input.locationId} AND \`sku\` = ${input.sku} LIMIT 1`)
    const row = r.rows[0]
    if (!row) return null
    const onHand = toId(row.on_hand)
    const reserved = toId(row.reserved)
    return {
      id: toId(row.id),
      onHand,
      reserved,
      available: onHand - reserved,
      incoming: toId(row.incoming ?? 0),
      damaged: toId(row.damaged ?? 0),
    }
  })
}
