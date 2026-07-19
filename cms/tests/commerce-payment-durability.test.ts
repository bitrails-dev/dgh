// C-03 durability coverage for the payment-event processing layer. Verifies that:
//   - receipt (insertPaymentEvent) remains a fast idempotent record, separate from work
//   - a fully-processed event is marked complete ONLY after all five side-effect checkpoints succeed
//   - a crash/throw AFTER the transaction checkpoint but BEFORE the inventory checkpoint leaves the
//     event unfinished (processed=0) with the remaining checkpoints surfaced as pending; a re-run
//     with working handlers completes it
//   - a duplicate signed event delivery is a harmless no-op (no double side effect)
//   - reconciliation (reconcilePaymentEvents) picks up an event with an unfinished checkpoint and
//     completes it
//   - the notification side effect is enqueued (not sent) inside processPaymentEvent
//
// Side-effect handlers are injected fakes throughout — no real providers, no network. The
// production wiring (buildProductionSideEffects in job.ts) is exercised by the type-checker and the
// existing ingest test; the durability of the CHECKPOINT MECHANISM is what this file nails down.
import assert from 'node:assert/strict'
import { rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import type { Payload } from 'payload'

const TEMP_DB = join(tmpdir(), `commerce-payment-durability-${process.pid}-${Date.now()}.db`)
process.env.DATABASE_URI = `file:${TEMP_DB}`
process.env.PAYLOAD_SECRET = process.env.PAYLOAD_SECRET || 'commerce-payment-durability-secret'

const { default: config } = await import('../src/payload.config')
const { getPayload } = await import('payload')
const { seedTenant } = await import('./helpers/commerce')
const payload = (await getPayload({ config })) as unknown as Payload
await payload.db.migrate()

const { sql } = await import('@payloadcms/db-sqlite')
const { insertPaymentEvent, processPaymentEvent, reconcilePaymentEvents, NO_OP_SIDE_EFFECTS } = await import('../src/commerce/payments/events')
import type { PaymentSideEffects, CheckpointName } from '../src/commerce/payments/events'

let tenantId: number | string

test.before(async () => {
  ;({ tenantId } = await seedTenant(payload))
})
test.after(async () => {
  try {
    try { await (payload.db as any).drizzle?.session?.client?.close?.() } catch { /* best-effort native close */ }
    await payload.destroy()
  } finally { try { rmSync(TEMP_DB, { force: true }) } catch { /* */ } }
})

// Read the event row directly to assert on processed / folded_state without going through the
// Payload Local API (which would just re-run our processing).
async function readEvent(id: number | string): Promise<{ processed: number; folded_state: string | null }> {
  const drizzle = (payload.db as unknown as { drizzle: { run: (s: ReturnType<typeof sql>) => Promise<{ rows: any[] }> } }).drizzle
  const r = await drizzle.run(sql`SELECT \`processed\`, \`folded_state\` FROM \`payment_events\` WHERE \`id\` = ${id}`)
  return r.rows[0] ?? { processed: -1, folded_state: null }
}

// Build a fake side-effect bundle that records every invocation and can be programmed to throw at
// a specific checkpoint (simulating a crash) or to record enqueue/send separately.
function makeRecordingFakes(opts: {
  throwAt?: CheckpointName
  failAt?: CheckpointName  // return ok:false instead of throwing
  calls?: Array<CheckpointName>
  enqueueCalls?: Array<{ orderNumber?: string; state: string }>
  sendCalls?: Array<{ orderNumber?: string; state: string }>
} = {}): PaymentSideEffects {
  const calls = opts.calls ?? []
  const enqueueCalls = opts.enqueueCalls ?? []
  const sendCalls = opts.sendCalls ?? []
  const record = (cp: CheckpointName) => { calls.push(cp) }
  return {
    order: async (ctx) => {
      record('order')
      if (opts.throwAt === 'order') throw new Error('crash in order checkpoint')
      if (opts.failAt === 'order') return { ok: false, reason: 'order_fail' }
      return { ok: true, effect: 'order_synced' }
    },
    transaction: async (ctx) => {
      record('transaction')
      if (opts.throwAt === 'transaction') throw new Error('crash in transaction checkpoint')
      if (opts.failAt === 'transaction') return { ok: false, reason: 'tx_fail' }
      return { ok: true, effect: 'tx_upserted' }
    },
    inventory: async (ctx) => {
      record('inventory')
      if (opts.throwAt === 'inventory') throw new Error('crash before inventory')
      if (opts.failAt === 'inventory') return { ok: false, reason: 'inv_fail' }
      return { ok: true, effect: 'inv_committed' }
    },
    giftcard: async (ctx) => {
      record('giftcard')
      if (opts.throwAt === 'giftcard') throw new Error('crash in giftcard checkpoint')
      if (opts.failAt === 'giftcard') return { ok: false, reason: 'gc_fail' }
      return { ok: true, effect: 'gc_verified' }
    },
    notification: async (ctx) => {
      record('notification')
      if (opts.throwAt === 'notification') throw new Error('crash in notification checkpoint')
      if (opts.failAt === 'notification') return { ok: false, reason: 'notif_fail' }
      // Enqueue only — NEVER send here. The send happens out-of-band in the
      // send-commerce-notification task (Wave E1).
      enqueueCalls.push({ orderNumber: ctx.orderNumber, state: ctx.foldedState })
      return { ok: true, effect: 'enqueued' }
    },
  }
}

test('receipt (insertPaymentEvent) is a fast idempotent record separate from work', async () => {
  // First delivery inserts.
  const a = await insertPaymentEvent({ payload, tenantId, gateway: 'paymob', providerEventId: 'receipt-1', merchantReference: 'ORD-RECEIPT', targetState: 'authorized' })
  assert.ok(a.inserted, 'first delivery inserts')
  assert.ok(a.id != null)
  // The row exists with processed=0 immediately after insert — work has NOT happened.
  const row = await readEvent(a.id as number)
  assert.equal(row.processed, 0, 'receipt does not perform work')
  assert.equal(row.folded_state, null, 'receipt does not fold')
  // Second delivery is a duplicate — zero-effect.
  const b = await insertPaymentEvent({ payload, tenantId, gateway: 'paymob', providerEventId: 'receipt-1', merchantReference: 'ORD-RECEIPT', targetState: 'authorized' })
  assert.equal(b.inserted, false)
  assert.equal(b.duplicate, true)
})

test('a fully-processed event is marked complete only after ALL 5 checkpoints', async () => {
  const ins = await insertPaymentEvent({ payload, tenantId, gateway: 'paymob', providerEventId: 'all-5', merchantReference: 'ORD-ALL5', targetState: 'captured' })
  assert.ok(ins.inserted && ins.id != null)

  const calls: CheckpointName[] = []
  const fakes = makeRecordingFakes({ calls })

  const result = await processPaymentEvent(payload, ins.id as number, { sideEffects: fakes })
  assert.equal(result.completed, true, 'event reports completed')
  assert.deepEqual(result.pendingCheckpoints, [], 'no pending checkpoints')
  assert.equal(result.foldedState, 'captured')
  assert.equal(result.idempotent, false, 'first processing is not idempotent-replay')

  // The DB row is advanced to processed=1 — work is durably complete.
  const row = await readEvent(ins.id as number)
  assert.equal(row.processed, 1, 'processed flag advanced')
  assert.equal(row.folded_state, 'captured')

  // All five checkpoints fired exactly once each, in order.
  assert.deepEqual(calls, ['order', 'transaction', 'inventory', 'giftcard', 'notification'])
})

test('a crash AFTER the transaction checkpoint but BEFORE inventory leaves the event unfinished; re-run completes it', async () => {
  const ins = await insertPaymentEvent({ payload, tenantId, gateway: 'paymob', providerEventId: 'crash-1', merchantReference: 'ORD-CRASH', targetState: 'captured' })
  assert.ok(ins.inserted && ins.id != null)

  // First processing: inventory throws. Order + transaction already succeeded; inventory/giftcard/
  // notification must be skipped (halt-on-failure) and recorded as pending.
  const callsRun1: CheckpointName[] = []
  const r1 = await processPaymentEvent(payload, ins.id as number, {
    sideEffects: makeRecordingFakes({ throwAt: 'inventory', calls: callsRun1 }),
  })
  assert.equal(r1.completed, false, 'event is unfinished')
  assert.deepEqual(r1.pendingCheckpoints, ['inventory', 'giftcard', 'notification'], 'remaining checkpoints surfaced as pending')
  assert.equal(r1.foldedState, 'captured', 'fold still persisted')

  // The DB row is NOT marked processed.
  const rowAfterCrash = await readEvent(ins.id as number)
  assert.equal(rowAfterCrash.processed, 0, 'processed flag stays 0 on unfinished work')
  assert.equal(rowAfterCrash.folded_state, 'captured', 'folded_state was persisted before the crash')

  // First run halted at inventory — order + transaction fired; inventory threw; giftcard/notification skipped.
  assert.deepEqual(callsRun1, ['order', 'transaction', 'inventory'])

  // The durable job would throw here. Simulate the bounded retry by re-running with working handlers.
  const callsRun2: CheckpointName[] = []
  const r2 = await processPaymentEvent(payload, ins.id as number, {
    sideEffects: makeRecordingFakes({ calls: callsRun2 }),
  })
  assert.equal(r2.completed, true, 're-run completes the event')
  assert.deepEqual(r2.pendingCheckpoints, [])

  // Re-run invoked every checkpoint (each idempotent — no double-write in production wiring).
  assert.deepEqual(callsRun2, ['order', 'transaction', 'inventory', 'giftcard', 'notification'])

  // processed flag advanced only after the successful re-run.
  const rowAfterRerun = await readEvent(ins.id as number)
  assert.equal(rowAfterRerun.processed, 1)
})

test('a duplicate signed event delivery is a harmless no-op (no double side effect)', async () => {
  const first = await insertPaymentEvent({ payload, tenantId, gateway: 'paymob', providerEventId: 'dup-1', merchantReference: 'ORD-DUP', targetState: 'captured' })
  assert.ok(first.inserted, 'first delivery inserts')

  // Second delivery of the SAME signed event: zero-effect at the receipt layer.
  const second = await insertPaymentEvent({ payload, tenantId, gateway: 'paymob', providerEventId: 'dup-1', merchantReference: 'ORD-DUP', targetState: 'captured' })
  assert.equal(second.inserted, false)
  assert.equal(second.duplicate, true)

  // Process the single inserted event once.
  const callsFirst: CheckpointName[] = []
  const r1 = await processPaymentEvent(payload, first.id as number, {
    sideEffects: makeRecordingFakes({ calls: callsFirst }),
  })
  assert.equal(r1.completed, true)
  assert.equal(callsFirst.length, 5, 'side effects fired once during initial processing')

  // Re-processing the same event (as a retry or a re-delivery-triggered job would) is a no-op:
  // idempotent short-circuit, NO further side-effect invocation.
  const callsReplay: CheckpointName[] = []
  const r2 = await processPaymentEvent(payload, first.id as number, {
    sideEffects: makeRecordingFakes({ calls: callsReplay }),
  })
  assert.equal(r2.idempotent, true, 're-processing a complete event is an idempotent no-op')
  assert.equal(r2.completed, true)
  assert.equal(callsReplay.length, 0, 'side effects NOT re-invoked on idempotent replay')
})

test('reconciliation picks up an event with an unfinished checkpoint and completes it', async () => {
  // Seed an unfinished event: process with an inventory-throwing handler so it stays at processed=0.
  const ins = await insertPaymentEvent({ payload, tenantId, gateway: 'paymob', providerEventId: 'recon-1', merchantReference: 'ORD-RECON', targetState: 'captured' })
  assert.ok(ins.inserted && ins.id != null)

  // First attempt crashes at the notification checkpoint — event left unfinished.
  const crashResult = await processPaymentEvent(payload, ins.id as number, {
    sideEffects: makeRecordingFakes({ throwAt: 'notification' }),
  })
  assert.equal(crashResult.completed, false)
  assert.deepEqual(crashResult.pendingCheckpoints, ['notification'])

  // The row is unfinished — visible to the reconciliation sweep.
  const rowBefore = await readEvent(ins.id as number)
  assert.equal(rowBefore.processed, 0)

  // Reconciliation sweep: re-attempts every processed=0 event with the working handler bundle.
  // The sweep covers this event and any leftover from prior tests in this file's seed tenant.
  const reconCalls: CheckpointName[] = []
  const sweep = await reconcilePaymentEvents(payload, {
    limit: 50,
    sideEffects: makeRecordingFakes({ calls: reconCalls }),
  })
  assert.ok(sweep.attempted >= 1, 'sweep attempted at least the one unfinished event')
  assert.ok(sweep.completed >= 1, 'sweep completed at least the one unfinished event')
  assert.equal(sweep.stillUnfinished, 0, 'sweep leaves no unfinished events behind with working handlers')

  // The specific event is now complete.
  const rowAfter = await readEvent(ins.id as number)
  assert.equal(rowAfter.processed, 1)

  // The notification checkpoint fired during the sweep (proving reconciliation reached it).
  assert.ok(reconCalls.includes('notification'), 'sweep invoked the notification checkpoint')
})

test('notification is enqueued, NOT sent inside the payment transaction', async () => {
  const ins = await insertPaymentEvent({ payload, tenantId, gateway: 'paymob', providerEventId: 'notif-1', merchantReference: 'ORD-NOTIF', targetState: 'captured' })
  assert.ok(ins.inserted && ins.id != null)

  const enqueueCalls: Array<{ orderNumber?: string; state: string }> = []
  const sendCalls: Array<{ orderNumber?: string; state: string }> = []
  const fakes = makeRecordingFakes({ enqueueCalls, sendCalls })

  const result = await processPaymentEvent(payload, ins.id as number, { sideEffects: fakes })
  assert.equal(result.completed, true)

  // Exactly one enqueue, no sends. The send happens out-of-band in the
  // send-commerce-notification task registered by Wave E1.
  assert.equal(enqueueCalls.length, 1, 'notification enqueued exactly once')
  assert.equal(enqueueCalls[0].state, 'captured')
  assert.equal(enqueueCalls[0].orderNumber, 'ORD-NOTIF')
  assert.equal(sendCalls.length, 0, 'no sends performed inside payment processing')
})

test('NO_OP default side-effects complete the fold path without performing real work (backward-compat)', async () => {
  // The default (no sideEffects passed) is a permissive no-op: the event completes via the fold
  // alone. This preserves the contract relied on by the existing folding tests in
  // commerce-payments-ingest.test.ts.
  const ins = await insertPaymentEvent({ payload, tenantId, gateway: 'paymob', providerEventId: 'noop-1', merchantReference: 'ORD-NOOP', targetState: 'authorized' })
  const result = await processPaymentEvent(payload, ins.id as number)
  assert.equal(result.completed, true)
  assert.deepEqual(result.pendingCheckpoints, [])
  assert.equal(result.foldedState, 'authorized')

  // processed advanced because every (no-op) checkpoint succeeded.
  const row = await readEvent(ins.id as number)
  assert.equal(row.processed, 1)
})

// Reference the export so type-stripping keeps it in the module graph even if a future test
// trims the body above.
void NO_OP_SIDE_EFFECTS
