// Operational commerce reports (Plan §7 E2).
//
// Tenant-scoped READ queries for operators/admins. Every query is scoped `tenant: { equals }` with
// `overrideAccess: true` — these are operator read paths, never customer-facing. Source of truth for
// plugin-first orders/transactions is the `store-*` collections; the legacy `orders`/`transactions`
// collections are treated as STALE for plugin-first orders (they are read-only side-by-side until the
// Wave F2 cutover, per the Wave E handoff "Decisions ALREADY MADE").
//
// All money is integer minor units (EGP). No new shadow order/transaction tables are introduced —
// these are pure aggregations over the existing `store-*`, policy, inventory, and jobs collections.

import type { Payload, Where } from 'payload'

import { SEND_COMMERCE_NOTIFICATION_TASK } from '../payments/job'

// A row read back from the Local API. Payload's generated types don't carry an index signature, so
// these report queries cast through `unknown` to a plain record for field access by name.
type Row = Record<string, unknown>

// ----------------------------------------------------------------------------
// Shared types + helpers
// ----------------------------------------------------------------------------

export interface ReportInput {
  payload: Payload
  tenantId: number | string
  /**
   * NC6 (default): mandatory access-control context. Every report is tenant-scoped operator read-
   * only data; without an explicit caller check, any code path (or future admin script) could read
   * another tenant's commercial aggregates. The caller MUST be constructed from a verified session
   * upstream — HTTP route handlers derive it from req.user (Payload's auth strategy) and CLI scripts
   * construct it from the operator's authenticated context. `isSuperAdmin` short-circuits the tenant
   * allow-list (platform operators can read any tenant); otherwise the caller's `tenantIds` MUST
   * include `tenantId`. Each report function asserts this at the top so the check is impossible to
   * forget. Default chosen for reversibility: a single guard at each entry point; to relax, narrow
   * the allow-list (e.g. remove superAdmin) — the assertion site is the single source of truth.
   */
  caller: ReportCaller
}

export interface ReportCaller {
  /** True for platform-level operators (e.g. the super-admin role); bypasses the tenant allow-list. */
  isSuperAdmin: boolean
  /** Tenant ids the caller is authorized to read. Empty for callers with no tenant grants. */
  tenantIds: ReadonlyArray<string | number>
}

// NC6: the mandatory guard. Throws a uniform `unauthorized` error when the caller has no grant for
// the requested tenant. Each report calls this as its very first statement so the query never runs
// against a tenant the caller may not read. The error message is intentionally generic — it does
// not distinguish "no such tenant" from "caller lacks grant" (mirrors the customer-auth oracle
// closure pattern in commerce/customers/payload-auth.ts).
export function assertCallerMayReadTenant(
  input: Pick<ReportInput, 'tenantId' | 'caller'>,
): void {
  const { caller, tenantId } = input
  const allowed =
    caller.isSuperAdmin || caller.tenantIds.some((id) => String(id) === String(tenantId))
  if (!allowed) {
    throw new Error('unauthorized: caller may not read reports for this tenant')
  }
}

export interface DateRange {
  /** Inclusive lower bound on the order's `placedAt` (ISO). */
  from?: string
  /** Inclusive upper bound on the order's `placedAt` (ISO). */
  to?: string
}

const CURRENCY = 'EGP' as const

// Coerce a persisted money value to a safe integer minor-unit count. Stored values are integers, but
// reports must never surface NaN/undefined from a missing field — default to 0.
const minor = (v: unknown): number => {
  const n = Number(v)
  if (!Number.isFinite(n)) return 0
  return Math.trunc(n)
}

// YYYY-MM-DD bucket from an ISO timestamp, or null when the timestamp is absent/invalid. Used for the
// by-day sales grouping; lexicographic ordering of these strings is chronological.
const dayOf = (iso: unknown): string | null => {
  if (typeof iso !== 'string' || iso.length < 10) return null
  return iso.slice(0, 10)
}

// ----------------------------------------------------------------------------
// 1. Sales totals by date / status
// ----------------------------------------------------------------------------

export interface SalesBucket {
  day: string | null
  status: string | null
  paymentState: string | null
  count: number
  subtotal: number
  totalDiscount: number
  shippingPrice: number
  totalTax: number
  giftCardApplied: number
  /** merchandise + shipping + tax − discount. Integer minor units. */
  grandTotal: number
  /** grandTotal − giftCardApplied (what was actually charged to the payment provider). */
  amountDue: number
}

