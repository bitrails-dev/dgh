# Commerce release runbook (plugin-first cutover)

Plugin-first commerce went live across Waves B–F (`@payloadcms/plugin-ecommerce` owning products /
variants / carts / addresses / orders / transactions under permanent `store-*` slugs). This runbook
lets an operator **provision** a commerce tenant, **prove** it in sandbox, **enable** it for one
pilot tenant, **rotate** keys, **monitor**, and **roll back**.

Commerce is **disabled by default**. It is enabled per-tenant by the operator only after sandbox
passes. Production commerce is enabled by the operator — never by Wave F.

**Post-Wave-F state:** the live commerce runtime is entirely plugin-first (`store-*`); the legacy
runtime is retired from the live path (`cms/src/commerce/**` is grep-clean of legacy collection
writes). Legacy collection **definitions + historical DB tables are retained** this release for
rollback — no tables are dropped.

---

## 0. Prerequisites

- CMS running (`cd cms && pnpm dev`, port 3001) and Astro running (`pnpm dev`, 4321) with a
  reachable CMS (`CMS_URL`).
- **Commerce-gateway key pair** (Astro + CMS, identical): `COMMERCE_GATEWAY_KEY_ID`,
  `COMMERCE_GATEWAY_SECRET` — ≥32 random bytes, base64; must NOT reuse `PAYLOAD_SECRET` or provider
  secrets. Optional rotation pair: `COMMERCE_GATEWAY_PREVIOUS_KEY_ID`,
  `COMMERCE_GATEWAY_PREVIOUS_SECRET` (specify both or neither — half-specifying throws at boot).
- `COMMERCE_GIFT_CARD_PEPPER` (gift-card code hashing).
- **Sandbox provider creds** (env, sandbox only): `PAYMOB_API_KEY`, `PAYMOB_HMAC_SECRET`,
  `PAYMOB_IFRAME_ID`, `PAYMOB_INTEGRATION_ID`; `KASHIER_API_KEY`, `KASHIER_WEBHOOK_SECRET`,
  `KASHIER_MERCHANT_ID`.
- `COMMERCE_TAX_MODE` (default `exclusive`), `COMMERCE_SANDBOX=true` for sandbox.

Verify the gate before any enablement:
```
npm --prefix cms run typecheck && npm --prefix cms run test:commerce   # cms gate
npx tsc --noEmit                                                       # Astro src/ (in-scope 0 errors)
cms/node_modules/.bin/tsx --test src/lib/store/__tests__/gateway-sign.test.ts   # signer 5/5
```

## 1. Provision a commerce tenant

```
cd cms && npx tsx scripts/provision-commerce-tenant.ts --tenant <slug> [--currency EGP] [--help]
```

Idempotent (safe to re-run; fills gaps, never duplicates). Creates, all tenant-scoped:

- `commerce-settings` — EGP, tax mode, sandbox flag, order-number prefix.
- one `inventory-locations` row + `inventory-levels` stock for the sample products.
- `tax-zones` + `tax-rates` (standard rate), `shipping-zones` + `shipping-methods`, a sample
  `promotions` row, one `gift-cards` row (raw code printed **once** to stdout; only the hash is
  stored).
- sandbox gateway credentials written through the encrypted gateway-config path
  (`commerce-settings` AES-256-GCM-encrypts `paymob.apiKey`/`hmacSecret` and
  `kashier.apiKey`/`webhookSecret` on write).

The script **does not flip the `commerce` feature** — you do that in step 3.

## 2. Sandbox end-to-end (the manual gate — operator)

Drive the full flow against the sandbox tenant and confirm business outcomes:

1. **Browse** the catalog (store-products, published only, tenant-scoped).
2. **Signed add-to-cart** (plugin cart ops over `store-carts`; the Astro proxy signs every mutation).
3. **Online checkout** → provider **sandbox hosted page** → **webhook capture** → assert the order
   reaches `paid`/`completed` and **stock decrements** (Phase-1 reservation committed by normalized
   SKU).
4. **Order history** (signed; `x-session-token` bridged from the `store_session_v2` cookie).
5. **Offline (COD)** order → **admin confirm** → `commitOrderInventory` commits the reservation.

Provider webhooks verify the **provider** signature and are **gateway-exempt** (no
`X-Commerce-Gateway-*` headers required) — see `cms/tests/commerce-webhook-gateway-exempt.integration.test.ts`.

The **automated analog** is `cms/tests/commerce-release-flow.integration.test.ts` — a fake-adapter
test that proves the identical flow up to a **mocked** gateway capture (browse → cart → COD checkout
→ admin confirm → online checkout → mocked capture → reservation commit; no legacy writes). The
**live** online Paymob/Kashier capture against the real sandbox is the operator's manual gate and
**must be green before step 3**.

## 3. Enable commerce for the pilot tenant

Set the tenant's `features: ['commerce']` (admin UI or script). `resolveStoreTenant` enforces the
gate — every storefront commerce call returns 404 for a featureless tenant. Enable **one explicitly
approved tenant only**, and only after step 2 is green.

## 4. Rotate the commerce-gateway key

