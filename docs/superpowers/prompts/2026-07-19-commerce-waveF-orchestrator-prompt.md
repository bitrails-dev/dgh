# Commerce Wave F — orchestrator prompt (cutover, retire legacy, release)

**Written:** 2026-07-19 · **Branch:** `feat/multi-tenant` · **HEAD to start from:** `8c2853b`
**Pick up fresh from here.** You are the integration owner for Wave F — the serial arc that turns the
plugin-first storefront (shipped through Wave E3) into the live commerce runtime by retiring the
legacy models behind a parity net, then gating release. Modeled on the Wave E orchestrator rules:
delegation does not transfer integration responsibility; the integration owner owns the registry,
`payload.config.ts`/importmap regen, the gate, and every commit.

**Wave F is SERIAL.** F1 gates F2; F2 gates F3; F3 gates F4. Do not start a phase until the prior
phase's gate is green. Never enable commerce before F3 + sandbox/manual gates pass.

## Read these first (in this order)

1. `docs/superpowers/prompts/2026-07-19-commerce-waveE3-continuation-prompt.md` — the E3 prompt you
   just finished; its "Decisions/gotchas inherited" and "Mandatory rejection conditions" carry forward
   verbatim. The E3 commit map (below) is the world F starts in.
2. `docs/superpowers/prompts/2026-07-19-commerce-waveE-handoff.md` — the Wave E owner doc; re-read its
   "After Wave E → Wave F" section + §9 DoD.
3. `docs/superpowers/prompts/2026-07-18-commerce-plugin-first-orchestrator-prompt.md` — integration-
   owner rules, forbidden files, rejection conditions, completion report format.
4. `docs/superpowers/plans/2026-07-18-commerce-plugin-first-delivery-plan.md` — §8 (Wave F), §9 (DoD),
   §3.8/§3.9 (order/transaction fields), §4.1/§4.2 (gateway), §7 (D3 side-effects + D4 checkout).
5. This file.

Superseded/historical: every other `2026-07-1{7,8,9}-commerce-*` doc except the plan + orchestrator
above. The four E3-continuation commits are the source of truth for current code state.

## Where things stand (commits on `feat/multi-tenant`)

| Commit | Wave | What |
| --- | --- | --- |
| `7398c45` | E1 | durable `send-commerce-notification` task + modules |
| `6b58838` | E2 | operational commerce reports |
| `edbd6d1` | E3 (partial) | storefront UI + verified gateway signer + signed `/api/store/v2/*` proxy + `server.ts` helpers |
| `eb34a8f` | E3 cont. (A) | plugin-first storefront quote (`quoteStoreCart`/`quoteStoreItems`) |
| `b7d461e` | E3 cont. (B) | signed plugin cart endpoints (`cart-v2.ts`) + registry + proxy cart activation |
| `5c04759` | E3 cont. (C) | signed orders endpoint + x-session-token customer bridge |
| `8c2853b` | E3 cont. (D) | storefront auth routed through `withVerifiedCommerceGateway` |

Gate on `8c2853b`: `npm --prefix cms run typecheck && npm --prefix cms run test:commerce` green
(unit 396/396; integration 23/23, 5 Windows-libsql teardown crashes tolerated); root `npx tsc
--noEmit` 0 errors under Astro `src/` and `cms/src/commerce` (the `cms/src/app` `@payload-config`
alias + `cms/src/migrations` noise are pre-existing and out of scope); signer self-check 5/5.

## What is live vs. retained-read-only after E3

**Live (plugin-first, the only path the storefront drives):**
- Cart: `cms/src/commerce/store/cart-v2.ts` → plugin ops over `store-carts` + `quoteStoreCart`.
- Quote: `cms/src/commerce/store/quote.ts` → `quoteStoreItems`; cart totals via `quoteStoreCart`.
- Orders: `cms/src/commerce/store/orders.ts` → `store-orders` + x-session-token bridge.
- Auth: `cms/src/commerce/store/auth.ts` → all handlers gateway-signed.
- Checkout: `cms/src/commerce/checkout/process.ts` (`processCheckout`) → `store-orders`/`store-transactions` + Phase-1 reservation by normalized SKU.
- Quote engine + loader: `cms/src/commerce/policies/quote.ts` + `quote-loader.ts` (authoritative).
- Gateway: `withVerifiedCommerceGateway` (`cms/src/commerce/store/gateway.ts`) — the only `overrideAccess:true` surface for guest commerce.