export interface SalesTotalsReport {
  currency: typeof CURRENCY
  buckets: SalesBucket[]
  totals: Omit<SalesBucket, 'day' | 'status' | 'paymentState'>
}

export interface SalesTotalsOptions extends DateRange {
  /** Filter by the plugin's administrative lifecycle status (processing / completed / cancelled / refunded). */
  status?: string
  /** Filter by the retained payment lifecycle state (pending / authorized / captured / ...). */
  paymentState?: string
}

/**
 * Sales totals by day / status / paymentState, tenant-scoped. Sums `store-orders` integer totals;
 * `grandTotal = subtotal + shippingPrice + totalTax − totalDiscount` and `amountDue = grandTotal −
 * giftCardApplied`. All money is integer minor units.
 */
export async function salesTotals(
  input: ReportInput,
  opts: SalesTotalsOptions = {},
): Promise<SalesTotalsReport> {
  assertCallerMayReadTenant(input)
  const and: Where[] = [{ tenant: { equals: input.tenantId } }]
  if (opts.status) and.push({ status: { equals: opts.status } })
  if (opts.paymentState) and.push({ paymentState: { equals: opts.paymentState } })
  if (opts.from) and.push({ placedAt: { greater_than_equal: opts.from } })
  if (opts.to) and.push({ placedAt: { less_than_equal: opts.to } })
  const { docs } = await input.payload.find({
    collection: 'store-orders',
    where: { and },
    overrideAccess: true,
    pagination: false,
    limit: 5000,
  })

  const totals = { count: 0, subtotal: 0, totalDiscount: 0, shippingPrice: 0, totalTax: 0, giftCardApplied: 0, grandTotal: 0, amountDue: 0 }
  const bucketMap = new Map<string, SalesBucket>()

  for (const d of docs as unknown as Row[]) {
    const subtotal = minor(d.subtotal)
    const totalDiscount = minor(d.totalDiscount)
    const shippingPrice = minor(d.shippingPrice)
    const totalTax = minor(d.totalTax)
    const giftCardApplied = minor(d.giftCardApplied)
    const grandTotal = subtotal + shippingPrice + totalTax - totalDiscount
    const amountDue = minor(d.amountDue)
    const day = dayOf(d.placedAt)
    const status = (d.status as string | null | undefined) ?? null
    const paymentState = (d.paymentState as string | null | undefined) ?? null
    const key = `${day ?? 'null'}|${status ?? 'null'}|${paymentState ?? 'null'}`
    let b = bucketMap.get(key)
    if (!b) {
      b = { day, status, paymentState, count: 0, subtotal: 0, totalDiscount: 0, shippingPrice: 0, totalTax: 0, giftCardApplied: 0, grandTotal: 0, amountDue: 0 }
      bucketMap.set(key, b)
    }
    b.count += 1
    b.subtotal += subtotal
    b.totalDiscount += totalDiscount
    b.shippingPrice += shippingPrice
    b.totalTax += totalTax
    b.giftCardApplied += giftCardApplied
    b.grandTotal += grandTotal
    b.amountDue += amountDue
    totals.count += 1
    totals.subtotal += subtotal
    totals.totalDiscount += totalDiscount
    totals.shippingPrice += shippingPrice
    totals.totalTax += totalTax
    totals.giftCardApplied += giftCardApplied
    totals.grandTotal += grandTotal
    totals.amountDue += amountDue
  }

  return { currency: CURRENCY, buckets: [...bucketMap.values()], totals }
}

// ----------------------------------------------------------------------------
// 2. Payment reconciliation exceptions
// ----------------------------------------------------------------------------

export interface ReconciliationExceptionRow {
  id: string | number
  status: string | null
  paymentMethod: string | null
  amount: number
  capturedAmount: number
  refundedAmount: number
  reconciliationStatus: string
  providerTransactionId: string | null
  providerOrderReference: string | null
  order: string | number | null
}

export interface ReconciliationReport {
  currency: typeof CURRENCY
  exceptionCount: number
  exceptions: ReconciliationExceptionRow[]
}

/**
 * `store-transactions` whose `reconciliationStatus` ≠ `matched`. These are the rows an operator must
 * investigate (provider state diverged from our ledger, or never settled).
 */
