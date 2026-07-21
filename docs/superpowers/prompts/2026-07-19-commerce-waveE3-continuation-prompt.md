# Commerce Wave E3 continuation — orchestrator prompt (finish the signed plugin-first storefront)

**Written:** 2026-07-19 · **Branch:** `feat/multi-tenant` · **HEAD to start from:** `edbd6d1`
**Pick up fresh from here.** You are the integration owner for the deferred tail of Wave E3. This
completes the plugin-first storefront: signed CMS cart + orders endpoints, plugin-first quoting, auth
gateway signing, and proxy activation. Modeled on the Wave E orchestrator rules — delegation does not
transfer integration responsibility.

## Read these first (in this order)

1. `docs/superpowers/prompts/2026-07-19-commerce-waveE3-continuation-handoff.md` — the deferred-work
   capture (state, what + why, file pointers). This prompt is the executable companion to it.
2. `docs/superpowers/prompts/2026-07-19-commerce-waveE-handoff.md` — the Wave E owner doc (§3.7 cart,
   §4.1/§4.2 gateway, §7 E3, §9 DoD, "Decisions ALREADY MADE", "Known gotchas").
3. `docs/superpowers/prompts/2026-07-18-commerce-plugin-first-orchestrator-prompt.md` — integration-
   owner rules, forbidden files, agent context packet, rejection conditions, completion report.
4. `docs/superpowers/plans/2026-07-18-commerce-plugin-first-delivery-plan.md` — §3.7, §4.1/§4.2, §7 E3, §9.
5. This file.

Superseded/historical: every other `2026-07-1{7,8}-commerce-*` doc except the plan + orchestrator above.

## Where things stand (commits on `feat/multi-tenant`)

| Commit | Wave | What |
| --- | --- | --- |
| `7398c45` | E1 | durable `send-commerce-notification` task + modules |
| `6b58838` | E2 | operational commerce reports |
| `edbd6d1` | E3 (partial) | storefront UI + verified gateway signer + signed `/api/store/v2/*` proxy + `server.ts` helpers |

Gate on `edbd6d1`: `npm --prefix cms run typecheck && npm --prefix cms run test:commerce` green
(cms unchanged since E2). Astro/src: `npx tsc --noEmit` 0 src errors; gateway-signer self-check 5/5.

## Objective

Make the plugin-first storefront functional end-to-end and §4.1-compliant, then commit. Concretely:
the proxy's cart + orders areas currently return `501 not_wired` because their signed CMS endpoints do
not exist and the storefront quote path prices the wrong collection. Remove each 501 by landing the
backing endpoint + plugin-first pricing.

## What is deferred = the work (4 lanes + integration-owner seams)

### Lane A — plugin-first quote helper (FOUNDATIONAL; cart depends on it)
- The legacy helpers in `cms/src/commerce/store/shared.ts` (`quoteItems`/`resolvePricedLines`) read
  `products` (legacy). They cannot price `store-products`/`store-variants`.
- Read `cms/src/commerce/policies/quote-loader.ts` — `createPayloadQuoteCartLoader` is the authoritative
  plugin-first resolver over `store-carts`/`store-products`/`store-variants` + the C4 policy
  collections (the same loader `processCheckout` already uses). Expose a thin, directly-testable quote
  helper from it (e.g. `quoteStoreCart(payload, tenantId, cartId)`) returning the `{currency, snapshot,
  …}` shape the storefront expects (`quote.{currency, merchandiseSubtotal|subtotal, totalTax|tax,
  shippingTotal?, discountTotal?, grandTotal|amountDue}`).
- Wire it into `cms/src/commerce/store/quote.ts` (replace the legacy `quoteItems` call for the
  plugin-first path; legacy path stays read-only until F2). The Astro proxy already forwards `/quote`
  and passes the body through.
- **Allowed:** new plugin-first quote helper module + `quote.ts` edit + focused tests.
- **Forbidden:** `payload.config.ts`, `migrations/**`, generated files, `endpoints.ts` registry, the
  other lanes' files.

### Lane B — signed plugin cart endpoints (depends on Lane A)
- New `cms/src/commerce/store/cart-v2.ts` exporting `pluginCartEndpoints`. Integration-owner appends it
  to `commerceStoreEndpoints` in `cms/src/commerce/store/endpoints.ts`.
- Each handler: `withVerifiedCommerceGateway` (`cms/src/commerce/store/gateway.ts`) → read `cartId`
  from the verified body (POST/PATCH/DELETE) or query (GET) → call plugin ops exported from
  `@payloadcms/plugin-ecommerce`:
  - `addItem({ payload, cartsSlug: 'store-carts', cartID, item: { product, variant? }, quantity })`
  - `updateItem({ payload, cartsSlug, cartID, itemID, quantity })` — `quantity` 0 removes (`removeOnZero`)
  - `removeItem({ payload, cartsSlug, cartID, itemID })`
  - `clearCart({ payload, cartsSlug, cartID })`
  - Return `CartOperationResult = { cart, message, success }` (types:
    `@payloadcms/plugin-ecommerce/dist/collections/carts/operations/types.d.ts`).
