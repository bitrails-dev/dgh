// Provider → adapter construction. The orchestration layer (webhook endpoints, checkout) loads a
// tenant's decrypted GatewayConfig (settings.ts) and calls buildPaymentAdapter to get a concrete
// adapter wired with those credentials. The factories' defaults (env, default base URLs) are only
// fallbacks — in production every adapter is built from per-tenant commerce-settings.
import type { PaymentAdapter } from '../types'
import type { GatewayConfig, GatewayProvider } from '../settings'
import { createKashierAdapter } from './kashier'
import { createPaymobAdapter } from './paymob'

export type AdapterBuilder = (provider: GatewayProvider, cfg: GatewayConfig) => PaymentAdapter

export const buildPaymentAdapter: AdapterBuilder = (provider, cfg) => {
  if (provider === 'paymob') {
    return createPaymobAdapter({
      apiKey: cfg.apiKey,
      hmacSecret: cfg.hmacSecret,
      iframeId: cfg.iframeId,
      integrationId: cfg.integrationId,
      sandbox: cfg.sandbox,
    })
  }
  return createKashierAdapter({
    apiKey: cfg.apiKey ?? '',
    merchantId: cfg.merchantId ?? '',
    webhookSecret: cfg.webhookSecret,
    sandbox: cfg.sandbox,
  })
}