export async function reconciliationExceptions(input: ReportInput): Promise<ReconciliationReport> {
  assertCallerMayReadTenant(input)
  const { docs } = await input.payload.find({
    collection: 'store-transactions',
    where: {
      and: [
        { tenant: { equals: input.tenantId } },
        { reconciliationStatus: { not_equals: 'matched' } },
      ],
    },
    overrideAccess: true,
    pagination: false,
    limit: 5000,
  })
  const exceptions = (docs as unknown as Row[]).map((d) => toExceptionRow(d))
  return { currency: CURRENCY, exceptionCount: exceptions.length, exceptions }
}

function toExceptionRow(d: Record<string, unknown>): ReconciliationExceptionRow {
  return {
    id: String((d as { id?: unknown }).id ?? ''),
    status: (d.status as string | null | undefined) ?? null,
    paymentMethod: (d.paymentMethod as string | null | undefined) ?? null,
    amount: minor(d.amount),
    capturedAmount: minor(d.capturedAmount),
    refundedAmount: minor(d.refundedAmount),
    reconciliationStatus: String(d.reconciliationStatus ?? 'pending'),
    providerTransactionId: (d.providerTransactionId as string | null | undefined) ?? null,
    providerOrderReference: (d.providerOrderReference as string | null | undefined) ?? null,
    order: relId(d.order),
  }
}

// ----------------------------------------------------------------------------
// 3. Unpaid / expired orders
// ----------------------------------------------------------------------------

const PAID_PAYMENT_STATES = new Set(['captured', 'partially_captured', 'refunded', 'partially_refunded'])

export interface UnpaidOrExpiredRow {
  id: string | number
  orderNumber: string
  status: string | null
  paymentState: string | null
  amountDue: number
  placedAt: string | null
  expiresAt: string | null
  /** True when `expiresAt` is set and in the past relative to `now`. */
  expired: boolean
  /** True when the payment state is not one of the paid/terminal states. */
  unpaid: boolean
}

export interface UnpaidOrExpiredReport {
  currency: typeof CURRENCY
  count: number
  orders: UnpaidOrExpiredRow[]
}

export interface UnpaidOrExpiredOptions {
  /** Override "now" (ISO); defaults to the current time. Useful for deterministic tests. */
  now?: Date
}

/**
 * `store-orders` that are unpaid (paymentState not in the paid/terminal set) OR past their `expiresAt`
 * window. Combines the two conditions with a single OR query and labels each row.
 */
export async function unpaidOrExpiredOrders(
  input: ReportInput,
  opts: UnpaidOrExpiredOptions = {},
): Promise<UnpaidOrExpiredReport> {
  assertCallerMayReadTenant(input)
  const nowIso = (opts.now ?? new Date()).toISOString()
  const { docs } = await input.payload.find({
    collection: 'store-orders',
    where: {
      and: [
        { tenant: { equals: input.tenantId } },
        {
          or: [
            { paymentState: { not_in: [...PAID_PAYMENT_STATES] } },
            { expiresAt: { less_than: nowIso } },
          ],
        },
      ],
    },
    overrideAccess: true,
    pagination: false,
    limit: 5000,
  })
  const orders = (docs as unknown as Row[]).map((d) => {
    const expiresAt = (d.expiresAt as string | null | undefined) ?? null
    const expired = expiresAt !== null && expiresAt < nowIso
    const paymentState = (d.paymentState as string | null | undefined) ?? null
    return {
      id: String((d as { id?: unknown }).id ?? ''),
      orderNumber: String(d.orderNumber ?? ''),
      status: (d.status as string | null | undefined) ?? null,
      paymentState,
      amountDue: minor(d.amountDue),
      placedAt: (d.placedAt as string | null | undefined) ?? null,
      expiresAt,
      expired,
      unpaid: paymentState === null || !PAID_PAYMENT_STATES.has(paymentState),
    }
  })
  return { currency: CURRENCY, count: orders.length, orders }
}

// ----------------------------------------------------------------------------
// 4. Low stock
// ----------------------------------------------------------------------------

export interface LowStockRow {
  id: string | number
  sku: string
  location: string | number | null
  onHand: number
  reserved: number
  /** onHand − reserved, derived (matches the inventory module's atomic availability). */
  available: number
  threshold: number
}

export interface LowStockReport {
  currency: typeof CURRENCY
  count: number
  items: LowStockRow[]
}

export interface LowStockOptions {
  /**
   * Override the low-stock threshold for ALL levels. When omitted, each level uses its own
   * `lowStockThreshold` field. Items are low-stock when `onHand − reserved <= threshold`.
   */
  thresholdOverride?: number
}