**Retained read-only side-by-side until F2 (do NOT remove before F1 parity passes):**
- `cms/src/commerce/store/cart.ts` (`upsertCart`/`readCart` + `cartEndpoints`) — unregistered, but still directly tested by `commerce-store-cart.test.ts`.
- `cms/src/commerce/store/shared.ts` — the legacy `quoteItems`/`resolvePricedLines` read legacy `products`. NOTE: `loadCommerceSettings`, `resolveStoreTenant`, `readJsonBody` in the same file ARE still used by the plugin-first paths — F2 deletes only the legacy quote helpers, not the whole file.
- `cms/src/commerce/store/catalog.ts` — reads legacy `products` (plugin-first browse gap; handoff §5).
- `cms/src/commerce/store/checkout.ts` (`placeOrder`) + `cms/src/commerce/checkout/index.ts` (`checkout()`) — the legacy orchestration; `commerce-store-checkout.test.ts` drives it.
- Legacy runtime collections: `cms/src/collections/{Products,Carts,Orders,Transactions}.ts` and the plugin's legacy slugs they publish.
- The D3 side-effect bundle (payment-event → order/transaction/inventory commit; see `cms/src/commerce/payments/`) — may still write legacy collections; F2 repoints to `store-*`.

## Objective

Retire the legacy commerce runtime behind a parity net, complete the plugin-first surface, then gate
release — without ever dropping historical tables, breaking the live (disabled) storefront, or
enabling commerce before the sandbox/manual gates pass.

---

## Phase F1 — plugin-cutover parity tests (GATING; no removal)

**Goal:** prove the plugin-first path is a complete, correct replacement for the legacy path so F2
can remove legacy without behavior change. Nothing is removed in F1.

**Scope:**
- For representative carts (simple product, variant, multi-line, promo, gift-card, tax-inclusive +
  tax-exclusive, insufficient-stock), assert the plugin-first path produces the **same business
  outcomes** the legacy path produced: merchandise subtotal, tax, shipping, grand total, discount,
  order line shape, stock-reservation effect, transaction fields. Where a legacy equivalent still
  exists (`quoteItems` vs `quoteStoreItems`; legacy `checkout()` vs `processCheckout`; legacy
  `upsertCart` vs `pluginAddItem`), run both over identical inputs and assert the comparable fields
  match (the legacy `quote()` engine is line-`taxBps` based; the plugin `quoteCart` engine is
  tax-class/zone based — assert the GRAND TOTAL + per-line net match for the configured tax policy,
  not internal field names).
