// Load + decrypt a tenant's gateway credentials. The secret fields on commerce-settings are
// write-only (field access.read = false); this reads them via overrideAccess and decrypts the stored
// AES-256-GCM blobs with commerce/crypto. Returns null when the tenant has no settings or that
// gateway is disabled — callers (checkout, webhook) treat null as "not configured".
import type { Payload } from 'payload'
import { decryptGatewaySecret } from '../crypto'

export type GatewayProvider = 'paymob' | 'kashier'

export interface GatewayConfig {
  provider: GatewayProvider
  enabled: boolean
  sandbox: boolean
  currency?: string
  merchantId?: string
  apiKey?: string
  hmacSecret?: string
  webhookSecret?: string
  iframeId?: string
  integrationId?: string
}

const dec = (blob: unknown): string | undefined =>
  typeof blob === 'string' && blob.length > 0 ? decryptGatewaySecret(blob) : undefined

export async function loadGatewayConfig(
  payload: Payload,
  tenantId: number | string,
  provider: GatewayProvider,
): Promise<GatewayConfig | null> {
  const { docs } = await payload.find({
    collection: 'commerce-settings',
    where: { tenant: { equals: tenantId } },
    overrideAccess: true,
    depth: 0,
    limit: 1,
  })
  const settings = docs[0] as
    | { sandbox?: boolean; currency?: string; paymob?: any; kashier?: any }
    | undefined
  if (!settings) return null
  const sandbox = Boolean(settings.sandbox)
  const currency = settings.currency

  if (provider === 'paymob') {
    const g = settings.paymob
    if (!g?.enabled) return null
    return {
      provider: 'paymob', enabled: true, sandbox, currency,
      merchantId: g.merchantId, iframeId: g.iframeId, integrationId: g.integrationId,
      apiKey: dec(g.apiKey), hmacSecret: dec(g.hmacSecret),
    }
  }
  const g = settings.kashier
  if (!g?.enabled) return null
  return {
    provider: 'kashier', enabled: true, sandbox, currency,
    merchantId: g.merchantId,
    apiKey: dec(g.apiKey), webhookSecret: dec(g.webhookSecret),
  }
}
