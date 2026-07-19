// Idempotent payment-event persistence + state folding, with durable side-effect checkpoints
// (C-03 fix). The compound unique index on (tenant, gateway, providerEventId) is the source of
// idempotency for RECEIPT: insertPaymentEvent uses INSERT ... ON CONFLICT DO NOTHING, so a duplicate
// webhook delivery is a zero-effect success. processPaymentEvent then (a) folds the event into the
// merchant-reference's current payment state via the pure state machine (state.ts), and (b) performs
// five side-effect checkpoints — order, transaction, inventory, gift-card ledger, notification —
// each of which must succeed (or be a permissive no-op) before the event is marked complete. If any
// checkpoint throws or returns not-ok, the event is left unfinished (processed=0) and the typed
// result surfaces which checkpoints remain pending; the durable job (job.ts) throws on unfinished
// work so Payload's bounded retry re-runs it. Duplicate signed events remain harmless: a fully
// processed event short-circuits to an idempotent result without re-running side effects, and every
// side effect is itself idempotent (re-running a checkpoint that succeeded previously is a no-op).
import { sql } from '@payloadcms/db-sqlite'
import type { Payload } from 'payload'
import { foldEvent, type PaymentState } from './state'

type RunResult = { rows: any[]; rowsAffected: number; lastInsertRowid: number | bigint }
type TxLike = { run: (stmt: ReturnType<typeof sql>) => Promise<RunResult> }
type Drizzle = {
  run: (stmt: ReturnType<typeof sql>) => Promise<RunResult>
  transaction: <T>(fn: (tx: TxLike) => Promise<T>) => Promise<T>
}
const drizzleOf = (payload: Payload): Drizzle => (payload.db as unknown as { drizzle: Drizzle }).drizzle

// ----------------------------------------------------------------------------
// Side-effect checkpoint contracts (C-03).
//
// Processing one event must produce/verify five checkpoints; the event is "complete" ONLY when ALL
// succeed. Each handler receives a context describing the folded event and returns a SideEffectResult.
// A handler that performs real work must be IDEMPOTENT — the durable job re-invokes every checkpoint
// until the event is complete, and a re-run after a partial crash must observe that earlier work is
// already done and return `{ ok: true }`. Throwing is allowed and is treated as `{ ok: false }` for
// that checkpoint, with the remaining checkpoints in the chain skipped (recorded as pending).
//
// The default side-effect bundle (NO_OP_SIDE_EFFECTS) is permissive — it succeeds without doing any
// work. It exists so that processPaymentEvent remains safe to call in contexts that only care about
// the state-machine fold (e.g., the folding assertions in commerce-payments-ingest.test.ts). The
// durable job (job.ts) wires a production side-effect bundle that actually performs the work; tests
// inject fakes to assert the durable-checkpoint contract precisely.
// ----------------------------------------------------------------------------

export type CheckpointName = 'order' | 'transaction' | 'inventory' | 'giftcard' | 'notification'

export const PAYMENT_SIDE_EFFECT_CHECKPOINTS: readonly CheckpointName[] = [
  'order',
  'transaction',
  'inventory',
  'giftcard',
  'notification',
]

export interface PaymentSideEffectContext {
  payload: Payload
  tenantId: number | string
  /** Merchant reference (order number) the event folds into. May be absent for synthetic events. */
  orderNumber?: string
  eventId: number | string
  providerEventId: string
  gateway: 'paymob' | 'kashier'
  /** Final folded payment state after absorbing this event. Drives effect selection. */
  foldedState: PaymentState
  /** Original target state carried by the signed event (pre-fold). */
  targetState?: PaymentState | null
  /** Event amount in integer minor units, if the provider supplied one. */
  amount?: number | null
}

export type SideEffectResult =
  | { ok: true; effect?: string }
  | { ok: false; reason: string }

export interface PaymentSideEffects {
  order: (ctx: PaymentSideEffectContext) => Promise<SideEffectResult>
  transaction: (ctx: PaymentSideEffectContext) => Promise<SideEffectResult>
  inventory: (ctx: PaymentSideEffectContext) => Promise<SideEffectResult>
  giftcard: (ctx: PaymentSideEffectContext) => Promise<SideEffectResult>
  notification: (ctx: PaymentSideEffectContext) => Promise<SideEffectResult>
}

