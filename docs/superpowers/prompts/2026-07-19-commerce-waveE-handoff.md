# Commerce plugin-first delivery — Wave E handoff (pick up fresh from here)

**Written:** 2026-07-19 · **Branch:** `feat/multi-tenant` · **HEAD:** `bd5dc75`
**Status:** Waves B4 + C (full) + D1/D2/D3/D4 are committed and the full gate is green. **Wave E is the storefront + operations fan-out — the last build wave before F (parity + cleanup + release).** You are the integration owner.

## Read these first (in this order)

1. `docs/superpowers/plans/2026-07-18-commerce-plugin-first-delivery-plan.md` — the authoritative, decision-complete plan. For E read: §3.7 (cart, cookie `store_cart_v2`, plugin cart server ops from signed endpoints), §4 + §4.1 (gateway signing — Astro signs, CMS verifies) , §4.2 (endpoint exposure), §6.1 + §6.2 (coordination rules + lane allowlists), §7 Wave E (E1/E2/E3), §9 (definition of done).
2. `docs/superpowers/prompts/2026-07-18-commerce-plugin-first-orchestrator-prompt.md` — the orchestrator (integration-owner rules, forbidden files, Wave E section, rejection conditions, mandatory completion report).
3. This file.

Superseded/historical (do NOT follow): every other `2026-07-18-commerce-*` / `2026-07-17-commerce-*` doc except the plan + orchestrator above.

## Where things stand (commits, oldest → newest)

| Commit | Wave | What |
| --- | --- | --- |
| `0d66170` | B4 | activate tenant-scoped ecommerce plugin |
| `c1386c0` | C1 | additive plugin schema migration (store-* + policy + nonce tables) |
| `991c67f` | C2 | backfill + preflight modules |
| `a87ee2f` | C3 | signed gateway boundary (HMAC/nonce/rotation + test vectors) |
| `16a30d1` | C4 | 8 policy collections + authoritative `quoteCart` |
| `d4319d7` | C5 | inventory SKU adaptation to store-products/store-variants |
| `66af7ee` | — | wire Wave C suites into the gate |
| `a8ef156` | D1 | Paymob adapter → plugin orders/transactions |
| `8008171` | D2 | Kashier adapter → plugin orders/transactions |
| `a27eba9` | D3 | durable payment side effects (C-03 fix: 5 checkpoints, throw-on-unfinished, reconciliation) |
| `a9c3806` | — | wire Wave D suites into the gate scripts |
| `bd5dc75` | D4 | plugin-first checkout (signed gateway → 10-step → store-*) |

**Gate on `bd5dc75`:** `npm --prefix cms run typecheck` ✅ · `test:commerce:unit` **374/374** ✅ · `test:commerce:integration` **18/18** ✅ (4 native-teardown crashes tolerated).

## What D4 delivered (the seams Wave E builds on)

- **Signed checkout endpoint** `POST /api/commerce/store/:tenantSlug/checkout` now goes through `withVerifiedCommerceGateway` (`cms/src/commerce/store/gateway.ts`) → `processCheckout` (`cms/src/commerce/checkout/process.ts`). Unsigned calls get 401/403 and perform no write. The body shape is the plugin-first `ProcessCheckoutInput` (`cartId`, `paymentMethod`, `shippingAddress`, `promotionCodes?`, `giftCardCode?`, `shippingMethodId?`, `idempotencyKey?`, `returnUrl?`) — NOT the legacy `{cartToken, items}`.
- **Payment adapters are registered** (`paymentMethods: [paymobAdapter, kashierAdapter()]`), so the plugin's payment endpoints exist under `/api/payments/{paymob,kashier}/*`.
- **The authoritative quote** is driven by `createPayloadQuoteCartLoader` (`cms/src/commerce/policies/quote-loader.ts`) reading `store-carts` / `store-products` / `store-variants` + the C4 policy collections.
- **D3's payment side-effect bundle still targets LEGACY `orders`/`transactions`** (see Known gotchas). E1 unblocks payment events reaching `processed=1`; the legacy→store-* repoint of the side-effect bundle is an F1/F2 task.

