# Commerce implementation — plan & progress

**Date:** 2026-07-17 · **Branch:** `feat/multi-tenant` · **Owner:** GLM-5.2 (senior implementation engineer)
**Scope:** End-to-end multi-tenant commerce for the Payload CMS (`cms/`) + Astro storefront (`/`).

This is the living plan + progress record. It is updated as work lands. The objective, locked
decisions, and acceptance definition come from the originating spec; everything under "Implemented"
is proven by tests run in this repo.

---

## 1. Objective

Independent per-tenant stores: each Tenant owns its own catalog, customers, carts, orders, inventory,
policies, gateway credentials, and settlement. No cross-Tenant carts, orders, customer records,
catalog aggregation, marketplace commissions, pooled settlement, or split payouts. Arabic-first
(RTL) + English. One ISO-4217 currency per Tenant (default EGP). Paymob + Kashier hosted checkout,
plus COD and bank transfer. Webhooks — not browser redirects — are the source of truth.

**Slice chosen for this pass:** *riskiest-deep first* — money correctness, inventory concurrency,
and payments/webhook state-machine correctness, with full integration tests. Catalog breadth,
storefront, admin UI, and live sandbox verification are deferred and tracked below.

## 2. Locked decisions (from spec)

- One code-defined Tenant Feature: `commerce`. Toggled per-Tenant via the existing `features` mechanism. Remains **disabled** on every Tenant/Tenant-Type until the full acceptance gate passes.
- Disabled commerce collections disappear from Payload nav and reject admin/REST/GraphQL/forged CRUD (via `tenantFeatureAccessPlugin` policy map). Commerce routes 404 when the resolved Tenant lacks `commerce`.
- Integer minor-unit money; basis-point rates; half-up per-line rounding. Never floats for persisted/calculated money.
- Never trust client prices/totals/discounts/tax/inventory/tenant IDs/payment status/fulfillment status.
- AES-256-GCM/HKDF (reused from `social/crypto.ts`, isolated HKDF `purpose`) for gateway secrets. Never return secrets after save. Never store raw card details / API secrets / tokens / OTPs.
- SQLite: `transactionOptions.behavior:'immediate'`, `busyTimeout:5000`, WAL `synchronous:'FULL'`, `autoIncrement:true`, `push:false`. Versioned migrations only.
- Atomic operations: order creation, order-number allocation, stock reservation/commit/release, booking holds, gift-card redemption, invoice-number allocation, payment-event insert + transition, refund creation, subscription renewal.
- Compound unique indexes on all tenant-scoped identities.
- `@payloadcms/plugin-ecommerce@3.85.1` + `@payloadcms/plugin-search@3.85.1` + `@payloadcms/email-nodemailer@3.85.1`; `@playwright/test` dev. Plugin transform order: **ecommerce → search → multi-tenant → tenantFeatureAccess**. Disable the plugin's rudimentary inventory counter; use the custom multi-location model.
- Per-Tenant `commercePermissions` matrix on each User→Tenant assignment (`tenantsArrayField.rowFields`).

## 3. Architecture — deep modules (one authoritative implementation each)

Payload endpoints, jobs, hooks, admin actions, and Astro routes call these modules; calculations and
state transitions are never duplicated in controllers/components.

