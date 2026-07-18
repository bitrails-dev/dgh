# Commerce Storefront — Implementation Report

**Date:** 2026-07-18 · **Branch:** `feat/multi-tenant` · **Scope:** WP11 shopper-facing storefront (Task 2 of the commerce handoff)
**Purpose:** Reference for the adversarial review (Task 1), fixes, and further work.

> **Session boundary.** This report details the **storefront work done in this session**. It builds on a **prior session's backend** (the `cms/src/commerce/*` modules + `20260717_100000`–`100400` migrations + their `commerce-*.test.ts` suites, reported as 223 green tests). The prior backend is **not** independently re-audited here — it is listed as a review dependency in §11. Files introduced or modified *this session* are marked 🆕 / ✏️.

---

## 1. Objective & chosen scope

Independent per-tenant storefronts behind the `commerce` feature flag. The user selected **full scope**:
- **Customer accounts** (register/login/me — password auth; OTP/email-verify deferred to SMTP).
- **Offline + gateway payments** (COD/bank verifiable now; Paymob/Kashier hosted redirect built, live-verify gated on keys).
- **Images + variants** (new product fields; variant sku keys inventory + pricing).

Commerce stays **disabled** on every tenant/TenantType until the acceptance gate passes; this is all built behind the flag and verified on a throwaway DB.

---

## 2. Architecture (forced by where the modules live)

```
Browser ──same-origin──▶ Astro  /api/store/*                ──HTTP──▶ CMS  /api/commerce/store/:tenantSlug/*
         (Secure HttpOnly   • tenant from Astro.locals.tenant   • tenant-by-slug → feature 404
          cookies, CSRF,    • owns cartToken + session cookies   • overrideAccess; wraps commerce modules
          rate-limit)       • proxies to CMS                    • stateless (tokens relayed in header/body)
```

**Why two layers:** the commerce modules live in the CMS process (Payload Local API). The Astro app is a separate package/process and **cannot import them**. So the shopper HTTP surface *must* be Payload custom endpoints in the CMS. The Astro `/api/store/*` is a thin BFF (mandated same-origin by the plan) that owns cookies/CSRF/rate-limit and relays tokens. The CMS endpoints are stateless w.r.t. cookies; the session token is relayed via `X-Session-Token`.

The CMS endpoints mirror the existing payment-webhook pattern (`cms/src/commerce/payments/endpoints.ts` + `webhook.ts`): thin HTTP handler over a directly-testable orchestration function; tenant resolved from the URL slug; 404 when the tenant lacks `commerce`.

---

## 3. Request / data flows

**Browse (SSR):** Astro page → `cmsFetch(slug, "/products")` → CMS catalog → product grid. No BFF needed for reads; pages hit the CMS directly server-side.

**Cart add (browser):** island → `POST /api/store/cart {items}` (same-origin) → Astro injects `cartToken` from cookie (mints if absent) → CMS `upsertCart` → server re-quotes via `quoteItems` → returns `{items, quote}`. Browser never sends or computes prices.