## Wave E — exactly what to do (integration-owner)

Per the orchestrator, Wave E runs **two writing agents in parallel** from the post-D4 HEAD, then you fan in, verify disjoint paths, and commit serially. **You alone do shared client/server route wiring + job/registry edits.**

### Before spawning

1. `git rev-parse HEAD` (must be `bd5dc75` or a descendant) and `git status --short`.
2. Preserve unrelated/untracked files. The working tree currently has long-lived modified/untracked `docs/superpowers/**` files — **never stage or commit those** (they outlive every wave).
3. Run the gate: `npm --prefix cms run typecheck && npm --prefix cms run test:commerce`. Stop if not green.
4. Record the exact HEAD + status; every spawned agent shares this checkout and branch.

### Spawn two agents in parallel (same branch + HEAD + checkout)

Hand each agent the full context packet (Task / Objective / Active branch / Recorded HEAD / Allowed files / Forbidden files / Forbidden git operations / Input contracts / Output contracts / Required tests / Stop conditions / Handoff format) from the orchestrator.

#### Agent 1 — Operations (E1 notifications + E2 reports)

- **Objective:** E1 register the durable commerce notification task(s); E2 add tenant-scoped operational commerce reports.
- **Allowed (E1):** new notification modules + the `send-commerce-notification` task body + focused tests. New report query modules + focused tests (E2).
- **Forbidden:** `cms/src/payload.config.ts`, `cms/src/migrations/index.ts`, the central jobs/tasks registry wiring, generated types/importmap, package manifests, shared store helpers, storefront files, payment domain logic.
- **E1 contract (plan §7 E1):**
  - Register a Payload task of slug **`send-commerce-notification`** (the constant `SEND_COMMERCE_NOTIFICATION_TASK` already lives in `cms/src/commerce/payments/job.ts`; D3 only enqueues it). The task owns dedupe via the `idempotencyKey` in its input and performs the out-of-band send. **Deterministic event keys; never send inside the payment database transaction; retry by throwing.**
  - Notification triggers (one deterministic key each): account verification, password reset, order placed, payment captured, payment failed, refund completed, order cancelled.
  - The task must be safe to call before any specific provider is configured (notifications are enqueued as jobs; the SMTP/transport is wired by the operator — see `cms/.env`).
  - **Once E1 is registered, D3's payment events can reach `processed=1`.** Add a focused test that enqueues a `send-commerce-notification` job, drives `processPaymentEvent` with the production side-effect bundle, and asserts the event completes. (The D4 test asserted `processed` falsy precisely because E1 had not landed.)
- **E2 contract (plan §7 E2):**
  - Reports are **tenant-scoped queries** over `store-orders`, `store-transactions`, `payment-events`, `stock-reservations`, `gift-card-ledger`, `promotion-redemptions`. **No new shadow order/transaction tables.**
  - Provide: sales totals by date/tenant/status; payment reconciliation exceptions (transactions whose `reconciliationStatus` ≠ `matched`); unpaid/expired orders; low stock (inventory-levels where `on_hand - reserved` ≤ threshold); promotion usage; gift-card liabilities (sum of active balances); failed notification jobs (Payload jobs in the `commerce` queue that exhausted retries).
  - All money integer minor units; tenant-scoped (`tenant: { equals }`) everywhere.
- **Integration-owner commits after fan-in:** E1 then E2.

#### Agent 2 — Storefront (E3)

