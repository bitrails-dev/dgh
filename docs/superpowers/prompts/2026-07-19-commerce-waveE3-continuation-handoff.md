# Commerce Wave E3 continuation handoff (signed CMS cart/orders + plugin-first pricing)

**Written:** 2026-07-19 · **Branch:** `feat/multi-tenant`
**Pick up fresh from here.** This is the deferred tail of Wave E (storefront). Read alongside
`docs/superpowers/prompts/2026-07-19-commerce-waveE-handoff.md` (the Wave E owner doc) and
`docs/superpowers/plans/2026-07-18-commerce-plugin-first-delivery-plan.md` (§3.7 cart, §4.1/§4.2
gateway, §7 E3, §9 DoD).

## Where things stand after the 2026-07-19 Wave E session

Committed on `feat/multi-tenant` (oldest → newest):

| Commit | Wave | What |
| --- | --- | --- |
| `7398c45` | E1 | durable `send-commerce-notification` task + notifications modules (registered in payload.config.ts) |
| `6b58838` | E2 | operational commerce reports (7 tenant-scoped read queries) |
| `<E3-boundary>` | E3 (partial) | storefront UI + verified gateway signer + signed `/api/store/v2/*` proxy + `server.ts` signing helpers |

**Gate on the E3-boundary commit:** `npm --prefix cms run typecheck && npm --prefix cms run
test:commerce` green (cms unchanged since E2). Astro/src side: `npx tsc --noEmit` reports 0 errors
under `src/`; the gateway signer self-check (`src/lib/store/__tests__/gateway-sign.test.ts`) passes
5/5, pinning the exact CMS vectors (VECTOR A `9745f4b1…010c6`, VECTOR B `eeda5798…cbdd8`).

## What E3 (partial) delivered

- **Storefront UI** (agent lane, all under `src/`): `src/components/shop/` (ShopCatalog, ProductDetail,
  CartView/CartBadge, ProductBuy, CheckoutForm, AccountView, OrderHistory/OrderDetail/OrderStatus,
  PasswordReset) + `api.ts` (`shopApi`, signing-free browser client), `checkout-input.ts`,
  `order-status.ts`, + focused contract tests. Pages under `src/pages/[...lang]/{shop,cart,checkout,
  account}/`. i18n keys in `src/i18n/{ar,en}.json`. Bilingual ar-RTL-default + en.
- **Astro gateway signer** `src/lib/store/gateway-sign.ts` — mirrors `cms/src/commerce/gateway/
  {canonical,sign}.ts` byte-for-byte; produces `X-Commerce-Gateway-{Key-Id,Timestamp,Nonce,
  Signature}` over the canonical `v1\nMETHOD\npathAndQuery\ntenant\ntimestamp\nnonce\nbodyHash`.
  Signs with the CURRENT key only (`COMMERCE_GATEWAY_KEY_ID`/`COMMERCE_GATEWAY_SECRET`).
- **Signed proxy** `src/pages/api/store/v2/[...path].ts` — resolves tenant from `Astro.locals.tenant`,
  maps v2 sub-paths to CMS store sub-paths (catalog↔products; reset/{request,confirm}↔
  {forgot-password,reset-password}), signs the outbound CMS request, forwards, and (a) on auth
  login/register moves `sessionToken`/`token` into the HttpOnly `store_session_v2` cookie and strips
  it from the browser body, (b) reshapes catalog `{products,total}`→`{items,total,page}`.
- **`src/lib/store/server.ts`** additions: `signedCmsFetch()` + `store_cart_v2`/`store_session_v2`
  cookie helpers (`getCartIdV2`/`setCartIdV2`/`clearCartIdV2`/`getSessionTokenV2`/`setSessionTokenV2`/
  `clearSessionTokenV2`) + `gatewayKey()`.

## What is DEFERRED — the `not_wired` 501s (this is the work)

The proxy returns `501 {error:'not_wired'}` for the **cart** and **orders** areas because their signed
CMS endpoints do not exist yet. Activating them is the continuation:

### 1. Signed plugin cart endpoints (CMS) — plan §3.7, §4.2
- New module e.g. `cms/src/commerce/store/cart-v2.ts` exporting `pluginCartEndpoints`, appended to
  `commerceStoreEndpoints` in `cms/src/commerce/store/endpoints.ts` (integration-owner file).
- Each handler goes through `withVerifiedCommerceGateway` (`cms/src/commerce/store/gateway.ts`) →
  reads `cartId` from the verified body (POST/PATCH/DELETE) or query (GET) → calls the plugin's
  exported server ops from `@payloadcms/plugin-ecommerce`:
  - `addItem({ payload, cartsSlug: 'store-carts', cartID, item: { product, variant? }, quantity })`
  - `updateItem({ payload, cartsSlug, cartID, itemID, quantity })`  // quantity 0 removes (removeOnZero)
  - `removeItem({ payload, cartsSlug, cartID, itemID })`
  - `clearCart({ payload, cartsSlug, cartID })`
  - All return `CartOperationResult = { cart, message, success }` (types in
    `@payloadcms/plugin-ecommerce/dist/collections/carts/operations/types.d.ts`).
- Resolve the storefront SKU → `{product, variant}` via `resolveSellableBySku({ payload, tenantId, sku })`
  (`cms/src/commerce/inventory/sku-resolution.ts:161`) — returns `{ ok, sellable:{ kind, sku,
  productId, variantId? } }`. **No `mergeCart` operation is exported** (only its endpoint) — skip
  merge-on-login (YAGNI); guest cart via `store_cart_v2` cookie is enough.
