# Dumyat Hospital commerce — resume + comprehensive manual validation

**Last updated:** 2026-07-20 · **Branch:** `feat/multi-tenant` · **Base:** `6b4842b` (Wave F4)
**Working dir:** `C:\Users\mrt\Desktop\dgh` (Astro storefront) + `cms/` (Payload CMS, port 3001).
**Companion docs:** `docs/commerce-release-runbook.md` (provision→sandbox→enable→rotate→monitor→rollback), `docs/superpowers/plans/2026-07-18-commerce-plugin-first-delivery-plan.md` (§3 field specs, §9 DoD).

This file is the single thing to read when you come back to ecommerce. Part 1 = what's left. Part 2 = how to validate every facet by hand.

---

## PART 1 — What's left (resume here)

### Session state at handoff
- **9 commits on `feat/multi-tenant`** (local only — **not pushed**, you said no PRs):
  - `6a3a21f` fix: coerce string cartId → number (the production blocker)
  - `4ba823b` fix: drop Kashier `bank_installments` (riba)
  - `c93d275` fix: `payload_preferences_rels.customers_id` migration
  - `7b089dc` chore: Kashier sandbox scripts + ignore sqlite sidecars
  - `0351452` feat: store-orders status/fulfillment transition guard
  - `4101098` test: signed-handler E2E test (string-cartId regression)
  - `3a56bc8` test: carts-customers → store-carts
  - `8c65ba3` test: Playwright AR/EN checkout specs
  - `f0d5244` chore: DB-migration rehearsal script
- **Gate is green:** `typecheck` clean · unit **409/409** · integration **24/24**.
- Working tree clean except pre-existing `docs/superpowers/**` dirt (untouched).

### Resume checklist (in rough priority order)
- [ ] **1. Apply the migration to your dev DB** (one-time): `cd cms && npx tsx scripts/migrate-dev.ts` — adds `payload_preferences_rels.customers_id`, fixes `/admin`.
- [ ] **2. Run the rehearsal script** against a real DB copy: `cd cms && DEV_DB_OVERRIDE=<path-to-staging-snapshot.db> npx tsx scripts/rehearse-migrations.ts` — proves migrations on empty + copied-real (runbook §8 rehearsal gate). Empty leg already verified 24/24.
- [ ] **3. Live Kashier sandbox capture** (manual gate A1): restart CMS + tunnel, update webhook URL, pay with a test card, assert order→`paid` + stock decremented. See Part 2 §M.
- [ ] **4. Live Paymob sandbox capture** (manual gate A1, second provider). See Part 2 §M.
- [ ] **5. Run Playwright AR/EN** against the live stack: `cd cms && npx playwright test`. See Part 2 §L. ⚠️ Specs are typechecked but **unverified against the real UI** — expect selector/route fixes on first run.
- [ ] **6. Enable ONE pilot tenant**: set `features:['commerce']` (runbook §3). Commerce stays off in prod until you flip it.
- [ ] **7. Push** when you're ready: `git push -u origin feat/multi-tenant` (you deferred PRs).
- [ ] **8. (Optional) B1 — unregister legacy collections.** Blocked in `node_modules`; recipe in CARL decision `development-003` (search "legacy collections unregister"). 3 steps: rewrite `store-orders.transactions.relationTo` → `store-transactions` in the override; remove `Orders/Transactions/Products/Carts` from `payload.config.ts` + the multiTenant map; update `countLegacy`/`assertNoLegacy` helpers in 5 tests. Non-blocking (legacy collections are vestigial).

### Known deferred / by-design (don't re-litigate without reason)
- **`paymentState` is NOT collection-guarded** on `store-orders` — only `status` + `fulfillmentState` are. `paymentState` is a singly-written ledger projection with a value space that doesn't match `payments/state.ts`. See commit `0351452`. Upgrade path = a purpose-built order-paymentState table if a second writer ever appears.
- **Legacy `Products/Carts/Orders/Transactions` still registered** — rollback safety + B1 blocker. No live writes (grep-verified).
- **Kashier `bank_installments` excluded** — riba (Sharia). Never re-add.