- **Objective:** adapt the Astro/Vue storefront to signed routes backed by `store-*`.
- **Allowed:** shop pages/components under `src/` and new focused UI tests. **Excluding** shared store helpers (`src/lib/store/client.ts`, `src/lib/store/server.ts`) — those are yours.
- **Forbidden:** server domain logic (`cms/src/commerce/**`), shared client/server helper files, CMS config/registries/migrations, generated files.
- **E3 contract (plan §7 E3 + §3.7):**
  - Required routes: catalog list/detail; add/update/remove cart; guest cart; login/register/logout/me/reset; address selection; quote; checkout; payment redirect/return; confirmation/failure; order history/detail.
  - Carts use the plugin `store-carts` via the cookie **`store_cart_v2`** (§3.7). Legacy `store_cart` is retired at cutover.
  - **Every storefront→CMS request must be gateway-signed** (§4.1): `X-Commerce-Gateway-{Key-Id,Timestamp,Nonce,Signature}` over the canonical string. The CMS verifier is `withVerifiedCommerceGateway`; the **Astro-side signer is integration-owner wiring** (see below).
  - Retain Arabic (default, RTL) + English, keyboard access, error summaries, loading/empty states.
- **Integration-owner commits after fan-in:** E3.

### Fan-in + commits (serial, in this order)