- **Guest-cart lifecycle:** `addItem` requires a `cartID`. First add with no cookie → create a
  `store-carts` doc (guest = no `customer`; `allowGuestCarts:true` is set in payload.config.ts) →
  use its id as `cartID`. The Astro proxy plants the `store_cart_v2` cookie from the response
  `cartId` (the cookie helpers already exist in `server.ts`; the proxy's cart-cookie block was
  removed for the 501 — re-add it when the endpoint lands, and drop the cart 501).
- **Cart totals (the hard part):** the cart response must carry a server-authoritative `quote`.
  The legacy helpers in `cms/src/commerce/store/shared.ts` (`quoteItems`/`resolvePricedLines`) read
  the **legacy `products`** collection — they CANNOT price plugin-first `store-products`. So the cart
  quote must use the **C4 `createPayloadQuoteCartLoader`** (`cms/src/commerce/policies/quote-loader.ts`),
  the authoritative plugin-first resolver over `store-carts`/`store-products`/`store-variants` + the
  policy collections. Wire it for the cart view; the full tax/shipping/promo/gift-card quote is
  already driven by this loader at checkout (`processCheckout`).

### 2. Plugin-first quote on the storefront `/quote` path
- `cms/src/commerce/store/quote.ts` also uses the legacy `quoteItems`. For plugin-first tenants it
  returns `product_not_found`. Wire `createPayloadQuoteCartLoader` here too (or have the cart/quote
  endpoints share one plugin-first quote helper). Without this, storefront totals are wrong for
  plugin-first catalogs even after the cart endpoint lands.

### 3. Orders endpoint (CMS) — read-only, plan §7 E3 "order history/detail"
- No orders endpoint exists in `commerceStoreEndpoints` today. Add `cms/src/commerce/store/orders.ts`
  exporting `orderEndpoints`, appended to the registry. `GET /commerce/store/:tenantSlug/orders` +
  `GET .../orders/:orderNumber`, tenant-scoped over `store-orders`.
- **Customer scoping (the bridge):** the gateway verifier resolves the customer from `req.user`
  (a Payload session), but storefront auth conveys the session via the `x-session-token` header (see
  `auth.ts` → `readCustomerMe(payload, token, tenantId)`). So the orders handler must resolve the
  customer from the `x-session-token` header (reuse the customer-auth token resolver), NOT from
  `req.user`, then filter `store-orders` by `{ tenant, customer }`. Confirm the session-token field
  name the proxy strips (`sessionToken`/`token`) matches what `loginCustomer`/`registerCustomer`
  actually return.

### 4. Auth endpoint gateway signing (§4.1 compliance gap)
- `cms/src/commerce/store/auth.ts` currently uses `resolveStoreTenant` (UNSIGNED). register/login are
  storefront MUTATIONS; per §4.1/§4.2 they should verify via `withVerifiedCommerceGateway`. Route
  them through the gateway helper (it stashes the tenant on `req.commerceTenantID`). Commerce is
  DISABLED for all tenants today, so this is not a live exposure — but it must close before F3
  enables commerce. (The auth token-stripping at the proxy is already in place.)

### 5. Catalog → store-products (parity)
- `cms/src/commerce/store/catalog.ts` reads legacy `products`. For a plugin-first storefront it should
  read `store-products`/`store-variants` (and the proxy's `{products}→{items}` reshape stays). Lower
  priority than 1–3 (catalog reads are allowed to be a dedicated read route per §4.2) but needed for
  real plugin-first browse.

## Decisions / gotchas inherited (do not re-litigate)

- Permanent `store-*` slugs; plugin `inventory:false`; reservation layer keyed by normalized SKU.
- EGP only, integer minor units; browser totals never trusted; `quoteCart` is authoritative.
- `withVerifiedCommerceGateway` is the ONLY code allowed `overrideAccess:true` for guest commerce.
- Migrations are hand-written + additive; never edit applied historical migrations. If a `store-*`
  insert hits "no such column", write a new ALTER migration + register in `cms/src/migrations/index.ts`.
- `payload-types.ts` is gitignored; `importMap.js` is tracked → run `generate:types` then
  `generate:importmap` after touching `payload.config.ts`.
- Windows libsql teardown flake: the runner tolerates exit `3221225477` when all subtests pass; any
  NEW booting integration test should `await payload.db.drizzle.session.client.close()` in `test.after`.
- Gateway signer test vectors live in `cms/tests/commerce-gateway.test.ts` (VECTOR A/B) — the Astro
  copy must keep matching them.
- `docs/superpowers/**` is dirty and must stay out of every commit. Stage explicit paths only.

## Completion checklist for the continuation

1. Cart endpoints (§3.7) wired + a focused test (boot Payload, signed add/update/remove/clear via the
   plugin ops + `resolveSellableBySku`, cart totals from the C4 loader).
2. `createPayloadQuoteCartLoader` wired into the storefront quote path (cart + `/quote`).
3. Orders endpoint + the x-session-token customer bridge + focused test.
4. Auth endpoints routed through `withVerifiedCommerceGateway`.
5. Proxy: drop the cart/orders 501; re-add the cart-cookie block (cookie helpers already in server.ts).
6. Full gate green: `npm --prefix cms run typecheck && npm --prefix cms run test:commerce`; Astro/src
   `npx tsc --noEmit` (0 src errors); signer self-check 5/5.
7. Commit as `feat(commerce): wire signed plugin cart + orders + plugin-first quote (Wave E3 cont.)`
   (or fold into the E3 commit if picked up before it lands).

Then Wave F (F1 parity → F2 legacy removal + D3 side-effect repoint → F3 release gates → F4 runbook),
per the Wave E handoff "After Wave E → Wave F" section.
