// Pure unit coverage for the durable commerce notifications engine + content renderer (Plan §7 E1).
// No Payload boot: executeSendCommerceNotification is driven with fake transports + a fake dedupe
// signal, so these run fast in the unit suite. The end-to-end "event reaches processed=1" path is
// covered separately in commerce-notifications-event.test.ts (integration).
import assert from 'node:assert/strict'
import test from 'node:test'

import { renderNotification, paymentStateTemplate } from '../src/commerce/notifications/content'
import {
  executeSendCommerceNotification,
  deriveIdempotencyKey,
} from '../src/commerce/notifications/engine'
import { createSmtpTransport } from '../src/commerce/notifications/transport'
import type {
  NotificationMessage,
  NotificationSendResult,
  NotificationTransport,
} from '../src/commerce/notifications/types'
import type { NotificationTaskInput } from '../src/commerce/notifications/types'

// ----------------------------------------------------------------------------
// Fakes
// ----------------------------------------------------------------------------

function fakeTransport(
  outcomes: NotificationSendResult[] | NotificationSendResult,
  log?: NotificationMessage[],
): NotificationTransport {
  const queue = Array.isArray(outcomes) ? [...outcomes] : [outcomes]
  return {
    name: 'fake',
    async send(message) {
      log?.push(message)
      const next = queue.shift()
      if (!next) throw new Error('fakeTransport: outcomes exhausted')
      return next
    },
  }
}

function makeDeps(opts: {
  transport: NotificationTransport
  hasAlreadySucceeded?: (key: string) => Promise<boolean>
  resolveRecipient?: (input: NotificationTaskInput) => Promise<string | null>
}) {
  return {
    transport: opts.transport,
    hasAlreadySucceeded: opts.hasAlreadySucceeded ?? (async () => false),
    resolveRecipient: opts.resolveRecipient ?? (async (i) => i.customerEmail ?? null),
  }
}

const paymentInput = (overrides: Partial<NotificationTaskInput> = {}): NotificationTaskInput => ({
  idempotencyKey: 'payment:1:evt-1:captured',
  tenantId: 1,
  trigger: 'payment_event',
  orderNumber: 'ORD-1',
  state: 'captured',
  gateway: 'paymob',
  providerEventId: 'evt-1',
  amount: 10000,
  // Present so the default resolveRecipient returns an address and the engine reaches the transport.
  // (The payment path resolves the recipient from store-orders in the real handler — see task.ts.)
  customerEmail: 'customer@dgh.test',
  ...overrides,
})

// ----------------------------------------------------------------------------
// Content rendering
// ----------------------------------------------------------------------------

test('payment_event captured/failed/refunded map to concrete templates; interim states skip', () => {
  assert.equal(paymentStateTemplate('captured'), 'payment_captured')
  assert.equal(paymentStateTemplate('failed'), 'payment_failed')
  assert.equal(paymentStateTemplate('refunded'), 'refund_completed')
  assert.equal(paymentStateTemplate('partially_refunded'), 'refund_completed')
  // Interim / non-terminal states have no customer-facing template.
  assert.equal(paymentStateTemplate('pending'), null)
  assert.equal(paymentStateTemplate('authorized'), null)
  assert.equal(paymentStateTemplate('partially_captured'), null)
  assert.equal(paymentStateTemplate('disputed'), null)
  assert.equal(paymentStateTemplate(undefined), null)
})

test('renderNotification yields bilingual subject+body for a captured payment with the order number', () => {
  const r = renderNotification(paymentInput(), 'customer@dgh.test')
  assert.equal(r.ok, true)
  if (!r.ok) throw new Error('unreachable')
  assert.equal(r.recipientEmail, 'customer@dgh.test')
  assert.equal(r.message.template, 'payment_captured')
  assert.equal(r.message.to, 'customer@dgh.test')
  assert.ok(r.message.subject.ar.includes('ORD-1'), 'ar subject carries the order number')
  assert.ok(r.message.subject.en.includes('ORD-1'), 'en subject carries the order number')
  assert.equal(r.message.meta.orderNumber, 'ORD-1')
  assert.equal(r.message.meta.amount, 10000)
  assert.equal(r.message.meta.gateway, 'paymob')
})

test('renderNotification skips when there is no template for the folded state', () => {
  const r = renderNotification(paymentInput({ state: 'authorized' }), 'customer@dgh.test')
  assert.equal(r.ok, false)
  if (r.ok) throw new Error('unreachable')
  assert.equal(r.skip, true)
  assert.match(r.reason, /no_template_for_state:authorized/)
})

test('renderNotification skips when no recipient is available', () => {
  const r = renderNotification(paymentInput(), '')
  assert.equal(r.ok, false)
  if (r.ok) throw new Error('unreachable')
  assert.equal(r.skip, true)
  assert.equal(r.reason, 'no_recipient')
})

test('order_placed renders with the amount due formatted as a decimal EGP string', () => {
  const r = renderNotification(
    { idempotencyKey: 'order_placed:1:ORD-9', tenantId: 1, trigger: 'order_placed', orderNumber: 'ORD-9', amountDue: 12550 },
    'buyer@dgh.test',
  )
  assert.equal(r.ok, true)
  if (!r.ok) throw new Error('unreachable')
  assert.equal(r.message.template, 'order_placed')
  assert.ok(r.message.body.ar.includes('125.50'), 'ar body formats minor units as decimal EGP')
})

