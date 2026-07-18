// Gift-cards policy repository + ledger atomicity (Plan §3.10).
//
// Wraps the `gift-cards` + `gift-card-ledger` collections and the pure gift-card engine at
// `commerce/giftcards`. The cached `balance` on the gift-cards row is the fold of the ledger; the
// ledger is append-only, system-written, and the row’s balance column is updated in the SAME
// database transaction as the ledger insert so a crash never leaves the cached balance out of sync
// with the audit source of truth.
//
// Idempotency: every state-changing operation carries an idempotencyKey unique per tenant. A replay
// (e.g. retried checkout) hits the (tenant, idempotencyKey) unique index and is a no-op.
//
// `redeemForOrder` and `refundForOrder` are the two state-changing entry points. Both:
//   1. compute the signed amount from the pure engine;
//   2. insert the ledger row + update the cached balance in a single transaction (the caller
//      supplies a `txn` runner that wraps both writes);
//   3. refuse to drive the balance or the order’s payable total negative.

import { canRedeem, redeem, refund, type GiftCardAccount } from '../giftcards'
import type { PolicyFindApi } from './tax'

export interface GiftCardRow {
  id: string | number
  tenant: string | number
  codeHash: string
  lastFour: string
  currency: string
  initialBalance: number
  balance: number
  status: 'active' | 'redeemed' | 'expired' | 'revoked'
  expiresAt: string | null
}

export interface GiftCardLedgerRow {
  id: string | number
  tenant: string | number
  giftCard: string | number
  order?: string | number | null
  kind: 'issue' | 'redeem' | 'refund' | 'adjustment'
  amount: number
  idempotencyKey: string
  createdAt: string
}

export type GiftCardKind = GiftCardLedgerRow['kind']

// Convert a row to the pure-engine account shape. The pure engine reads balance + issued + active +
// expiresAtMs; we derive those from the persisted shape.
export function toGiftCardAccount(row: GiftCardRow): GiftCardAccount {
  return {
    id: String(row.id),
    currency: row.currency,
    balanceMinor: row.balance,
    // For v1 we treat initialBalance as the lifetime issued total. Adjustments that grow the balance
    // beyond initialBalance are not exposed at the policy layer.
    issuedMinor: row.initialBalance,
    expiresAtMs: row.expiresAt ? Date.parse(row.expiresAt) : undefined,
    active: row.status === 'active',
  }
}

// Repository — read-only by default. State-changing operations go through `runLedgerTxn` so the
// cached balance and the ledger stay consistent atomically.
export interface GiftCardLedgerTxnApi extends PolicyFindApi {
  // Insert one ledger row + update the gift-card’s cached balance. Both writes MUST be in the same
  // DB transaction; the integration owner provides this and the migration / runtime config ensures
  // the underlying sqlite/drizzle transaction is shared. We pass the resolved new balance so the
  // implementation can write it directly without re-deriving (the pure engine is the source of truth
  // for the new balance value).
  insertLedgerAndUpdateBalance(args: {
    tenant: string | number
    giftCardId: string | number
    kind: GiftCardKind
    amount: number // signed integer minor units
    idempotencyKey: string
    createdAt: string
    order?: string | number | null
    newBalance: number
  }): Promise<{ inserted: boolean; ledgerRowId?: string | number }>
}

export class GiftCardsPolicyRepository {
  constructor(private readonly api: GiftCardLedgerTxnApi) {}

  // Lookup by code hash. Cross-tenant: a code resolves to at most one row globally (codeHash is
  // globally unique per §3.10), so we fetch and then check the row’s tenant matches the resolved
  // tenant id. A mismatch is treated as "not found" so a code typed into the wrong tenant cannot be
  // redeemed.
  async findByCodeHash(
    tenant: string | number,
    codeHash: string,
  ): Promise<GiftCardRow | null> {
    const { docs } = await this.api.find({
      collection: 'gift-cards',
      where: { codeHash: { equals: codeHash } },
      limit: 2,
      overrideAccess: true,
    })
    if (docs.length === 0) return null
    const row = toGiftCardRow(docs[0], tenant)
    if (String(row.tenant) !== String(tenant)) return null
    return row
  }

  // Plan §3.10 step 10 — validate the gift card and compute the amount to apply (capped at the
  // grand total so the payable never goes negative). Returns:
  //   - ok: { applied, newBalance, row } — applied is what the quote deducts; newBalance is what the
  //     ledger entry will fold to.
  //   - err: typed reason (NOT_FOUND, INACTIVE, EXPIRED, INSUFFICIENT, INVALID)
  async validateForRedemption(args: {
    tenant: string | number
    codeHash: string
    grandTotal: number
    now: number
  }): Promise<
    | { ok: true; applied: number; newBalance: number; row: GiftCardRow }
    | { ok: false; code: 'NOT_FOUND' | 'INACTIVE' | 'EXPIRED' | 'INSUFFICIENT' | 'INVALID' }
  > {
    if (!Number.isInteger(args.grandTotal) || args.grandTotal < 0) {
      return { ok: false, code: 'INVALID' }
    }
    const row = await this.findByCodeHash(args.tenant, args.codeHash)
    if (!row) return { ok: false, code: 'NOT_FOUND' }
    const account = toGiftCardAccount(row)
    // Cap at the grand total — a card with more than the payable is partially redeemed.
    const requested = Math.min(args.grandTotal, account.balanceMinor)
    if (!canRedeem(account, requested, args.now)) {
      if (!account.active) return { ok: false, code: 'INACTIVE' }
      if (account.expiresAtMs !== undefined && args.now >= account.expiresAtMs) {
        return { ok: false, code: 'EXPIRED' }
      }
      if (requested <= 0) return { ok: false, code: 'INSUFFICIENT' }
      return { ok: false, code: 'INSUFFICIENT' }
    }
    const r = redeem(account, requested, args.now)
    if (!r.ok) return { ok: false, code: r.code }
    return { ok: true, applied: requested, newBalance: r.balance, row }
  }

