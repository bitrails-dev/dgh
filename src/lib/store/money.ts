// Minor-unit → display string for storefront UI. Used by both .astro pages and .vue islands.
// ponytail: catalog pages display in the tenant default currency (EGP); the server always charges in
// the tenant's actual currency from commerce-settings, which is carried on cart/checkout responses.
const ZERO_DECIMAL_CURRENCIES = new Set([
  "BIF", "CLP", "DJF", "GNF", "JPY", "KMF", "KRW", "PYG", "RWF", "UGX", "VND", "VUV", "XOF", "XPF",
]);

export function formatMoney(minor: number | undefined, currency = "EGP"): string {
  const n = Number(minor) || 0;
  const decimals = ZERO_DECIMAL_CURRENCIES.has(currency.toUpperCase()) ? 0 : 2;
  const major = (n / 10 ** decimals).toFixed(decimals);
  return `${major} ${currency}`;
}
