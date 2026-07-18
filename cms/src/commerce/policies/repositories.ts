// Aggregator: bundles the four policy repositories + the gift-card pepper resolver into one object
// the quoteCart engine + checkout flow can take as a single dependency. The integration owner
// constructs one RepositoryBundle per request with the live Payload instance; tests construct one
// with fakes that implement the PolicyFindApi / GiftCardLedgerTxnApi surfaces.

import { GiftCardsPolicyRepository } from './giftcards'
import { PromotionsPolicyRepository } from './promotions'
import { ShippingPolicyRepository } from './shipping'
import { TaxPolicyRepository } from './tax'
import type { PolicyFindApi } from './tax'
import type { GiftCardLedgerTxnApi } from './giftcards'

export interface RepositoryBundle {
  tax: TaxPolicyRepository
  shipping: ShippingPolicyRepository
  promotions: PromotionsPolicyRepository
  giftCards: GiftCardsPolicyRepository
  findApi: PolicyFindApi
  ledgerApi: GiftCardLedgerTxnApi
}

// Factory: construct all four repositories over a single shared API surface. `api` must implement
// both the read surface (PolicyFindApi) and the ledger-txn surface (GiftCardLedgerTxnApi); the
// integration owner's production implementation does both via Payload Local API + a small
// transactional helper for insertLedgerAndUpdateBalance.
export function makeRepositoryBundle(api: PolicyFindApi & GiftCardLedgerTxnApi): RepositoryBundle {
  return {
    tax: new TaxPolicyRepository(api),
    shipping: new ShippingPolicyRepository(api),
    promotions: new PromotionsPolicyRepository(api),
    giftCards: new GiftCardsPolicyRepository(api),
    findApi: api,
    ledgerApi: api,
  }
}

// Re-export the types + row mappers so the integration owner imports everything from one path.
export {
  GiftCardsPolicyRepository,
  toGiftCardAccount,
  toGiftCardRow,
  toGiftCardLedgerRow,
} from './giftcards'
export type {
  GiftCardRow,
  GiftCardLedgerRow,
  GiftCardLedgerTxnApi,
  GiftCardKind,
} from './giftcards'
export { PromotionsPolicyRepository, computeRemainingQuota, toPromotionRow, toPurePromotion } from './promotions'
export type { PromotionRow, PromotionRedemptionRow, CustomerIdentityInput } from './promotions'
export {
  ShippingPolicyRepository,
  matchShippingZone,
  resolveShipping,
  toShippingMethodRow,
  toShippingZoneRow,
} from './shipping'
export type {
  ShippingZoneRow,
  ShippingMethodRow,
  ResolvedShipping,
  ShippingResolveResult,
  ShippingResolveErrorCode,
} from './shipping'
export {
  TaxPolicyRepository,
  matchTaxZone,
  pickActiveRate,
  resolveLineTax,
  toPureTaxRate,
  toTaxRateRow,
  toTaxZoneRow,
} from './tax'
export type { TaxZoneRow, TaxRateRow, PolicyFindApi, ResolvedLineTax, ResolvedTaxZoneMatch } from './tax'
export {
  GIFT_CARD_PEPPER_ENV,
  GiftCardPepperError,
  decodeGiftCardPepper,
  generateGiftCardCode,
  giftCardLastFour,
  hashGiftCardCode,
  normalizeGiftCardCode,
  resolveGiftCardPepper,
} from './gift-card-hash'