// ----------------------------------------------------------------------------
// Engine: dedupe, skip, send, retry, non-retryable
// ----------------------------------------------------------------------------

test('engine SENDS once and records the template + transport on a successful dispatch', async () => {
  const sent: NotificationMessage[] = []
  const out = await executeSendCommerceNotification(
    paymentInput(),
    makeDeps({ transport: fakeTransport({ ok: true, transport: 'smtp', messageId: 'm-1', retryable: false }, sent) }),
  )
  assert.equal(out.sent, true)
  if (!out.sent) throw new Error('unreachable')
  assert.equal(out.transport, 'smtp')
  assert.equal(out.template, 'payment_captured')
  assert.equal(out.to, 'customer@dgh.test')
  assert.equal(out.deduped, false)
  assert.equal(sent.length, 1, 'transport.send invoked exactly once')
})

test('engine DEDUPES when a prior send for the same idempotencyKey already succeeded', async () => {
  const sent: NotificationMessage[] = []
  const transport = fakeTransport({ ok: true, transport: 'smtp', retryable: false }, sent)
  const deps = makeDeps({
    transport,
    hasAlreadySucceeded: async (key) => key === 'payment:1:evt-1:captured',
  })
  const out = await executeSendCommerceNotification(paymentInput(), deps)
  assert.equal(out.sent, false)
  assert.equal((out as { deduped?: boolean }).deduped, true)
  assert.equal(sent.length, 0, 'transport.send NOT invoked on a dedupe hit')
})

test('two calls with the same idempotencyKey send exactly once (the dedupe contract)', async () => {
  const sent: NotificationMessage[] = []
  const transport = fakeTransport({ ok: true, transport: 'smtp', retryable: false }, sent)
  // The dedupe signal flips to "already succeeded" after the first send — mirrors a real prior job
  // having completed. This proves the task body is idempotent under re-delivery.
  const succeededKeys = new Set<string>()
  const deps = makeDeps({
    transport,
    hasAlreadySucceeded: async (key) => succeededKeys.has(key),
  })
  const input = paymentInput()
  const first = await executeSendCommerceNotification(input, deps)
  assert.equal(first.sent, true)
  succeededKeys.add(input.idempotencyKey) // mark as succeeded (as Payload would after the job completes)
  const second = await executeSendCommerceNotification(input, deps)
  assert.equal(second.sent, false)
  assert.equal((second as { deduped?: boolean }).deduped, true)
  assert.equal(sent.length, 1, 'exactly one send across the two calls')
})

test('engine THROWS on a retryable transport failure (Payload bounded retry re-runs the task)', async () => {
  const transport = fakeTransport({ ok: false, transport: 'smtp', reason: 'connect ECONNREFUSED', retryable: true })
  await assert.rejects(
    executeSendCommerceNotification(paymentInput(), makeDeps({ transport })),
    /retryable/,
  )
})

test('engine records a structured SKIP on a non-retryable failure (does not burn retries)', async () => {
  const transport = fakeTransport({ ok: false, transport: 'smtp', reason: 'missing COMMERCE_SMTP_FROM', retryable: false })
  const out = await executeSendCommerceNotification(paymentInput(), makeDeps({ transport }))
  assert.equal(out.sent, false)
  assert.equal((out as { skipped?: boolean }).skipped, true)
  assert.match((out as { reason?: string }).reason ?? '', /non_retryable/)
})

test('engine skips cleanly when the folded state has no template', async () => {
  const sent: NotificationMessage[] = []
  const transport = fakeTransport({ ok: true, transport: 'smtp', retryable: false }, sent)
  const out = await executeSendCommerceNotification(
    paymentInput({ state: 'authorized' }),
    makeDeps({ transport }),
  )
  assert.equal(out.sent, false)
  assert.equal((out as { skipped?: boolean }).skipped, true)
  assert.equal(sent.length, 0)
})

test('the default SMTP transport SUCCEEDS with transport=unconfigured when host is unset', async () => {
  // No COMMERCE_SMTP_HOST → the task must still succeed so payment events can reach processed=1.
  const transport = createSmtpTransport({ /* no host */ })
  const r = await transport.send({
    to: 'x@dgh.test', tenantId: 1, trigger: 'payment_event', template: 'payment_captured',
    subject: { ar: 'a', en: 'b' }, body: { ar: 'a', en: 'b' }, meta: {},
  })
  assert.equal(r.ok, true)
  assert.equal(r.transport, 'unconfigured')
  assert.equal(r.retryable, false)
})

test('deriveIdempotencyKey is deterministic for the non-payment triggers', () => {
  assert.equal(deriveIdempotencyKey('order_placed', 7, 'ORD-7'), 'order_placed:7:ORD-7')
  assert.equal(deriveIdempotencyKey('order_placed', 7, 'ORD-7'), 'order_placed:7:ORD-7')
  assert.notEqual(
    deriveIdempotencyKey('order_placed', 7, 'ORD-7'),
    deriveIdempotencyKey('order_placed', 7, 'ORD-8'),
  )
})