### Operator pre-deploy — `commerce` capability gate widened (2026-07-21)
The per-tenant `commerce` feature flag previously governed only the **legacy** commerce slugs (`orders`, `transactions`, `products`, `carts`, `customers`, inventory/stock, `commerce-settings`, `payment-events`). The plugin-first `store-*` surface (8 slugs) and the policy collections (8 slugs: tax-zones/rates, shipping-zones/methods, promotions/redemptions, gift-cards/ledger) were registered with `multiTenantPlugin` but missing from `TENANT_COLLECTION_FEATURES` (`cms/src/plugins/tenantFeatureAccess.ts`), so:
- tenant-admins of **non-commerce** tenants could see and edit tax/shipping/promotion/gift-card config + the `store-*` catalog (the "partial settings" symptom);
- the `tenant` ownership column stayed hidden in super-admin aggregate list views for those 16 collections.

**Fix:** all 16 slugs added to the gate map, grouped with inventory/stock and gated on `commerce`. An invariant test (`cms/tests/tenant-feature-gating-invariant.test.ts`) now fails at PR time if `multiTenantPlugin.collections` and the gate map drift again.

**Pre-deploy action (operators):** any tenant mid-configuration that has been editing tax/shipping/promotion/gift-card rows **without** `commerce` in its `features` will lose visibility of those collections in admin nav after this change. Before deploying, either:
1. set `features: ['commerce']` on those tenants (runbook §3), or
2. accept that the surface is hidden until commerce is enabled (rows already written are preserved; they reappear when the feature is flipped on).

No data migration — `multiTenantPlugin` already injected `tenant_id` + index on all 16 tables; only the gate map was stale.

### Follow-up — two-stage commerce toggle (planned, not yet implemented)
Today only **super-admin** can toggle `features` on a tenant (`Tenants.ts:321` `superAdminFieldAccess`, plus `enforceTenantSettingsEntitlement` rejects non-super-admin writes to `features` via `TENANT_PLATFORM_FIELDS`). Decided 2026-07-21: move to a **two-stage** toggle so a tenant-admin can self-enable commerce on their own tenant **only after** a super-admin has pre-authorized it:
- **Stage 1 (super-admin):** set a new per-tenant grant, e.g. `commerceAllowed: boolean` on `Tenants` (platform-level opt-in).
- **Stage 2 (tenant-admin):** when `commerceAllowed === true`, the tenant-admin may flip their own `features: ['commerce']` on/off (UI on their Tenant record, scoped to own tenant, audit-logged).

Scope (not in this change): new field + migration; relax `TENANT_PLATFORM_FIELDS` / field access with a per-feature entitlement exception; custom tenant-admin UI; audit log of who toggled. Track separately — the gating fix above is a prerequisite and lands first.

### Operator pre-deploy — `commercePermissions` per-assignment field (2026-07-21)
A separate gap from the gating fix above: the per-User→Tenant `commercePermissions` matrix was read by the commerce access layer (`cms/src/commerce/plugin/access.ts`) but was **never declared as a schema field**. Symptom: in a tenant-admin's account on a tenant with `commerce` enabled, the products page showed no "Add product" CTA and draft products were hidden — because `isCommerceAdmin()` returned false for everyone except super-admin.

**Fix:** the field is now declared via `tenantsArrayField.rowFields` (`payload.config.ts`), and `enforceUserScope` stamps role-based defaults on create/update when the row is unset:
- tenant-admin → all 10 commerce permissions
- editor → `['catalog.manage']`
- super-admin → nothing stored (reader grants ALL at read time)
- An explicit value (including `[]`) is **never overwritten** — operators can deliberately curate a smaller set per user.