/**
 * Permissive no-op handlers. Each returns `{ ok: true }` without doing any work, so the event
 * completes purely through the state-machine fold. Used when the caller only wants folding — the
 * durable job and tests inject real/fake handlers.
 */
export const NO_OP_SIDE_EFFECTS: PaymentSideEffects = {
  order: async () => ({ ok: true, effect: 'noop' }),
  transaction: async () => ({ ok: true, effect: 'noop' }),
  inventory: async () => ({ ok: true, effect: 'noop' }),
  giftcard: async () => ({ ok: true, effect: 'noop' }),
  notification: async () => ({ ok: true, effect: 'noop' }),
}

export interface ProcessPaymentEventOptions {
  /**
   * Override one or more side-effect handlers. Provided handlers replace the no-op defaults; the
   * durable job passes the full production bundle, tests pass fakes that throw/record as needed.
   */
  sideEffects?: Partial<PaymentSideEffects>
}

// ----------------------------------------------------------------------------
// Receipt: idempotent event insert. Stays fast and transaction-free; it ONLY records the verified
// event. The (tenant_id, gateway, provider_event_id) unique index makes a duplicate delivery a
// zero-effect success — exactly the C-03 "duplicate signed events are harmless" property.
// ----------------------------------------------------------------------------

export interface InsertResult {
  inserted: boolean
  id?: number
  duplicate?: boolean
}

export async function insertPaymentEvent(input: {
  payload: Payload
  tenantId: number | string
  gateway: 'paymob' | 'kashier'
  providerEventId: string
  merchantReference?: string
  targetState?: PaymentState
  amount?: number
  rawRedacted?: string
  receivedAt?: string
}): Promise<InsertResult> {
  const receivedAt = input.receivedAt ?? new Date().toISOString()
  const r = await drizzleOf(input.payload).run(sql`
    INSERT INTO \`payment_events\`
      (\`gateway\`, \`provider_event_id\`, \`merchant_reference\`, \`target_state\`, \`amount\`, \`raw_redacted\`, \`received_at\`, \`tenant_id\`)
    VALUES (${input.gateway}, ${input.providerEventId}, ${input.merchantReference ?? null}, ${input.targetState ?? null}, ${input.amount ?? null}, ${input.rawRedacted ?? null}, ${receivedAt}, ${input.tenantId})
    ON CONFLICT(\`tenant_id\`, \`gateway\`, \`provider_event_id\`) DO NOTHING`)
  if (r.rowsAffected === 0) return { inserted: false, duplicate: true }
  return { inserted: true, id: Number(r.lastInsertRowid) }
}

// ----------------------------------------------------------------------------
// Processing: fold + checkpoints.
//
// FoldResult retains its original fields (the existing ingest tests rely on foldedState/changed/
// idempotent) and adds two new ones: `completed` and `pendingCheckpoints`. `completed` is true iff
// every checkpoint succeeded AND the event row's `processed` flag was advanced to 1. The durable
// job inspects these and throws on unfinished work.
// ----------------------------------------------------------------------------

export interface FoldResult {
  foldedState: PaymentState
  changed: boolean
  idempotent: boolean
  tenantId?: number | string
  merchantReference?: string
  /** True iff every side-effect checkpoint succeeded and processed=1 was persisted. */
  completed: boolean
  /** Checkpoints that did not succeed (empty when completed). Driving input for the job's throw. */
  pendingCheckpoints: CheckpointName[]
}

type LoadedEvent = {
  id: number
  tenant_id: number
  merchant_reference: string | null
  provider_event_id: string
  gateway: 'paymob' | 'kashier'
  target_state: PaymentState | null
  folded_state: PaymentState | null
  processed: number
  amount?: number | null
}

type FoldStep =
  | { kind: 'idempotent'; foldedState: PaymentState; tenantId: number; merchantReference: string | null }
  | {
      kind: 'folded'
      foldedState: PaymentState
      changed: boolean
      tenantId: number
      merchantReference: string | null
      providerEventId: string
      gateway: 'paymob' | 'kashier'
      targetState: PaymentState | null
      amount?: number | null
    }

