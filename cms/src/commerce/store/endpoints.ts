// Shopper-facing storefront endpoints, mounted under /api/commerce/store/:tenantSlug/*. Each concern
// is a thin HTTP handler over a directly-testable orchestration function (model on the payment
// webhook pattern); all share tenant resolution, settings load, and server-authoritative pricing via
// ./shared. Registered in payload.config.ts alongside the payment webhooks.
import type { Endpoint } from 'payload'
import { catalogEndpoints } from './catalog'
import { quoteEndpoints } from './quote'
import { pluginCartEndpoints } from './cart-v2'
import { authEndpoints } from './auth'
import { checkoutEndpoints } from './checkout'
import { orderEndpoints } from './orders'

// Wave F2 retired the legacy cart runtime: cart.ts (upsertCart/readCart) and its HTTP surface were
// removed, and only the plugin-first cart-v2.ts endpoints are registered on the shared /cart path.
// Every endpoint registered here is plugin-first (writes store-*; no legacy collection is touched).
export const commerceStoreEndpoints: Endpoint[] = [
  ...catalogEndpoints,
  ...quoteEndpoints,
  ...pluginCartEndpoints,
  ...authEndpoints,
  ...checkoutEndpoints,
  ...orderEndpoints,
]