**Migration `20260721_140149_commerce_permissions_field`** creates the `users_tenants_commerce_permissions` join table and **idempotently backfills existing users** by role: every existing tenant-admin → all permissions, every existing editor → `catalog.manage`. Re-running is a no-op (guarded by `NOT EXISTS`); existing explicit grants are preserved. **This migration MUST be committed alongside its sibling `.json` schema snapshot** (`20260721_140149_commerce_permissions_field.json`) — Payload's SQLite adapter builds its in-memory schema model from the latest `.json` snapshot, not from the `.ts` migration, so omitting the snapshot leaves the adapter unable to see the new table and produces invalid nested SQL at runtime even though the table exists. The snapshot was generated by `payload migrate:create`.

**Operator UI:** the `Commerce permissions` multi-select now renders on each User→Tenant assignment row in the Users edit form. Tenant-admins can grant/revoke commerce permissions on **other** users within their own tenant — **but not on themselves** (the existing `enforceUserScope` self-edit lock covers `data.tenants`, and `commercePermissions` lives inside that array, so a tenant-admin cannot self-elevate). Super-admin can edit any user.

**Post-deploy check:** create a fresh tenant-admin via the admin UI → log in as them → confirm the products page shows the "Add product" CTA and draft products are visible.

---

## PART 2 — Comprehensive manual validation

**Goal:** validate every ecommerce facet by hand before enabling commerce for a real tenant. Work top-to-bottom; each section is independent so you can resume mid-way. Tick boxes as you go.

### §0. Prerequisites (do once)
- [ ] CMS running: `cd cms && pnpm dev` (port 3001).
- [ ] Astro running: `pnpm dev` (port 4321) with `CMS_URL=http://localhost:3001`.
- [ ] `cms/.env` + root `.env` carry **identical** commerce-gateway keys: `COMMERCE_GATEWAY_KEY_ID`, `COMMERCE_GATEWAY_SECRET` (≥32 random bytes base64; NOT `PAYLOAD_SECRET` or provider secrets). Plus `COMMERCE_GIFT_CARD_PEPPER`, `COMMERCE_TAX_MODE=exclusive`, `COMMERCE_SANDBOX=true`.
- [ ] Sandbox provider creds in `cms/.env`: `PAYMOB_API_KEY/HMAC_SECRET/IFRAME_ID/INTEGRATION_ID`, `KASHIER_API_KEY/WEBHOOK_SECRET/MERCHANT_ID`. (User-entered; never log them.)
- [ ] Provision the pilot tenant (idempotent): `cd cms && npx tsx scripts/provision-commerce-tenant.ts --tenant pilot`. Seeds commerce-settings (EGP/exclusive/sandbox), one location + stock (DGH-SAND-TEE=100, DGH-SAND-MUG-L=50), tax 14%, shipping 50 EGP flat, promo `WELCOME10`, gift card `DGH-XXXX-XXXX-XXXX` (100 EGP; raw code printed once to stdout).
- [ ] **Commerce still OFF** for pilot (`features: []`) until §M passes — `resolveStoreTenant` 404s commerce for a featureless tenant.

### §A. Foundation / gating
- [ ] **A1 Disabled-by-default:** with pilot `features: []`, hit any storefront commerce endpoint (e.g. signed cart) → **404 / not found**. No commerce UI.
- [ ] **A2 Enable:** set pilot `features: ['commerce']` (admin UI or script) → commerce endpoints respond, storefront shows catalog.
- [ ] **A3 Gateway trust:** unsigned POST to `/commerce/store/pilot/checkout` → **401/403**, no write. Tampered body with a valid signature → **403** (signature over raw bytes). Replayed nonce → **403**.
- [ ] **A4 Key rotation:** set a new current pair + old pair as previous; verifier accepts both during overlap; drop previous after Astro rolls over. Half-specifying previous (id without secret) → boot throws `GatewayKeyError`.

### §B. Catalog (browse) — `store-products`, published-only, tenant-scoped
- [ ] **B1** Storefront lists published products for the pilot tenant.
- [ ] **B2** Draft products (`_status: draft`) are **excluded**.
- [ ] **B3** Other-tenant products are **excluded** (tenant isolation).
- [ ] **B4** Variant parents (`sku: null`, `enableVariants`) are listed and surface their priced variant child under `variants`.
- [ ] **B5** Client-supplied prices are **never trusted** — the quote is recomputed server-side (tamper a price in the request, confirm the server-authoritative total wins).

