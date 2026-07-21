# Commerce plugin-first delivery — Wave B4 handoff (pick up fresh from here)

**Written:** 2026-07-18 · **Branch:** `feat/multi-tenant` · **HEAD:** `bc723e6`
**Status:** Wave B is 3/4 committed and the full gate is green. **B4 is the next and last step of Wave B.**

## Read these first (in this order)

1. `docs/superpowers/plans/2026-07-18-commerce-plugin-first-delivery-plan.md` — the authoritative, decision-complete plan (§3.2 plugin order/config, §7 Wave B / Commit B4).
2. `docs/superpowers/prompts/2026-07-18-commerce-plugin-first-orchestrator-prompt.md` — the orchestrator (integration-owner rules, forbidden files, rejection conditions).
3. This file.

Superseded/historical (do NOT follow): the other `2026-07-18-commerce-*` docs except the plan + orchestrator above. Do not edit `docs/superpowers/prompts/2026-07-18-commerce-phase2-handoff.md`.

## Where things stand (commits, oldest → newest)

| Commit | Wave | What |
| --- | --- | --- |
| `1630a03` | Gate 0 | libsql native-teardown fix (payments-ingest) |
| `307f076` | B1 | plugin collection overrides (`cms/src/commerce/plugin/**`) + 90 config tests |
| `cdd0d8e` | B3 | migration fixtures + preflight + per-test/runner libsql teardown hardening |
| `bc723e6` | B2 | customers → tenant-aware Payload auth + additive migration + 8 auth wrappers + tests |

**Gate on `bc723e6`:** `npm --prefix cms run typecheck` ✅ · `test:commerce:unit` 274/274 ✅ · `test:commerce:integration` 14/14 ✅.

## B4 — exactly what to do next (integration-owner only; no subagents)

B4 = `feat(commerce): activate tenant-scoped ecommerce plugin` (plan §7 Commit B4). Edit **only** `cms/src/payload.config.ts` (and run the generators). Steps:

1. Import `ecommercePlugin` from `@payloadcms/plugin-ecommerce` and the B1 modules:
   `STORE_COLLECTION_SLUGS`, `EGP`, `commercePluginAccess`, `validateStoreSellable`, and the eight
   `overrideStore*` functions — all from `cms/src/commerce/plugin/**` (see `cms/src/commerce/plugin/index.ts` if it barrel-exports, else import each).
2. Order the `plugins` array exactly: `ecommercePlugin(config)` → `multiTenantPlugin(...)` → `tenantFeatureAccessPlugin()`. (Ecommerce runs first so multi-tenant can attach tenant fields to the generated `store-*` collections.)
3. Plugin config block (verified against the installed `3.85.1` by Wave A1):
   ```ts
   ecommercePlugin({
     access: commercePluginAccess,
     addresses: { supportedCountries: [{ label: 'Egypt', value: 'EG' }], addressesCollectionOverride: overrideStoreAddresses },
     carts: { allowGuestCarts: true, cartItemMatcher: defaultCartItemMatcher, cartsCollectionOverride: overrideStoreCarts },
     currencies: { defaultCurrency: 'EGP', supportedCurrencies: [EGP] },
     customers: { slug: 'customers' },
     inventory: false,
     orders: { ordersCollectionOverride: overrideStoreOrders },
     payments: { paymentMethods: [] },          // Wave D adds paymobAdapter()/kashierAdapter() — leave EMPTY for B4
     products: {
       productsCollectionOverride: overrideStoreProducts,
       validation: validateStoreSellable,
       variants: {
         variantsCollectionOverride: overrideStoreVariants,
         variantTypesCollectionOverride: overrideStoreVariantTypes,
         variantOptionsCollectionOverride: overrideStoreVariantOptions,
       },
     },
     slugMap: STORE_COLLECTION_SLUGS,
     transactions: { transactionsCollectionOverride: overrideStoreTransactions },
   })
   ```
   `defaultCartItemMatcher` is exported by `@payloadcms/plugin-ecommerce`.