// Step 1: load the event, fast-path the idempotent return, else fold and persist folded_state. The
// `processed` flag is intentionally NOT advanced here — it advances only after every checkpoint
// succeeds (markProcessed, called by processPaymentEvent). A crash between this step and the
// checkpoint phase leaves folded_state populated but processed=0; a re-run recomputes the fold
// deterministically and re-attempts every checkpoint idempotently.
async function loadAndFold(payload: Payload, eventId: number | string): Promise<FoldStep> {
  return drizzleOf(payload).transaction(async (tx) => {
    const ev = (await tx.run(sql`SELECT \`id\`, \`tenant_id\`, \`merchant_reference\`, \`provider_event_id\`, \`gateway\`, \`target_state\`, \`folded_state\`, \`processed\`, \`amount\`
      FROM \`payment_events\` WHERE \`id\` = ${eventId}`)).rows[0] as LoadedEvent | undefined
    if (!ev) throw new Error(`payment event ${eventId} not found`)
    if (ev.processed && ev.folded_state) {
      return {
        kind: 'idempotent',
        foldedState: ev.folded_state,
        tenantId: ev.tenant_id,
        merchantReference: ev.merchant_reference,
      }
    }

    const prev = (await tx.run(sql`SELECT \`folded_state\` FROM \`payment_events\`
      WHERE \`tenant_id\` = ${ev.tenant_id} AND \`merchant_reference\` IS NOT NULL AND \`merchant_reference\` = ${ev.merchant_reference}
        AND \`id\` <> ${ev.id} AND \`folded_state\` IS NOT NULL
      ORDER BY \`id\` DESC LIMIT 1`)).rows[0] as { folded_state?: PaymentState } | undefined
    const currentState: PaymentState = (prev?.folded_state as PaymentState) ?? 'pending'

    const seenRows = await tx.run(sql`SELECT \`provider_event_id\` FROM \`payment_events\`
      WHERE \`tenant_id\` = ${ev.tenant_id} AND \`merchant_reference\` IS NOT NULL AND \`merchant_reference\` = ${ev.merchant_reference}
        AND \`id\` < ${ev.id}`)
    const seen = seenRows.rows.map((row: any) => String(row.provider_event_id))

    const fold = foldEvent(currentState, seen, {
      providerEventId: ev.provider_event_id,
      targetState: ev.target_state ?? 'pending',
    })
    // Persist folded_state WITHOUT advancing processed. Side effects are not yet verified.
    await tx.run(sql`UPDATE \`payment_events\` SET \`folded_state\` = ${fold.state} WHERE \`id\` = ${ev.id}`)
    return {
      kind: 'folded',
      foldedState: fold.state,
      changed: fold.changed,
      tenantId: ev.tenant_id,
      merchantReference: ev.merchant_reference,
      providerEventId: ev.provider_event_id,
      gateway: ev.gateway,
      targetState: ev.target_state,
      amount: ev.amount,
    }
  })
}

// Step 3 (after checkpoints): advance processed=1. Small, dedicated tx so the side effects (which
// run between the fold tx and this one) are never inside the payment database transaction.
async function markProcessed(payload: Payload, eventId: number | string): Promise<void> {
  await drizzleOf(payload).run(sql`UPDATE \`payment_events\` SET \`processed\` = 1 WHERE \`id\` = ${eventId}`)
}

/**
 * Fold one event into the merchant-reference's payment state, then perform the five side-effect
 * checkpoints. Idempotent: a fully-processed event short-circuits without re-running side effects.
 * Side effects are invoked sequentially; the first failure (thrown error or `{ ok: false }`) halts
 * the chain — subsequent checkpoints are recorded as pending without being invoked, which prevents
 * e.g. a notification-of-capture from firing before inventory has been committed. The caller (the
 * durable job) throws on unfinished work so Payload's bounded retry re-runs the event; every
 * checkpoint handler must therefore be idempotent under re-invocation.
 */
