// Idempotent payment-event persistence + state folding. The compound unique index on
// (tenant, gateway, providerEventId) is the source of idempotency: insertPaymentEvent uses
// INSERT ... ON CONFLICT DO NOTHING, so a duplicate webhook delivery is a zero-effect success.
// processPaymentEvent folds an event into the merchant-reference's current payment state via the
// pure state machine (state.ts), making duplicate and out-of-order deliveries safe no-ops.
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

export interface FoldResult {
  foldedState: PaymentState
  changed: boolean
  idempotent: boolean
  tenantId?: number | string
  merchantReference?: string
}

// Fold one event into the merchant-reference's current state. Current state = the latest folded_state
// among earlier events for the same reference (default 'pending'); already-seen providerEventIds make
// the fold a duplicate no-op. Idempotent: re-processing a processed event returns its stored state.
export async function processPaymentEvent(payload: Payload, eventId: number | string): Promise<FoldResult> {
  return drizzleOf(payload).transaction(async (tx) => {
    const ev = (await tx.run(sql`SELECT \`id\`, \`tenant_id\`, \`merchant_reference\`, \`provider_event_id\`, \`target_state\`, \`folded_state\`, \`processed\`
      FROM \`payment_events\` WHERE \`id\` = ${eventId}`)).rows[0] as
      | { id: number; tenant_id: number; merchant_reference: string | null; provider_event_id: string; target_state: PaymentState | null; folded_state: PaymentState | null; processed: number }
      | undefined
    if (!ev) throw new Error(`payment event ${eventId} not found`)
    if (ev.processed && ev.folded_state) {
      return { foldedState: ev.folded_state, changed: false, idempotent: true, tenantId: ev.tenant_id, merchantReference: ev.merchant_reference ?? undefined }
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
    await tx.run(sql`UPDATE \`payment_events\` SET \`folded_state\` = ${fold.state}, \`processed\` = 1 WHERE \`id\` = ${ev.id}`)
    return { foldedState: fold.state, changed: fold.changed, idempotent: false, tenantId: ev.tenant_id, merchantReference: ev.merchant_reference ?? undefined }
  })
}
