// EGP currency definition for the ecommerce plugin.
//
// Plan §3.3. All persisted amounts remain integer minor units; browser-provided totals are ignored
// by the gateway/quote path. The integration owner wires this into `currencies.supportedCurrencies`
// at B4 (cms/src/payload.config.ts).

import type { Currency } from '@payloadcms/plugin-ecommerce/types'

export const EGP: Currency = {
  code: 'EGP',
  decimals: 2,
  label: 'Egyptian Pound',
  symbol: 'E£',
  symbolDisplay: 'symbol',
}
