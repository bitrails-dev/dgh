// Shopper-facing checkout + pay route: the single place-order endpoint. A thin HTTP handler over
// placeOrder (directly callable, hence directly testable). placeOrder chains the server-authoritative
// checkout (reserve → quote → create order — client prices/totals are never trusted) and then, for an
// online gateway, initiates a hosted checkout. Offline methods (cod/bank) leave inventory RESERVED
// for an admin to confirm later (which triggers commitOrderInventory). The capture→commit loop is
// owned by the payment webhook + job; this route only starts it. Mirrors the webhook pattern: tenant
// resolved by URL slug → 404 when missing/featureless; buildAdapter is injectable for fake-adapter
// tests with no network.
import type { Endpoint, Payload, PayloadRequest } from 'payload'
import { checkout } from '../checkout'
import { money } from '../money'
import { loadGatewayConfig, type GatewayProvider } from '../payments/settings'
import { buildPaymentAdapter, type AdapterBuilder } from '../payments/adapters/registry'
import { loadCommerceSettings, readJsonBody, resolveStoreTenant } from './shared'

export interface PlaceOrderItem {
  sku: string
  quantity: number
}

export interface PlaceOrderInput {
  cartToken: string
  items: PlaceOrderItem[]
  customerEmail?: string
  customerPhone?: string
  shippingAddress?: unknown
  billingAddress?: unknown
  paymentMethod: 'cod' | 'bank' | 'paymob' | 'kashier'
  returnUrl?: string
  locationId?: number | string
}

// checkout() failure code → HTTP status + body. Prices and stock are resolved server-side, so these
// are the only shopper-facing failure modes from the place-order step (a browser never sends totals).
const checkoutFailure = (
  code: 'PRODUCT_NOT_FOUND' | 'INSUFFICIENT_STOCK' | 'TAMPER',
  detail?: unknown,
): { status: number; body: Record<string, unknown> } => {
  const status = code === 'INSUFFICIENT_STOCK' ? 409 : code === 'PRODUCT_NOT_FOUND' ? 422 : 500
  return { status, body: { error: code, detail } }
}

// Unified place-order orchestration:
//   1. load commerce settings (503 when the tenant has none),
//   2. resolve a fulfillment location (explicit, else the tenant's first inventory-location; 422 when
//      none),
//   3. checkout() — reserve → quote → create order (never trusting client prices),
//   4a. offline (cod/bank): return a pending order; inventory stays reserved for admin confirmation,
//   4b. online gateway (paymob/kashier): build the adapter from the tenant's decrypted config and
//       initiate a hosted checkout (422 when the gateway isn't configured). `buildAdapter` is
//       injectable so the gateway path is testable with a fake adapter and no network.
export async function placeOrder(
  payload: Payload,
  tenantId: number | string,
  input: PlaceOrderInput,
  opts?: { buildAdapter?: AdapterBuilder },
): Promise<{ status: number; body: Record<string, unknown> }> {
  const settings = await loadCommerceSettings(payload, tenantId)
  if (!settings) return { status: 503, body: { error: 'commerce_not_configured' } }

  // Resolve the fulfillment location: explicit if provided, else the tenant's first inventory-location.
  let locationId = input.locationId
  if (locationId == null) {
    const { docs } = await payload.find({
      collection: 'inventory-locations',
      where: { tenant: { equals: tenantId } },
      overrideAccess: true,
      limit: 1,
    })
    const loc = docs[0] as { id: number | string } | undefined
    if (!loc) return { status: 422, body: { error: 'no_fulfillment_location' } }
    locationId = loc.id
  }

  const result = await checkout({
    payload,
    tenantId,
    cartToken: input.cartToken,
    lines: input.items,
    locationId,
    currency: settings.currency,
    taxMode: settings.taxMode,
    customerEmail: input.customerEmail,
    customerPhone: input.customerPhone,
    shippingAddress: input.shippingAddress,
    billingAddress: input.billingAddress,
  })
  if (!result.ok) return checkoutFailure(result.code, result.detail)

  const orderNumber = (result.order as { orderNumber: string }).orderNumber
  const amountDue = result.quote.amountDue

  // Offline methods: inventory stays reserved; an admin confirms later (→ commitOrderInventory).
  if (input.paymentMethod === 'cod' || input.paymentMethod === 'bank') {
    return {
      status: 200,
      body: {
        orderNumber,
        amountDue,
        currency: settings.currency,
        paymentMethod: input.paymentMethod,
        paymentState: 'pending',
        quote: result.quote,
      },
    }
  }

  // Online gateway: build the adapter from the tenant's decrypted credentials and initiate hosted
  // checkout. The capture→commit loop is owned by the payment webhook + job, so nothing else happens
  // here. Never log the gateway config / secrets.
  const provider = input.paymentMethod as GatewayProvider
  const cfg = await loadGatewayConfig(payload, tenantId, provider)
  if (!cfg) return { status: 422, body: { error: 'gateway_not_configured' } }

  const adapter = (opts?.buildAdapter ?? buildPaymentAdapter)(provider, cfg)
  const r = await adapter.createHostedCheckout({
    merchantReference: orderNumber,
    amount: money(amountDue, settings.currency),
    customerEmail: input.customerEmail,
    billingUrl: input.returnUrl,
    sandbox: settings.sandbox,
  })
  return {
    status: 200,
    body: {
      orderNumber,
      amountDue,
      currency: settings.currency,
      paymentMethod: provider,
      checkoutUrl: r.checkoutUrl,
      providerSessionId: r.providerSessionId,
    },
  }
}

// POST /commerce/store/:tenantSlug/checkout — resolve the tenant by slug (404 when unknown or without
// the commerce feature), parse the JSON body (400 when missing/invalid), then place the order and pass
// its {status, body} through unchanged.
const checkoutHandler = async (req: PayloadRequest): Promise<Response> => {
  const tenantSlug = req.routeParams?.tenantSlug as string | undefined
  if (!tenantSlug) return Response.json({ error: 'missing_tenant' }, { status: 400 })

  const tenant = await resolveStoreTenant(req.payload, tenantSlug)
  if (!tenant) return Response.json({ error: 'not_found' }, { status: 404 })

  const body = await readJsonBody(req)
  if (!body) return Response.json({ error: 'invalid_body' }, { status: 400 })

  const { status, body: resp } = await placeOrder(req.payload, tenant.id, body as PlaceOrderInput)
  return Response.json(resp, { status })
}

export const checkoutEndpoints: Endpoint[] = [
  { path: '/commerce/store/:tenantSlug/checkout', method: 'post', handler: checkoutHandler },
]