**Checkout, COD:** island → `POST /api/store/checkout {items, email, address, paymentMethod:'cod'}` → Astro injects cartToken (+ session if any) → CMS `placeOrder`:
1. `loadCommerceSettings` → currency/taxMode (503 if absent).
2. Resolve `locationId` (body, else tenant's first inventory-location; 422 if none).
3. `checkout()` → resolve prices (server) → reserve inventory atomically → `quote()` → `createOrder` (status `pending`, paymentState `pending`, immutable snapshot + tamper hash).
4. COD/bank → 200 `{orderNumber, amountDue, paymentState:'pending', quote}`. Stock stays **reserved**; an admin confirms later → `commitOrderInventory`.

**Checkout, gateway:** same as above through step 3, then `loadGatewayConfig` (422 if unconfigured) → `buildPaymentAdapter` → `createHostedCheckout({merchantReference:orderNumber, amount, billingUrl:returnUrl, sandbox})` → 200 `{orderNumber, checkoutUrl}`. Browser redirects; the **existing** webhook→job→`commitOrderInventory` loop closes capture (not re-implemented here).

**Auth:** `POST /auth/login|register` → CMS verifies (scrypt) / creates customer → `signSession({customerId, tenantId, exp})` → returns token → Astro moves it into the HttpOnly `store_session` cookie and strips it from the body. `/auth/me` relays `X-Session-Token`; CMS `verifySession` (constant-time) → customer or 401.

---

## 4. CMS storefront layer (`cms/src/commerce/store/`) 🆕

| File | Role | Key invariants |
|---|---|---|
| `shared.ts` 🆕 | `resolveStoreTenant` (slug→tenant, 404 if no commerce), `loadCommerceSettings` (currency/taxMode/sandbox), `resolvePricedLines` (variant-aware price resolver), `quoteItems` (settings→resolve→`quote()`), `readJsonBody`. | The **single** server-authoritative price path. Loads all active products for a tenant once (limit 500) into a sku index covering base + variant skus. `ponytail:` ceiling noted (paginate if >hundreds). |
| `endpoints.ts` 🆕 | Barrel: `commerceStoreEndpoints = [...catalog, ...quote, ...cart, ...auth, ...checkout]`. | Registered in `payload.config.ts:110`. |
| `catalog.ts` 🆕 (agent a2) | `listProducts`, `getProduct`; `GET /products`, `GET /products/:id`. | Active-only, overrideAccess, tenant-scoped. Resolves `images` (JSON media-ID array) to `{id,url,alt}` via one batched media find; dead IDs skipped; URLs absolutized vs `PAYLOAD_PUBLIC_SERVER_URL`. |
| `quote.ts` 🆕 (agent a3) | `POST /quote {items}` → wraps `quoteItems`. | Items-only body (no client price). Errors carry HTTP status (400/422/503). |
| `cart.ts` 🆕 (agent a4) | `upsertCart`, `readCart`; `GET /cart?cartToken=`, `POST /cart {cartToken,items}`. | `items` is a client-mutable snapshot; re-quoted every call. Unquotable line (e.g. product went inactive) → 200 `{items, quote:null, quoteError:{code,detail}}` (items still persisted as intent). Empty items clears. |
| `auth.ts` 🆕 (agent a5) | `registerCustomer`, `loginCustomer`, `readSession`; `POST /auth/{register,login,logout}`, `GET /auth/me`. | scrypt passwords (reuses `customers/auth.ts`); single `invalid_credentials` for unknown-email vs wrong-password (no leak); responses surface only `{id,email,name}`; tenant-scoped session find. |
| `checkout.ts` 🆕 (agent a6) | `placeOrder` (injectable `buildAdapter`); `POST /checkout`. | Offline vs gateway branch; maps `PRODUCT_NOT_FOUND→422`, `INSUFFICIENT_STOCK→409`, `TAMPER→500`; gateway-not-configured→422. |

**Supporting changes:**
- `cms/src/commerce/crypto.ts` ✏️ — added `signSession`/`verifySession`: HMAC-SHA256 over `{customerId,tenantId,exp}`, HKDF key under purpose **`payload-commerce-session`** (isolated from `payload-commerce` gateway secrets), constant-time verify, expiry check. Stateless → **no server-side revocation** (logout = cookie clear + 7d TTL).
- `cms/src/commerce/checkout/index.ts` ✏️ — refactored the product-resolution step onto `resolvePricedLines` (base sku **or** variant sku). Behavior for base-sku products preserved (verified: checkout 3/3, capture-commit 2/2 still green).

---

## 5. Astro BFF layer (`src/lib/store/` + `src/pages/api/store/`) 🆕

| File | Role |
|---|---|
| `src/lib/store/server.ts` 🆕 | `storeTenantSlug(locals)` (→404 if no commerce), `cmsFetch` (proxy, preserves status), `ensureCartToken`/`getCartToken`, `getSessionToken`/`setSessionToken`/`clearSessionToken`/`attachSession` (moves token to cookie, strips from body), `ensureCsrf`/`checkCsrf` (double-submit), `rateLimit` (in-memory token-bucket), `json`. |
| `src/lib/store/client.ts` 🆕 | `storeApi` — same-origin fetch, `credentials:"include"`, reads `store_csrf` cookie → `X-CSRF-Token` on mutating calls. Typed methods for products/cart/quote/checkout/auth. |
| `src/lib/store/money.ts` 🆕 | `formatMoney(minor, currency)` — minor→major display; zero-decimal-currency set. |
| `src/pages/api/store/products.ts`, `products/[id].ts` 🆕 | GET list/detail; set CSRF cookie. |
| `src/pages/api/store/cart.ts` 🆕 | GET (read+quote) / POST (upsert); CSRF on POST; injects cartToken. |
| `src/pages/api/store/quote.ts` 🆕 | POST; CSRF; forwards body. |
| `src/pages/api/store/checkout.ts` 🆕 | POST; CSRF; rate-limit (20/min/IP); injects cartToken + relays session. |
| `src/pages/api/store/auth/{register,login,logout,me}.ts` 🆕 | register/login rate-limited (10/min/IP); `attachSession` sets the cookie; logout clears it; me relays token. |

**Cookie policy:** `store_cart` + `store_session` = `HttpOnly; Secure(in prod); SameSite=Lax`. `store_csrf` = readable (not HttpOnly) so islands can echo it. `cartToken` minted via `crypto.randomUUID`.

**Verified behavior:** Astro merges `cookies.set()` headers onto a raw `Response` returned from a handler (the `cmsFetch` Response) — confirmed live (`Set-Cookie: store_csrf=…` present on the products GET).

**`src/middleware.ts` ✏️** — added `/^\/(en\/)?(shop|cart|checkout|account)(\/|$)/ → "commerce"` to `FEATURE_ROUTES` (existing middleware 404s gated routes). API routes (`/api/store/*`) are not page-gated; they check `storeTenantSlug` themselves.

---

## 6. Pages & islands 🆕

- `src/layouts/ShopLayout.astro` — slim shop header (shop/account/cart + live `CartBadge`) over `BaseLayout`; modeled on `PortalLayout`.
- `src/pages/[...lang]/shop/index.astro` — SSR product grid (SEO-friendly, no island needed).
- `src/pages/[...lang]/shop/[slug]/index.astro` — SSR product detail + `ProductBuy.vue` (variant picker + qty + add-to-cart).
- `src/pages/[...lang]/cart/index.astro` + `CartView.vue` — load cart, per-line qty/remove, server totals, checkout link.
- `src/pages/[...lang]/checkout/index.astro` + `CheckoutForm.vue` — contact/address/payment; COD completes inline with order number; gateway redirects to `checkoutUrl`.
- `src/pages/[...lang]/account/index.astro` + `AccountView.vue` — login/register tabs; shows profile on session; order-history shows "not available yet" (endpoint deferred).
- `src/components/shop/CartBadge.vue` — header cart count; refreshes on `astro:page-load`.
- All islands: `<script setup lang="ts">`, `client:load`, `astro:page-load` re-init where they fetch (`TheSidebar.vue` pattern). RTL-first, teal/navy/ivory/ink tokens.
- `src/i18n/{en,ar}.json` ✏️ — added a `shop` namespace (product/cart/checkout/account/errors) parallel to `portal`.

---

## 7. Schema & migration

- `cms/src/collections/commerce/Products.ts` ✏️ — added `images` (JSON array of media IDs) + `variants` (JSON array `{sku,name,price,compareAtPrice?,taxBps?}`). **`ponytail:` JSON (single text column each, matches `carts.items` precedent) instead of typed array fields** — trivial migration, worse admin UX (raw JSON editing); upgrade later.
- `cms/src/migrations/20260717_100500_commerce_products_media_variants.ts` 🆕 — additive `ALTER TABLE products ADD images/variants`. The mandatory `payload_locked_documents_rels.products_id` already exists from `100300` (not re-added). Rehearsal: applied cleanly on a fresh DB (all migrations 1→end).
- **Variant keying:** a variant's `sku` is the single key into `inventory-levels` and what `checkout`'s `lines[].sku` accepts. No inventory/pricing schema change — `resolvePricedLines` builds the index, `checkout` was refactored to use it.

---

## 8. How it was built (process)

1. **Exploration:** two parallel `Explore` agents mapped (a) the Astro conventions (tenant resolution, i18n, portal pattern, Vue islands) and (b) the commerce backend surface — which surfaced the key finding: **almost no shopper HTTP surface existed** (only the two payment-webhook routes).
2. **Plan** (approved): two-layer CMS-endpoints + Astro-BFF, full scope.
3. **Foundation (mine, serial):** `shared.ts`, session crypto, products schema + migration `100500`, `checkout()` refactor, the BFF helpers. Verified: `cms tsc` 0, checkout/capture-commit tests green.
4. **5 endpoint agents (parallel, background):** a2-catalog, a3-quote, a4-cart, a5-auth, a6-checkout — each built its module + integration test against the shared foundation, forbidden from touching `payload.config.ts`/`shared.ts`.
5. **Integration (mine):** `endpoints.ts` barrel + `payload.config.ts` registration; ran the full suite.
6. **BFF + pages (mine):** 9 API routes, client wrapper, 5 pages, 5 islands, i18n, middleware.
7. **Verification:** see §9.

---

## 9. Verification evidence (proof)

- `cd cms && npx tsc --noEmit` → **0 errors**.
- **5 new store suites, 44 tests, all green** (each Payload-integration file run in its own process per the libSQL `0xC0000005` flake on Windows):
  - `commerce-store-catalog` 12 · `-quote` 8 · `-cart` 12 · `-auth` 7 · `-checkout` 5
- **No regression** from the `checkout()` refactor: `commerce-checkout` 3/3, `commerce-capture-commit` 2/2.
- Migration `100500` applies on a fresh DB (migrated 1→end during the suite).
- `pnpm build` (Astro) → **0** — every new `.ts`/`.astro`/`.vue` compiles + bundles (only unrelated `#__PURE__` warnings from `@vueuse/core`).
- **Live runtime E2E** on a throwaway DB (seeded commerce tenant + product `DEMO-1` @ 5000 minor + onHand 10), driven through the Astro BFF:
  - `GET /api/store/products` → **200**, product returned.
  - `POST /api/store/cart {DEMO-1×2}` → **200**, server-priced `grandTotal 10000`, `amountDue 10000`, tamper hash present.
  - `POST /api/store/checkout` COD → **200**, order placed.
  - CMS storefront also confirmed live directly: catalog/product/quote all 200 with correct server-authoritative bodies.

> Verification environment note: the host machine had a pre-existing .NET app on port 4321 and services on 3001, so the Astro smoke ran on **4399** and the CMS on a throwaway `cms-build.db` (since removed). `curl` drops `localhost` cookies, so the CSRF token was sent manually in the smoke; the cookie code itself is correct (browsers store localhost cookies). All throwaway processes/DBs were cleaned up; the user's services were untouched.

---

## 10. Known gaps / deferred / external blockers

**External blockers (not code):**
- **Paymob/Kashier live capture** — needs `PAYMOB_*`/`KASHIER_*` sandbox keys in `cms/.env`. Adapters are fixture-tested only.
- **Email OTP / account verification** — needs `SMTP_*`.

**Not surfaced in the UI (backend modules exist, unit-tested, but no storefront exposure):**
- Promotions (promo-code apply), gift cards, shipping-zone selection, tax classes, invoices/credit-notes, digital downloads. The checkout is flat (merchandise + tax; no shipping/promo UI).

**Not implemented:**
- Per-customer **order-history endpoint** (account page says "not available yet").
- **Admin commerce UI** (orders/fulfillment/inventory management).
- **Playwright E2E**, SEO, search indexing, categories/brands/price-lists, bookings/subscriptions/B2B/notifications/reporting.

**Structural:** commerce is **disabled** on all tenants until the acceptance gate passes — nothing is live.

---

## 11. Attack surface for the adversarial review

Prioritized. **§11.1 is this session's new code; §11.2 is the prior backend the review was originally scoped to cover.**

### 11.1 Storefront (this session) — review these first
1. **`resolvePricedLines` (`shared.ts`):** loads all active products (limit 500) into an in-memory sku index. Check: variant-sku collisions across products, cross-tenant leakage (it's scoped by `tenantId`, but confirm), the limit-500 ceiling, and that the index can't be poisoned by malformed `variants` JSON.
2. **The 5 agent-built endpoints** (`catalog/quote/cart/auth/checkout.ts`) — subagent code, highest scrutiny:
   - `auth.ts`: password verify path, session issuance, the tenant-scoped `find({tenant, id})` isolation, that `passwordHash`/`passwordSalt` can never leak, the `Number(tenantId)` cast the agent noted.
   - `checkout.ts`: the `locationId` fallback to "tenant's first inventory location" (correctness + intent), the offline "manual-pending" state (does it match the state machine's legal edges?), the gateway branch + injected `buildAdapter` (production uses the real builder — confirm no test-only seam ships).
   - `cart.ts`: the `quoteError` 200 quirk (unquotable line still persisted) — is that the desired behavior?; cartToken trust.
   - `catalog.ts`: `overrideAccess` reads + image resolution (no private fields leaked).
3. **`checkout()` refactor:** confirm moving from per-line `find` to `resolvePricedLines` preserved the **no-oversell** and **tamper-hash** guarantees (the 3+2 regression tests pass, but the review should reason about the reservation loop + `createOrder` hash).
4. **Session crypto (`crypto.ts` `signSession`/`verifySession`):** HMAC construction, constant-time compare, expiry, replay, and the **no-revocation** stateless tradeoff (logout = cookie clear only).
5. **Astro BFF (`server.ts` + routes):** CSRF double-submit soundness; the cookie-merge-on-raw-Response behavior (verified, but confirm across all routes); rate-limit single-instance ceiling; `cartToken` minted at edge; `storeTenantSlug` gate; that mutating routes all enforce CSRF.
6. **Migration `100500`:** additive JSON columns; confirm `payload_locked_documents_rels` integrity; JSON-vs-array tradeoff doesn't break the document-lock check.
7. **Tenant resolution / spoofing:** CMS endpoints resolve tenant by **slug** and are public. A direct caller can pass any slug. Catalog data is public-per-tenant (fine), but cart/order/auth namespaces are slug-scoped — confirm a slug + own-token can't cross into another tenant's data, and that the Astro BFF always derives the slug from `locals.tenant` (host), not client input.

### 11.2 Prior backend (not re-audited this session — original Task 1 scope)
- Paymob/Kashier adapter **HMAC** + Kashier **major-unit decimal conversion**.
- The **50-way no-oversell** claim and atomic reservation SQL.
- All hand-written migrations (`100000`–`100400`) incl. the `payload_locked_documents_rels` gotcha.
- Webhook **idempotency** (ON CONFLICT), secret handling (write-only gateway creds), and the payment **state-machine** bypass paths.
- Tenant isolation in the raw-SQL modules (inventory/giftcards/orders).
- Test quality vs. theatre across the 223 prior tests.

---

## 12. File inventory (this session)

**CMS — new:** `cms/src/commerce/store/{shared,endpoints,catalog,quote,cart,auth,checkout}.ts`; `cms/src/migrations/20260717_100500_commerce_products_media_variants.ts`; `cms/tests/commerce-store-{catalog,quote,cart,auth,checkout}.test.ts`.
**CMS — modified:** `cms/src/commerce/crypto.ts`; `cms/src/commerce/checkout/index.ts`; `cms/src/collections/commerce/Products.ts`; `cms/src/migrations/index.ts`; `cms/src/payload.config.ts`.

**Astro — new:** `src/lib/store/{server,client,money}.ts`; `src/pages/api/store/{products.ts, products/[id].ts, cart.ts, quote.ts, checkout.ts, auth/{register,login,logout,me}.ts}`; `src/layouts/ShopLayout.astro`; `src/pages/[...lang]/{shop/index.astro, shop/[slug]/index.astro, cart/index.astro, checkout/index.astro, account/index.astro}`; `src/components/shop/{CartBadge,ProductBuy,CartView,CheckoutForm,AccountView}.vue`.
**Astro — modified:** `src/middleware.ts`; `src/i18n/{en,ar}.json`.

**Docs:** `docs/superpowers/plans/2026-07-17-commerce-implementation.md` (WP11 + verification updated); this report.

> Note: `git status` also shows the **prior session's** untracked commerce files (`cms/src/commerce/*`, `cms/src/collections/commerce/`, `100000`–`100400` migrations, earlier `commerce-*.test.ts`, and modifications to `tenantFeatures.ts`/`tenantFeatureAccess.ts`/`social/crypto.ts`/`src/lib/tenant.ts`). Those are **not** this session's work.

---

## 13. How to run / reproduce

```bash
# CMS typecheck + the new storefront suites (each file in its own process — Windows libSQL flake)
cd cms
npx tsc --noEmit
for f in catalog quote cart auth checkout; do npx tsx --test tests/commerce-store-$f.test.ts; done

# Astro build (needs the CMS reachable for content-sync, per CLAUDE.md)
cd ..
pnpm build

# Live E2E (throwaway DB): migrate + seed + run both servers, then drive /api/store/*
cd cms && DATABASE_URI=file:./smoke.db npx payload migrate   # fresh DB, no drift prompt
# seed a commerce tenant (model on cms/tests/helpers/commerce.ts: seedTenant + commerce-settings + location + level + product)
# start CMS (pnpm dev) and Astro (PORT=<free> pnpm dev), then:
#   GET  /api/store/products          -> 200 + product
#   POST /api/store/cart {items}      -> 200 + server-priced quote (send X-CSRF-Token from the GET's store_csrf cookie)
#   POST /api/store/checkout COD      -> 200 + order number
```

---

## 14. Recommended next steps

1. **Adversarial review (Task 1)** against §11 — the gate before enabling commerce.
2. **Drop sandbox keys + SMTP**, then verify Paymob/Kashier capture + email OTP live.
3. **Surface promotions/shipping/gift-cards** in checkout; add the **order-history** endpoint.
4. Then enable `commerce` on a dev tenant for real QA.