/**
 * Low-stock `inventory-levels`. `reserved` is the cached counter kept in lock-step with
 * `stock-reservations` by the inventory module (the authoritative, atomically-updated value);
 * availability is `onHand − reserved`.
 */
export async function lowStock(
  input: ReportInput,
  opts: LowStockOptions = {},
): Promise<LowStockReport> {
  assertCallerMayReadTenant(input)
  const { docs } = await input.payload.find({
    collection: 'inventory-levels',
    where: { tenant: { equals: input.tenantId } },
    overrideAccess: true,
    pagination: false,
    limit: 5000,
  })
  const items: LowStockRow[] = []
  for (const d of docs as unknown as Row[]) {
    const onHand = minor(d.onHand)
    const reserved = minor(d.reserved)
    const available = onHand - reserved
    const threshold = opts.thresholdOverride != null ? Math.trunc(opts.thresholdOverride) : minor(d.lowStockThreshold)
    if (available <= threshold) {
      items.push({
        id: String((d as { id?: unknown }).id ?? ''),
        sku: String(d.sku ?? ''),
        location: relId(d.location),
        onHand,
        reserved,
        available,
        threshold,
      })
    }
  }
  return { currency: CURRENCY, count: items.length, items }
}

// ----------------------------------------------------------------------------
// 5. Promotion usage
// ----------------------------------------------------------------------------

export interface PromotionUsageRow {
  promotionId: string
  code: string | null
  redemptionCount: number
  totalDiscount: number
}

export interface PromotionUsageReport {
  currency: typeof CURRENCY
  promotionCount: number
  totalRedemptions: number
  promotions: PromotionUsageRow[]
}

/**
 * Per-promotion redemption counts + total discount from `promotion-redemptions`. Enriched with the
 * promotion code via a follow-up tenant-scoped read of `promotions`.
 */
export async function promotionUsage(input: ReportInput): Promise<PromotionUsageReport> {
  assertCallerMayReadTenant(input)
  const { docs } = await input.payload.find({
    collection: 'promotion-redemptions',
    where: { tenant: { equals: input.tenantId } },
    overrideAccess: true,
    pagination: false,
    limit: 5000,
  })
  const agg = new Map<string, { redemptionCount: number; totalDiscount: number }>()
  for (const d of docs as unknown as Row[]) {
    const promotionId = String(relId(d.promotion) ?? '')
    if (!promotionId) continue
    const entry = agg.get(promotionId) ?? { redemptionCount: 0, totalDiscount: 0 }
    entry.redemptionCount += 1
    entry.totalDiscount += minor(d.discountAmount)
    agg.set(promotionId, entry)
  }
  // Enrich with promotion codes (single tenant-scoped read; cheap relative to the redemption fold).
  const promotionIds = [...agg.keys()]
  const codeById = new Map<string, string>()
  if (promotionIds.length > 0) {
    const { docs: promos } = await input.payload.find({
      collection: 'promotions',
      where: { and: [{ tenant: { equals: input.tenantId } }, { id: { in: promotionIds } }] },
      overrideAccess: true,
      pagination: false,
      limit: promotionIds.length,
    })
    for (const p of promos as unknown as Row[]) {
      codeById.set(String((p as { id?: unknown }).id), String((p as { code?: unknown }).code ?? ''))
    }
  }
  const promotions: PromotionUsageRow[] = [...agg.entries()].map(([promotionId, e]) => ({
    promotionId,
    code: codeById.get(promotionId) || null,
    redemptionCount: e.redemptionCount,
    totalDiscount: e.totalDiscount,
  }))
  return {
    currency: CURRENCY,
    promotionCount: promotions.length,
    totalRedemptions: promotions.reduce((n, p) => n + p.redemptionCount, 0),
    promotions,
  }
}

// ----------------------------------------------------------------------------
// 6. Gift-card liabilities
// ----------------------------------------------------------------------------

export interface GiftCardLiabilitiesReport {
  currency: typeof CURRENCY
  /** Sum of reconstructed balances across ACTIVE cards. Integer minor units. */
  totalLiability: number
  activeCardCount: number
}

/**
 * Gift-card liabilities reconstructed from the append-only `gift-card-ledger` (the audit source of
 * truth). For each ACTIVE card in the tenant, the balance is the fold of its signed ledger entries;
 * the report sums those reconstructed balances. This mirrors the cached `balance` column kept in
 * lock-step by the gift-cards policy module (used as a defensive fallback when a card has no ledger
 * rows yet).
 */
