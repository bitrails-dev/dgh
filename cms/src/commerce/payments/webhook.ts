// Webhook ingestion orchestration. The HTTP endpoint (added once the Paymob/Kashier adapters land)
// resolves the tenant from the URL slug, loads that tenant's gateway config, constructs the adapter
// with the decrypted credentials, and calls ingestWebhook. Verification, the durable idempotent
// insert, and acknowledgement all happen here — the browser redirect is never trusted.
//
// ingestWebhook takes the adapter as a dependency so it is fully testable with a fake adapter and no
// network. Processing (state folding) is split into processPaymentEvent (events.ts) so it can run in
// a commerce-queue job after the ACK.
import type { Payload } from 'payload'
import { sql } from '@payloadcms/db-sqlite'
import type { PaymentAdapter } from './types'
import { insertPaymentEvent, processPaymentEvent } from './events'
import { loadGatewayConfig, type GatewayProvider } from './settings'
import { buildPaymentAdapter, type AdapterBuilder } from './adapters/registry'
import { COMMERCE_QUEUE, PROCESS_PAYMENT_EVENT_TASK } from './job'

export interface IngestResult {
  status: number
  inserted?: boolean
  duplicate?: boolean
  eventId?: number
  reason?: string
}

export async function ingestWebhook(input: {
  payload: Payload
  tenantId: number | string
  gateway: 'paymob' | 'kashier'
  adapter: PaymentAdapter
  rawBody: Buffer
  headers: Record<string, string | undefined>
}): Promise<IngestResult> {
  const verified = await input.adapter.verifyWebhook({ rawBody: input.rawBody, headers: input.headers })
  if (!verified.accepted || !verified.event) {
    return { status: 401, reason: verified.reason ?? 'invalid_signature' }
  }
  const ev = verified.event
  const ins = await insertPaymentEvent({
    payload: input.payload,
    tenantId: input.tenantId,
    gateway: input.gateway,
    providerEventId: ev.providerEventId,
    merchantReference: ev.merchantReference,
    targetState: ev.targetState,
    amount: ev.amount?.amount,
    rawRedacted: ev.rawRedacted != null ? safeStringify(ev.rawRedacted) : undefined,
  })
  if (!ins.inserted) return { status: 200, duplicate: true }
  return { status: 200, inserted: true, eventId: ins.id }
}

// Best-effort sanitized JSON. The adapter is responsible for redaction before returning rawRedacted;
// this only ensures the value is serializable and strips nothing else.
const safeStringify = (value: unknown): string => {
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

// Full webhook orchestration: resolve the tenant by slug, 404 when the tenant lacks `commerce` or
// the gateway isn't configured, build the adapter from the tenant's decrypted credentials, ingest
// (verify + atomic idempotent insert + ACK), then enqueue the durable processing job. The browser
// redirect is never trusted; only a verified, durably-inserted event proceeds.
//
// `buildAdapter` is injectable so the orchestration (tenant resolution, feature gate, config load,
// enqueue) is fully testable with a fake adapter and no real HMAC computation.
export async function handleProviderWebhook(input: {
  payload: Payload
  tenantSlug: string
  provider: GatewayProvider
  rawBody: Buffer
  headers: Record<string, string | undefined>
  buildAdapter?: AdapterBuilder
}): Promise<{ status: number; body: Record<string, unknown> }> {
  const { payload, tenantSlug, provider } = input

  const { docs } = await payload.find({
    collection: 'tenants',
    where: { slug: { equals: tenantSlug } },
    overrideAccess: true,
    limit: 1,
  })
  const tenant = docs[0] as { id: number | string; features?: string[] | null } | undefined
  // Commerce routes 404 when the resolved tenant lacks the feature (and for unknown tenants).
  if (!tenant || !(tenant.features ?? []).includes('commerce')) {
    return { status: 404, body: { error: 'not_found' } }
  }

  const cfg = await loadGatewayConfig(payload, tenant.id, provider)
  if (!cfg) {
    return { status: 404, body: { error: 'gateway_not_configured' } }
  }

  const adapter = (input.buildAdapter ?? buildPaymentAdapter)(provider, cfg)
  const result = await ingestWebhook({
    payload, tenantId: tenant.id, gateway: provider, adapter,
    rawBody: input.rawBody, headers: input.headers,
  })

  // Best-effort enqueue of the durable processing job. The ACK only depends on the durable insert
  // (above); a queue hiccup never fails the webhook. A sweep (reprocessUnprocessed) recovers any
  // event whose job was dropped.
  if (result.inserted && result.eventId != null) {
    try {
      await (payload as unknown as {
        jobs?: { queue: (args: unknown) => Promise<unknown> }
      }).jobs?.queue({ task: PROCESS_PAYMENT_EVENT_TASK, input: { eventId: result.eventId }, queue: COMMERCE_QUEUE })
    } catch {
      /* durable insert; the sweep recovers */
    }
  }

  return { status: result.status, body: { inserted: result.inserted, duplicate: result.duplicate } }
}

// Recovery sweep: fold every still-unprocessed payment event. Used by an operator/admin action or a
// scheduled task to guarantee at-least-once processing even if a webhook's job enqueue was dropped.
export async function reprocessUnprocessed(payload: Payload, limit = 100): Promise<{ processed: number }> {
  const drizzle = (payload.db as unknown as { drizzle: { run: (s: ReturnType<typeof sql>) => Promise<{ rows: any[] }> } }).drizzle
  const res = await drizzle.run(sql`SELECT \`id\` FROM \`payment_events\` WHERE \`processed\` = 0 ORDER BY \`id\` ASC LIMIT ${limit}`)
  let processed = 0
  for (const row of res.rows) {
    await processPaymentEvent(payload, Number(row.id))
    processed += 1
  }
  return { processed }
}
