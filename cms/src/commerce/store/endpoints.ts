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

// The plugin-first cart endpoints (cart-v2.ts) supersede the legacy cart.ts HTTP surface on the
// shared /cart path (Express first-match wins → only one /cart GET can be live). The legacy cart.ts
// orchestration (upsertCart/readCart) is retained on disk, read-only, and still directly tested by
// commerce-store-cart.test.ts until Wave F2 retires the legacy runtime model.
export const commerceStoreEndpoints: Endpoint[] = [
  ...catalogEndpoints,
  ...quoteEndpoints,
  ...pluginCartEndpoints,
  ...authEndpoints,
  ...checkoutEndpoints,
]
