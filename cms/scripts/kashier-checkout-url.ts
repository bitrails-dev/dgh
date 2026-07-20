// Kashier sandbox smoke test (direct adapter): load the pilot tenant's decrypted Kashier creds +
// call createHostedCheckout directly → print a signed checkout URL. Open it, pay with a Kashier
// test card; the capture webhook (if registered on the dashboard) arrives + is signature-verified.
// This validates the Kashier-facing integration only (URL signing + the hosted checkout page),
// bypassing order/transaction creation. For the full plugin-first flow (cart → processCheckout →
// store-orders/store-transactions → signed URL), use kashier-test-checkout.ts instead.
// Run: npx tsx scripts/kashier-checkout-url.ts
import 'dotenv/config'
import { getPayload } from 'payload'
import config from '../src/payload.config'

const payload = await getPayload({ config })
try {
  const t = await payload.find({ collection: 'tenants', where: { slug: { equals: 'pilot' } }, limit: 1, overrideAccess: true })
  if (!t.docs.length) throw new Error('pilot tenant not found')
  const tenantId = t.docs[0].id

  const { loadGatewayConfig } = await import('../src/commerce/payments/settings')
  const { buildPaymentAdapter } = await import('../src/commerce/payments/adapters/registry')
  const { money } = await import('../src/commerce/money')

  const cfg = await loadGatewayConfig(payload, tenantId, 'kashier')
  if (!cfg) throw new Error('Kashier not configured for tenant pilot')
  console.log('Kashier config loaded:', { merchantId: cfg.merchantId, sandbox: cfg.sandbox, hasApiKey: Boolean(cfg.apiKey), hasWebhookSecret: Boolean(cfg.webhookSecret) })
  if (!cfg.merchantId || !cfg.apiKey) throw new Error('Kashier not fully configured (merchantId/apiKey missing)')

  const adapter = buildPaymentAdapter('kashier', cfg)
  const hosted = await adapter.createHostedCheckout({
    merchantReference: 'DGH-SANDBOX-TEST-1',
    amount: money(5500, 'EGP'), // 55.00 EGP test amount (integer minor units)
    customerEmail: 'sandbox@dgh.test',
    billingUrl: 'http://localhost:4321/',
    sandbox: true,
  } as any)
  console.log('--- Kashier checkout URL ---')
  console.log(hosted.checkoutUrl)
  console.log('providerSessionId:', hosted.providerSessionId)
} catch (e: any) {
  console.error('ERROR:', e?.message)
  console.error('cause:', e?.cause?.message ?? e?.data?.errors ?? e?.cause)
  process.exitCode = 1
} finally {
  try { await (payload.db as any).drizzle?.session?.client?.close?.() } catch { /* */ }
  try { await payload.destroy() } catch { /* */ }
}