### §C. Cart — `store-carts`, signed
- [ ] **C1** Signed add-to-cart for a simple SKU (e.g. `DGH-SAND-TEE`) → 200, cart created, `cartId` returned as a **string** (cookie shape).
- [ ] **C2** Add a variant SKU → line added under the same cart.
- [ ] **C3** `store_cart_v2` cookie planted on add, cleared on clear; subsequent mutations use it.
- [ ] **C4** Cart response carries the **server-authoritative quote** (`subtotal`, `totalTax`, `shippingPrice`, `totalDiscount`, `giftCardApplied`, `grandTotal`) — not browser totals.
- [ ] **C5** Guest cart works with no session; logging in tags the order at checkout (merge-on-login is intentionally skipped — a cart is guest-keyed by cookie).

### §D. Pricing / quote policies (server-authoritative `quoteCart`)
- [ ] **D1 Tax:** exclusive mode → 14% added to taxable lines (EGP minor units).
- [ ] **D2 Shipping:** 50 EGP flat (or the matched shipping-method price) applied.
- [ ] **D3 Promo:** code `WELCOME10` → 10% off (verify the discount line + that an invalid code is rejected/no-op per policy).
- [ ] **D4 Gift card:** `DGH-XXXX-XXXX-XXXX` → 100 EGP applied; raw code never persisted (only its peppered hash). Reuse across carts is governed by the gift-card ledger.
- [ ] **D5 Quote hash:** same cart+address+method → same `quoteHash`; any line/address/method change → different hash.

### §E. Checkout — `processCheckout`
- [ ] **E1 COD:** `paymentMethod:'cod'` → **200**, `store-orders` created (`paymentState:'pending'`, `status:'processing'`), stock **reserved** (no online call).
- [ ] **E2 Online Paymob:** → 200 + `checkoutUrl` (Paymob hosted) + `transactionId` (a `store-transactions` row).
- [ ] **E3 Online Kashier:** → 200 + Kashier hosted `checkoutUrl`. Open it → the page offers **card + wallet only** (NO `bank_installments` — riba). Creds decrypt from `commerce-settings`.
- [ ] **E4 String cartId:** checkout with a cookie-shape string `cartId` succeeds (the production path; this was the bug fixed in `6a3a21f`). Regression test: `npx tsx --test tests/commerce-store-checkout-plugin.test.ts` (subtest "STRING cartId") + `tests/commerce-release-flow.integration.test.ts`.
- [ ] **E5 Idempotency:** send the same RFC-4122 v4 `Idempotency-Key` twice with the same body → **200 replay** (same `orderNumber`); same key + different body → **409** `idempotency_conflict`.
- [ ] **E6 Unknown cart** → 422 `cart_not_found` before any reservation. Insufficient stock → 409 `INSUFFICIENT_STOCK` + the partial reservation released.

### §F. Inventory — Phase-1 reservation by normalized SKU
- [ ] **F1 Reserve:** at checkout, `inventory-levels.reserved` increases by the line qty for that SKU (allocation key = normalized SKU, not doc id).
- [ ] **F2 Commit on capture/admin-confirm:** after an online capture or COD admin-confirm → `onHand` ↓ by qty, `reserved` → 0. Idempotent (repeat confirm commits nothing).
- [ ] **F3 Release:** on payment `failed`/`voided`/`refunded` → reservation released (`reserved` ↓, `onHand` unchanged).
- [ ] **F4 No oversell:** hammer a SKU with onHand=5 from many concurrent checkouts → never commit >5 (the order-scoped reservation lock + unique constraint enforce this; covered by `commerce-inventory.test.ts` "50 concurrent reservations against 5 units").
- [ ] **F5 Tenant isolation:** a reservation in pilot never touches another tenant's levels.

