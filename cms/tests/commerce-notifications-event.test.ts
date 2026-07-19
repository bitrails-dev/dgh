// Integration coverage for the E1 contract (Plan §7 E1): once the `send-commerce-notification` task
// is registered, a payment event driven through the production side-effect bundle reaches
// `processed=1` AND enqueues exactly one notification job with the deterministic payment idempotency
// key. This is the test that was blocked on E1 landing — the D4 test asserted `processed` falsy
// precisely because E1 had not landed.
//
// The `send-commerce-notification` task is NOT yet registered in payload.config.ts (the integration
// owner does that at fan-in). We therefore stub `payload.jobs.queue` — the exact seam D3's
// `buildProductionSideEffects` reads — so the notification checkpoint succeeds and the event can
// complete. The task body's own dedupe/send logic is covered in commerce-notifications.test.ts.
import assert from 'node:assert/strict'
import { rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import type { Payload } from 'payload'

const TEMP_DB = join(tmpdir(), `commerce-notifications-event-${process.pid}-${Date.now()}.db`)
process.env.DATABASE_URI = `file:${TEMP_DB}`
process.env.PAYLOAD_SECRET = process.env.PAYLOAD_SECRET || 'commerce-notifications-event-secret'

const { default: config } = await import('../src/payload.config')
const { getPayload } = await import('payload')
const { seedTenant } = await import('./helpers/commerce')
const payload = (await getPayload({ config })) as unknown as Payload
await payload.db.migrate()

const { sql } = await import('@payloadcms/db-sqlite')
const { insertPaymentEvent, processPaymentEvent } = await import('../src/commerce/payments/events')
const { buildProductionSideEffects, SEND_COMMERCE_NOTIFICATION_TASK } = await import('../src/commerce/payments/job')

let tenantId: number | string

test.before(async () => {
  ;({ tenantId } = await seedTenant(payload))
})
test.after(async () => {
  try {
    // Windows libsql teardown: close the native client before destroy (see run-commerce-integration-tests.mjs).
    try { await (payload.db as any).drizzle?.session?.client?.close?.() } catch { /* best-effort */ }
    await payload.destroy()
  } finally { try { rmSync(TEMP_DB, { force: true }) } catch { /* */ } }
})

async function readEvent(id: number | string): Promise<{ processed: number; folded_state: string | null }> {
  const drizzle = (payload.db as unknown as { drizzle: { run: (s: ReturnType<typeof sql>) => Promise<{ rows: any[] }> } }).drizzle
  const r = await drizzle.run(sql`SELECT \`processed\`, \`folded_state\` FROM \`payment_events\` WHERE \`id\` = ${id}`)
  return r.rows[0] ?? { processed: -1, folded_state: null }
}

// The recorded enqueue calls captured by the stubbed jobs runtime.
type QueuedCall = { task: string; input: Record<string, unknown>; queue: string }

test('a captured payment event completes (processed=1) and enqueues one send-commerce-notification job', async () => {
  const ins = await insertPaymentEvent({
    payload, tenantId, gateway: 'paymob', providerEventId: 'e1-cap',
    merchantReference: 'ORD-E1-CAP', targetState: 'captured', amount: 10000,
  })
  assert.ok(ins.inserted && ins.id != null)

  // Stub the jobs runtime — the seam buildProductionSideEffects reads. Records every queue() call.
  const queued: QueuedCall[] = []
  ;(payload as unknown as { jobs: { queue: (a: unknown) => Promise<unknown> } }).jobs = {
    queue: async (args) => { queued.push(args as QueuedCall); return { id: queued.length } },
  }

  const result = await processPaymentEvent(payload, ins.id as number, {
    sideEffects: buildProductionSideEffects(payload),
  })

  // The event is complete — every checkpoint succeeded (order/transaction/inventory/giftcard are
  // permissive no-ops for this seed; notification succeeded via the stubbed queue).
  assert.equal(result.completed, true, 'event completes once the notification can be enqueued')
  assert.deepEqual(result.pendingCheckpoints, [])
  assert.equal(result.foldedState, 'captured')

  const row = await readEvent(ins.id as number)
  assert.equal(row.processed, 1, 'processed flag advanced — E1 unblocks payment completion')

  // Exactly one notification job, on the commerce queue, with the deterministic payment key.
  const notifCalls = queued.filter((q) => q.task === SEND_COMMERCE_NOTIFICATION_TASK)
  assert.equal(notifCalls.length, 1, 'send-commerce-notification enqueued exactly once')
  assert.equal(notifCalls[0].queue, 'commerce')
  assert.equal(
    notifCalls[0].input.idempotencyKey,
    `payment:${tenantId}:${ins.id}:captured`,
    'deterministic idempotency key: payment:<tenant>:<eventId>:<foldedState>',
  )
  assert.equal(notifCalls[0].input.trigger, 'payment_event')
  assert.equal(notifCalls[0].input.state, 'captured')
  assert.equal(notifCalls[0].input.gateway, 'paymob')
  assert.equal(notifCalls[0].input.orderNumber, 'ORD-E1-CAP')
  assert.equal(notifCalls[0].input.amount, 10000)
})

test('re-processing a completed event does NOT re-enqueue the notification (idempotent replay)', async () => {
  const ins = await insertPaymentEvent({
    payload, tenantId, gateway: 'paymob', providerEventId: 'e1-replay',
    merchantReference: 'ORD-E1-REPLAY', targetState: 'captured',
  })
  const queued: QueuedCall[] = []
  ;(payload as unknown as { jobs: { queue: (a: unknown) => Promise<unknown> } }).jobs = {
    queue: async (args) => { queued.push(args as QueuedCall); return { id: queued.length } },
  }

  const first = await processPaymentEvent(payload, ins.id as number, {
    sideEffects: buildProductionSideEffects(payload),
  })
  assert.equal(first.completed, true)

  const replay = await processPaymentEvent(payload, ins.id as number, {
    sideEffects: buildProductionSideEffects(payload),
  })
  assert.equal(replay.idempotent, true, 're-processing a complete event short-circuits')
  assert.equal(replay.completed, true)

  const notifCalls = queued.filter((q) => q.task === SEND_COMMERCE_NOTIFICATION_TASK)
  assert.equal(notifCalls.length, 1, 'notification enqueued once across processing + replay')
})