4. Add the `store-*` slugs + `customers` + retained policy/inventory slugs
   (`tax-zones, tax-rates, shipping-zones, shipping-methods, promotions, promotion-redemptions,
   gift-cards, gift-card-ledger, inventory-locations, inventory-levels, stock-movements,
   stock-reservations, inventory-transfers`) to the `multiTenantPlugin` collection map so each gets
   a tenant field + tenant-scoped access. (Policy/inventory collections don't all exist yet — they
   land in Wave C; add the ones that exist now, append the rest as they're created.)
5. Keep the legacy plugin-replaced collections (`products`, `carts`, `orders`, `transactions`)
   registered **read-only** during side-by-side migration (plan §7 B4). Commerce feature flag stays OFF.
6. Regenerate: `npm --prefix cms run generate:types` then `npm --prefix cms run generate:importmap`.
7. After regen, the pre-B4-regen `as any` / `as unknown as` casts in
   `cms/src/commerce/customers/payload-auth.ts` (create options, login data, the `auth` cast in
   `Customers.ts`) can be tightened — optional, do it if time permits.
8. Gate (must be green before committing B4):
   ```
   npm --prefix cms run typecheck && npm --prefix cms run test:commerce
   ```
   Then `git add cms/src/payload.config.ts cms/src/payload-types.ts cms/src/css/cache.importmap.json <any other generated files>` and commit `feat(commerce): activate tenant-scoped ecommerce plugin (Wave B4)`.

## Decisions ALREADY MADE — do not re-litigate (Wave A + B findings)

- **`slugMap` does NOT rename collection slugs** in `3.85.1` — it only rewires relationship targets. Every `overrideStore*` already sets `slug: 'store-*'` explicitly (B1). Don't "fix" this by removing the explicit slugs.
- **`addresses.supportedCountries`** must be `[{label:'Egypt', value:'EG'}]`, NOT the bare `['EG']` the plan's §3.2 code block shows.
- **`manageCommerce`** (used by `commercePluginAccess.isAdmin`/`adminOnlyFieldAccess`) is a **derived roll-up** over the existing `effectivePermissions` resolver (any commerce-manage capability) — no change to the permission model.
- **Migrations are hand-written** (`*.ts`, no `.json` snapshot). `payload migrate:create` produces a full-schema dump because the commerce migrations lack drizzle snapshots — do NOT use it; hand-write additive ALTERs and register in `cms/src/migrations/index.ts`.
- **Windows libsql teardown flake** is handled two ways (both already committed): each Payload-booting integration test closes `payload.db.drizzle.session.client` in `test.after`, AND the runner (`cms/scripts/run-commerce-integration-tests.mjs`) treats an exit `3221225477` with all subtests `ok` as the infrastructure crash it is. If a NEW integration test flakes on exit, add the same one-liner teardown.
- **`commerce-store-auth.test.ts` was deleted** in B2 (it tested the removed legacy auth orchestration); its replacement is `commerce-customer-payload-auth.test.ts`.
- **Payment adapters (`paymobAdapter`/`kashierAdapter`) do not exist yet** — they're Wave D. B4 uses `payments.paymentMethods: []`.

## Known gotchas

- `generate:types` boots Payload — if the plugin config is wrong it fails loudly; wire incrementally and run typecheck first.
- The 429 usage limit that killed the original B2 subagent resets ~19:27 daily; subagents are fine for Waves C–F but B4 itself is integration-owner (inline).
- Stage only explicit paths when committing — there are long-lived **untracked/modified docs** in `docs/superpowers/**` (the plan, orchestrator, phase2-handoff, etc.) that must NOT be swept into commits.

## After B4 → Wave C

Wave C fans out 4 writing agents (C1 additive plugin-schema migration, C2 gateway, C3 policies, C4 inventory adaptation) per the orchestrator. Re-read the orchestrator's Wave C section and the §6.2 lane allowlists before spawning.
