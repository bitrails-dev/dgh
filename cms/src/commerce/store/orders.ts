// Signed plugin-first storefront orders endpoint (Wave E3 continuation, plan §7 E3). Read-only
// customer order history + detail over the plugin `store-orders` collection. Every handler crosses
// withVerifiedCommerceGateway first; the customer is then resolved from the `x-session-token` header
// (the storefront session bridge — the Astro proxy relays the Secure HttpOnly `store_session_v2`
// cookie as this header, and readCustomerMe verifies the JWT + tenant), and orders are filtered by
// {tenant, customer}. Money is integer minor units (EGP), unchanged from the order snapshot.
//
// The gateway verifier does NOT resolve the customer for storefront flows (it reads req.user, which
// a signed proxy request does not carry); the x-session-token bridge is the storefront's customer
// identity, validated here. Commerce is disabled for all tenants until F3, so this is not live yet.
import type { Endpoint, Payload, PayloadRequest } from 'payload'
import { withVerifiedCommerceGateway } from './gateway'
import { readCustomerMe } from '../customers/payload-auth'
import { STORE_COLLECTION_SLUGS } from '../plugin/slugs'

const ORDERS = STORE_COLLECTION_SLUGS.orders

type OrderRow = Record<string, unknown>

function currencyOf(o: OrderRow): string {
  const snap = o.quoteSnapshot as { currency?: string } | undefined
  return snap?.currency ?? 'EGP'
}
function itemCount(o: OrderRow): number {
  const items = o.items as unknown
  return Array.isArray(items) ? items.length : 0
}

// Lean order summary for the history list.
function orderSummary(o: OrderRow) {
  return {
    orderNumber: o.orderNumber,
    status: o.status,
    paymentState: o.paymentState,
    amountDue: o.amountDue,
    currency: currencyOf(o),
    placedAt: o.placedAt,
    itemCount: itemCount(o),
  }
}

export type OrdersResult = { status: number; body: Record<string, unknown> }

// List the customer's orders for the resolved tenant, newest first.
export async function listOrders(
  payload: Payload,
  tenantId: number | string,
  customerId: number | string,
): Promise<OrdersResult> {
  const { docs } = await payload.find({
    collection: ORDERS,
    where: { and: [{ tenant: { equals: tenantId } }, { customer: { equals: customerId } }] },
    overrideAccess: true,
    limit: 50,
    sort: '-placedAt',
  })
  return { status: 200, body: { items: (docs as unknown as OrderRow[]).map(orderSummary) } }
}

// One order by orderNumber, tenant + customer scoped.
export async function readOrder(
  payload: Payload,
  tenantId: number | string,
  customerId: number | string,
  orderNumber: string,
): Promise<OrdersResult> {
  const { docs } = await payload.find({
    collection: ORDERS,
    where: {
      and: [
        { tenant: { equals: tenantId } },
        { customer: { equals: customerId } },
        { orderNumber: { equals: orderNumber } },
      ],
    },
    overrideAccess: true,
    limit: 1,
  })
  const o = docs[0] as unknown as OrderRow | undefined
  if (!o) return { status: 404, body: { error: 'not_found' } }
  return { status: 200, body: { ...o, currency: currencyOf(o), itemCount: itemCount(o) } }
}

// Resolve the customer id from the x-session-token header via the customer-auth token resolver
// (verifies the JWT + tenant). Returns the failure {status, body} to pass through unchanged.
// Exported so the storefront session bridge is directly testable without a gateway-signed request.
export async function resolveCustomer(
  req: PayloadRequest,
  tenantId: number | string,
): Promise<{ ok: true; customerId: number | string } | { ok: false; status: number; body: Record<string, unknown> }> {
  const token = req.headers.get('x-session-token')
  if (!token) return { ok: false, status: 401, body: { error: 'invalid_session' } }
  const me = await readCustomerMe(req.payload, token, tenantId)
  if (me.status !== 200) return { ok: false, status: me.status, body: me.body }
  const id = (me.body as { customer?: { id?: unknown } }).customer?.id
  if (id === undefined || id === null) return { ok: false, status: 401, body: { error: 'invalid_session' } }
  return { ok: true, customerId: id as number | string }
}

async function verifyGet(req: PayloadRequest, tenantSlug: string | undefined) {
  if (!tenantSlug) return { ok: false as const, res: Response.json({ error: 'missing_tenant' }, { status: 400 }) }
  // GET has no body; the signature covers path + query + the empty body hash.
  const v = await withVerifiedCommerceGateway({ req, tenantSlug, bodyBytes: Buffer.alloc(0) })
  if (!v.ok) return { ok: false as const, res: Response.json(v.body, { status: v.status }) }
  return { ok: true as const, tenantId: v.context.tenantId }
}

export const orderEndpoints: Endpoint[] = [
  {
    path: '/commerce/store/:tenantSlug/orders',
    method: 'get',
    handler: async (req: PayloadRequest): Promise<Response> => {
      const tenantSlug = req.routeParams?.tenantSlug as string | undefined
      const v = await verifyGet(req, tenantSlug)
      if (!v.ok) return v.res
      const c = await resolveCustomer(req, v.tenantId)
      if (!c.ok) return Response.json(c.body, { status: c.status })
      const r = await listOrders(req.payload, v.tenantId, c.customerId)
      return Response.json(r.body, { status: r.status })
    },
  },
  {
    path: '/commerce/store/:tenantSlug/orders/:orderNumber',
    method: 'get',
    handler: async (req: PayloadRequest): Promise<Response> => {
      const tenantSlug = req.routeParams?.tenantSlug as string | undefined
      const orderNumber = req.routeParams?.orderNumber as string | undefined
      const v = await verifyGet(req, tenantSlug)
      if (!v.ok) return v.res
      if (!orderNumber) return Response.json({ error: 'missing_order' }, { status: 400 })
      const c = await resolveCustomer(req, v.tenantId)
      if (!c.ok) return Response.json(c.body, { status: c.status })
      const r = await readOrder(req.payload, v.tenantId, c.customerId, orderNumber)
      return Response.json(r.body, { status: r.status })
    },
  },
]