### §G. Payments / webhooks — provider-signed, gateway-EXEMPT
- [ ] **G1 Gateway-exempt:** webhook endpoints (`/api/commerce/webhooks/{paymob,kashier}/pilot` and the plugin `/api/payments/*`) accept requests with **no** `X-Commerce-Gateway-*` headers (they verify the provider signature instead). Covered by `commerce-webhook-gateway-exempt.integration.test.ts`.
- [ ] **G2 Provider signature:** a webhook with a bad/missing provider signature → **rejected**, no state change.
- [ ] **G3 Capture:** a verified capture event → order `paymentState:'captured'`, `store-transactions.status:'succeeded'`, `reconciliationStatus:'matched'`, `capturedAmount` = authoritative amount, reservation **committed**.
- [ ] **G4 Refund:** verified refund → `paymentState:'refunded'` (or partial), `refundedAmount` updated, stock released.
- [ ] **G5 Idempotent ledger:** duplicate `providerEventId`, out-of-order, and stale events are **no-ops** (the `payment-events` ledger absorbs them). `rawPayloadHash` recorded (raw provider payload never persisted).
- [ ] **G6 Reconciliation:** `commerce-reports` flags any `store-transactions` with `reconciliationStatus ≠ matched`.

### §H. Orders — `store-orders`
- [ ] **H1 Order number:** each order gets a unique tenant-scoped `orderNumber` (prefix from commerce-settings).
- [ ] **H2 Immutable snapshot:** `quoteHash` + `quoteSnapshot` + every integer total stored on the order at placement.
- [ ] **H3 Status guard:** illegal `status`/`fulfillmentState` transitions are rejected with APIError 400 (e.g. `processing→pending` blocked; `processing→completed` allowed). Test: `npx tsx --test tests/commerce-store-orders.test.ts`.
- [ ] **H4 (Known gap)** `paymentState` transitions are **not** collection-guarded — the D3 job drives them from the ledger. (See Part 1 "deferred".)
- [ ] **H5 Order history:** storefront order history is signed (`x-session-token` bridged from `store_session_v2`); a customer sees only their orders.

