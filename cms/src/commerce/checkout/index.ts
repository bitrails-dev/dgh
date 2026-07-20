// Repointed order side-effects for the plugin-first runtime (Wave F2). These two helpers find an
// order by its per-tenant orderNumber and either commit its Phase-1 reservation (capture / offline
// admin confirm) or sync its paymentState from the folded payment-event state. Both now operate on
// the plugin `store-orders` collection (STORE_COLLECTION_SLUGS.orders); the legacy `orders` runtime
// model is retired. They have no live caller in the HTTP surface today — processCheckout records a
// pending payment event and the D3 `process-payment-event` task drives capture→commit through its
// own side-effect bundle (commerce/payments/job.ts) — but F3's offline-COD admin-confirm flow will
// call these; they must write `store-orders`, never legacy.
//
// Note: the legacy `checkout()` orchestration + CheckoutInput/CheckoutLine/CheckoutResult that used
// to live here was removed in Wave F2 (the live path is processCheckout in ./process). The transition
// enforcement that used to reject illegal moves lived on the legacy `orders` beforeChange hook; the
// plugin `store-orders` override has no such hook, so `store-orders` paymentState is a permissive
// denormalized field (the authoritative fold lives in the `payment-events` ledger) — see the note on
// setOrderPaymentState below.
import type { Payload } from 'payload'
import { commitOrder } from '../inventory'
import { STORE_COLLECTION_SLUGS } from '../plugin/slugs'
import type { PaymentState } from '../payments/state'

// On payment capture / offline admin confirm, consume the order's reserved stock (closes the
// reserve→commit loop). Finds the order by its per-tenant orderNumber in store-orders, then commits
// ONLY that order's reservations via the Phase-1 layer (order-scoped — never another order's that
// happens to share a cart token; C-01). Idempotent: a second call after commit finds no active
// reservations and commits nothing.
export async function commitOrderInventory(input: {
  payload: Payload
  tenantId: number | string
  orderNumber: string
}): Promise<{ committed: number; found: boolean }> {
  const { payload, tenantId, orderNumber } = input
  const { docs } = await payload.find({
    collection: STORE_COLLECTION_SLUGS.orders,
    where: { and: [{ tenant: { equals: tenantId } }, { orderNumber: { equals: orderNumber } }] },
    overrideAccess: true,
    limit: 1,
  })
  if (!docs[0]) return { committed: 0, found: false }
  const { committed } = await commitOrder({ payload, tenantId, orderNumber })
  return { committed, found: true }
}

// Map the full payment-state machine onto the smaller `store-orders` paymentState select. The select
// carries the common lifecycle values but not `voided`/`disputed` (those are ledger- +
// transaction-only states). voided maps to its plugin analogue `cancelled`; disputed has no faithful
// representation on the order doc and is a permissive no-op. Mirrors mapPaymentStateForOrder in
// commerce/payments/job.ts so this helper and the D3 job denormalize identically.
function mapPaymentStateForOrder(state: PaymentState): string | null {
  if (state === 'voided') return 'cancelled'
  if (state === 'disputed') return null
  return state
}

// Sync the store-order's paymentState from the folded payment-event state. The plugin `store-orders`
// collection has no transition-enforcement beforeChange hook (unlike the retired legacy `orders`),
// so this is a best-effort denormalization, NOT a state-machine gate — the authoritative fold lives
// in the `payment-events` ledger and the D3 job's own setStoreOrderPaymentState is likewise
// permissive. No-op when the order is missing, already in that state, or the state has no faithful
// store-orders representation (disputed). Returns updated:false in all those cases.
export async function setOrderPaymentState(input: {
  payload: Payload
  tenantId: number | string
  orderNumber: string
  state: PaymentState
}): Promise<{ updated: boolean }> {
  const mapped = mapPaymentStateForOrder(input.state)
  if (mapped === null) return { updated: false }
  const { docs } = await input.payload.find({
    collection: STORE_COLLECTION_SLUGS.orders,
    where: { and: [{ tenant: { equals: input.tenantId } }, { orderNumber: { equals: input.orderNumber } }] },
    overrideAccess: true,
    limit: 1,
  })
  const order = docs[0] as { id: number | string; paymentState?: string } | undefined
  if (!order || order.paymentState === mapped) return { updated: false }
  // `mapped` is one of the store-orders paymentState select values; cast to match the codebase's
  // other plugin-collection writes (the generated select union is stricter than the runtime string).
  await input.payload.update({
    collection: STORE_COLLECTION_SLUGS.orders,
    id: order.id,
    data: { paymentState: mapped } as any,
    overrideAccess: true,
  })
  return { updated: true }
}
