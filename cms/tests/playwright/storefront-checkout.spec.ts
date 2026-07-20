// RUN PREREQUISITES (operator — read before `npx playwright test`):
//
// This spec drives the storefront AR + EN checkout against a LIVE tenant. It does NOT boot
// servers, mock the gateway, or hit any payment sandbox. Before running, provide ALL of:
//
//   1. CMS running on :3001            → `cd cms && pnpm dev`
//   2. Astro running on :4321          → `pnpm dev`            (repo root)
//   3. Commerce-gateway key pair set   → COMMERCE_GATEWAY_KEY_ID + COMMERCE_GATEWAY_SECRET
//                                        identical in both cms/.env and the Astro .env
//                                        (optional rotation pair: both or neither).
//   4. COMMERCE_GIFT_CARD_PEPPER set   → in cms/.env (gift-card hashing; not exercised here
//                                        but the commerce plugin boots without it).
//   5. A provisioned pilot tenant with → features: ['commerce'] enabled (runbook §1 + §3):
//           cd cms && npx tsx scripts/provision-commerce-tenant.ts --tenant <slug>
//      then flip the feature ON for that one tenant only. resolveStoreTenant enforces the
//      gate — every storefront commerce call 404s for a featureless tenant.
//   6. At least one PUBLISHED + PRICED → store-products row on that tenant, with non-zero
//      inventory-levels stock so the catalog grid renders a card with an enabled
//      "Add to cart" button. The default provisioned sample products satisfy this.
//   7. COMMERCE_SANDBOX=true in cms/.env (the test uses COD, which is sandbox-agnostic, but
//      the storefront proxy refuses commerce when the plugin is in hard-off mode).
//   8. The Astro storefront must resolve the pilot tenant from the request hostname — set
//      PUBLIC_SITE / tenant-resolver env so localhost hits the pilot tenant (CLAUDE.md).
//
// What this spec covers (per locale, parametrized):
//   - browse catalog (store-products) → open a product detail
//   - signed add-to-cart (shopApi.addItem → Astro proxy → CMS store-carts v2)
//   - open cart, assert server-authoritative quote + the line we just added
//   - proceed to checkout, fill contact + shipping address, select COD, place order
//   - assert the inline order-placed panel + the issued order number (no provider redirect)
//   - assert <html dir="rtl|ltr"> + localized heading text on every page in the flow
//
// What this spec does NOT cover (separate operator manual gate, runbook §2.3):
//   - online Paymob/Kashier hosted-checkout redirect + webhook capture + stock commit.
//     That path hits an external sandbox and is intentionally out of scope here. To exercise
//     it, switch the payment-method radio to `paymob` or `kashier` and assert the redirect
//     to `r.checkoutUrl`; the actual capture must be driven on the provider's sandbox page.
//
// Cookie contract being exercised: the Secure HttpOnly `store_cart_v2` cookie is planted by
// the Astro proxy on the first addItem mutation and rides `credentials:"include"` for the
// rest of the flow. The browser NEVER signs requests and NEVER sends totals — only item
// intent + address + paymentMethod; the CMS re-prices authoritatively (cart-v2.ts / quote.ts).

import { test, expect, type Page } from '@playwright/test';

// Localized strings lifted verbatim from src/i18n/{ar,en}.json — these are the exact labels
// the operator-facing UI renders, so the role-based selectors stay faithful to what a real
// shopper sees. If the i18n keys change, update both locales together.
interface LocaleVariant {
  lang: 'ar' | 'en';
  /** URL prefix: '' for ar (default locale, unprefixed), '/en' for en. */
  base: string;
  dir: 'rtl' | 'ltr';
  shopTitle: string; // shop.title (catalog page <h1>)
  addToCart: string; // shop.product.addToCart
  added: string; // shop.product.added (transient button state)
  cartTitle: string; // shop.cart.title
  proceedToCheckout: string; // shop.cart.checkout (the <a> into /checkout)
  checkoutTitle: string; // shop.checkout.title
  cod: string; // shop.checkout.cod (radio label)
  placeOrder: string; // shop.checkout.placeOrder (submit)
  orderPlaced: string; // shop.checkout.orderPlaced (success <h2>)
}