1. Wait for both agents. Verify their changed paths are disjoint and each within its allowlist.
2. Inspect the combined diff.
3. **You alone wire the shared seams** (these are why the agents cannot finish alone):
   - Register the `send-commerce-notification` task in `cms/src/payload.config.ts` `jobs.tasks` (E1's task body comes from the agent; registration is yours).
   - Astro-side gateway signer + the request path in `src/lib/store/client.ts` / `src/lib/store/server.ts` (E3's pages call it; the signer is yours). It must sign with `COMMERCE_GATEWAY_KEY_ID` + `COMMERCE_GATEWAY_SECRET` (current key only — Astro never signs with the previous/rotation key).
   - **Signed plugin cart endpoints.** The plugin cart HTTP endpoints are wiped (§3.7). Wire signed CMS store endpoints that call the plugin's exported `addItem`/`updateItem`/`removeItem`/`clearCart`/`mergeCart` server operations, going through `withVerifiedCommerceGateway`. (The legacy `cms/src/commerce/store/cart.ts` exists for the legacy path; the plugin-first cart endpoints are new wiring.)
   - Add E1/E2/E3 env vars to `.env.example` / `cms/.env.example` as needed (e.g. SMTP transport).
4. Run focused tests per lane, then run the full gate.
5. Stage **only explicit paths** per commit. **Never stage `docs/superpowers/**`.** Verify with `git diff --cached --name-only` before every commit.
6. Commit serially:
   - `feat(commerce): add durable commerce notifications (Wave E1)`
   - `feat(commerce): add operational commerce reports (Wave E2)`
   - `feat(storefront): switch catalog cart account and checkout (Wave E3)`

### Gate (must be green before each commit)

```
npm --prefix cms run typecheck && npm --prefix cms run test:commerce
```

Add any new booting integration test to `cms/scripts/run-commerce-integration-tests.mjs` and close `payload.db.drizzle.session.client` in `test.after` (Windows libsql teardown — see Known gotchas).

## Decisions ALREADY MADE — do not re-litigate (B4 → D4 findings)

- **Permanent `store-*` slugs** (§3.1); `slugMap` rewires relationship targets, does not rename collection slugs. Every `overrideStore*` sets `slug: 'store-*'`.
- **Plugin `inventory: false`**; Phase 1 reservation layer is retained and reserves by immutable normalized SKU. `resolveSellableBySku` (C5) is the SKU resolver.
- **EGP only**, integer minor units. Browser totals are never trusted — `quoteCart` is authoritative.
- **`paymobAdapter` is a pre-built INSTANCE** (D1 `export const`); `kashierAdapter` is a factory (D2). Both sit in `paymentMethods`.
- **D4 checkout creates the `store-transactions` row itself** with the authoritative `amountDue` and calls the adapter's `createHostedCheckout` for the URL. Reason: the D1/D2 `initiatePayment` reads `cart.subtotal`, which is not a top-level field on the plugin cart. **Reconciling the adapter `initiatePayment`/`confirmOrder` to the real plugin cart schema is an F1/F2 task** — do not re-litigate in E.
- **D3 side-effect bundle (`buildProductionSideEffects`) targets LEGACY `orders`/`transactions`.** Inventory commit/release still works (keyed by `orderNumber` in `stock_reservations`, which D4 sets as `orderRef`). The order/transaction side-effect checkpoints no-op on the wrong collection for plugin-first orders until F1/F2 repoint them to `store-*`. **E2 reports must read `store-*` as the source of truth and treat the legacy collections as stale for plugin-first orders.**
- **`withVerifiedCommerceGateway` is the ONLY code allowed `overrideAccess: true` for guest commerce ops.** It stashes the resolved tenant on `req.commerceTenantID` / `req.tenantID` — the seam the adapters + checkout read.
- **Provider webhooks** (`/api/commerce/webhooks/{paymob,kashier}/:tenantSlug` and the plugin's `/api/payments/{paymob,kashier}/*`) are **gateway-exempt** (§4.2) — they verify provider signatures, never the commerce-gateway signature.
- **Migrations are hand-written** (`.ts`, no `.json` snapshot). `payload migrate:create` is forbidden. New schema needs → hand-write an additive migration + register it in `cms/src/migrations/index.ts`. **Never modify already-applied historical migrations** (§0.14).
- **`payload-types.ts` is gitignored** (generated); `importMap.js` is tracked. After touching `payload.config.ts` (jobs/plugins), run `generate:types` then `generate:importmap`.
- **`manageCommerce`** is a derived roll-up over `effectivePermissions` (any commerce-manage capability) — no permission-model change.
- **Commerce stays disabled for all tenants** (feature flag off) until every release gate passes.

## Known gotchas

- **C1 schema-capture drift.** The C1 migration (`20260719_300000_commerce_plugin_additive`) was captured before some override fields landed, so it missed columns the live config emits. D4 backfilled two via `20260719_400000_commerce_store_cart_shipping_method` (`store_carts.selected_shipping_method_id`, `store_transactions.payment_method`). **If E hits "no such column" on a `store-*`/policy insert, the fix is another hand-written additive ALTER migration registered in `index.ts` — not editing C1.** Compare the failing insert's column list against the C1 `CREATE TABLE` to spot the missing column.
- **Windows libsql teardown flake:** the runner tolerates exit `3221225477` when all subtests pass. Any NEW Payload-booting integration test should `await payload.db.drizzle.session.client.close()` in `test.after` (one-liner) before `payload.destroy()`.
- **Signed storefront requests are mandatory.** The CMS checkout + cart endpoints reject unsigned calls. The Astro signer must produce the exact canonical string (§4.1) and the four `X-Commerce-Gateway-*` headers; reuse the test vectors in `cms/src/commerce/gateway` to validate it.
- **Guest promotion identity is per-tenant for anonymous guests** (the loader buckets guests without a gift card together). Per-customer limits effectively target signed-in customers. Tighten only if guest promo abuse surfaces.
- **Notification task timing:** until E1 lands, payment events stay `processed=0` — intentional. E1 is what unblocks them.
- **`docs/superpowers/**` is dirty and must stay out of every commit.** Stage explicit paths only; verify with `git diff --cached --name-only`.

## After Wave E → Wave F (serial acceptance + cleanup)

Wave F is serial: F1 (plugin cutover parity tests), F2 (remove legacy runtime models — `Products.ts`, `Carts.ts`, `Orders.ts`, `Transactions.ts`, legacy cart/order ops, custom session/password crypto; this is also where the D3 side-effect bundle gets repointed to `store-*` and the adapter `initiatePayment`/`confirmOrder` reconciled to the plugin cart), F3 (complete release gates), F4 (release runbook). Re-read the orchestrator's Wave F section before starting. **Never remove legacy runtime models before F1 parity passes; never drop historical tables in this release; never enable commerce before F3 + sandbox/manual gates pass.**

## Completion report (return this when E is done)

Per the orchestrator: commit list mapped to E1/E2/E3; agent/lane/changed-files table; changed files by domain; test/build evidence; migrated counts if any; security-gate results; retained custom modules; removed duplicate modules; blockers + exact next command; final definition-of-done checklist progress. **Do not say "complete" unless every item in §9's definition of done passes.**