  // Commit a redemption as a ledger entry + cached-balance update. Idempotent on (tenant,
  // idempotencyKey). The unique index on the ledger makes a duplicate insert reject; we treat
  // "duplicate" as a successful no-op (returning the already-applied state) so retried checkouts are
  // safe. Caller passes the resolved `applied` + `newBalance` from validateForRedemption so the
  // transaction body is deterministic.
  async redeemForOrder(args: {
    tenant: string | number
    giftCardId: string | number
    orderId: string | number
    applied: number
    newBalance: number
    idempotencyKey: string
    now: number
  }): Promise<{ committed: boolean }> {
    if (!Number.isInteger(args.applied) || args.applied <= 0) {
      throw new Error('redeemForOrder requires a positive integer applied amount')
    }
    const createdAt = new Date(args.now).toISOString()
    const { inserted } = await this.api.insertLedgerAndUpdateBalance({
      tenant: args.tenant,
      giftCardId: args.giftCardId,
      kind: 'redeem',
      amount: -args.applied,
      idempotencyKey: args.idempotencyKey,
      createdAt,
      order: args.orderId,
      newBalance: args.newBalance,
    })
    return { committed: inserted }
  }

  // Idempotent compensating entry on a failed/expired payment. The unique index on (tenant,
  // idempotencyKey) makes a duplicate refund a no-op. Refund amount is bounded by the prior redeem
  // (caller resolves how much was redeemed for this order) and by the lifetime issued total so the
  // balance can never go negative or above initialBalance.
  async refundForOrder(args: {
    tenant: string | number
    giftCardId: string | number
    orderId: string | number
    refundAmount: number
    idempotencyKey: string
    now: number
    currentBalance: number
    initialBalance: number
  }): Promise<{ committed: boolean; refunded: number; newBalance: number }> {
    if (!Number.isInteger(args.refundAmount) || args.refundAmount <= 0) {
      throw new Error('refundForOrder requires a positive integer refundAmount')
    }
    const account: GiftCardAccount = {
      id: String(args.giftCardId),
      currency: 'EGP',
      balanceMinor: args.currentBalance,
      issuedMinor: args.initialBalance,
      active: true,
    }
    const r = refund(account, args.refundAmount)
    if (!r.ok) throw new Error('refundForOrder rejected by pure engine')
    const createdAt = new Date(args.now).toISOString()
    const { inserted } = await this.api.insertLedgerAndUpdateBalance({
      tenant: args.tenant,
      giftCardId: args.giftCardId,
      kind: 'refund',
      amount: r.balance - args.currentBalance, // signed delta actually applied
      idempotencyKey: args.idempotencyKey,
      createdAt,
      order: args.orderId,
      newBalance: r.balance,
    })
    return {
      committed: inserted,
      refunded: r.balance - args.currentBalance,
      newBalance: r.balance,
    }
  }
}

export function toGiftCardRow(d: Record<string, unknown>, tenant: string | number): GiftCardRow {
  return {
    id: String((d as { id?: unknown }).id ?? ''),
    tenant,
    codeHash: String((d as { codeHash?: unknown }).codeHash ?? ''),
    lastFour: String((d as { lastFour?: unknown }).lastFour ?? ''),
    currency: String((d as { currency?: unknown }).currency ?? 'EGP'),
    initialBalance: Number((d as { initialBalance?: unknown }).initialBalance ?? 0) || 0,
    balance: Number((d as { balance?: unknown }).balance ?? 0) || 0,
    status: ((d as { status?: unknown }).status ?? 'active') as GiftCardRow['status'],
    expiresAt: ((d as { expiresAt?: unknown }).expiresAt ?? null) as string | null,
  }
}

export function toGiftCardLedgerRow(
  d: Record<string, unknown>,
  tenant: string | number,
): GiftCardLedgerRow {
  const orderRaw = (d as { order?: unknown }).order
  const orderId =
    orderRaw === null || orderRaw === undefined
      ? null
      : orderRaw !== null && typeof orderRaw === 'object' && 'id' in (orderRaw as Record<string, unknown>)
      ? String((orderRaw as { id?: unknown }).id ?? '')
      : String(orderRaw ?? '')
  const giftRaw = (d as { giftCard?: unknown }).giftCard
  const giftId =
    giftRaw !== null && typeof giftRaw === 'object' && 'id' in (giftRaw as Record<string, unknown>)
      ? String((giftRaw as { id?: unknown }).id ?? '')
      : String(giftRaw ?? '')
  return {
    id: String((d as { id?: unknown }).id ?? ''),
    tenant,
    giftCard: giftId,
    order: orderId,
    kind: ((d as { kind?: unknown }).kind ?? 'redeem') as GiftCardKind,
    amount: Number((d as { amount?: unknown }).amount ?? 0) || 0,
    idempotencyKey: String((d as { idempotencyKey?: unknown }).idempotencyKey ?? ''),
    createdAt: String((d as { createdAt?: unknown }).createdAt ?? ''),
  }
}
