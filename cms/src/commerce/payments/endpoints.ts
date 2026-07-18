// Public webhook routes: POST /api/commerce/webhooks/{paymob,kashier}/:tenantSlug
// These are the source of truth for payment status (never the browser redirect). The handler reads
// the raw body, delegates to handleProviderWebhook (tenant resolution + feature 404 + config load +
// verify + durable insert + ACK + enqueue), and returns the result. The raw body is read with the
// web-standard req.text(); both providers sign field values (parsed by the adapter), so the JSON
// bytes are what the adapter verifies.
import type { Endpoint, PayloadRequest } from 'payload'
import { handleProviderWebhook } from './webhook'
import type { GatewayProvider } from './settings'

const toRecord = (headers: PayloadRequest['headers']): Record<string, string | undefined> => {
  const out: Record<string, string | undefined> = {}
  const h = headers as unknown
  if (h && typeof (h as { forEach?: unknown }).forEach === 'function') {
    ;(h as { forEach: (cb: (v: string, k: string) => void) => void }).forEach((v, k) => {
      out[k] = v
    })
  } else if (h && typeof h === 'object') {
    Object.assign(out, h)
  }
  return out
}

const webhook =
  (provider: GatewayProvider) =>
  async (req: PayloadRequest): Promise<Response> => {
    const tenantSlug = req.routeParams?.tenantSlug as string | undefined
    if (!tenantSlug) return Response.json({ error: 'missing_tenant' }, { status: 400 })
    let rawBody: Buffer
    try {
      rawBody = Buffer.from(typeof req.text === 'function' ? await req.text() : '')
    } catch {
      rawBody = Buffer.alloc(0)
    }
    const { status, body } = await handleProviderWebhook({
      payload: req.payload,
      tenantSlug,
      provider,
      rawBody,
      headers: toRecord(req.headers),
    })
    return Response.json(body, { status })
  }

export const commerceWebhookEndpoints: Endpoint[] = [
  { path: '/commerce/webhooks/paymob/:tenantSlug', method: 'post', handler: webhook('paymob') },
  { path: '/commerce/webhooks/kashier/:tenantSlug', method: 'post', handler: webhook('kashier') },
]