- Resolve storefront SKU → `{product, variant?}` via `resolveSellableBySku({ payload, tenantId, sku })`
  (`cms/src/commerce/inventory/sku-resolution.ts:161` → `{ ok, sellable:{ kind, sku, productId,
  variantId? } }`). **No `mergeCart` op is exported** (only its endpoint) — skip merge-on-login.
- **Guest-cart lifecycle:** `addItem` requires `cartID`. First add with no cookie → create a
  `store-carts` doc (guest = no `customer`; `allowGuestCarts:true` is set) → use its id as `cartID` →
  return `cartId` so the Astro proxy plants the `store_cart_v2` cookie (helpers already in
  `src/lib/store/server.ts`). `GET /cart` with no cartId → empty cart `{cartId:'', items:[], quote:null}`.
- **Cart totals:** use Lane A's helper (NOT legacy `quoteItems`). Response shape:
  `{cartId, items:[{sku, quantity, product?}], quote, quoteError?}`.
- **Allowed:** `cart-v2.ts` + focused tests (boot Payload: signed add/update/remove/clear via plugin
  ops + `resolveSellableBySku`; cart totals from Lane A's loader).
- **Forbidden:** `endpoints.ts` (registry — integration-owner's), `payload.config.ts`, `migrations/**`,
  generated files, `quote.ts` (Lane A's), the proxy, Lane C/D files.

### Lane C — orders endpoint + session bridge (independent)
- No orders endpoint exists. New `cms/src/commerce/store/orders.ts` exporting `orderEndpoints`
  (`GET /commerce/store/:tenantSlug/orders` + `GET .../orders/:orderNumber`), appended by the
  integration-owner. Tenant-scoped reads over `store-orders`; money integer minor units.
- **Customer bridge (important):** the gateway verifier resolves the customer from `req.user`, but
  storefront auth conveys the session via the `x-session-token` header (see `auth.ts` →
  `readCustomerMe(payload, token, tenantId)`). The handler must resolve the customer from
  `x-session-token` (reuse the customer-auth token resolver), then filter `store-orders` by
  `{ tenant, customer }`. Also confirm the session-token field name the Astro proxy strips
  (`sessionToken`/`token` in `src/pages/api/store/v2/[...path].ts`) matches what
  `loginCustomer`/`registerCustomer` actually return — align if not.
- **Allowed:** `orders.ts` + focused tests.
- **Forbidden:** the registry, `payload.config.ts`, `migrations/**`, generated files, other lanes.

### Lane D — auth gateway signing (§4.1 compliance; independent)
- `cms/src/commerce/store/auth.ts` currently uses `resolveStoreTenant` (UNSIGNED). register/login are
  storefront MUTATIONS → route every auth handler through `withVerifiedCommerceGateway` (it stashes
  the tenant on `req.commerceTenantID`/`req.tenantID`). Preserve the existing token-in-body behavior
  the Astro proxy strips (`sessionToken`/`token`).
- Commerce is DISABLED today so this is not live exposure — but it must close before F3 enables it.
- **Allowed:** `auth.ts` + focused tests.
- **Forbidden:** the registry, `payload.config.ts`, `migrations/**`, generated files, other lanes.

### Integration-owner seams (yours alone)
- Append `pluginCartEndpoints` + `orderEndpoints` to `commerceStoreEndpoints` in
  `cms/src/commerce/store/endpoints.ts`.
- **Proxy activation:** once Lane B lands, drop the cart/orders `501` in
  `src/pages/api/store/v2/[...path].ts` and re-add the cart-cookie block (inject `cartId` from the
  `store_cart_v2` cookie into cart bodies; plant/clear the cookie from the response `cartId`). The
  cookie helpers (`getCartIdV2`/`setCartIdV2`/`clearCartIdV2`) already exist in `src/lib/store/server.ts`.
- After any `payload.config.ts` touch: `npm --prefix cms run generate:types && generate:importmap`
  (`payload-types.ts` gitignored; `importMap.js` tracked). Cart/orders endpoints are NOT `payload.config`
  changes (they're `endpoints.ts`), so no regen expected — verify with `git status`.
- Add focused tests to the right gate script: pure unit → `test:commerce:unit` in `cms/package.json`;
  booting integration → `cms/scripts/run-commerce-integration-tests.mjs` `INTEGRATION_FILES` (+ close
  `payload.db.drizzle.session.client` in `test.after` — Windows libsql teardown).

## Spawn plan (Lane A first, then B/C/D parallel — same discipline as Wave E)

1. **Before spawning:** `git rev-parse HEAD` (must be `edbd6d1` or descendant) + `git status --short`
   (only `docs/superpowers/**` dirty). Run the gate; stop if not green.
2. **Lane A** (foundational) — run it first (one agent, or yourself). Wait for it, commit (or stage),
   because Lane B depends on its quote helper. Gate.
3. **Lanes B, C, D in parallel** from the post-A HEAD — three writing agents, disjoint allowlists,
   same branch + HEAD + checkout. Hand each the full agent context packet (below).
4. **Fan-in:** verify disjoint paths + within allowlists; reject any mandatory-rejection hit; inspect
   the combined diff.
5. **Wire the integration-owner seams** (endpoint registration + proxy activation).
6. **Gate** (cms typecheck + `test:commerce`; Astro `npx tsc --noEmit` 0 src errors; signer 5/5).
7. **Commit serially**, explicit paths only (NEVER `docs/superpowers/**`):
   - `feat(commerce): add plugin-first storefront quote (Wave E3 cont.)`  (Lane A)
   - `feat(commerce): wire signed plugin cart endpoints (Wave E3 cont.)`  (Lane B + registry + proxy cart activation)
   - `feat(commerce): add signed orders endpoint (Wave E3 cont.)`         (Lane C + registry)
   - `feat(commerce): sign storefront auth endpoints (Wave E3 cont.)`     (Lane D)
   (Collapse into fewer commits if a lane is small — but keep the cms gate green before each.)

## Agent context packet (give every spawned agent all fields)

```text
Task:
Objective:
Active branch: feat/multi-tenant
Recorded starting HEAD: <post-A HEAD>
Shared checkout: the current one (no worktree)
Authoritative plan sections: §3.7, §4.1, §4.2, §7 E3, §9
Allowed files: <lane allowlist above>
Forbidden files: <lane forbidden list + payload.config.ts, migrations/index.ts, endpoints.ts (unless
  yours), generated files, package manifests, the other lanes' files, all src/ storefront files>
Forbidden git operations: git add/commit/branch/merge/cherry-pick/rebase/stash/reset/checkout/switch/restore
Input contracts: <the API shapes above>
Output contracts: <response shapes above>
Required tests: <focused test per the lane>
Stop conditions: gate green; if a forbidden file or an out-of-plan decision is required, STOP + report
Handoff format: Changed files / Commands+results / Plan items satisfied / Integration-owner edits
required / Blockers
```

## Mandatory rejection conditions (reject an agent handoff that…)
- reimplements Phase 1 / enables plugin inventory / creates parallel product/cart/order collections;
- changes permanent `store-*` slugs; bypasses tenant or feature access; trusts browser totals;
- swallows retryable errors / stores raw secrets or raw provider payloads;
- leaves a storefront mutation unsigned (cart writes, auth register/login);
- modifies a forbidden/shared file; omits focused tests / changed-file list / command results.

## Decisions / gotchas inherited (do not re-litigate)
- Permanent `store-*` slugs; plugin `inventory:false`; reservation layer keyed by normalized SKU.
- EGP only, integer minor units; browser totals never trusted; `quoteCart` is authoritative.
- `withVerifiedCommerceGateway` is the ONLY code allowed `overrideAccess:true` for guest commerce.
- Migrations hand-written + additive; never edit applied historical migrations. "No such column" on a
  `store-*` insert → new hand-written ALTER migration + register in `cms/src/migrations/index.ts`.
- `payload-types.ts` gitignored; `importMap.js` tracked → `generate:types` then `generate:importmap`
  after `payload.config.ts` touches.
- Windows libsql teardown flake tolerated (exit 3221225477, all subtests OK); new booting integration
  test closes `payload.db.drizzle.session.client` in `test.after`.
- Gateway signer vectors pinned in `cms/tests/commerce-gateway.test.ts` (VECTOR A `9745f4b1…010c6`,
  B `eeda5798…cbdd8`) + `src/lib/store/__tests__/gateway-sign.test.ts` — keep both green.
- `docs/superpowers/**` stays out of every commit. Stage explicit paths; verify with
  `git diff --cached --name-only`.
- Legacy runtime models (`Products.ts`, `Carts.ts`, `Orders.ts`, `Transactions.ts`, legacy cart/order
  ops) are NOT removed here — that's F2. Read-only side-by-side until then.

## Gate (must be green before each commit)
```
npm --prefix cms run typecheck && npm --prefix cms run test:commerce
npx tsc --noEmit   # from repo root; expect 0 errors under src/
```
Signer self-check: `cms/node_modules/.bin/tsx --test src/lib/store/__tests__/gateway-sign.test.ts` (5/5).

## Completion report (return when done)
1. commit list mapped to lanes; 2. agent/lane/changed-files table; 3. changed files by domain;
4. test/build evidence (cms gate + src tsc + signer 5/5 + each lane's focused tests);
5. security-gate results (signed mutations: cart + checkout + auth; tokens cookie-only; gateway-exempt
   webhooks); 6. retained custom modules / removed duplicates; 7. blockers + exact next command;
8. §9 DoD checklist progress. **Do not say "complete" unless every §9 DoD item passes** — and note that
the D3 side-effect bundle is still repointed to store-* at F2 (out of scope here).

## After this → Wave F (serial)
F1 (plugin cutover parity tests) → F2 (remove legacy runtime models + repoint D3 side-effects to
`store-*` + reconcile adapter `initiatePayment`/`confirmOrder` to the plugin cart) → F3 (release gates)
→ F4 (release runbook). Re-read the orchestrator's Wave F section first. Never remove legacy runtime
models before F1 parity passes; never drop historical tables this release; never enable commerce before
F3 + sandbox/manual gates pass.