1. Set the **new current** pair (`COMMERCE_GATEWAY_KEY_ID` / `COMMERCE_GATEWAY_SECRET`).
2. Set the **old** pair as the previous pair (`COMMERCE_GATEWAY_PREVIOUS_KEY_ID` /
   `COMMERCE_GATEWAY_PREVIOUS_SECRET`).
3. Roll every Astro instance to the new current key. The CMS verifier accepts **both** during the
   overlap; Astro signs only with the current key.
4. Once all Astro instances use the new current key, **drop the previous pair**.

Half-specifying the previous pair (id without secret or vice-versa) throws at boot
(`GatewayKeyError`). Gateway-signer vectors are pinned in `cms/tests/commerce-gateway.test.ts` and
`src/lib/store/__tests__/gateway-sign.test.ts` — keep both green.

## 5. Monitor

- **E2 operational reports** (`cms/src/commerce/reports`): sales totals (by day/status/paymentState),
  reconciliation exceptions (transaction status ≠ matched), unpaid/expired orders, low stock,
  promotion usage, gift-card liabilities, failed notification jobs.
- **Durable `send-commerce-notification` task**: order-placed, payment-captured/failed/refunded
  notifications (bilingual; deduped by idempotency key; retried by Payload's bounded retry).
- **`payment-events`** ledger: append-only signed-event + retry ledger; duplicate/out-of-order/stale
  events are idempotent no-ops.

## 6. Rollback

- **Soft:** disable the tenant `commerce` feature — the storefront returns to non-commerce for that
  tenant, no data changes.
- **Deep (this release only):** legacy DB tables + collection definitions are retained, so a flip-back
  to the legacy read path is possible. Note: the legacy runtime was retired from registration in F2
  (commit `5f68fe6`); re-registering requires the F2 follow-up in §7 (repoint the multi-tenant plugin
  tenant-scoping + the plugin relationship field that still reference legacy slugs).

## 7. Known post-F follow-ups

- **Unregister the legacy collections** (`Products`/`Carts`/`Orders`/`Transactions`) — blocked because
  `@payloadcms/plugin-multi-tenant`'s tenant-scoping list and a plugin relationship field still
  reference those legacy slugs (removing the collections throws `InvalidFieldRelationship` at
  sanitize). Must repoint those references to `store-*` first. See the note in `cms/src/payload.config.ts`.
- **Restore order/payment-state transition enforcement on `store-orders`** — the legacy `Orders.ts`
  `beforeChange` hook retired with the runtime; the state machines (`orders/state.ts`,
  `payments/state.ts`) remain and are unit-tested, but there is no collection-level guard against
  illegal transitions. Add a `beforeChange` hook to the `store-orders` override.
- **Convert `commerce-carts-customers.test.ts`** to `store-carts` (it still exercises the legacy
  `carts` collection, which is registered-but-vestigial).

## 8. Definition of Done — plan §9 sign-off

| §9 item | Status |
| --- | --- |
| Payload ecommerce owns base products/variants/carts/addresses/orders/transactions | ✅ `store-*` |
| No parallel custom base model remains active | ✅ legacy retired (F2 `5f68fe6`) |
| Phase 1 inventory green, not reimplemented | ✅ |
| Plugin inventory disabled | ✅ |
| Paymob + Kashier work through plugin-backed orders/transactions | ⚠️ adapters plugin-aligned; **live sandbox capture = operator gate** |
| C-03 durable payment processing fixed | ✅ D3 job repointed to `store-*` (F2 `0be54cc`) |
| Customer auth uses Payload sessions, tenant-bound | ✅ gateway-signed |
| HMAC/nonce gateway tests pass | ✅ signer 5/5 + `commerce-gateway.test.ts` |
| Tax/shipping/promotion/gift-card policies persisted + server-authoritative | ✅ one `quoteCart` engine |
| Operational reports + durable notifications work | ✅ E1/E2 |
| Legacy data migration parity passes | ✅ F1 parity suite (`baa540f`) |
| Legacy tables remain recoverable for the cutover release | ✅ retained |
| Arabic/English storefront checkout passes | ⚠️ storefront switched in E3; **full Playwright AR/EN checkout = operator gate** |
| Empty + copied-real DB rehearsals pass | ⚠️ migrations run on temp DBs in tests; **full rehearsal = operator** |
| All security/build/sandbox/manual gates pass | ⚠️ code gates green; **live sandbox + manual = operator** |
| Commerce enabled only for the approved pilot tenant | ⚠️ disabled by default; **operator enables one** |

**Wave F is not "complete" until every ⚠️ item passes — those are the operator's sandbox + manual
gates (steps 2–3 above).** Historical tables are retained this release (rollback path); production
commerce is enabled by the operator, not by Wave F.

---

### Wave F commit map
`baa540f` F1 plugin-cutover parity suite · `7aed500` F2 store-products name field · `3202112` F2
catalog from store-products · `0be54cc` F2 payment side-effects to store-* · `5f68fe6` F2 retire
legacy runtime call-sites · `c702e04` F3 sandbox release gates (proxy reset-password strip,
webhook-exempt test, provisioning script, fake-adapter E2E).
