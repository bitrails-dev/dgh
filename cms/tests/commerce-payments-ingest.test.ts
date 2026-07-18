// Integration coverage for the payments persistence layer: encrypted gateway credentials,
// loadGatewayConfig decryption, idempotent payment-event insert (compound unique + ON CONFLICT),
// tenant isolation, event folding, and webhook ingest with a fake adapter. Runs against an isolated
// throwaway SQLite DB migrated from scratch.
import assert from 'node:assert/strict'
import { rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import type { Payload } from 'payload'

const TEMP_DB = join(tmpdir(), `commerce-payments-itest-${process.pid}-${Date.now()}.db`)
process.env.DATABASE_URI = `file:${TEMP_DB}`
process.env.PAYLOAD_SECRET = process.env.PAYLOAD_SECRET || 'commerce-payments-itest-secret'

const { default: config } = await import('../src/payload.config')
const { getPayload } = await import('payload')
const { seedTenant } = await import('./helpers/commerce')
const payload = (await getPayload({ config })) as unknown as Payload
await payload.db.migrate()

const { decryptGatewaySecret } = await import('../src/commerce/crypto')
const { money } = await import('../src/commerce/money')
const { loadGatewayConfig } = await import('../src/commerce/payments/settings')
const { insertPaymentEvent, processPaymentEvent } = await import('../src/commerce/payments/events')
const { ingestWebhook } = await import('../src/commerce/payments/webhook')
import type { PaymentAdapter, NormalizedEvent } from '../src/commerce/payments/types'

let tenantId: number | string
let tenantBId: number | string
let settingsId: number | string

test.before(async () => {
  ;({ tenantId } = await seedTenant(payload))
  ;({ tenantId: tenantBId } = await seedTenant(payload))
  const settings = await payload.create({
    collection: 'commerce-settings',
    overrideAccess: true,
    data: {
      tenant: tenantId, status: 'live', currency: 'EGP', taxMode: 'exclusive', sandbox: false,
      paymob: { enabled: true, apiKey: 'plain-key', hmacSecret: 'plain-hmac', iframeId: '1', merchantId: 'm1' },
      kashier: { enabled: false },
    } as any,
  })
  settingsId = (settings as any).id
})
test.after(async () => {
  try {
    // Root cause of the payments-ingest teardown flake: @payloadcms/drizzle's destroy() nulls
    // `drizzle` but never closes the underlying @libsql/client native Sqlite3Client, which then
    // intermittently access-violates (0xC0000005) at process exit on Windows. Close it explicitly
    // first, while payload.db.drizzle still exists. Test-harness hygiene, not a Phase 1 logic change.
    try { await (payload.db as any).drizzle?.session?.client?.close?.() } catch { /* best-effort native close */ }
    await payload.destroy()
  } finally { try { rmSync(TEMP_DB, { force: true }) } catch { /* */ } }
})

async function readSettings(tid: number | string) {
  const r = await payload.find({ collection: 'commerce-settings', where: { tenant: { equals: tid } }, overrideAccess: true, limit: 1 })
  return r.docs[0] as any
}

test('gateway secrets are encrypted at rest and decryptable to the original', async () => {
  const s = await readSettings(tenantId)
  assert.notEqual(s.paymob.apiKey, 'plain-key', 'plaintext must not be stored')
  assert.equal(decryptGatewaySecret(s.paymob.apiKey), 'plain-key', 'stored blob decrypts to the original')
  assert.notEqual(s.paymob.hmacSecret, 'plain-hmac')
  assert.equal(decryptGatewaySecret(s.paymob.hmacSecret), 'plain-hmac')
})

test('updating other settings without re-entering the key preserves the stored secret', async () => {
  await payload.update({
    collection: 'commerce-settings', id: settingsId, overrideAccess: true,
    data: { status: 'maintenance', paymob: { enabled: true, apiKey: '', hmacSecret: '', iframeId: '1', merchantId: 'm1' } } as any,
  })
  const s = await readSettings(tenantId)
  assert.equal(decryptGatewaySecret(s.paymob.apiKey), 'plain-key', 'previous secret preserved on partial update')
})

test('loadGatewayConfig decrypts an enabled gateway and returns null for a disabled/absent one', async () => {
  const paymob = await loadGatewayConfig(payload, tenantId, 'paymob')
  assert.ok(paymob?.enabled)
  assert.equal(paymob?.apiKey, 'plain-key')
  assert.equal(paymob?.hmacSecret, 'plain-hmac')
  assert.equal(paymob?.sandbox, false)
  assert.equal(await loadGatewayConfig(payload, tenantId, 'kashier'), null)
  assert.equal(await loadGatewayConfig(payload, tenantBId, 'paymob'), null, 'tenant B has no settings')
})

test('a duplicate payment-event insert is an idempotent no-op; another tenant is not blocked', async () => {
  const a = await insertPaymentEvent({ payload, tenantId, gateway: 'paymob', providerEventId: 'evt-1', merchantReference: 'ORD-1', targetState: 'authorized' })
  const b = await insertPaymentEvent({ payload, tenantId, gateway: 'paymob', providerEventId: 'evt-1', merchantReference: 'ORD-1', targetState: 'authorized' })
  const c = await insertPaymentEvent({ payload, tenantId: tenantBId, gateway: 'paymob', providerEventId: 'evt-1', merchantReference: 'ORD-1', targetState: 'authorized' })
  assert.ok(a.inserted && a.id != null)
  assert.equal(b.inserted, false)
  assert.equal(b.duplicate, true)
  assert.ok(c.inserted, 'same providerEventId allowed for a different tenant (isolation)')
})

test('event folding advances state and absorbs out-of-order events', async () => {
  const e1 = await insertPaymentEvent({ payload, tenantId, gateway: 'paymob', providerEventId: 'fold-1', merchantReference: 'ORD-F', targetState: 'authorized' })
  const f1 = await processPaymentEvent(payload, (e1 as any).id)
  assert.equal(f1.foldedState, 'authorized')
  assert.equal(f1.changed, true)

  const e2 = await insertPaymentEvent({ payload, tenantId, gateway: 'paymob', providerEventId: 'fold-2', merchantReference: 'ORD-F', targetState: 'captured' })
  const f2 = await processPaymentEvent(payload, (e2 as any).id)
  assert.equal(f2.foldedState, 'captured')

  const again = await processPaymentEvent(payload, (e2 as any).id)
  assert.equal(again.idempotent, true)
  assert.equal(again.foldedState, 'captured')

  const eStale = await insertPaymentEvent({ payload, tenantId, gateway: 'paymob', providerEventId: 'fold-stale', merchantReference: 'ORD-F', targetState: 'pending' })
  const fStale = await processPaymentEvent(payload, (eStale as any).id)
  assert.equal(fStale.foldedState, 'captured', 'out-of-order pending does not regress')
  assert.equal(fStale.changed, false)
})

test('ingestWebhook: bad signature -> 401; good -> inserted; duplicate delivery -> 200 idempotent', async () => {
  const makeAdapter = (event: NormalizedEvent | null, reason?: string): PaymentAdapter => ({
    provider: 'paymob',
    capabilities: () => ({ hostedCheckout: true, authorization: true, refunds: true, partialRefunds: true, voiding: true, recurring: false, webhookSignature: 'hmac' }),
    createHostedCheckout: async () => ({ checkoutUrl: '', providerSessionId: '' }),
    refund: async () => ({ ok: true }),
    verifyWebhook: async () => (event ? { accepted: true, event } : { accepted: false, reason: reason ?? 'bad_sig' }),
    lookup: async () => ({ state: 'pending' }),
  })

  const bad = await ingestWebhook({ payload, tenantId, gateway: 'paymob', adapter: makeAdapter(null), rawBody: Buffer.from('{}'), headers: {} })
  assert.equal(bad.status, 401)

  const okEvent: NormalizedEvent = { provider: 'paymob', providerEventId: 'w-1', merchantReference: 'ORD-W', targetState: 'captured', amount: money(1000, 'EGP') }
  const good = await ingestWebhook({ payload, tenantId, gateway: 'paymob', adapter: makeAdapter(okEvent), rawBody: Buffer.from('{}'), headers: { hmac: 'x' } })
  assert.equal(good.status, 200)
  assert.equal(good.inserted, true)

  const dup = await ingestWebhook({ payload, tenantId, gateway: 'paymob', adapter: makeAdapter(okEvent), rawBody: Buffer.from('{}'), headers: { hmac: 'x' } })
  assert.equal(dup.status, 200)
  assert.equal(dup.duplicate, true, 'redelivery is an idempotent success')
})