export async function processPaymentEvent(
  payload: Payload,
  eventId: number | string,
  options?: ProcessPaymentEventOptions,
): Promise<FoldResult> {
  const sideEffects: PaymentSideEffects = { ...NO_OP_SIDE_EFFECTS, ...(options?.sideEffects ?? {}) }

  const step = await loadAndFold(payload, eventId)

  if (step.kind === 'idempotent') {
    return {
      foldedState: step.foldedState,
      changed: false,
      idempotent: true,
      tenantId: step.tenantId,
      merchantReference: step.merchantReference ?? undefined,
      completed: true,
      pendingCheckpoints: [],
    }
  }

  const ctx: PaymentSideEffectContext = {
    payload,
    tenantId: step.tenantId,
    orderNumber: step.merchantReference ?? undefined,
    eventId,
    providerEventId: step.providerEventId,
    gateway: step.gateway,
    foldedState: step.foldedState,
    targetState: step.targetState,
    amount: step.amount,
  }

  // Sequential checkpoints. First failure halts; remaining checkpoints are recorded as pending.
  const pending: CheckpointName[] = []
  let halted = false
  for (const cp of PAYMENT_SIDE_EFFECT_CHECKPOINTS) {
    if (halted) {
      pending.push(cp)
      continue
    }
    try {
      const r = await sideEffects[cp](ctx)
      if (!r.ok) {
        pending.push(cp)
        halted = true
      }
    } catch {
      pending.push(cp)
      halted = true
    }
  }

  if (pending.length > 0) {
    // Leave processed=0 so reconciliation and the durable-job retry pick this event back up.
    return {
      foldedState: step.foldedState,
      changed: step.changed,
      idempotent: false,
      tenantId: step.tenantId,
      merchantReference: step.merchantReference ?? undefined,
      completed: false,
      pendingCheckpoints: pending,
    }
  }

  await markProcessed(payload, eventId)
  return {
    foldedState: step.foldedState,
    changed: step.changed,
    idempotent: false,
    tenantId: step.tenantId,
    merchantReference: step.merchantReference ?? undefined,
    completed: true,
    pendingCheckpoints: [],
  }
}

// ----------------------------------------------------------------------------
// Reconciliation: find events whose checkpoints never completed (processed=0) and re-attempt them
// with the production side-effect bundle. Used by an operator/admin action or a scheduled task to
// guarantee at-least-once completion even if a webhook's job enqueue was dropped or a worker died
// mid-checkpoint. Pass the same side-effect bundle the durable job uses (buildProductionSideEffects
// in job.ts); defaults to NO_OP if the caller wants a fold-only sweep.
// ----------------------------------------------------------------------------

export interface ReconcileResult {
  attempted: number
  completed: number
  stillUnfinished: number
  unfinishedEventIds: Array<number | string>
}

export async function reconcilePaymentEvents(
  payload: Payload,
  options?: {
    limit?: number
    sideEffects?: Partial<PaymentSideEffects>
    /** Only retry events older than this many seconds (default: 0 = no age gate). */
    minAgeSeconds?: number
  },
): Promise<ReconcileResult> {
  const limit = options?.limit ?? 100
  const minAgeSeconds = options?.minAgeSeconds ?? 0
  const cutoff = minAgeSeconds > 0
    ? new Date(Date.now() - minAgeSeconds * 1000).toISOString().replace('T', ' ').replace(/\.\d+Z$/, 'Z')
    : null
  // Note: received_at is an ISO8601 string; lexicographic comparison is correct for the cutoff.
  const rows = cutoff
    ? (await drizzleOf(payload).run(sql`SELECT \`id\` FROM \`payment_events\` WHERE \`processed\` = 0 AND \`received_at\` < ${cutoff} ORDER BY \`id\` ASC LIMIT ${limit}`)).rows
    : (await drizzleOf(payload).run(sql`SELECT \`id\` FROM \`payment_events\` WHERE \`processed\` = 0 ORDER BY \`id\` ASC LIMIT ${limit}`)).rows

  let completed = 0
  const unfinishedEventIds: Array<number | string> = []
  for (const row of rows) {
    const id = Number(row.id)
    const result = await processPaymentEvent(payload, id, { sideEffects: options?.sideEffects })
    if (result.completed) completed += 1
    else unfinishedEventIds.push(id)
  }
  return {
    attempted: rows.length,
    completed,
    stillUnfinished: unfinishedEventIds.length,
    unfinishedEventIds,
  }
}