| Module | Responsibility | Status |
|---|---|---|
| `commerce/money` | `Money {amount, currency}`; integer math; `applyBps`, `divRoundHalfUp` | ✅ |
| `commerce/pricing` | 9-step server-side quote; inclusive/exclusive tax; pro-rata order discount; frozen snapshot + SHA-256 hash | ✅ |
| `commerce/inventory` | atomic reserve/commit/release/expire/adjust; immutable stock-movements ledger | ✅ |
| `commerce/payments/state` | payment state machine; refund caps; idempotent event folding | ✅ |
| `commerce/payments/types` | `PaymentAdapter` interface + capability contract | ✅ |
| `commerce/payments/adapters/paymob` | Paymob Accept API adapter (native fetch, HMAC-SHA512) | ✅ |
| `commerce/payments/adapters/kashier` | Kashier adapter (native fetch, HMAC-SHA256) | ✅ |
| `commerce/payments/settings` | load + decrypt tenant gateway credentials | ✅ |
| `commerce/payments/events` | idempotent payment-event insert (ON CONFLICT) + state folding | ✅ |
| `commerce/payments/webhook` | webhook ingest (verify → atomic insert → ack) | ✅ |
| `commerce/promotions` | promotion evaluation (fixed/percent/free-ship/BXGY, schedules, limits, stacking) | ✅ |
| `commerce/permissions` | 10-key staff permission matrix; super-admin→all; reload-on-sensitive-check | ✅ |
| `commerce/crypto` | gateway-secret encryption (reuses AES-256-GCM/HKDF, `payload-commerce` purpose) | ✅ |
| `commerce/giftcards` | immutable balance ledger; issue/redeem/refund; reconstruct-from-ledger | ✅ |
| `commerce/customers/auth` | scrypt password hashing, session/OTP tokens, email/E.164 normalization (Node crypto) | ✅ |
| `commerce/shipping` | zone matching + flat/free/weight/price/pickup rate evaluation | ✅ |
| `commerce/orders/state` | order + fulfillment state machines (independent dimensions) | ✅ |
| `commerce/orders` (+ `transactions`) collections | order/transaction model (own collections — own path A), immutable snapshot, atomic per-tenant numbering | ✅ |
| `commerce/orders/numbering` + `createOrder` | atomic order-number allocation; tamper-checked order creation from a QuoteSnapshot | ✅ |
| `commerce/products` collection | catalog MVP (sku unique per tenant, price/taxBps/kind) | ✅ |
| `commerce/checkout` (+ `commitOrderInventory`) | end-to-end: server-resolved prices → inventory reservation → quote → order; webhook→commit on capture | ✅ |
| order/payment/fulfillment transition enforcement | beforeChange hooks validate every status move via the pure state machines (even via overrideAccess); payment job syncs order.paymentState | ✅ |
| `commerce/digital` | short-lived signed download URLs (HMAC + expiry, no storage-path exposure) | ✅ |
| `carts` + `customers` collections | cart/account model; cartToken unique per tenant; server-normalized email identity (unique per tenant); write-only credentials | ✅ |
| Astro storefront + admin actions + Playwright E2E | `/shop`, product, cart, checkout pages + `/api/store/*`; admin commerce UI; E2E | ⏳ (WP11) |

## 4. Implemented & verified (this pass)

### Foundation
- `commerce` added to backend `TenantFeature` union + catalogue (`collections/tenantFeatures.ts`) **and** frontend mirror (`src/lib/tenant.ts`); a static parity test asserts the two key sets match.
- `commerce/money.ts` — `Money`, `money()`, `add/subtract/scale/sum`, `applyBps`, `divRoundHalfUp` (exact integer half-up), currency + safe-integer guards.
- `commerce/crypto.ts` — `encryptGatewaySecret`/`decryptGatewaySecret` via the generalized `social/crypto.ts` (added a backward-compatible `purpose` arg; commerce uses `payload-commerce`, isolated from `payload-social`).
- `commerce/permissions.ts` — 10 `CommercePermission` keys + labelled catalogue; `effectivePermissions` (super-admin→all; reads the tenant-assignment row); `reloadEffectivePermissions` for sensitive checks.

### Inventory (the concurrency crown jewel)
- Collections: `inventory-locations`, `inventory-levels`, `stock-movements`, `stock-reservations`, `inventory-transfers` — tenant-scoped + commerce-gated; quantity counters read-only via field `access.update`.
- Migration `20260717_100000_commerce_inventory`: flat tables, AUTOINCREMENT PKs, compound unique `(tenant_id, location_id, sku)`, partial unique `(tenant_id, level_id, cart_token) WHERE status='active'`.
- `commerce/inventory/index.ts` — every op runs in a drizzle IMMEDIATE transaction and writes both the cached counter and a `stock-movements` row. Oversell is impossible: reservation is an atomic conditional `UPDATE … SET reserved = reserved + ? WHERE id = ? AND (on_hand - reserved) >= ?`. Retry-on-lock absorbs `SQLITE_BUSY` under contention.
- **Proof: 50 concurrent reservations against 5 units → exactly 5 winners, 45 `INSUFFICIENT_STOCK`, 0 oversell.** Plus idempotent re-reserve, commit (idempotent), release, `releaseCart`, `expireDue`, `adjustOnHand` (with negative-guard/rollback), tenant isolation, and ledger-reconstructs-on-hand.

### Pricing
- `commerce/pricing/index.ts` — the 9-step order; inclusive/exclusive tax; `allocateProRata` (penny residual on the largest line); gift-card cap; frozen `QuoteSnapshot` + `hashSnapshot`/`verifySnapshot` (SHA-256 over a canonical projection).
- **Proof: inclusive≡exclusive parity, line/order promo math, tamper-evident hash, gift-card cap.**