- Add a self-contained variant-in-cart integration case (the E3 cart suite covers simple products;
  variant seeding needs the plugin variant-type/options shape — exercise it here so F2's removal
  doesn't lose variant coverage).
- Assert no legacy collection (`products`, `carts`, `orders`, `transactions` — legacy slugs) is
  written by `processCheckout` / the cart ops / the orders endpoint (negative assertions; they are
  the contract that lets F2 remove legacy).

**Allowed:** new test files under `cms/tests/` + the `INTEGRATION_FILES`/`test:commerce:unit` lists.
**Forbidden:** every non-test source file. No `payload.config.ts`, no migrations, no `src/`.

**Stop conditions:** the parity suite is green on top of the existing 396 unit + 23 integration
files. If a parity test reveals a real plugin-first discrepancy, STOP + report it (do not patch the
engine to force green — surface the divergence).

---

## Phase F2 — retire legacy runtime + repoint D3 side-effects (depends on F1)

**Goal:** the live commerce code no longer reads or writes any legacy collection. Historical tables +
collection definitions stay (additive-only release); only the call-sites + registrations retire.

**Scope (discover exact files before editing; pointers above):**
- **Catalog → store-products/store-variants:** rewrite `cms/src/commerce/store/catalog.ts` to read
  the plugin collections (the proxy's `{products}→{items}` reshape stays). Drop the legacy read.
- **D3 side-effect repoint:** the payment-event processing path (capture→commit: order state,
  transaction totals, inventory commit) must write `store-orders`/`store-transactions` and reserve/
  release by normalized SKU — never legacy `orders`/`transactions`/`carts`. Find the side-effect
  bundle in `cms/src/commerce/payments/` (the `process-payment-event` task + state transitions) and
  repoint every legacy write. Confirm reservation commit/release goes through the Phase-1 layer keyed
  by SKU.
- **Adapter reconciliation:** the D1/D2 adapters (`paymob`/`kashier`) `confirmOrder`/`initiatePayment`
  (or equivalent) must reconcile against the plugin cart/order, not legacy. `processCheckout` already
  uses `createHostedCheckout` with the authoritative amount; close any remaining legacy references.
- **Retire legacy orchestration call-sites:** remove the legacy `cartEndpoints` (already
  unregistered), `quoteItems`/`resolvePricedLines` (legacy price helpers), `placeOrder`/legacy
  `checkout()`, and their tests (`commerce-store-cart.test.ts`, `commerce-store-checkout.test.ts`) —
  or convert them to plugin-first. Keep `shared.ts`'s `loadCommerceSettings`/`resolveStoreTenant`/
  `readJsonBody` (still used). Keep `cart.ts`/`checkout.ts` files on disk only if a collection still
  references them; otherwise delete.
- **Collection registration:** stop registering the legacy runtime collections as write targets. The
  collection DEFINITIONS + DB tables stay (never drop historical tables this release). If a
  `payload.config.ts` touch is needed → `npm --prefix cms run generate:types && generate:importmap`
  (`payload-types.ts` gitignored; `importMap.js` tracked).
- **"No such column" on a `store-*` write → new hand-written ALTER migration + register in
  `cms/src/migrations/index.ts`.** Never edit an applied historical migration.

**Allowed:** `cms/src/commerce/**`, `cms/src/collections/*` (retire registration only), `cms/src/payload.config.ts`, `cms/src/migrations/` (new additive files only), `cms/tests/**`, the gate scripts.
**Forbidden:** editing applied historical migrations; dropping tables; generated files (regen instead);
the Astro `src/` storefront (unchanged in F2); `docs/superpowers/**`.

**Stop conditions:** no live path reads or writes a legacy commerce collection (grep-verified: no
`collection: 'products'|'carts'|'orders'|'transactions'` outside retained legacy collection defs +
their own tests); gate green; `payload.config.ts` regen committed (`importMap.js` tracked).

---

## Phase F3 — release gates (depends on F2; commerce still disabled until the operator flips it)

**Goal:** the system is ready for a tenant to turn commerce on, proven in sandbox.

**Scope:**
- **Feature gate:** commerce is gated by the tenant `features: ['commerce']` flag (already enforced by
  `resolveStoreTenant`). F3 provisions a real commerce tenant config end-to-end in sandbox: commerce-
  settings (EGP, tax mode), inventory-location + stock levels, tax/shipping/promotion policy rows,
  gateway credentials (Paymob/Kashier) in sandbox mode.
- **Sandbox end-to-end:** drive a full flow against the sandbox — browse (catalog now store-products),
  add to cart (signed), checkout (online gateway → sandbox hosted page → webhook capture →
  reservation commit), order history (signed). Assert the order reaches `completed`/`paid` and stock
  decrements. Drive an offline (cod) order through admin confirmation.
- **Tighten the proxy:** strip/plant the `token` from `auth/reset-password` into the `store_session_v2`
  cookie (login/register already handled; reset-password returns a fresh session token that currently
  reaches the browser — close it here).
- **Webhook-exempt verification:** confirm Paymob/Kashier webhook routes verify the PROVIDER signature
  (not the commerce gateway) and remain gateway-exempt (§4.2).
- Commerce stays DISABLED in production. F3 proves sandbox readiness; the operator enables per-tenant.

**Allowed:** tenant/provisioning data + scripts, sandbox config, the proxy reset-password strip, test
coverage for the sandbox flow. **Forbidden:** flipping production commerce on; migrations that drop
tables.

**Stop conditions:** sandbox end-to-end green (online capture + offline confirm); reset-password token
cookie-only; no provider webhook crosses the commerce gateway.

---

## Phase F4 — release runbook (depends on F3)

**Goal:** an operator can enable commerce for a tenant, rotate keys, monitor, and roll back.

**Scope:** a runbook doc under `docs/superpowers/` (or `docs/` per convention) covering: provision a
commerce tenant (settings + inventory + policies + gateway creds); enable the `commerce` feature;
rotate `COMMERCE_GATEWAY_KEY_ID/SECRET` (current/previous key rotation is supported by the verifier);
monitor (the E2 operational reports + the durable notification task); rollback (disable the feature
flag; legacy tables are retained this release so a flip-back is possible). Reference the §9 DoD as the
sign-off checklist.

**Allowed:** docs only. **Forbidden:** code changes (F4 is documentation).

**Stop conditions:** runbook reviewed against the F1–F3 state; §9 DoD checklist complete.

---

## Sequencing plan (serial)

1. **Before F1:** `git rev-parse HEAD` (must be `8c2853b` or descendant) + `git status --short` (only
   `docs/superpowers/**` dirty). Run the gate; stop if not green.
2. **F1** — run it (yourself or one agent; test-only allowlist). Gate. Commit
   `test(commerce): add plugin-cutover parity suite (Wave F1)`. **F1 MUST be green before F2 starts.**
3. **F2** — the bulk of the work; can fan out across (a) catalog, (b) D3 side-effect repoint, (c)
   adapter reconciliation, (d) legacy call-site/test retirement, with disjoint allowlists, BUT the
   `payload.config.ts` regen + final gate are the integration owner's alone. Gate. Commit serially,
   explicit paths only (e.g. `feat(commerce): repoint payment side-effects to store-* (Wave F2)`,
   `feat(commerce): browse catalog from store-products (Wave F2)`,
   `refactor(commerce): retire legacy runtime call-sites (Wave F2)`).
4. **F3** — sandbox end-to-end + proxy reset-password tighten. Gate. Commit
   `feat(commerce): wire sandbox release gates (Wave F3)`.
5. **F4** — runbook doc. Commit `docs(commerce): add release runbook (Wave F4)`.

Collapse small phases into fewer commits if trivial, but never collapse the F1→F2 gate.

## Agent context packet (give every spawned agent all fields)

```text
Task:
Objective:
Active branch: feat/multi-tenant
Recorded starting HEAD: <phase-start HEAD>
Shared checkout: the current one (no worktree)
Authoritative plan sections: §8, §9, §3.8, §3.9, §4.1, §4.2, §7
Allowed files: <phase allowlist above>
Forbidden files: <phase forbidden list + payload.config.ts (unless yours), migrations/index.ts (new
  files only; never edit applied), generated files, package manifests (unless gate-script edit),
  docs/superpowers/**, the other phases' files, all src/ storefront files (unchanged in F2)>
Forbidden git operations: git add/commit/branch/merge/cherry-pick/rebase/stash/reset/checkout/switch/restore
Input contracts: <the API/DB shapes from E3 + the plan>
Output contracts: <store-* document shapes; integer minor units; signed mutations>
Required tests: <phase test contract>
Stop conditions: gate green; if a forbidden file or an out-of-plan decision is required, STOP + report
Handoff format: Changed files / Commands+results / Plan items satisfied / Integration-owner edits
required / Blockers
```

## Mandatory rejection conditions (reject a handoff that…)
- removes a legacy collection DEFINITION or drops a historical table/migration this release (additive only);
- enables commerce (flips a tenant to live) before F3 sandbox/manual gates pass;
- bypasses tenant or feature access, or trusts browser totals;
- leaves a storefront mutation unsigned (cart writes, auth register/login, checkout);
- writes a raw secret or raw provider payload (hash only);
- starts F2 before F1 parity is green, or starts F3/F4 before the prior phase gates green;
- modifies a forbidden/shared file; omits focused tests / changed-file list / command results;
- regens `payload-types.ts`/`importMap.js` without committing the tracked `importMap.js`.

## Decisions / gotchas inherited (do not re-litigate)
- Permanent `store-*` slugs; plugin `inventory:false`; reservation layer keyed by normalized SKU.
- EGP only, integer minor units; browser totals never trusted; `quoteCart`/`computeQuote` authoritative.
- `withVerifiedCommerceGateway` is the ONLY code allowed `overrideAccess:true` for guest commerce.
- Migrations hand-written + additive; never edit applied historical migrations. "No such column" on a
  `store-*` insert → new ALTER migration + register in `cms/src/migrations/index.ts`.
- `payload-types.ts` gitignored; `importMap.js` tracked → `generate:types` then `generate:importmap`
  after any `payload.config.ts` touch.
- Windows libsql teardown flake tolerated (exit 3221225477, all subtests OK); new booting integration
  tests close `payload.db.drizzle.session.client` in `test.after`. Integration tests run with
  `cwd: cms` (`npx tsx --test tests/<file>` — running from repo root fails at `seedTenant`).
- Gateway signer vectors pinned in `cms/tests/commerce-gateway.test.ts` (VECTOR A `9745f4b1…010c6`,
  B `eeda5798…cbdd8`) + `src/lib/store/__tests__/gateway-sign.test.ts` — keep both green.
- `docs/superpowers/**` stays out of every commit. Stage explicit paths; verify with
  `git diff --cached --name-only`.
- The plugin cart ops (`addItem`/`updateItem`/`removeItem`/`clearCart`) hardcode `overrideAccess:false`
  and authorize via `req.context.cartSecret`; the verified handler reads each cart's secret
  (overrideAccess) and threads a `req` carrying it into every op.
- `loginCustomer`/`registerCustomer` return `body.token` (field name `token`); the proxy strips
  `o.sessionToken ?? o.token` for login/register — `reset-password` also returns `token` and is NOT yet
  stripped (F3 closes it).
- Legacy runtime models + the legacy quote/cart/checkout orchestration are read-only side-by-side
  until F2; they are removed only after F1 parity passes.

## Gate (must be green before each phase commit)
```
npm --prefix cms run typecheck && npm --prefix cms run test:commerce
npx tsc --noEmit          # from repo root; expect 0 errors under src/ and cms/src/commerce
```
Signer self-check: `cms/node_modules/.bin/tsx --test src/lib/store/__tests__/gateway-sign.test.ts` (5/5).
After any `payload.config.ts` touch: `npm --prefix cms run generate:types && npm --prefix cms run generate:importmap`, then verify `git status` shows `importMap.js` (tracked) staged and `payload-types.ts` NOT staged (gitignored).

## Completion report (return when done)
1. commit list mapped to phases; 2. phase/changed-files table; 3. changed files by domain;
4. test/build evidence (cms gate + root tsc + signer 5/5 + each phase's focused tests + sandbox
end-to-end for F3); 5. security-gate results (signed mutations; tokens cookie-only incl. reset-password
after F3; gateway-exempt provider webhooks; no legacy collection written by any live path after F2);
6. legacy call-sites removed vs. definitions/tables retained (additive); 7. blockers + exact next
command; 8. §9 DoD checklist progress. **Do not say "complete" unless every §9 DoD item passes and F3
sandbox end-to-end is green.** Note explicitly that historical tables are retained this release
(rollback path) and that production commerce is enabled by the operator, not by Wave F.