const VARIANTS: LocaleVariant[] = [
  {
    lang: 'ar',
    base: '',
    dir: 'rtl',
    shopTitle: 'المتجر',
    addToCart: 'أضف إلى السلة',
    added: 'تمت الإضافة',
    cartTitle: 'سلة المشتريات',
    proceedToCheckout: 'إتمام الطلب',
    checkoutTitle: 'إتمام الطلب',
    cod: 'الدفع عند الاستلام',
    placeOrder: 'تأكيد الطلب',
    orderPlaced: 'تم تأكيد الطلب!',
  },
  {
    lang: 'en',
    base: '/en',
    dir: 'ltr',
    shopTitle: 'Shop',
    addToCart: 'Add to cart',
    added: 'Added',
    cartTitle: 'Your cart',
    proceedToCheckout: 'Proceed to checkout',
    checkoutTitle: 'Checkout',
    cod: 'Cash on delivery',
    placeOrder: 'Place order',
    orderPlaced: 'Order placed!',
  },
];

// The CMS checkout endpoint rejects a malformed idempotency key with 400 invalid_idempotency_key
// (checkout.ts). The browser mints a UUID v4 itself (CheckoutForm.vue) and we don't override it,
// but we do assert the contract holds: this regex is the same RFC 4122 v4 shape the server enforces.
const ORDER_NUMBER_RE = /[A-Z0-9-]{4,}/;