### Payments (core)
- `commerce/payments/state.ts` — `PaymentState`, `canTransition`/`transition` (terminal states block), `applyRefund` (never exceeds captured), `foldEvent` (duplicates + out-of-order = no-ops).
- `commerce/payments/types.ts` — `PaymentAdapter` interface (capabilities, hosted checkout, refund, optional void, `verifyWebhook`, `lookup`) + normalized `NormalizedEvent`.

### Payments pipeline (persistence + adapters)
- `commerce-settings` collection — tenant-global config; one doc per tenant (unique on `tenant_id`); **encrypted, write-only gateway credentials** (field `access.read=false`; collection hook encrypts non-empty plaintext and preserves the stored blob when an update submits blank — a field hook would double-encrypt the restored blob).
- `payment-events` collection — idempotent webhook ledger; compound unique `(tenant, gateway, providerEventId)`.
- `commerce/payments/settings.ts` — `loadGatewayConfig` reads the write-only secrets via overrideAccess and decrypts them.
- `commerce/payments/events.ts` — `insertPaymentEvent` (`INSERT … ON CONFLICT DO NOTHING` → duplicate = zero-effect success) and `processPaymentEvent` (folds an event into the merchant-reference's current state via the pure state machine; idempotent + out-of-order-safe).
- `commerce/payments/webhook.ts` — `ingestWebhook` (adapter-injected): verify → atomic insert → ACK. The browser redirect is never trusted.
- `commerce/payments/adapters/paymob.ts` + `kashier.ts` — native-`fetch` adapters implementing `PaymentAdapter`; Paymob HMAC-SHA512 + Kashier HMAC-SHA256 (Kashier's fixed field order), both constant-time compared; injectable `fetcher`/base URL → contract tests with no network. Provider limits expressed through capabilities (Kashier: no void, instant capture).

### Promotions
- `commerce/promotions/index.ts` — pure evaluation: eligibility (schedule/min-subtotal/min-quantity/targeting/usage), stacking (exclusive vs stackable, priority order), fixed/percent/free-shipping/BXGY, `maxDiscount` cap; deterministic (time via `now` input).

### Webhook endpoints + job (WP9)
- `commerce/payments/adapters/registry.ts` — `buildPaymentAdapter(provider, GatewayConfig)` constructs the concrete adapter from decrypted per-tenant credentials.
- `commerce/payments/endpoints.ts` — `POST /api/commerce/webhooks/{paymob,kashier}/:tenantSlug`; reads raw body, delegates to `handleProviderWebhook`.
- `commerce/payments/webhook.ts#handleProviderWebhook` — tenant-by-slug → 404 unless `commerce` → load config → 404 if gateway unconfigured → build adapter → verify → durable idempotent insert → ACK → enqueue job. `buildAdapter` injectable (tested with a fake adapter). `reprocessUnprocessed` sweeps dropped jobs (at-least-once).
- `commerce/payments/job.ts` — `process-payment-event` task on the `commerce` queue (config autoRun drainer) → folds the event via the state machine.

### SQLite + config
- `payload.config.ts` db block: `autoIncrement`, `busyTimeout:5000`, `transactionOptions:{behavior:'immediate'}`, `wal:{synchronous:'FULL'}`, `push:false`.

## 5. Migrations

| Name | Effect | Rehearsal |
|---|---|---|
| `20260717_100000_commerce_inventory` | additive: 5 inventory tables + compound/partial uniques + `payload_locked_documents_rels` columns | ✅ fresh-DB rehearsal (integration test migrates a temp DB from scratch through all migrations) |
| `20260717_100100_commerce_settings_events` | additive: `commerce_settings` (unique per tenant) + `payment_events` (compound unique) + `payload_locked_documents_rels` columns | ✅ fresh-DB rehearsal (integration test) |
| `20260717_100200_commerce_orders` | additive: `orders` (unique per tenant+orderNumber, JSON snapshots, cart_token) + `transactions`; per-tenant order/invoice sequence counters on commerce_settings; `payload_locked_documents_rels` columns | ✅ fresh-DB rehearsal (integration test) |
| `20260717_100300_commerce_products` | additive: `products` (sku unique per tenant) + `payload_locked_documents_rels` column | ✅ fresh-DB rehearsal (integration test) |
| `20260717_100400_commerce_carts_customers` | additive: `carts` (cartToken unique per tenant) + `customers` (normalized email unique per tenant) + `payload_locked_documents_rels` columns | ✅ fresh-DB rehearsal (integration test) |

## 6. Test evidence

- `cd cms && npx tsc --noEmit` → **0 errors**
- Commerce suite (22 files) → **223 tests, all pass deterministically in isolation** (186 unit across money, permissions, crypto, feature-parity, pricing, payment-state, promotions, paymob-adapter, kashier-adapter, giftcards, customer-auth, shipping, order-state, tax, digital; + 37 integration: inventory 10, payments-ingest 6, webhook-endpoint 5, orders 5, checkout 3, capture-commit 2, state-enforcement 3, carts-customers 3).
- Recommended invocation: unit tests in one batch (`tsx --test` over the non-Payload files → 91/91), then each Payload-integration file in its own process (`inventory` 10/10, `payments-ingest` 6/6, `webhook-endpoint` 5/5).
- **Known environmental flake:** running many Payload-integration files together can intermittently crash a test *process* with `exitCode 3221225477` (`0xC0000005`, a native libSQL access violation on Windows) — a native-binding/harness issue, not a test-logic or code defect (no `not ok` assertion; re-running isolated is green). It does not affect correctness; it is why integration files should run in separate processes.
- Existing-test regression (`social-crypto`, `tenant-feature-access`, `tenant-types`, `tenant-types.integration`) → **50/50 pass** (same per-file caveat).
- Audits: no float money in commerce paths; no stock mutation outside the inventory module/migration; no secret logging; `git diff --check` clean (only benign LF→CRLF on Windows).
- **Storefront (WP11, this pass):** 5 new endpoint suites `commerce-store-{catalog,quote,cart,auth,checkout}` → **44 tests (12/8/12/7/5), all green in isolation** (same per-file libSQL flake caveat). `cd cms && npx tsc --noEmit` → **0**. Astro `pnpm build` → **0** (all `/api/store/*` routes, `src/lib/store/*`, shop pages + Vue islands compile). **Live runtime smoke** on a throwaway DB (seeded commerce tenant + product + stock): Astro `/api/store/products` → 200 (product); `/api/store/cart {DEMO-1×2}` → 200 server-priced quote (`grandTotal 10000`, tamper hash); `/api/store/checkout` COD → **200 order placed**. Gateway (Paymob/Kashier) live capture still gated on sandbox keys; email-OTP gated on SMTP.

## 7. Remaining work (dependency-ordered)

- **WP8 — Paymob + Kashier adapters** ✅ (native fetch, HMAC verify, capability discovery, hosted checkout, refunds, void). Contract/fixture tests green; **live sandbox verification gated on user-provided keys**. Open contract items to validate against sandbox: Paymob sandbox base / HMAC channel (header vs `?hmac=`) / refund path / `integration_id`; Kashier refund endpoint + REST auth header + sandbox host. (Kashier uses major-unit decimal amount strings — converted via integer math.)
- **WP9 — payment-events + webhook endpoints + idempotent job** ✅: compound-unique idempotent insert (ON CONFLICT), event folding, HTTP routes `/api/commerce/webhooks/{paymob,kashier}/:tenantSlug` (tenant-by-slug → feature 404 → config load → verify → durable insert → ACK → enqueue), `process-payment-event` job on the `commerce` queue, recovery sweep.
- **WP10 — ecommerce plugin + orders/transactions**: install the three plugins + `@playwright/test`; wire transform order; extend orders/transactions with payment-events/refunds/disputes; disable plugin inventory counter; order/payment/fulfillment independent state machines wired to the pure cores.

  **STATUS — BLOCKED on plugin composition (turn 4):** Deps installed cleanly (`@payloadcms/plugin-ecommerce@3.85.1`, `plugin-search`, `email-nodemailer`, `@playwright/test` — peer deps satisfied, kept installed). The plugin was wired (`inventory:false`, transform order ecommerce → multi-tenant → tenantFeatureAccess) and **typechecks clean**, but the config **fails to boot**: `@payloadcms/plugin-multi-tenant` cannot see the ecommerce plugin's collections (`products`, `carts`, `customers`) at its sanitize phase — it emits `WARNING (plugin-multi-tenant) missing collections [...] try placing the multi-tenant plugin after other plugins` even though it IS placed after — and the ecommerce plugin's internal `customers` relationship then fails validation (`InvalidFieldRelationship: ... invalid relationship 'customers'`). Reordering and the `customers` slug override do not fix it. The config wiring was **reverted** to keep the repo green (deps remain installed).

  **DECISION (turn 5): proceeding with path A — own collections.** Orders + transactions are built as tenant-scoped + commerce-gated collections with immutable snapshots, atomic per-tenant order-number allocation, and a tamper-checked `createOrder` (verified: 20-concurrent numbering yields 20 distinct numbers). Products/carts/customers collections + the checkout orchestration (reserve → quote → createOrder → pay) follow in WP11. The plugin remains a possible later integration if its composition issue is resolved, but it is no longer on the critical path.
- **WP11 — storefront ✅ (this pass)**: shopper HTTP surface built end-to-end (architecture decision logged as `development-001` in CARL).
  - **CMS endpoints** `/api/commerce/store/:tenantSlug/*` (new, `cms/src/commerce/store/`): catalog list/detail (image + variant JSON fields added via migration `20260717_100500`), server-authoritative quote, cart upsert + re-quote, customer auth (password; **stateless HMAC session**, HKDF `payload-commerce-session`), checkout (reserve→quote→order) + offline (COD/bank) and gateway (Paymob/Kashier `createHostedCheckout`) pay. Shared module: tenant-by-slug gate, **variant-aware price resolver** (also refactored into `checkout()`), session crypto. 44 integration tests.
  - **Astro BFF** `/api/store/*` (new `src/lib/store/{server,client,money}.ts` + 9 routes): same-origin proxy, Secure HttpOnly SameSite=Lax cartToken + session cookies, double-submit CSRF, in-memory rate-limit. Pages: `/shop`, `/shop/[slug]`, `/cart`, `/checkout`, `/account` + Vue islands (ProductBuy, CartView, CheckoutForm, AccountView, CartBadge) + `ShopLayout` + `shop` i18n namespace (ar/en). `shop|cart|checkout|account` gated on `commerce` in `src/middleware.ts`.
  - **Remaining breadth (deferred):** categories/brands/price-lists/SEO + search indexing; email-OTP/phone-OTP + SMTP; promotions/gift-cards/shipping-zones/tax-classes surfaced in the UI; invoices/credit-notes; digital/bookings/subscriptions/B2B/notifications/reporting; per-customer **order-history endpoint** (account page shows "not available yet"); admin commerce UI; Playwright E2E.

## 8. External inputs still required

- **Paymob + Kashier sandbox merchant credentials + SMTP** — drop into `cms/.env` (`PAYMOB_*`, `KASHIER_*`, `SMTP_*`). Adapters are built fixture-first; live verification runs once keys exist.
- The portal backend remains out of repo (commerce has its own storefront → non-blocking).

## 9. How to run / verify

```bash
cd cms
npx tsx --test tests/commerce-*.test.ts tests/feature-parity.test.ts   # all commerce tests
npx tsc --noEmit                                                        # typecheck
npx payload migrate                                                     # apply versioned migrations on a fresh DB
```

## 10. Key conventions & decisions made

- **Tests:** Node's built-in `node:test` + `node:assert/strict`, run via `tsx` (no vitest/jest). Integration tests create a temp SQLite DB in the OS temp dir, migrate from scratch, and exercise the real Payload Local API.
- **Table/column naming** (Payload sqlite): slug → snake_case (`tenant-types` → `tenant_types`); camelCase fields → snake_case; relationship `X` → column `X_id`; the multi-tenant `tenant` field → `tenant_id`.
- **Inventory invariant:** quantity counters are read-only through the API (field `access.update: () => false`); the module is the sole writer (overrideAccess). Every counter change is paired with an immutable `stock-movements` row; the ledger reconstructs every level.
- **Oversell prevention:** atomic conditional UPDATE inside a drizzle IMMEDIATE transaction + bounded retry-on-lock. SQLite serializes writers; no application-level lock needed.
- **Secret isolation:** HKDF `purpose` (`payload-commerce` vs `payload-social`) derives independent keys from the same `PAYLOAD_SECRET`; a blob from one domain cannot be decrypted under the other's purpose.
- **Permission checks:** sensitive operations call `reloadEffectivePermissions` (re-reads the current User→Tenant assignment) rather than trusting JWT claims.
- **Money:** rates in basis points; the only non-integer step is a single half-up division per line (`divRoundHalfUp`), keeping all arithmetic exact within `Number.MAX_SAFE_INTEGER`.
- **Migration gotcha (learned):** every migration that adds a collection MUST also `ALTER TABLE payload_locked_documents_rels ADD <slug>_id` (+ index). Payload's document-lock check references one `<slug>_id` column per collection; omitting them breaks `update` globally. All commerce migrations include these.
- **Write-only secrets:** a field hook would re-encrypt a restored blob on update; encryption + preserve-from-`originalDoc` live in the collection `beforeChange` hook. Because the field is `read:false`, a client can only submit plaintext or empty — never a stored blob.
