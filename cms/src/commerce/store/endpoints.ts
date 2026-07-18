// Shopper-facing storefront endpoints, mounted under /api/commerce/store/:tenantSlug/*. Each concern
// is a thin HTTP handler over a directly-testable orchestration function (model on the payment
// webhook pattern); all share tenant resolution, settings load, and server-authoritative pricing via
// ./shared. Registered in payload.config.ts alongside the payment webhooks.
import type { Endpoint } from 'payload'
import { catalogEndpoints } from './catalog'
import { quoteEndpoints } from './quote'
import { cartEndpoints } from './cart'
import { authEndpoints } from './auth'
import { checkoutEndpoints } from './checkout'

export const commerceStoreEndpoints: Endpoint[] = [
  ...catalogEndpoints,
  ...quoteEndpoints,
  ...cartEndpoints,
  ...authEndpoints,
  ...checkoutEndpoints,
]