export async function giftCardLiabilities(input: ReportInput): Promise<GiftCardLiabilitiesReport> {
  assertCallerMayReadTenant(input)
  const [{ docs: ledger }, { docs: cards }] = await Promise.all([
    input.payload.find({
      collection: 'gift-card-ledger',
      where: { tenant: { equals: input.tenantId } },
      overrideAccess: true,
      pagination: false,
      limit: 5000,
    }),
    input.payload.find({
      collection: 'gift-cards',
      where: {
        and: [{ tenant: { equals: input.tenantId } }, { status: { equals: 'active' } }],
      },
      overrideAccess: true,
      pagination: false,
      limit: 5000,
    }),
  ])

  // Fold signed amounts per gift-card id.
  const foldByCard = new Map<string, number>()
  for (const row of ledger as unknown as Row[]) {
    const cardId = String(relId(row.giftCard) ?? '')
    if (!cardId) continue
    foldByCard.set(cardId, (foldByCard.get(cardId) ?? 0) + minor(row.amount))
  }

  let totalLiability = 0
  for (const c of cards as unknown as Row[]) {
    const id = String((c as { id?: unknown }).id ?? '')
    const reconstructed = foldByCard.has(id) ? foldByCard.get(id)! : minor(c.balance)
    // A liability is a positive outstanding balance; clamp negatives (should not occur — the ledger
    // never drives a balance below zero).
    totalLiability += Math.max(0, reconstructed)
  }
  return { currency: CURRENCY, totalLiability, activeCardCount: cards.length }
}

// ----------------------------------------------------------------------------
// 7. Failed notification jobs
// ----------------------------------------------------------------------------

export interface FailedJobRow {
  id: string | number
  taskSlug: string
  queue: string | null
  totalTried: number
  hasError: boolean
  completedAt: string | null
  input: { idempotencyKey?: string; tenantId?: number | string; trigger?: string } | null
  error: unknown
}

export interface FailedNotificationJobsReport {
  currency: typeof CURRENCY
  count: number
  jobs: FailedJobRow[]
}

/**
 * `send-commerce-notification` jobs in the `commerce` queue that exhausted retries (`hasError: true`).
 * `payload-jobs` is a system collection (NOT tenant-scoped by the multi-tenant plugin), so tenant
 * isolation is enforced in JS by matching `input.tenantId`. These are the sends that need operator
 * follow-up after the bounded retry gave up.
 */
export async function failedNotificationJobs(
  input: ReportInput,
): Promise<FailedNotificationJobsReport> {
  assertCallerMayReadTenant(input)
  const { docs } = await input.payload.find({
    collection: 'payload-jobs',
    where: {
      and: [
        { taskSlug: { equals: SEND_COMMERCE_NOTIFICATION_TASK } },
        { hasError: { equals: true } },
      ],
    },
    overrideAccess: true,
    pagination: false,
    limit: 1000,
  })
  const jobs: FailedJobRow[] = []
  for (const d of docs as unknown as Row[]) {
    const jobInput = (d.input ?? {}) as { idempotencyKey?: string; tenantId?: number | string; trigger?: string }
    // Tenant scoping in JS — payload-jobs carries the tenant only inside its JSON input.
    if (String(jobInput.tenantId) !== String(input.tenantId)) continue
    const queue = (d.queue as string | null | undefined) ?? null
    // The commerce queue is the only queue these jobs are enqueued on (D3 + E1 enqueue set it); keep
    // rows from any other queue out of this report.
    if (queue !== 'commerce') continue
    jobs.push({
      id: String((d as { id?: unknown }).id ?? ''),
      taskSlug: SEND_COMMERCE_NOTIFICATION_TASK,
      queue,
      totalTried: minor(d.totalTried),
      hasError: true,
      completedAt: (d.completedAt as string | null | undefined) ?? null,
      input: jobInput,
      error: (d.error as unknown) ?? null,
    })
  }
  return { currency: CURRENCY, count: jobs.length, jobs }
}

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------

// Normalize a relationship value (which may be an id, a populated doc, or null) to a stable id.
function relId(v: unknown): string | number | null {
  if (v === null || v === undefined) return null
  if (typeof v === 'object' && v !== null && 'id' in v) {
    const id = (v as { id?: unknown }).id
    if (id !== undefined && id !== null) return String(id)
  }
  const s = String(v)
  return s === '' ? null : s
}