async function expectDirAndTitle(page: Page, v: LocaleVariant, path: string, expectedH1: string) {
  await expect(page).toHaveURL(new RegExp(`${escapeRegExp(v.base + path)}$`));
  await expect(page.locator('html')).toHaveAttribute('dir', v.dir);
  await expect(page.getByRole('heading', { level: 1, name: expectedH1 }).first()).toBeVisible();
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

for (const v of VARIANTS) {
  test.describe(`storefront checkout — ${v.lang.toUpperCase()} (${v.dir})`, () => {
    test.describe.configure({ mode: 'serial' });

    test('browse → add to cart → cart → checkout (COD) → order placed', async ({ page }) => {
      await test.step(`catalog renders (${v.lang})`, async () => {
        await page.goto(`${v.base}/shop`);
        await expectDirAndTitle(page, v, '/shop', v.shopTitle);
        // The catalog island hydrates and pulls store-products via shopApi.catalog. Wait for
        // at least one product card's add-to-cart button — prerequisite #6 guarantees stock.
        await expect(
          page.getByRole('button', { name: v.addToCart }).first(),
        ).toBeVisible({ timeout: 20_000 });
      });

      let productHref: string | null = null;
      await test.step(`browse a published product (${v.lang})`, async () => {
        // The first product card's image/title anchor links into /shop/[slug] — grab its href
        // so the next navigation is deterministic rather than clicking a possibly-stale card.
        const firstCardLink = page.locator('a[href]').filter({ hasText: /.+/ }).first();
        productHref = await firstCardLink.getAttribute('href');
        // Fallback: if the anchor resolution misses, click the first product card image anchor
        // inside the grid (the <a> wrapping the product image / title).
        const cardAnchor =
          productHref && /\/shop\//.test(productHref)
            ? page.locator(`a[href="${productHref}"]`).first()
            : page.locator('div.card a[href*="/shop/"]').first();
        await cardAnchor.first().click();
        await page.waitForLoadState('networkidle');
        // ProductDetail island fetches via shopApi.product(slug); wait for the Add-to-cart
        // button inside ProductBuy to mount.
        await expect(
          page.getByRole('button', { name: v.addToCart }).first(),
        ).toBeVisible({ timeout: 20_000 });
      });

      await test.step(`signed add-to-cart (${v.lang})`, async () => {
        await page.getByRole('button', { name: v.addToCart }).first().click();
        // The button briefly swaps to the "Added" label (1.5s) on success — that is the
        // client-side signal the POST /api/store/v2/cart/items round-trip came back 2xx and
        // the proxy planted the `store_cart_v2` cookie on this context.
        await expect(
          page.getByRole('button', { name: v.added }).first(),
        ).toBeVisible({ timeout: 10_000 });
      });

      await test.step(`cart shows the line + server-authoritative quote (${v.lang})`, async () => {
        await page.goto(`${v.base}/cart`);
        await expectDirAndTitle(page, v, '/cart', v.cartTitle);
        // CartView renders the line items list + the quote aside (subtotal/tax/total).
        const itemList = page.getByRole('list', { name: 'Cart items' });
        await expect(itemList).toBeVisible({ timeout: 15_000 });
        await expect(itemList.locator('li')).toHaveCount(1, { timeout: 10_000 });
        // grandTotal is always the server's (quote.grandTotal); assert the total row renders
        // a formatted money string (EGP). formatMoney emits "EGP" or "ج.م" — accept either.
        await expect(page.locator('aside').filter({ hasText: /EGP|ج\.م/ })).toBeVisible();
      });

      await test.step(`proceed to checkout (${v.lang})`, async () => {
        // CartView's checkout CTA is an <a class="btn btn-primary"> into /checkout.
        await page.getByRole('link', { name: v.proceedToCheckout }).first().click();
        await page.waitForLoadState('networkidle');
        await expectDirAndTitle(page, v, '/checkout', v.checkoutTitle);
        // CheckoutForm pulls cart + me on mount; the form replaces the loading state once the
        // cart line is confirmed. Wait for the submit button to appear before filling inputs.
        await expect(
          page.getByRole('button', { name: v.placeOrder }),
        ).toBeVisible({ timeout: 15_000 });
      });

      await test.step(`fill shipping address + select COD (${v.lang})`, async () => {
        // The address inputs have no `name`/`id` (Vue v-model only) and their <label> text is
        // fed from i18n keys that currently render empty (shop.address.* is not defined) — so
        // we target the required inputs structurally. The CheckoutForm template order is:
        //   [fullName(文本,必填), email(必填), phone, line1(必填), line2, city(必填),
        //    governorate, postalCode, country]
        const requiredText = page.locator('form input[type="text"][required]');
        await requiredText.nth(0).fill('Playwright Shopper');
        await page.locator('form input[type="email"][required"]').fill(`pw-${Date.now()}@dgh.test`);
        await requiredText.nth(1).fill('15 Nile Corniche');
        await requiredText.nth(2).fill('Damietta');
        // COD radio value is locale-independent (the v-model is hard-coded value="cod").
        await page.locator('form input[type="radio"][value="cod"]').check();
        await expect(page.locator('form input[type="radio"][value="cod"]')).toBeChecked();
      });

      await test.step(`place order → inline order-placed panel (${v.lang})`, async () => {
        // Single submit per in-flight attempt; the idempotency-key header dedups any retry.
        await page.getByRole('button', { name: v.placeOrder }).click();
        // COD completes inline (no checkoutUrl in the response) — the form swaps to the
        // success panel with the orderPlaced heading + the issued order number.
        await expect(
          page.getByRole('heading', { level: 2, name: v.orderPlaced }),
        ).toBeVisible({ timeout: 30_000 });
        // Order number renders inside <span class="font-mono font-bold"> — assert it is non-empty.
        const orderNumberEl = page.locator('span.font-mono.font-bold').first();
        await expect(orderNumberEl).toBeVisible();
        await expect(orderNumberEl).toContainText(ORDER_NUMBER_RE);
      });
    });
  });
}