### §I. Customer auth — Payload sessions, tenant-bound
- [ ] **I1** Username is **server-derived** (from tenant + normalized email); cannot be client-set.
- [ ] **I2** Email unique **per tenant**; the same email in a second tenant is allowed.
- [ ] **I3** Cross-tenant customer isolation holds (a pilot customer cannot read another tenant's data).
- [ ] **I4** Session token bridges to order history + checkout customer tagging.

### §J. i18n — Arabic-first, RTL
- [ ] **J1 AR** at `/` → `<html dir="rtl">`, Arabic strings + Arabic content fields, Reem Kufi / IBM Plex Sans Arabic fonts.
- [ ] **J2 EN** at `/en` → `<html dir="ltr">`, English strings + English content fields.
- [ ] **J3** The full flow (catalog → cart → checkout → order-placed) renders correctly in **both** locales.

### §K. Operations
- [ ] **K1 Reports** (`cms/src/commerce/reports`): sales totals (by day/status/paymentState), reconciliation exceptions, unpaid/expired orders, low stock, promotion usage, gift-card liabilities, failed notification jobs — all return data for the pilot tenant.
- [ ] **K2 Notifications:** the durable `send-commerce-notification` task fires on order-placed + payment-captured/failed/refunded — **bilingual** (AR/EN), deduped by idempotency key, retried by Payload's bounded retry.
- [ ] **K3 Ledger:** `payment-events` is append-only; replaying a capture is a no-op.

### §L. Automated gates (now scripted — run them)
- [ ] **L1 Code gate:** `npm --prefix cms run verify:commerce` → green (typecheck + unit 409 + integration 24 + `generate:types` + `generate:importmap` + `git diff --check`). Astro: `npx tsc --noEmit` 0 errors; signer `cms/node_modules/.bin/tsx --test src/lib/store/__tests__/gateway-sign.test.ts` 5/5.
- [ ] **L2 DB rehearsal:** `cd cms && DEV_DB_OVERRIDE=<staging-snapshot.db> npx tsx scripts/rehearse-migrations.ts` → empty leg 24/24 + copied-real leg booted/at-head/idempotent.
- [ ] **L3 Playwright:** bring up CMS+:3001 + Astro:4321 + pilot tenant enabled + gateway keys + sandbox, then `cd cms && npx playwright test` → AR + EN COD checkout passes. ⚠️ Expect to fix selectors/routes on first run (specs are unverified). Paymob/Kashier hosted redirect is NOT in the spec — that's §M.

### §M. Live sandbox capture (THE manual gate — must pass before pilot enablement)
This is the one thing no automation can do. Do it for **both** providers.

**Setup:**
- [ ] `cd cms && pnpm dev` (3001) + `pnpm dev` (4321).
- [ ] `cloudflared tunnel --url http://localhost:3001` → note the new `*.trycloudflare.com` URL.
- [ ] Register/update the provider webhook(s) to `<tunnel-url>/api/commerce/webhooks/{paymob,kashier}/pilot`.
- [ ] Pilot tenant enabled (`features:['commerce']`), sandbox=true.

**Kashier leg:**
- [ ] `cd cms && npx tsx scripts/kashier-test-checkout.ts` → prints a signed Kashier checkout URL + `orderNumber` + `amountDue`.
- [ ] Open the URL, pay with a **Kashier test card**.
- [ ] Webhook capture arrives + passes signature verification → order `paymentState:'captured'`, `store-transactions.status:'succeeded'`, `reconciliationStatus:'matched'`, **stock decremented** (reserved→0, onHand↓).
- [ ] (Direct-adapter smoke, no order linkage): `npx tsx scripts/kashier-checkout-url.ts` → valid signed URL only.

**Paymob leg:** repeat the analog against the Paymob sandbox (iframe flow, HMAC-signed webhook).

**Pass criteria for §M:** real test-card payment → verified webhook → order paid → stock committed, for **both** providers. Until this is green, do **not** enable commerce beyond the pilot.

### §N. Rollback rehearsal (do this before going live, not after)
- [ ] **Soft:** disable the tenant `commerce` feature → storefront returns to non-commerce for that tenant, no data changes. Confirm.
- [ ] **Deep (this release only):** legacy `Products/Carts/Orders/Transactions` tables + definitions are retained, so a flip-back to the legacy read path is possible. (The legacy runtime was retired from registration in F2; re-registering requires the B1 follow-up.)

---

## Quick command index
```
# Gates
npm --prefix cms run verify:commerce                 # full pre-merge gate
cd cms && npx tsx --test tests/<file>.test.ts        # one integration test (boots Payload)
cd cms && npx playwright test                         # AR/EN storefront (needs live stack)

# DB
cd cms && npx tsx scripts/migrate-dev.ts             # apply pending migrations to dev DB
cd cms && DEV_DB_OVERRIDE=<snap> npx tsx scripts/rehearse-migrations.ts   # rehearsal gate

# Sandbox / provisioning
cd cms && npx tsx scripts/provision-commerce-tenant.ts --tenant pilot
cd cms && npx tsx scripts/kashier-test-checkout.ts   # full plugin-first Kashier flow → signed URL
cd cms && npx tsx scripts/kashier-checkout-url.ts    # direct adapter URL (no order/txn)

# Run
cd cms && pnpm dev        # CMS :3001
pnpm dev                  # Astro :4321
cloudflared tunnel --url http://localhost:3001
```

## Pointers (don't re-derive)
- Runbook (provision→enable→rotate→monitor→rollback): `docs/commerce-release-runbook.md`
- Delivery plan (§3 field specs, §9 DoD): `docs/superpowers/plans/2026-07-18-commerce-plugin-first-delivery-plan.md`
- B1 unregister recipe (blocked): CARL decision `development-003`
- processCheckout: `cms/src/commerce/checkout/process.ts` · gateway: `cms/src/commerce/store/gateway.ts` · Kashier adapter: `cms/src/commerce/payments/adapters/kashier.ts`
- The string-cartId fix (why E4 matters): commit `6a3a21f`
