// Sandbox smoke test: create a cart for the `pilot` tenant + run processCheckout with the REAL
// Kashier adapter (creds decrypted from commerce-settings) → print the signed Kashier checkout URL.
// Open the URL, pay with a Kashier test card; the capture webhook (registered on the dashboard)
// flips the order to paid. Run: npx tsx scripts/kashier-test-checkout.ts
import 'dotenv/config'
import { getPayload } from 'payload'
import config from '../src/payload.config'

const payload = await getPayload({ config })
try {
  const t = await payload.find({ collection: 'tenants', where: { slug: { equals: 'pilot' } }, limit: 1, overrideAccess: true })
  if (!t.docs.length) throw new Error('pilot tenant not found — run provision-commerce-tenant.ts --tenant pilot first')
  const tenantId = t.docs[0].id

  const { pluginAddItem } = await import('../src/commerce/store/cart-v2')
  const add = await pluginAddItem(payload, tenantId as any, { sku: 'DGH-SAND-TEE', quantity: 1 } as any) as any
  const cartId = add?.body?.cartId
  if (!cartId) throw new Error(`pluginAddItem did not return a cartId: ${JSON.stringify(add)}`)
  console.log('cart:', cartId, '| items:', add.body.items.map((i: any) => `${i.sku}x${i.quantity}`).join(', '))
  const cartDoc = await payload.findByID({ collection: 'store-carts', id: cartId as any, overrideAccess: true }).catch((e: any) => ({ lookupError: e?.message }))
  console.log('store-carts lookup:', JSON.stringify(cartDoc, null, 2)?.slice(0, 600))

  const { processCheckout } = await import('../src/commerce/checkout/process')
  const result = await processCheckout(
    payload,
    { tenantId } as any,
    {
      cartId,
      paymentMethod: 'kashier',
      shippingAddress: { country: 'EG' },
      customerEmail: 'sandbox@dgh.test',
      returnUrl: 'http://localhost:4321/',
    } as any,
  )
  console.log('--- processCheckout result ---')
  console.log('status:', result.status)
  console.log('orderNumber:', (result.body as any).orderNumber)
  console.log('amountDue:', (result.body as any).amountDue, (result.body as any).currency)
  console.log('checkoutUrl:', (result.body as any).checkoutUrl)
  if ((result.body as any).error) console.log('ERROR body:', JSON.stringify(result.body))
} catch (e: any) {
  console.error('DRIVER ERROR:', e?.message)
  console.error('errors:', JSON.stringify(e?.data?.errors ?? e?.errors ?? e?.cause?.data?.errors, null, 2))
  process.exitCode = 1
} finally {
  try { await (payload.db as any).drizzle?.session?.client?.close?.() } catch { /* */ }
  try { await payload.destroy() } catch { /* */ }
}
