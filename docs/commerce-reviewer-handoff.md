# Commerce Feature — Reviewer Handoff

**Purpose:** Single document summarizing every commerce feature change, the reasoning behind each
decision, and a structured catalog of bugs / dangers / risks for an independent reviewer model to
validate logic and catch mistakes. Read top-to-bottom. Every code claim cites a `file:line` under
`C:\Users\mrt\Desktop\dgh`.

**As-of date:** 2026-07-21 · **Branch:** `feat/multi-tenant` · **Base commit:** `759a139`
· **Diff vs `main`:** 556 files, +138 855 / −1 837 lines.

**Repository shape:**
- Root = Astro storefront (`/`, port 4321). Vue islands under `src/components/shop/`. Gateway signer
  in `src/lib/store/`. BFF proxy at `src/pages/api/store/v2/[...path].ts`.
- `cms/` = Payload CMS (`next dev -p 3001`). Commerce runtime under `cms/src/commerce/` (22 modules).
  Plugin overrides under `cms/src/commerce/plugin/overrides/`. Tests under `cms/tests/` (≈47
  commerce-specific files + tenant tests).

---

## PART 1 — Scope & Architecture

### 1.1 What was built

A plugin-first, multi-tenant ecommerce surface over `@payloadcms/plugin-ecommerce` (v3.85.1),
cutover from a legacy custom model. The legacy `Products`/`Carts`/`Orders`/`Transactions`
collections are **retained for rollback** (tables + definitions) but the runtime that wrote them is
retired (grep-verified). The live surface is the plugin-owned `store-*` slugs.

**Owned slugs** (`cms/src/commerce/plugin/slugs.ts:14-24`) — 8 plugin collections under permanent
collision-free `store-*` slugs:

| Slug | Role |
|---|---|
| `store-products` | Catalog parent (with Wave F2 `name` field) |
| `store-variants` | Variant child docs |
| `store-variant-types` / `store-variant-options` | Variant grouping taxonomy |
| `store-carts` | Guest + customer carts (signed) |
| `store-addresses` | Shipping/billing addresses |
| `store-orders` | Order docs (immutable quote snapshot) |
| `store-transactions` | Per-payment provider transaction rows |

Plus 8 **policy collections** backing the server-authoritative quote engine:
`tax-zones`, `tax-rates`, `shipping-zones`, `shipping-methods`, `promotions`,
`promotion-redemptions`, `gift-cards`, `gift-card-ledger`.

Plus 5 **inventory collections** (Phase-1 reservation system, owned by `cms/src/commerce/inventory/`):
`inventory-locations`, `inventory-levels`, `stock-movements`, `stock-reservations`,
`inventory-transfers`.

Plus 2 **operational collections**: `commerce-settings` (per-tenant config + encrypted gateway
creds), `payment-events` (idempotent provider-event ledger).

### 1.2 Trust model

```
Browser  ──(cookies only)──▶  Astro BFF  ──(HMAC-signed)──▶  Payload CMS  ──(provider-signed)──▶  Webhooks
                                  │                              │
                          signs every mutation        verifies sig, then resolves tenant
                          never sends prices           server-authoritative quote engine
                          holds gateway secret         tenant-isolated by `tenant_id` everywhere
```

- **Astro → CMS:** HMAC-SHA256 over canonical `v1\nMETHOD\npath?query\ntenant\ntimestamp\nnonce\nbody_hash`.
  Headers `X-Commerce-Gateway-{KeyId,Timestamp,Nonce,Signature}`. Nonce is `crypto.randomUUID()`.
- **Provider → CMS:** provider-native HMAC (Paymob SHA-512 over 20 fields; Kashier SHA-256 over 10
  fields). Webhooks are **gateway-exempt** (no `X-Commerce-Gateway-*` required).
- **CMS internal:** every `payload.create` writes `tenant: tenantId` from the verified context;
  every `find` carries a tenant `where`. Cross-tenant reads fail to match (no oracle).

### 1.3 The 10-step checkout (`cms/src/commerce/checkout/process.ts:163-439`)

1. Resolve tenant (already verified upstream).
2. Load `commerce-settings`.
3. Validate idempotency key (RFC-4122 v4).
4. Replay check by `checkoutKey`.
5. Quote the cart server-side (`quoteCart`).
6. Reserve inventory by normalized SKU (Phase-1 atomic conditional UPDATE).
7. Allocate order number (per-tenant, drizzle IMMEDIATE tx).
8. Create `store-orders` doc with immutable `quoteHash` + `quoteSnapshot`.
9. For online methods: create `store-transactions` row + call `adapter.createHostedCheckout`.
10. Insert `payment-events` row (`initiate:${cartId}`), back-link transaction→order.

Offline (COD) methods skip 9 and await admin confirmation.

---

## PART 2 — Implementation Changes by Wave

The work is organized into Waves B–F. Each wave is a set of commits; the key ones are listed with
their reasoning.

### Wave B — Plugin cutover (foundation)
- **`@payloadcms/plugin-ecommerce` registered** with `slugMap` AND explicit `slug: 'store-<x>'` on
  every override (`payload.config.ts:221-357`). **Reason:** `slugMap` alone does not rename
  collections — without the per-override `slug`, the plugin still emits `products`, `carts`, etc.
  and collides with the legacy definitions.
- **Plugin order fixed:** ecommerce → multiTenant → tenantFeatureAccess. **Reason:** the feature
  gate wraps access that the multi-tenant plugin injects; reversing the order silently neuters the
  gate (the invariant test relies on this order but does NOT explicitly assert it — see Risk C7).
- **Legacy collections kept registered.** **Reason:** `cms/src/collections/commerce/Transactions.ts:42`
  has `relationTo: 'orders'` (legacy slug); removing `Orders` throws `InvalidFieldRelationship` at
  sanitize. This is the documented "B1 blocker" — unregistering requires repointing that field +
  removing the slugs from `multiTenantPlugin.collections` (`payload.config.ts:280-284`).

### Wave C — Policies + inventory
- **Server-authoritative quote engine** (`cms/src/commerce/policies/quote.ts`). Pure function
  `computeQuote(input)` + async loader-bound `quoteCart`. **Reason:** client prices are never
  trusted; the storefront posts only `{sku, quantity}` and the engine resolves `priceInEGP` +
  `taxClass` server-side. Money is integer EGP minor units; percentages are basis points; the only
  division is half-up rounding in `divRoundHalfUp`.
- **Phase-1 inventory** by normalized SKU (not doc id). **Reason:** SKU is the stable business key;
  doc ids are adapter-internal. Reservation is a single atomic conditional UPDATE
  (`UPDATE inventory_levels SET reserved = reserved + ? WHERE id = ? AND (on_hand - reserved) >= ?`)
  inside a drizzle IMMEDIATE transaction with SQLITE_BUSY retry — oversell-proof.
- **Policy collections** (`tax-zones`/`rates`, `shipping-zones`/`methods`, `promotions`,
  `promotion-redemptions`, `gift-cards`, `gift-card-ledger`). **Reason:** persistence backing the
  quote engine; redeemable quotable state has to survive restarts.

### Wave D — Checkout + payments
- **`processCheckout` orchestration** (10 steps above). Idempotency via unique `(tenant_id,
  checkout_key)` partial index; replay (same key + same fingerprint) → 200 `replayed:true`; conflict
  (same key + different fingerprint) → 409.
- **Paymob + Kashier adapters** (`cms/src/commerce/payments/adapters/{paymob,kashier}.ts`).
  Provider-native signature verification, constant-time compare, redaction of card fields.
- **Idempotent ledger** (`cms/src/commerce/payments/events.ts`). `INSERT ... ON CONFLICT(tenant_id,
  gateway, provider_event_id) DO NOTHING`. Duplicate provider events are no-ops.
- **`bank_installments` dropped from Kashier `allowedMethods`** (commit `4ba823b`, riba/Sharia).
  Verified at `kashier.ts:233` — `allowedMethods: 'card,wallet'`. **Never re-add.**

### Wave E — Operations
- **Durable notifications** (`cms/src/commerce/notifications/`). `send-commerce-notification` task
  fires on order-placed + payment-captured/failed/refunded. Bilingual (AR/EN), deduped by
  idempotency key, retried by Payload's bounded retry (5× exponential 2s).
- **Operational reports** (`cms/src/commerce/reports/`). Sales totals, reconciliation exceptions,
  unpaid/expired orders, low stock, promotion usage, gift-card liabilities, failed notification jobs.

### Wave F — Plugin-first cutover completion
- **F1** (`baa540f`) plugin-cutover parity suite.
- **F2** (`7aed500`…`5f68fe6`) catalog from `store-products`; payment side-effects repointed to
  `store-*`; legacy runtime call-sites retired.
- **F3** (`c702e04`) sandbox release gates (proxy reset-password strip, webhook-exempt test,
  provisioning script, fake-adapter E2E).
- **F4** (`6b4842b`) release runbook.

### Post-F operator-gap fixes (2026-07-21)
- **`a29aeeb`** — Gate `store-*` (8) and policy (8) collections on the `commerce` feature. **Reason:**
  these 16 collections were registered with `multiTenantPlugin` but missing from
  `TENANT_COLLECTION_FEATURES`, so tenant-admins of **non-commerce** tenants could see/edit them and
  the `tenant` list column stayed hidden for super-admin aggregate views. Fix adds all 16 to the gate
  map (`cms/src/plugins/tenantFeatureAccess.ts:55-82`).
- **Invariant test** (`cms/tests/tenant-feature-gating-invariant.test.ts`). **Reason:** this exact
  omission has bitten 3× (legacy → store-* → policies). Test fails at PR time if the gate map and
  `multiTenantPlugin.collections` diverge.
- **`5b6e22e`** — Declare the per-User→Tenant `commercePermissions` field via
  `tenantsArrayField.rowFields` and stamp role-based defaults in `enforceUserScope`
  (`cms/src/access/userAccess.ts:56-83`). **Reason:** the field was read by
  `cms/src/commerce/plugin/access.ts:55-84` (`isCommerceAdmin`) but never declared, so every
  tenant-admin except super-admin had `isCommerceAdmin() === false` → no "Add product" CTA, drafts
  hidden. Migration `20260721_140149_commerce_permissions_field` (with `.json` snapshot sibling)
  creates the join table and idempotently backfills by role. An explicit value (including `[]`) is
  never overwritten.

---

## PART 3 — Key Decisions & Reasoning

| # | Decision | Reasoning |
|---|---|---|
| D1 | **Plugin-first over custom model** | The legacy custom `Products/Carts/Orders/Transactions` was reimplementing what
  `@payloadcms/plugin-ecommerce` already owns (variants, addresses, carts, orders, transactions). Cutover
  reduces surface area; legacy retained for one release as rollback path. |
| D2 | **Server-authoritative quote** | Browser cannot be trusted with prices/totals. The quote engine recomputes from
  `priceInEGP` server-side; `quoteHash` freezes the agreement at order placement. |
| D3 | **Phase-1 reservation by SKU** | Doc ids are adapter-internal; SKU is the business key. Atomic conditional UPDATE prevents
  oversell under concurrency. |
| D4 | **`paymentState` on `store-orders` is NOT collection-guarded** | Only `status` and `fulfillmentState` are. **Documented reasoning** (commit `0351452`,
  `store-orders.ts:192-200`): paymentState is a singly-written ledger projection driven by the D3 payment
  job; its value space (`'cancelled'`, no `'voided'`/`'disputed'`/`'partially_*'`) doesn't match
  `payments/state.ts`. **⚠️ This reasoning is now FALSE — see HIGH RISK P1.** |
| D5 | **Kashier `bank_installments` excluded** | Riba (Sharia). Hard exclusion at `kashier.ts:233`. |
| D6 | **Legacy collections retained** | Rollback safety for one release. B1 follow-up unregisters them after repointing the
  `Transactions.order` relationship. |
| D7 | **Webhooks gateway-exempt** | The provider's own HMAC is the trust anchor; requiring the gateway signature would break the
  webhook flow (the provider cannot mint our nonce). |
| D8 | **String cartId → number coercion** (commit `6a3a21f`) | Cookies carry string cartId; `store-transactions.cart` is a numeric relationship. Coerced at
  `process.ts:317` via `Number(input.cartId)`. **⚠️ Unguarded — see MED RISK S5.** |
| D9 | **Idempotency-Key RFC-4122 v4 only** | Stable, unique, verifiable. Validated at both the Astro proxy and the CMS. |
| D10 | **Two-stage commerce toggle (planned, NOT implemented)** | Today only super-admin can flip `features`. Decision 2026-07-21: move to a two-stage toggle
  (`commerceAllowed` super-admin grant + tenant-admin self-flip) — tracked separately. |

---

## PART 4 — BUGS / DANGERS / RISKS (for the reviewer)

Findings consolidated from five parallel deep audits of the CMS checkout/store, payments/webhooks,
policies/inventory/gateway, config/migrations, and Astro storefront. Severity tags:
**[CRITICAL]** / **[HIGH]** / **[MED]** / **[LOW]**. Each cites `file:line`.

> **The reviewer's job:** confirm each finding is real (not a false positive), assess severity in
> the actual deployment context, and decide fix-vs-accept. The most dangerous are flagged ★.

### 4.1 CRITICAL — Must fix before pilot enablement

#### ★ C1 — Gift-card redemption is NEVER committed to the ledger
- **Where:** `cms/src/commerce/policies/giftcards.ts:144,174` define `redeemForOrder` /
  `refundForOrder` / `validateForRedemption` — **none are called anywhere** in `cms/src` (grep
  returns only definitions).
- **Effect:** `processCheckout` writes `quote.giftCardApplied` onto the order row
  (`checkout/process.ts:378`) and the customer pays `amountDue = grandTotal − giftCardApplied` to the
  gateway — **but the gift card's balance is never debited and the ledger has no record.** The same
  card can be reused indefinitely across checkouts.
- **Root cause:** `cms/src/commerce/policies/repositories.ts` requires
  `api: PolicyFindApi & GiftCardLedgerTxnApi`, but the only production caller
  (`cms/src/commerce/policies/quote-loader.ts:95`) passes `payloadFindApi(payload) as never` — which
  provides only `find`. The `as never` hides the missing `insertLedgerAndUpdateBalance`.
- **Reviewer action:** confirm via `grep -rn "redeemForOrder\|refundForOrder\|validateForRedemption" cms/src`.
  If zero non-definition hits, this is a hard blocker.

#### ★ C2 — Promotion redemption is NEVER committed; quotas are decorative
- **Where:** `cms/src/commerce/policies/promotions.ts:206-219` — `releaseRedemptionsForOrder` is a
  stub returning `docs.length` (does NOT delete). There is no `recordRedemption` method at all.
- **Effect:** `totalUsageLimit` and `perCustomerLimit` are computed for eligibility display but
  never decremented. A single-use promo can be redeemed infinitely.
- **Reviewer action:** `grep -rn "recordRedemption\|createRedemption" cms/src/commerce`.

#### ★ C3 — Gift-card issuance has NO flow
- **Where:** `cms/src/commerce/policies/collections/GiftCards.ts:45` — `create/update/delete` access
  all return `false`. There is no admin endpoint or system flow with `overrideAccess: true` to create
  a card.
- **Effect:** Gift cards cannot be created in v1 except by the provisioning script
  (`cms/scripts/provision-commerce-tenant.ts`) which seeds exactly one sandbox card. Operators have
  no production issuance UI.

#### ★ C4 — Catalog and quote endpoints have NO gateway signature verification
- **Where:** `cms/src/commerce/store/catalog.ts:253-279` and `cms/src/commerce/store/quote.ts:13-40`
  call only `resolveStoreTenant`; never `withVerifiedCommerceGateway`. The `quote.ts:8` comment
  claims "Gateway-signed by the Astro proxy upstream" but no verification is performed server-side.
- **Effect:** Anyone can hit `/commerce/store/:tenant/quote` with arbitrary SKUs; each triggers 1+
  tenant-scoped DB reads. No rate limit. Unauthenticated price-probing + load amplification. Catalog
  browsing is arguably public; the quote endpoint is not.
- **Reviewer action:** decide whether quote should be signed or rate-limited (or both).

#### ★ C5 — V2 proxy has NO CSRF protection and NO rate limiting
- **Where:** `src/pages/api/store/v2/[...path].ts` — `checkCsrf` called zero times; `rateLimit`
  never invoked. The v1 routes DO have both.
- **Effect:** login/registration/checkout/quote are unthrottled at `/api/store/v2/*`.
  `SameSite=Lax` mitigates naive CSRF but not same-site subdomain attacks or older browsers.
- **Reviewer action:** confirm `src/pages/api/store/v2/[...path].ts` should mirror v1's CSRF + rate
  limit posture.

### 4.2 HIGH

#### ★ H1 — `paymentState` guard claim is FALSE; multiple unguarded writers
- **Where:** `cms/src/commerce/plugin/overrides/store-orders.ts:192-200` comment claims
  `setStoreOrderPaymentState` is the only writer of `paymentState`. **Not true:**
  `cms/src/commerce/payments/adapters/paymob.ts:862` and
  `cms/src/commerce/payments/adapters/kashier.ts:826` write `paymentState` directly in
  `confirmOrder`, bypassing `mapPaymentStateForOrder`.
- **Effect:** `voided`/`disputed` writes will be rejected by the select field options (400);
  `partially_*` writes succeed silently. The D4 decision's safety argument collapses.
- **Reviewer action:** the "ponytail upgrade" (purpose-built order-paymentState table) is now
  necessary, not optional.

#### H2 — Plugin webhook tenant resolution is GLOBAL (cross-tenant collision)
- **Where:** `cms/src/commerce/payments/adapters/kashier.ts:893-897` — `findInTenant` called WITHOUT
  a tenant filter, only `{ providerOrderReference: { equals: merchantReference } }`.
- **Effect:** if two tenants share a merchantOrderId scheme, the first transaction found wins. The
  Phase-1 webhook (`payments/webhook.ts`) is safe (tenant from URL slug); the plugin webhook at
  `/api/payments/kashier/webhooks` is not.
- **Reviewer action:** confirm whether the plugin webhook path is exposed; if so, add tenant filter.

#### H3 — Customer identity taken from `req.user` without checking `user.collection`
- **Where:** `cms/src/commerce/store/gateway.ts:129-131`.
- **Effect:** a logged-in admin (the `users` collection) hitting a signed endpoint would have their
  user id written into `store-orders.customer` / `store-transactions.customer`
  (`process.ts:331`, `process.ts:387`).
- **Fix:** check `user.collection === 'customers'` before trusting `user.id`.

#### H4 — `reservationTtlMs` is client-controllable with no upper bound
- **Where:** `cms/src/commerce/checkout/process.ts:231` — `input.reservationTtlMs ?? DEFAULT`.
- **Effect:** a signed request can supply `reservationTtlMs: 9_999_999_999` and hold inventory
  indefinitely. Combined with offline (COD) orders (no automatic release), this is an
  inventory-hoarding DoS.

#### H5 — Concurrent same-key idempotency races orphan provider sessions
- **Where:** `cms/src/commerce/checkout/process.ts:184-187` (replay read) → `:362` (unique-constrained
  create). Between them: allocate order number, reserve inventory, call
  `adapter.createHostedCheckout` (real provider network call at `:286`), insert transaction, insert
  payment event.
- **Effect:** the loser's `payload.create` throws → `releaseOrder` (`:392`) — but the loser's hosted
  checkout session at the provider is orphaned and its `providerSessionId` leaked. The DB unique
  index is the only thing preventing a duplicate order.

#### H6 — `providerEventId` collides on cartId reuse
- **Where:** `cms/src/commerce/checkout/process.ts:346` — `providerEventId: 'initiate:${cartId}'`.
- **Effect:** two legitimate checkouts of the same cart (abandon + recheckout) collide on the
  `(tenant, gateway, provider_event_id)` unique index; the second's ledger row is silently dropped
  (swallowed at `:341-354`). Mischaracterized as "replay."

#### H7 — Reconciliation cutoff format is broken
- **Where:** `cms/src/commerce/payments/events.ts:350-356` — cutoff `'2026-07-21 10:00:00Z'` vs
  stored `'2026-07-21T10:00:00.000Z'`. Space (0x20) < `T` (0x54), so the age comparison returns false
  for nearly all rows.
- **Effect:** dormant when `minAgeSeconds=0` (default); breaks any age-gated sweep.

#### H8 — `disputed` payment state never releases inventory
- **Where:** `cms/src/commerce/payments/job.ts:160` — release only on `failed|voided|refunded`.
  `disputed` is a no-op (`:164`).
- **Effect:** chargeback dispute leaves stock committed forever with no operator signal. No automatic
  scheduler exists for `reprocessUnprocessed`.

#### H9 — Transaction handler overwrites cumulative `refundedAmount` with event-local amount
- **Where:** `cms/src/commerce/payments/job.ts:97-101`.
- **Effect:** on a partial-refund event, the prior cumulative total is lost. `state.ts:applyRefund`
  accumulates correctly but `job.ts` bypasses it. Multiple partial refunds lose accounting.

#### H10 — Kashier `confirmOrder` soft-fails ALL lookup errors
- **Where:** `cms/src/commerce/payments/adapters/kashier.ts:758-760`.
- **Effect:** catches 401/5xx alongside genuine 404s, stays `pending`, and proceeds to create the
  order in `processing`. Customer sees "confirmed" with unknown payment state.

#### H11 — Plugin webhook `providerEventId` fallback collides
- **Where:** `kashier.ts:291-292` (`transactionId || ${orderId}:${paymentStatus}`) and
  `paymob.ts:519` (`obj.id ?? String(obj.order)`).
- **Effect:** when the provider omits a unique transaction id, two same-status events for the same
  order dedupe; a legitimate second capture is silently dropped.

#### H12 — Silent enqueue failure in webhook ingestion
- **Where:** `cms/src/commerce/payments/webhook.ts:104-112` — `try/catch` swallows
  `payload.jobs.queue` errors.
- **Effect:** the event is durably inserted (`processed=0`) but the worker is never told. ACK 200
  with side-effect chain never running. Recovery depends on operator-triggered
  `reprocessUnprocessed` with no automatic scheduler.

### 4.3 MEDIUM

#### M1 — `validateForRedemption` never called; revoked/expired cards still reduce `amountDue`
- **Where:** `cms/src/commerce/policies/quote-loader.ts:730-736` — sets
  `giftCardApplied = giftCard.row.balance` straight off the row, never invoking
  `validateForRedemption`. `computeQuote` only does
  `Math.max(0, Math.min(input.giftCardApplied ?? 0, grandTotalMinor))` (`quote.ts:544`).
- **Effect:** a revoked or expired gift card still reduces `amountDue` in the quote.

#### M2 — Anonymous `perCustomerLimit` collapses to one tenant-wide bucket
- **Where:** `quote-loader.ts:243-247` — every anonymous checkout without a gift card hashes to the
  same identity (`${tenantId}|guest:anon`).
- **Effect:** `perCustomerLimit: 1` becomes "one anonymous redemption per tenant across all
  anonymous customers, ever" — or (given C2) never triggers at all.

#### M3 — Promotion code normalization mismatch
- **Where:** save hook `Promotions.ts:38` does `trim().toUpperCase().replace(/\s+/g, '-')`; lookup
  `promotions.ts:159` does `trim().toUpperCase()` only.
- **Effect:** admin saves `SUMMER SALE` → stored `SUMMER-SALE`; customer types `SUMMER SALE` →
  normalized `SUMMER SALE` → no match.

#### M4 — Previous gateway key rotation has NO expiry
- **Where:** `cms/src/commerce/gateway/keys.ts:66-71` + `verify.ts:90-92`.
- **Effect:** once `COMMERCE_GATEWAY_PREVIOUS_KEY_ID` is set, it is accepted indefinitely. A
  compromised previous key grants signing ability until ops removes the env var.

#### M5 — Cart-view quote uses empty shipping address; can diverge from checkout
- **Where:** `quote-plugin.ts:94` passes `shippingAddress: {}`.
- **Effect:** if a tenant configures a tax zone with a country filter, cart view shows no tax while
  checkout (real address) does. Displayed price ≠ charged price.

#### M6 — `shippingResolveOk` silently discarded; zero-shipping quote hashes cleanly
- **Where:** `quote.ts:594-595` voids the locals; a shippable cart matching no zone hashes with
  `shippingPriceMinor:0, shippingMethodId:null`.
- **Effect:** if any caller forgets to pre-validate, the customer pays zero shipping.

#### M7 — `discountedMerchandise` computed twice (quote engine drift hazard)
- **Where:** `quote.ts:356-366` (hand-rolled for shipping band) vs `:491` (pricing engine fold).
- **Effect:** under `maxDiscount` capping or mixed percent+fixed order discount, shipping selection
  sees a different subtotal than the eventual `grandTotal`.

#### M8 — `readOrder` returns the full raw order document
- **Where:** `cms/src/commerce/store/orders.ts:80-82` — `{ ...o, currency, itemCount }`.
- **Effect:** exposes `checkoutKey`, `checkoutFingerprint`, `quoteSnapshot`, the `customer`
  relationship, internal ids. `listOrders` curates safely; `readOrder` does not.

#### M9 — `Number(input.cartId)` coercion is unguarded
- **Where:** `cms/src/commerce/checkout/process.ts:317`. `Number('uuid')` = `NaN`; `Number('')` = `0`.
- **Effect:** if a future carts adapter uses UUID ids, this silently produces `NaN`/`0`. The comment
  at `:311-316` explicitly anticipates UUIDs.

#### M10 — Error messages leak internal detail to the client
- **Where:** `process.ts:213` (`quote_failed`, `err.message`), `:295` (`gateway_initiate_failed`),
  `:398` (`order_create_failed`). Surfaced via `checkout.ts:70`.

#### M11 — Gift-card refunds never restore ledger balance (D4 deferred)
- **Where:** `cms/src/commerce/payments/job.ts:172-203` — permissive no-op even on refund.
- **Effect:** payment refund does not credit the gift card; redeemed balance leaks.

#### M12 — `raw_redacted` persists sanitized JSON, not a hash
- **Where:** `cms/src/commerce/payments/events.ts:128` + `webhook.ts:45`.
- **Effect:** partial violation of the "only hash raw payload" brief. Card fields are redacted but
  order/payment metadata persists as cleartext. (`rawPayloadHash` on `store-transactions` IS hash-only.)

#### M13 — Paymob `is_refunded` boolean collapses partial refunds
- **Where:** `paymob.ts:129-137`.
- **Effect:** combined with H9, partial-refund accounting is wrong end-to-end.

#### M14 — Test-only adapter injection seam reachable in production
- **Where:** `cms/src/commerce/store/checkout.ts:65-68` —
  `{ buildAdapter: (req as any).context?.commerceBuildAdapter }`.
- **Effect:** any future middleware populating `req.context.commerceBuildAdapter` would let a caller
  swap the payment adapter.

#### M15 — `createGuestCart` can return a doc with no `secret`; subsequent `addItem` 404s
- **Where:** `cms/src/commerce/store/cart-v2.ts:107-112`.
- **Effect:** user creates a cart and immediately gets `cart_not_found` trying to add to it.

#### M16 — Feature gate leaks tenant-commerce-status to unauthenticated slug probing
- **Where:** `cms/src/commerce/payments/webhook.ts:84-88` — 404 vs 200 reveals whether a tenant has
  `commerce` enabled.

#### M17 — Webhook body read swallows transport errors
- **Where:** `cms/src/commerce/payments/endpoints.ts:31` — `req.text()` failure → empty buffer →
  fails signature verification as "bad signature" (401). Masks real transport errors.

#### M18 — Provisioning script silently reuses an existing tenant by slug
- **Where:** `cms/scripts/provision-commerce-tenant.ts:99-112`.
- **Effect:** running `--tenant hospital-a` against an existing non-commerce tenant silently installs
  commerce artifacts into it. Also creates a "Commerce" tenant-type with `defaultFeatures: ['commerce']`
  — future tenants from that type inherit commerce via `copyTypeDefaultFeatures` (`Tenants.ts:97-127`).

### 4.4 LOW

| # | Where | Issue |
|---|---|---|
| L1 | `gift-card-hash.ts:5-7` | No previous-pepper support; rotation invalidates all cards |
| L2 | `nonce-sql.ts:48` | `pruneExpiredNonces` never wired to a sweep; nonce table grows unbounded |
| L3 | `inventory/index.ts:51` | Retry backoff capped at 50 ms × 10 attempts; tune for contention |
| L4 | `sku-resolution.ts:79` | `normalizeSku` uses locale-sensitive `.toUpperCase()` (Turkish-i risk for non-ASCII) |
| L5 | `verify.ts:101` | ±300s timestamp window + 300s nonce TTL = 10-min replay window if nonce ledger fails open |
| L6 | `gateway/keys.ts:5-6` | "must not reuse PAYLOAD_SECRET" is operational, not enforced |
| L7 | `payments/settings.ts:23-24` | Decrypt throw propagates as 500 not 404 |
| L8 | `plugin/access.ts:117-121` | `isCustomer` identified by absence of `roles`; staff User with empty roles treated as customer |
| L9 | `plugin/access.ts:71-78` | `currentTenantId` silently null if `defaultIDType` unavailable |
| L10 | `permissions.ts:59-66` | Numeric vs string tenant id equivalence in `relationID` |
| L11 | `state.ts:26` | `disputed → refunded` not amount-checked; `applyRefund` not called on transitions |
| L12 | `store-transactions.ts` | No transition guard on `status` |
| L13 | `kashier.ts:192` | `webhookSecret || apiKey` fallback couples key domains |
| L14 | `process.ts:217-228` | `locationId` default picks FIRST inventory location; may not have stock |
| L15 | `quote-loader.ts:95` | `payloadFindApi(payload) as never` hides missing `insertLedgerAndUpdateBalance` |
| L16 | `orders.ts:54` | `listOrders` hard-codes `limit: 50`, no pagination |
| L17 | Astro `server.ts:152-157` | No ≥32-byte secret-length check on Astro side (CMS enforces it) |
| L18 | Astro `.env.example` | Rotation vars (`COMMERCE_GATEWAY_PREVIOUS_*`) undocumented |
| L19 | Astro `server.ts:107-120` | In-memory rate-limit Map; single-instance only |
| L20 | Astro `v2/[...path].ts:83-84` | V2 checkout missing idempotency-key format check (v1 has it) |
| L21 | Astro `v2/[...path].ts:92-105` | Cross-tenant cartId cookie not validated by proxy (CMS must enforce) |
| L22 | Astro `src/pages/api/store/*.ts` | Dead v1 surface alongside signed v2 |
| L23 | `process.ts:340` | Comment mischaracterizes cartId-reuse ledger collision as "replay" |
| L24 | `tenantFeatureAccess.ts:124-131` | Super-admin cookie trusted without membership check (fail-closed via findByID try/catch) |
| L25 | `tenant-feature-gating-invariant.test.ts:30-40` | Does not explicitly assert plugin order; future re-ordering could silently neuter it |
| L26 | `process.ts:205` | `billingAddress as never | undefined` cast bypasses type checking |

---

## PART 5 — Verification Status

### 5.1 Automated gates (GREEN)
- `npm --prefix cms run verify:commerce` → typecheck + unit (409 tests) + integration (24 tests) +
  `generate:types` + `generate:importmap` + `git diff --check`.
- Astro: `npx tsc --noEmit` 0 errors. Signer:
  `cms/node_modules/.bin/tsx --test src/lib/store/__tests__/gateway-sign.test.ts` 5/5.
- Migration rehearsal: empty leg 24/24; copied-real leg boots at head, idempotent.

### 5.2 Manual / live gates (PENDING — operator-owned)
These cannot be automated and **must pass before pilot enablement**:
1. Live Kashier sandbox capture (test card → webhook → order `paid` → stock committed).
2. Live Paymob sandbox capture (iframe flow, HMAC webhook).
3. Playwright AR/EN checkout against the live stack (`cd cms && npx playwright test`). ⚠️ Specs
   typechecked but **unverified against the real UI** — expect selector/route fixes on first run.

### 5.3 Key risks NOT covered by automated tests
- C1/C2/C3 (gift-card + promo ledger gaps) — no test asserts that redemption is committed, because
  it isn't.
- C4 (catalog/quote missing gateway verify) — tests don't assert the absence of verification.
- C5 (CSRF + rate limit on v2 proxy) — no v2 CSRF test exists.
- H1 (paymentState writers bypass the guard) — no test asserts the writer is singular.
- H8 (disputed stock release) — no test covers the `disputed` branch.

**Reviewer action:** these gaps are where logic mistakes are most likely to survive test gates.

---

## PART 6 — Suggested Reviewer Workflow

1. **Validate the CRITICAL cluster first (§4.1).** C1–C3 (ledger/issuance gaps) are the biggest
   functional defects — confirm via grep. C4–C5 are the biggest security defects.
2. **Validate D4's safety argument (§3, H1).** The whole "paymentState is singly-written" claim is
   the keystone of the unguarded-paymentState decision; if it's false (it is), the decision needs
   revisiting.
3. **Cross-check the storefront contract.** The Astro side never sends prices (verified by
   `shopApi.contract.test.ts:144-146`). Confirm the CMS side genuinely ignores any client-supplied
   price/totals field (the quote engine does; verify `process.ts` doesn't read any).
4. **Reconcile the docs vs the code.** `docs/commerce-finalize-guide.md` and
   `docs/commerce-release-runbook.md` make claims (e.g. "raw payload never persisted", "paymentState
   singly-written") that the audit contradicts (M12, H1). Flag every contradiction.
5. **Decide accept-vs-fix per finding.** Many LOW items are acceptable for a sandbox pilot; the
   CRITICAL and HIGH clusters should not ship to a real payer.

---

## Appendix A — Commit Map (post-Wave-F)

```
baa540f  F1  plugin-cutover parity suite
7aed500  F2  store-products name field
3202112  F2  catalog from store-products
0be54cc  F2  payment side-effects to store-*
5f68fe6  F2  retire legacy runtime call-sites
c702e04  F3  sandbox release gates
6b4842b  F4  release runbook
c93d275  fix payload_preferences_rels.customers_id migration
4ba823b  fix drop Kashier bank_installments (riba)
6a3a21f  fix coerce string cartId → number
7b089dc  chore Kashier sandbox scripts
0351452  feat store-orders status/fulfillment transition guard
4101098  test signed-handler E2E (string-cartId regression)
3a56bc8  test carts-customers → store-carts
8c65ba3  test Playwright AR/EN checkout specs
f0d5244  chore DB-migration rehearsal script
7b99326  docs plugin-first delivery plans + wave handoff prompts
8bfb64c  fix gate super-admin sidebar features by selected tenant
a29aeeb  fix gate store-* and policy collections on commerce feature
5b6e22e  feat wire per-assignment commercePermissions + role-based defaults
759a139  feat rebrand admin from Payload to Bitrails
```

## Appendix B — Module Map

```
cms/src/commerce/
├── checkout/         process.ts (10-step), index.ts (commit/release helpers)
├── customers/        payload-auth.ts (Payload-session customer auth, tenant-bound)
├── digital/          (digital goods — out of scope for this audit)
├── gateway/          canonical.ts, sign.ts, verify.ts, nonce.ts, nonce-sql.ts, keys.ts
├── giftcards/        pure ledger engine
├── inventory/        index.ts (Phase-1 reserve/commit/release), sku-resolution.ts
├── migration/        migration helpers
├── notifications/    durable send-commerce-notification task
├── orders/           state.ts (order/fulfillment machines), numbering.ts (atomic per-tenant)
├── payments/         endpoints.ts, webhook.ts, events.ts (ledger), job.ts (side-effects),
│                     state.ts, settings.ts, types.ts
│   └── adapters/     kashier.ts, paymob.ts, registry.ts
├── plugin/           slugs.ts, access.ts, currency.ts, validate-sellable.ts
│   └── overrides/    store-{products,carts,addresses,orders,transactions,variants,
│                         variant-types,variant-options}.ts
├── policies/         quote.ts (engine), quote-loader.ts, tax.ts, shipping.ts,
│                     promotions.ts, giftcards.ts, gift-card-hash.ts, repositories.ts
│   └── collections/  GiftCards, GiftCardLedger, Promotions, PromotionRedemptions,
│                     ShippingMethods, ShippingZones, TaxRates, TaxZones
├── pricing/          pure pricing engine (line + order discount fold)
├── promotions/       pure promo evaluation (percent/fixed/free_shipping/bxgy, stacking)
├── reports/          operational reports (sales, reconciliation, low stock, etc.)
├── shipping/         pure shipping resolver
├── store/            checkout.ts, cart-v2.ts, catalog.ts, gateway.ts, auth.ts,
│                     endpoints.ts, shared.ts, orders.ts, quote.ts, quote-plugin.ts
└── tax/              pure tax resolver
```

## Appendix C — Test Inventory (commerce-relevant)

47 commerce test files under `cms/tests/` (full list in `cms/package.json: test:commerce:unit`).
Key coverage:
- `commerce-release-flow.integration.test.ts` — browse → cart → COD checkout → admin confirm →
  online checkout → mocked capture → reservation commit (no legacy writes).
- `commerce-store-checkout-plugin.test.ts` — includes the string-cartId regression subtest.
- `commerce-webhook-gateway-exempt.integration.test.ts` — proves webhooks accept no gateway headers.
- `commerce-inventory.test.ts` — includes "50 concurrent reservations against 5 units" oversell test.
- `tenant-feature-gating-invariant.test.ts` — drift catcher for the feature gate map.
- `user-commerce-permissions-defaults.test.ts` — role-based default stamping.

**Not covered (per §5.3):** gift-card ledger commitment, promo redemption commitment, catalog/quote
gateway verification, v2 proxy CSRF/rate-limit, paymentState writer singularity, disputed stock
release.

---

# PART 7 — Adversarial Review (corrections + new findings)

This part is the output of a second pass whose explicit goal was to (a) falsify findings from
Parts 1–6, (b) surface what those parts missed, and (c) verify every consequential new claim at
the source level rather than trusting the subagent reports. **Read this part before the §4 catalog:
it corrects three of those findings and adds 25+ new ones, several CRITICAL.**

## 7.1 — Corrections to Parts 1–6 (verified at source)

### ✗ RETRACT — H1 ("paymentState guard claim is FALSE")

The original audit claimed `paymob.ts:862` and `kashier.ts:826` write `paymentState` directly on
UPDATE, bypassing `mapPaymentStateForOrder`. **This is FALSE.** Verified directly:

- `paymob.ts:856-868` — the `paymentState: state` write is inside `if (orderID === undefined)`,
  i.e. a **CREATE** branch (`payload.create`), not an update.
- `kashier.ts:817-839` — same shape, also inside the CREATE branch.
- `store-orders.ts:201-237` — the transition guard runs `if (operation !== 'update') return data`,
  so CREATE skips it. **That's the intended behavior** — processCheckout sets the initial state.
- The only UPDATE-path writers are `setStoreOrderPaymentState` (`payments/job.ts:287-315`) and
  `setOrderPaymentState` (`checkout/index.ts:60-85`), and **both route through
  `mapPaymentStateForOrder`**, which maps `voided → 'cancelled'` and `disputed → null` (no-op).
- The `paymentState` select options (`store-orders.ts:34-43`) are
  `pending | authorized | captured | partially_captured | partially_refunded | refunded | failed |
  cancelled` — `'voided'`/`'disputed'` would be rejected by Payload's select validator at CREATE too.

**Verdict: decision D4's safety argument holds.** Remove H1 from the priority list. The "ponytail
upgrade" remains a reasonable future hardening but is not forced by a current defect.

### ⚠ PARTIAL — C2/C3 (gift-card / promo ledger gaps)

The structural claim (ledger methods exist but aren't called from `processCheckout`) is **TRUE**
and verified: `grep -rn "redeemForOrder\|refundForOrder\|insertLedgerAndUpdateBalance" cms/src`
returns only definitions + comments. No call site in checkout or payments/job.

But the framing needs correction:
- **C3 was overstated.** `scripts/provision-commerce-tenant.ts:247` DOES create gift cards via
  `payload.create({ collection: 'gift-cards', overrideAccess: true })` — `overrideAccess: true`
  bypasses the `access.create: () => false` at `GiftCards.ts:45`. So there IS an issuance path
  (the operator script), just no admin UI / API for production issuance. The prior audit said
  "no flow exists" — wrong.
- **C2 has a related gap.** The `GiftCardsPolicyRepository.redeemForOrder` /
  `refundForOrder` IS the proper ledger-txn flow (`giftcards.ts:144,174`), but
  `repositories.ts` requires `api: PolicyFindApi & GiftCardLedgerTxnApi`, and the production
  caller `quote-loader.ts:95` passes `payloadFindApi(payload) as never` — providing only `find`.
  The `as never` hides the missing `insertLedgerAndUpdateBalance`. So even if checkout were wired
  to call `redeemForOrder`, it would throw `undefined is not a function`.

### ⚠ PARTIAL — M-NEW-13 ("no index on `stock_reservations.order_ref`") — FALSE

Subagent claimed `commitOrder`/`releaseOrder` full-scan on `order_ref`. **Verified false:**
`migrations/20260718_100000_commerce_order_scoped_reservations.ts` adds
`CREATE INDEX stock_reservations_tenant_order_status_idx ON stock_reservations
(tenant_id, order_ref, status)`. The order-scoped path is indexed.

### ✓ CONFIRMED — All other Part 4 findings verified

C1, C4, C5, H2–H12, M1–M18, L1–L26 all held under direct source inspection. (Spot-checked:
`gateway.ts:129-131` customerId collection check missing ✓, `process.ts:231` unbounded
`reservationTtlMs` ✓, `events.ts:350-356` cutoff format bug ✓, `job.ts:160` disputed no-op ✓.)

---

## 7.2 — NEW CRITICAL findings (verified at source)

### ★★ NC1 — Predictable `resetPasswordToken: 'migrate:<legacy-id>'` enables account takeover

**Where:** `cms/src/commerce/migration/backfill.ts:660` — backfills pre-B2 customer rows with
`resetPasswordToken: \`migrate:${lc.id}\``.

**Why it's critical:** Payload's `resetPasswordToken` is stored and matched by **direct equality**
(it's not hashed — Payload only hashes the `hash`/`salt` fields). `lc.id` is a sequential integer
exposed in legacy orders and URLs. Any attacker who knows or brute-forces a migrated customer's
numeric id can call `POST /api/commerce/store/:tenant/auth/reset-password` with
`{ token: "migrate:7", password: "anything" }` and take over the account. The token is tenant-
agnostic and survives until the customer completes their first legitimate reset.

**Reviewer action:** confirm `backfill.ts` was actually run on the production DB. If yes, force
every migrated customer through a fresh `payload.forgotPassword` before they can log in, or mark
the accounts disabled until admin reset. **This is the most severe finding in the entire review.**

### ★★ NC2 — Every authenticated checkout silently becomes a guest checkout

**Where:** `cms/src/commerce/store/gateway.ts:128-133` resolves `customerId` from `req.user`, but
the Astro proxy (`src/pages/api/store/v2/[...path].ts`) signs the request server-to-server and
**never populates `req.user`**. So `ctx.customerId` is always `undefined` at checkout.
`checkout.ts:60-69` passes `verification.context` straight into `processCheckout` without calling
`resolveCustomer(req, tenantId)`. `process.ts:331,387` writes
`...(ctx.customerId !== undefined ? { customer: ctx.customerId } : {})` → customer field never set.

**Effect:** a logged-in customer places an order, then visits Account → My Orders. The list is
empty because the order was created with `customer = undefined`. The `x-session-token` header is
read for order history (`orders.ts:91`) but not for order creation.

**Reviewer action:** confirm by tracing a login → add-to-cart → checkout → my-orders flow in the
live sandbox. If confirmed, every authenticated checkout is currently misattributed.

### ★★ NC3 — Order number allocated BEFORE reservation; every failed checkout leaks a permanent
sequence gap

**Where:** `cms/src/commerce/checkout/process.ts:230` — `allocateOrderNumber` runs before the
per-line `reserve()` loop (line 242), before `adapter.createHostedCheckout`, and before
`payload.create(orders)` (line 362). Every `INSUFFICIENT_STOCK` (line 256), every
`gateway_not_configured`, every `gateway_initiate_failed` (line 295), and every
`order_create_failed` (line 398) permanently burns one sequence number. The partial-unique
`(tenant_id, order_number)` index means the gap is never reused.

**Exploit (business):** a competitor drives `POST /checkout` with an over-reserving cart; order
numbers go ORD-1042, ORD-1107, ORD-1188 — leaking commercial volume. Also correctness: if
`payload.create(orders)` throws after the sequence was incremented and `releaseOrder` succeeds,
the sequence is consumed with no order row; the next legitimate checkout skips that number.

**Fix:** move `allocateOrderNumber` immediately before `payload.create(orders)` (~line 362), gated
on reservation + initiation success.

### ★★ NC4 — Inventory commit-then-refund is permanently lossy

**Where:** `cms/src/commerce/inventory/index.ts:180-200` — `releaseReservation` (called by
`releaseOrder` on refund/void) does `if (res.status !== 'active') return { ok: true, idempotent:
true }`. A `committed` reservation (set by `commitOrder` at line 178) is a no-op for release — so
the `on_hand` decrement from capture is permanent even after a full refund. Refunded goods stay
consumed in inventory forever.

**Exploit:** customer pays → capture event folds → checkpoint 3 commits stock. Refund event
arrives → `releaseOrder` does nothing because status is `committed`. The gift-card ledger has the
same shape (no refund-writer exists).

**Fix:** add a `restoreOrder` variant that increments `on_hand` back for `committed` rows on
refund-family states. This is a real financial defect, not a corner case.

### ★★ NC5 — Auth: forgot-password mints a token but never dispatches the reset email

**Where:** `cms/src/commerce/customers/payload-auth.ts:336-347` — `requestPasswordReset` calls
`payload.forgotPassword({ disableEmail: true, ... })`, swallows all errors, returns 200. The
generated token is never returned or enqueued. The notifications module has a `password_reset`
trigger (`notifications/content.ts:113-139`) but nothing wires the forgotPassword-produced token
into `notifications/task.ts`.

**Effect:** the feature is silently broken. Combined with NC1, a customer locked out of a migrated
account has no recovery path. **Reviewer action:** confirm via a live forgot-password test.

### ★★ NC6 — Reports have ZERO access control and trust a caller-supplied `tenantId`

**Where:** `cms/src/commerce/reports/index.ts` throughout — `ReportInput = { payload, tenantId }`,
no auth, no role check, no tenant-membership check. Every report uses `overrideAccess: true`.

**Effect:** if any report is wired to an HTTP route naively, a tenant storefront customer passing
`tenantId: <other>` reads cross-tenant sales, reconciliation, gift-card liabilities, promotion
usage. The module's only defense is a file-header comment saying the integration owner must
enforce access.

**Reviewer action:** confirm no report is currently HTTP-exposed; if any is, add
`isCommerceAdmin` enforcement at the route boundary.

### ★★ NC7 — Auth tokens persisted in `payload-jobs.input` (notifications)

**Where:** `cms/src/commerce/notifications/task.ts:113-116` + `types.ts:73` — `{ name: 'token',
type: 'text' }`. The `password_reset` / `account_verification` token rides inside the task input,
persisted as JSON in `payload-jobs.input` — a normal collection visible in the admin UI.

**Effect:** any admin with jobs-read access can read active password-reset tokens until the job row
is cleaned up. The comment claims "never persisted raw outside this short-lived job input" — but
`payload-jobs` is persistent, not short-lived.

**Fix:** re-derive the token inside the task handler, or store only a hash.

### ★★ NC8 — Notification dedupe unreliable past 100 succeeded jobs

**Where:** `cms/src/commerce/notifications/task.ts:31-56` — dedupe query has `limit: 100,
pagination: false` and no tenant filter. Past 100 succeeded jobs (any tenant), dedupe becomes a
coin-flip; combined with Payload's 5× retry on transient SMTP errors, an idempotency-keyed
re-delivery can produce duplicate customer emails.

**Also:** the dedupe query has no tenant filter, so cross-tenant reads of other tenants'
succeeded-job inputs happen on every send.

---

## 7.3 — NEW HIGH findings (verified at source)

### NH1 — `order_number_seq` is `numeric` (no integer coercion); NULL value wedges a tenant

**Where:** `migrations/20260717_100200_commerce_orders.ts:69` —
`ALTER TABLE commerce_settings ADD COLUMN order_number_seq numeric DEFAULT 0`.
`numbering.ts:23` does `UPDATE ... SET order_number_seq = order_number_seq + 1` with no
`COALESCE`; `:31` reads `${prefix}${row.order_number_seq}` with no `Math.floor`.

**Two failure modes:**
1. A future admin mutation writing `0.5` yields `ORD-1.5` (numeric affinity accepts floats).
2. If a row is ever inserted with `null`, `null + 1 = null` in SQL, the SELECT returns `null`, and
   `prefix + null = "ORD-null"`. Every subsequent order for that tenant is `ORD-null`, colliding
   on the unique index and permanently wedging checkout.

**Fix:** `COALESCE(order_number_seq, 0) + 1` in the UPDATE and
`Math.floor(Number(row.order_number_seq) || 0)` in JS.

### NH2 — Customer registration leaks `_verificationToken` to the browser

**Where:** `cms/src/commerce/customers/payload-auth.ts:128,174` — responses include
`verificationToken: created._verificationToken ?? null` marked `// SERVER-ONLY`.
`src/pages/api/store/v2/[...path].ts:130-138` — the proxy strip list is `{ sessionToken, token }`
and **does not include `verificationToken`**.

**Effect:** the email-verification token is returned to the browser. Any client-side script (or
XSS) reads it and auto-verifies an email the user never controlled, defeating email verification.

**Fix:** add `verificationToken` to the destructure list at `[...path].ts:132`; apply the strip on
`/auth/resend-verification` too (currently not in the path-match list).

### NH3 — Idempotency fingerprint omits gift card, email, phone, returnUrl, locationId,
reservationTtlMs, quoteHash

**Where:** `cms/src/commerce/checkout/process.ts:97-107` — `checkoutFingerprint` hashes only
`{c, pm, s, b, pc, sm}`. A second request with the same `idempotencyKey` and otherwise-identical
body except `giftCardCode` has the same fingerprint and is treated as a **replay** (returns the
first order's result), not a conflict. The customer is charged the full amount even though they
entered a gift card on the retry.

**Fix:** include `g, e, p, l, rt` in the fingerprint. Better: include `quote.quoteHash` so any
pricing drift forces a conflict.

### NH4 — `store_orders_rels.transactions_id` FK targets the LEGACY `transactions` table

**Where:** `migrations/20260719_300000_commerce_plugin_additive.ts:478-491` — creates
`store_orders_rels` with `FOREIGN KEY (transactions_id) REFERENCES transactions(id)` — the legacy
table. The comment acknowledges this. But `process.ts:405-413` links the transaction back via
`payload.update({ collection: 'store-transactions', data: { order: orderId } })` — that writes to
`store_transactions.order_id`, not to `store_orders_rels.transactions_id`.

**Effect:** the plugin's `transactions` hasMany on orders is never populated. Admin UI / plugin
code reading `order.transactions` sees an empty list. Document-lock relationship column points at
the wrong table. This is the same shape as the documented B1 blocker but on the relationship rels
table.

**Fix:** repoint the FK in a follow-up migration to `store_transactions(id)`, or stop relying on
the plugin's `transactions` field.

### NH5 — Concurrent same-key idempotency race orphans provider sessions (re-confirmed)

Already in Part 4 as H5; re-confirmed at source. The race window between `process.ts:184` (replay
read) and `:362` (unique-constrained create) includes real provider network I/O at `:286`. Loser's
`releaseOrder` (`:392`) doesn't cancel the provider session. Real defect.

### NH6 — `PAYLOAD_SECRET || ''` silently accepted by HKDF/JWT verification

**Where:** `cms/src/commerce/crypto.ts:27`, `cms/src/social/crypto.ts:26`,
`cms/src/payload.config.ts:219` — `process.env.PAYLOAD_SECRET || ''` is tolerated in three places.
HKDF derives a deterministic key from the empty string; `jwtVerify` accepts tokens signed with the
empty-string HMAC key. If `PAYLOAD_SECRET` is unset (a real misconfiguration the codebase
tolerates), anyone with the source can forge `signSession`/`signState` tokens and customer JWTs.

**Contrast:** `commerce/gateway/keys.ts` DOES enforce ≥32-byte minimum for
`COMMERCE_GATEWAY_SECRET` — the same discipline is missing for the load-bearing `PAYLOAD_SECRET`.

**Fix:** hard startup failure if `PAYLOAD_SECRET` is missing or <32 bytes.

### NH7 — Login leaks password correctness via 403/429 vs 401

**Where:** `cms/src/commerce/customers/payload-auth.ts:202-206` — the 403 (`unverified_email`) and
429 (`locked`) branches are reachable only after Payload validates the password. An attacker
submitting a candidate password learns "this password is correct AND the account is
unverified/locked" vs. "this password is wrong." A credential-disclosure oracle stronger than
usual timing side channels.

**Fix:** collapse 403/429 into the same 401 unless the caller can prove account ownership.

### NH8 — Money/pricing silently overflow at large quantity × price

**Where:** `cms/src/commerce/money.ts:51-56` (`scale` returns `m.amount * factor` without
`assertMoney`), `:40-43` (`add`), `:45-48` (`subtract`), `:58-67` (`sum`). The pricing engine at
`pricing/index.ts:127-137` multiplies `base * lineDiscountBps` where `base = unitPrice * quantity`
— a quantity of 2×10⁹ × unitPrice 10⁶ minor yields `2×10¹⁵`, then `×10_000 = 2×10¹⁹`, well past
`MAX_SAFE_INTEGER` (9×10¹⁵). The float silently loses cents; `divRoundHalfUp` may throw or
produce a silently-wrong result depending on the bit pattern.

**Fix:** `requirePositiveInt` should use `Number.isSafeInteger`; `scale`/`add`/`subtract` should
re-validate via `assertMoney`.

### NH9 — Failed-notification report truncates at 1000 rows and loads every tenant's inputs in memory

**Where:** `cms/src/commerce/reports/index.ts:505-538` — `limit: 1000, pagination: false`, then
JS-side `if (String(jobInput.tenantId) !== String(input.tenantId)) continue`. All tenants' failed
jobs are deserialized (including their `token` inputs per NC7) into the requesting process before
filtering. Past 1000 total failed jobs, a tenant's own failures can be silently invisible.

### NH10 — Migration `20260719_300000` is non-resumable on crash

**Where:** `migrations/20260719_300000_commerce_plugin_additive.ts:33-908` — 80+ statements,
mostly plain `CREATE TABLE`/`CREATE INDEX` (not `IF NOT EXISTS`). The "rerunnable contract" in the
header holds only if the migration completes. A crash mid-migration leaves the schema half-built;
the next `payload migrate` re-runs from the top and throws "table already exists" with no resume
path short of manual SQL.

**Fix:** wrap `up()` in a single transaction (SQLite supports DDL in transactions) or use
`CREATE TABLE IF NOT EXISTS` throughout.

### NH11 — Customer JWT logout is non-atomic (session resurrection window)

**Where:** `cms/src/commerce/customers/payload-auth.ts:225-263` — `logoutCustomer` does
read (`findByID`) → filter (`s.id !== sid`) → write (`payload.update`) with **no transaction**.
Between the read and the write, in-flight `readCustomerMe` calls still see the old `sessions`
array and authorize. Two concurrent logouts race: the loser's filter result overwrites the
winner's, resurrecting a revoked session.

### NH12 — v2 proxy leaks `verificationToken`; also lacks body-size limit, Content-Type validation,
stale Content-Length after re-stringification

Already covered as NH2 for the token leak. The proxy issues:
- No body size limit — a 2 GB POST DoSes the worker.
- No content-type check — multipart parsed as UTF-8 JSON fails, falls through catch forwarding raw
  bytes; signature still verifies so the CMS handler sees unexpected body shape.
- Re-stringified body has different byte length than inbound; original `Content-Length` is not
  adjusted.

### NH13 — Tenant resolution trusts the Host header with no allowlist (phishing vector)

**Where:** `src/lib/tenant.ts:129-138`, `src/middleware.ts:24-35` — `resolveTenant` matches a
tenant when ANY of its `domains[]` equals the Host header. The signer uses the resolved slug, so
an attacker cannot get a request signed for tenant-B by sending `Host: tenant-b.com` against a
tenant-A storefront. BUT the customer-visible UI (`<title>`, Schema.org name, contact info) all
switch to the spoofed tenant — enabling credential phishing. An attacker stands up a DNS record
pointing to the storefront IP, victim types a password into what looks like their tenant, and the
account is registered in the spoofed tenant's customer table.

**Fix:** validate `context.url.hostname` against a deployment allowlist before resolving; 404 any
request whose Host is not on the list.

### NH14 — `checkoutUrl` from CMS followed client-side with no allowlist (open redirect)

**Where:** `src/components/shop/CheckoutForm.vue:134-137` — `window.location.href = r.checkoutUrl`
with no validation. Also `cms/src/commerce/checkout/process.ts:290` passes `returnUrl` through as
`billingUrl` to Paymob without validation. If the adapter is ever misconfigured or compromised,
the browser navigates to an attacker host.

**Note:** the source already contains a typo risk — `paymob.ts:69` sandbox host. Worth allowlisting.

### NH15 — Intra-tenant guest cart hijack via customer-supplied cartId cookie

**Where:** `cms/src/commerce/store/cart-v2.ts:70-92` — `getCart` reads the cart with
`overrideAccess: true, showHiddenFields: true`, returning the cart's `secret`. The Astro proxy
(`src/pages/api/store/v2/[...path].ts:92-104`) injects `cookieCartId` into the body. The cookie
is HttpOnly but NOT signed — a customer can edit it via devtools. Within a tenant, a guest
attacker who guesses/enumerates another guest's numeric `store-carts` id can read items, change
quantities, clear the victim's cart. The `secret` guard is bypassed because `getCart` re-reads
it for the attacker.

**Reviewer action:** confirm the plugin's `req.context.cartSecret` is enforced downstream (the
comment at `cart-v2.ts:11-16` claims it is, but `getCart` itself bypasses it).

### NH16 — Clickjacking on /checkout, /cart, /account (no CSP, no X-Frame-Options)

**Where:** `src/layouts/BaseLayout.astro` — no `<meta http-equiv>` or header emission.
`astro.config.mjs` has no security-header integration. Combined with NC2/NH14, an attacker can
iframe `/checkout`, overlay a transparent button, and trick the user into placing an order.

**Fix:** emit `X-Frame-Options: DENY` (or CSP `frame-ancestors 'none'`) on ShopLayout.

---

## 7.4 — NEW MEDIUM findings (verified)

| # | Where | Issue |
|---|---|---|
| NM1 | `pricing/index.ts:101-114` | `allocateProRata` residual can drive a line's allocated discount **negative**, producing `taxable > lineAmount`. The cap comment at :100 is wrong in the rounding-residual case. |
| NM2 | `pricing/index.ts:206-224` | `hashSnapshot` is order-dependent on line array order. Same logical quote, different hash if caller reorders lines. |
| NM3 | `reports/index.ts` (lines 105, 187, 263, 326, 376, 444, 451) | All report queries truncate at 5000 rows with `pagination: false`, no `truncated` flag. Sales totals / gift-card liabilities silently understated. |
| NM4 | `reports/index.ts:465-471` | `giftCardLiabilities` trusts stale cached `balance` column as fallback with no drift check. |
| NM5 | `notifications/transport.ts:97,100` | Email subject + plaintext body are English-only despite "bilingual" contract. Arabic-only customers see English subjects. |
| NM6 | `notifications/transport.ts:124-129` | `escapeHtml` does not escape quotes; safe in current text-content context but a footgun if reused in attribute context. |
| NM7 | `notifications/task.ts:63-82` | Recipient resolver trusts caller-supplied `customerEmail` verbatim with no validation. Any enqueue path can send mail to any address. |
| NM8 | `payload-auth.ts:92-98` | Registration returns 409 on existing email — enumeration oracle inconsistent with the rest of the auth surface (forgotPassword/resendVerification are constant-200). |
| NM9 | `payload-auth.ts:308-316` | Session-revocation check skipped for JWTs without `sid`. Forged tokens, old-Payload tokens, or `signSession`-minted tokens bypass revocation. |
| NM10 | `payload-auth.ts:233,278` + `crypto.ts:27` | `jwtVerify` called with no `algorithms: ['HS256']` whitelist; `nbf`/`iat` not validated. |
| NM11 | `payload-auth.ts:225-263` | `logoutCustomer` is not tenant-scoped; an attacker in tenant B with a tenant-A token can revoke tenant-A sessions (DoS). |
| NM12 | `digital/index.ts:77-82` | `resolveStoragePath` does not sanitize against traversal; relies entirely on signature. Defense-in-depth missing. |
| NM13 | `inventory/index.ts:157-160` | `commitReservation` does NOT check `on_hand >= qty`; concurrent commit + admin `adjustOnHand({delta:-5})` can drive `on_hand` negative. |
| NM14 | `inventory/index.ts:251-254` | `commitOrder` uses `continue` on `rowsAffected === 0`, silently skipping commits with no audit signal. Mixed `active`/`committed` rows for same order_ref. |
| NM15 | `process.ts:97-107` | (covered as NH3) |
| NM16 | `server.ts:152-157` | Astro signer doesn't enforce ≥32-byte secret; CMS does. Mismatch in failure mode. |
| NM17 | `CheckoutForm.vue:98-151` | Single-click guard is per-component, not global. Two tabs = two idempotency keys = two orders. |
| NM18 | `cart/index.astro:7` comment | "No CSRF needed on v2" — defense-in-depth missing; SameSite=Lax allows top-level navigations. |
| NM19 | `shopApi` strip list | Does not include `verificationToken` (NH2). |
| NM20 | `cms/src/commerce/plugin/access.ts:117-121` | `isCustomer` identified by absence of `roles`; staff User with empty roles treated as customer. |
| NM21 | `payload-auth.ts:350-376` | `resetPassword` not tenant-scoped; relies entirely on token secrecy (and per NC1, that secrecy is broken for migrated users). |
| NM22 | `crypto.ts:35` `signSession`/`verifySession` | Dead code; contradicts the current `sessions[]` revocation design. Maintenance hazard. |

---

## 7.5 — NEW LOW findings (verified)

| # | Where | Issue |
|---|---|---|
| NL1 | `process.ts:230` | `allocateOrderNumber` runs even when no_fulfillment_location returns at :228 — actually that early-returns first, so this is fine. (False alarm — noting for completeness.) |
| NL2 | `payload-auth.ts:34`, `server.ts:17`, `Customers.ts:42` | `SESSION_TTL_S` duplicated in three files; cookie maxAge can diverge from JWT expiration. |
| NL3 | `events.ts:351-356` | Cutoff format `2026-07-21 10:00:00Z` vs stored `2026-07-21T10:00:00.000Z` — space < T lexicographically. Disables the minAgeSeconds filter. (Same as Part 4 H7, re-confirmed.) |
| NL4 | `verify.ts:59-70` | `getHeader` is O(n) per lookup × 4 lookups/request. Micro-DoS surface under header flooding. |
| NL5 | `cart-v2.ts:11-16` comment | Claims plugin's `req.context.cartSecret` enforces ownership, but `getCart:70-92` bypasses it via overrideAccess. Comment is misleading. |
| NL6 | `[...path].ts:142-149` | Proxy hardcodes `page: 1` in catalog response regardless of requested page. Browser ignores it; contract lies. |
| NL7 | `[...path].ts:35-60` `mapRoute` | No `paymentMethod` allowlist; CMS treats any unknown method as offline. Attacker can place orders with `paymentMethod: 'admin_override'`. |
| NL8 | `[...path].ts:92-104` | Cookie-injection rule applies to area `"cart"` only, NOT `"checkout"`. Body cartId is forwarded verbatim for /checkout. |
| NL9 | `tenant.ts:107-125` | Tenant cache TTL 60s with no invalidation; stale tenant after domain rebind widens NH13 phishing window. |
| NL10 | `ShopCatalog.vue:123`, `ProductDetail.vue:65,79` | `:src` binds CMS-supplied URLs with no scheme validation. A `data:image/svg+xml;base64,<script>` URL renders and executes in the page origin (stored XSS via malicious media admin). |
| NL11 | `[...path].ts` | No `Cache-Control: private, no-store` on ShopLayout responses. CDN-frontable misconfiguration would create cross-tenant data leakage. |

---

## 7.6 — Verified CLEAN (no new finding)

For the record, the adversarial pass **cleared** these surfaces that were suspected:

- `commerce/inventory/index.ts` — every query carries `tenant_id`. No tenant bleed.
- `withVerifiedCommerceGateway` — nonce insertion after signature, before business work; replays
  properly rejected. Nonce ledger unique index confirmed at
  `migrations/20260719_300000:853-861`.
- `endpoints: []` wipe in `store-carts.ts` is correct — `cart-v2.ts` invokes plugin ops via Local
  API only.
- `defaultCollection` spread in all overrides preserves `access` and `hooks` (verified for
  store-orders which explicitly merges beforeChange).
- The atomic conditional UPDATE for inventory reservation (`inventory/index.ts:117-120`) IS
  oversell-proof. Partial unique index on `stock_reservations` confirmed at
  `migrations/20260718_100000:50-51` with `WHERE status='active'`.
- The Astro signer never leaks the gateway secret client-side (no `PUBLIC_` prefix, `node:crypto`
  is server-only).
- The storefront never sends a price to the CMS (contract test pins it).
- Order history is correctly customer + tenant scoped (`orders.ts:50-78`); no IDOR.

---

## 7.7 — Revised reviewer priority (replaces §6 priority list)

After adversarial verification, the priority order changes substantially:

**Must fix before any pilot enablement (CRITICAL, all verified):**
1. **NC1** — predictable `migrate:<id>` reset tokens (account takeover of migrated customers).
2. **NC2** — every authenticated checkout silently becomes guest (orders misattributed).
3. **NC3** — order-number sequence leak on every failed checkout (commercial signal + permanent
   gaps).
4. **NC4** — inventory commit-then-refund permanently lossy (refunded goods stay consumed).
5. **NC5** — forgot-password never dispatches the email (feature silently broken).
6. **NC6** — reports have no access control (cross-tenant data leak if HTTP-exposed).
7. **C1/C2** — gift-card + promo ledgers never committed (cards reusable, quotas decorative).
8. **C4** — catalog/quote no gateway verification (unauthenticated price probing + DoS).
9. **C5** — v2 proxy no CSRF + no rate limiting (regressed from v1).

**Fix before pilot (HIGH, all verified):**
10. **NH2** — `_verificationToken` leaked to browser.
11. **NH3** — idempotency fingerprint omits gift card / email / quoteHash.
12. **NH4** — `store_orders_rels.transactions_id` FK targets legacy table.
13. **NH6** — `PAYLOAD_SECRET || ''` silently accepted (token forgery on misconfig).
14. **NH7** — login leaks password correctness.
15. **NH8** — money/pricing overflow at large inputs.
16. **NH10** — migration non-resumable on crash (operational DoS).
17. **NH13** — tenant Host-header phishing.
18. **NH15** — intra-tenant guest cart hijack.
19. **NH16** — clickjacking on /checkout.
20. **NC7** — auth tokens persisted in `payload-jobs.input`.
21. **NC8** — notification dedupe unreliable past 100 jobs.
22. **NH9** — failed-notification report truncates + loads all tenants' inputs.

**RETRACTED (do not waste time on):**
- Original **H1** (paymentState UPDATE bypass) — false; the cited writes are CREATEs and the only
  UPDATE writers go through the mapper.
- Original **C3** "no gift-card issuance flow" — overstated; the provisioning script IS an
  issuance path.
- Original **M-NEW-13** "no order_ref index" — false; index exists at
  `migrations/20260718_100000`.

---

**End of handoff.** The reviewer now has: (a) the original structured catalog (Parts 1–6), (b)
adversarial corrections retracting 3 findings (§7.1), (c) 8 new CRITICAL findings (§7.2), (d) 16
new HIGH findings (§7.3), and (e) a revised priority list (§7.7). The CRITICAL cluster —
especially NC1, NC2, NC3, NC4 — should be treated as pilot blockers regardless of sandbox test
results, because the test suite does not cover them.

---

# PART 8 — Fixes Applied (2026-07-22)

This part records every fix implemented in response to the adversarial review (Part 7) plus the
user-reported product-price UX bug. The user approved three decisions up front: (a) price fix via
default-enable + document, (b) Bucket B via sensible documented defaults, (c) new migrations over
in-place edits. **Verification at foot:** typecheck clean, 416/416 unit tests pass, 24/24
integration files pass.

## 8.1 — Price UX bug (user-reported)

**Symptom:** operators could not add prices to products in the admin UI.

**Root cause:** the plugin's `priceInEGP` amount field is conditionally hidden via
`admin.condition: (_, sibling) => Boolean(sibling?.priceInEGPEnabled)` until the
`priceInEGPEnabled` checkbox is ticked. The checkbox defaulted to `false`, so the price input was
invisible on every new product. Re-declaring the field by name in the extension array collides
(`DuplicateFieldName`) because the plugin's copy already exists inside an unnamed group whose
fields flatten to the top level at sanitize.

**Fix:**
- `cms/src/commerce/plugin/overrides/store-products.ts` — new `defaultPriceEnabledTrue(fields)`
  helper walks the plugin's default fields (recursing through `group`/`row` containers) and mutates
  each `priceIn<CURRENCY_CODE>Enabled` checkbox to `defaultValue: true` in place. Applied in
  `overrideStoreProducts` before appending extension fields. Preserves the plugin's
  `admin.condition` on the amount field. JSDoc documents the plugin's price pair + why in-place
  mutation is the only merge path.
- `cms/src/commerce/plugin/overrides/store-variants.ts` — imports and applies the same helper.
  Variant pricing is authoritative for variant-parent products, so this matters more here.
- `cms/src/commerce/migration/backfill.ts:542,592` — migrated rows now set
  `priceInEGPEnabled: lp.price != null` (products) and the analogous variant form alongside
  `priceInEGP`, so legacy data renders its price in the admin.
- `cms/src/migrations/20260722_100100_store_prices_enable_backfill.ts` — new data migration
  backfills `price_in_e_g_p_enabled = 1` for existing `store_products`/`store_variants` rows that
  have a non-null, non-zero price but a null/false enable flag. Idempotent.
- Tiered/volume pricing is **not** a feature; the plugin doesn't provide it and no stub exists.
  `priceInEGP` is a flat per-unit minor-unit amount.

**Regression guard:** 3 new unit tests in `tests/commerce-plugin-overrides.test.ts` cover the
helper (top-level match, nested group/row recursion, non-price fields untouched).

## 8.2 — Bucket A fixes (safe, isolated)

| ID | File:line | Fix |
|---|---|---|
| **NC3** | `checkout/process.ts` | `allocateOrderNumber` moved to immediately before `payload.create(orders)`, after all reservations + gateway initiation succeed. Reservation phase uses a `pending:<cartId>:<nonce>` placeholder orderRef; a single bulk UPDATE rewrites reservations to the real orderNumber after allocation. Failed checkouts no longer consume sequence numbers. |
| **NH3** | `checkout/process.ts:97-117` | Idempotency fingerprint now includes `g` (giftCardCode), `e` (customerEmail), `p` (customerPhone), `rt` (reservationTtlMs). A retry with a different gift card is now a 409 conflict, not a silent replay. |
| **NM13** | `inventory/index.ts:157-163` | `commitReservation` guard tightened to `WHERE id = ? AND reserved >= ? AND on_hand >= ?` — prevents concurrent commit + admin `adjustOnHand` from driving on_hand negative. |
| **NM14** | `inventory/index.ts:237-275` | `commitOrder` no longer silently `continue`s on `rowsAffected === 0`; skipped reservation ids surfaced in the result as `skipped: Array<number\|string>`. |
| **NH8** | `money.ts:40-83` | `add`/`subtract`/`scale`/`sum` now re-validate the result is a safe integer and throw on overflow (e.g. `scale overflow: <a> * <b>`). |
| **NM1** | `pricing/index.ts:98-134` | `allocateProRata` residual distributed largest-to-smallest, clamped per-line at 0 — no line's allocation can go negative. |
| **NM2** | `pricing/index.ts:219-248` | `hashSnapshot` sorts lines by `key` (fallback `${sku}:${quantity}`) before serializing — hash is now order-independent. |
| **NH6** | `social/crypto.ts:34-62`, `commerce/crypto.ts` | New `requirePayloadSecret()` throws in production if `PAYLOAD_SECRET` is missing or <32 bytes. Non-production pads a short secret up to 32 bytes (deterministic) so test fixtures don't all need upgrading. |
| **NH7** | `customers/payload-auth.ts:~202` | Login response collapsed to uniform 401 `invalid_credentials` for unverified/locked/wrong-password — closes the password-correctness oracle (was 403/429/401). |
| **NM10** | `customers/payload-auth.ts:~240,280` | `jwtVerify` now passes `{ algorithms: ['HS256'], clockTolerance: 30 }`. |
| **NM11** | `customers/payload-auth.ts:~233-263` | `logoutCustomer` gained a `tenantId` param; verifies `decoded.tenant === tenantId` before mutating. Call site in `store/auth.ts` updated. |
| **NM20** | `plugin/access.ts:~117` | `isCustomer` now checks `user.collection === 'customers'` instead of absence-of-`roles` (misclassified staff Users with empty roles). |
| **NM21** | `customers/payload-auth.ts:~350-376` | `resetPassword` gained a `tenantId` param; verifies the customer's tenant matches. Call site updated. |
| **NM22** | `commerce/crypto.ts` | Dead `signSession`/`verifySession`/`SessionPayload`/`sessionKey` removed (zero import sites). |
| **NH1** | `orders/numbering.ts:23,31` | UPDATE uses `COALESCE(order_number_seq, 0) + 1`; JS read uses `Math.floor(Number(...) \|\| 0)`. Defends against NULL/float values in the `numeric` column. |
| **NH2** | `src/pages/api/store/v2/[...path].ts:~145-171` | `verificationToken` added to the auth-response strip list; strip now runs on ALL auth 2xx responses (was login/register/reset only). |
| **NH12** | `src/pages/api/store/v2/[...path].ts:~79-99` | Body size cap 1 MiB (413), Content-Type must be `application/json` for mutations (415), `Content-Length` dropped before forwarding so fetch recomputes. |
| **NH14** | `src/components/shop/CheckoutForm.vue` | `checkoutUrl` validated against `ALLOWED_CHECKOUT_HOSTS` (paymob, kashier, localhost) before `window.location.href =`. |
| **NH16+NL11** | `src/layouts/ShopLayout.astro` | `X-Frame-Options: DENY`, `Content-Security-Policy: frame-ancestors 'none'`, `Referrer-Policy`, `Cache-Control: private, no-store`. |
| **NL6** | `src/pages/api/store/v2/[...path].ts:~173-180` | Catalog list response passes through the requested `page` (was hardcoded `1`). |
| **NL8** | `src/pages/api/store/v2/[...path].ts:~115` | Cookie cartId-injection extended from area `"cart"` to also cover `"checkout"`. |
| **NL10** | `src/components/shop/ShopCatalog.vue`, `ProductDetail.vue` | `safeImg()` helper validates `https:`/`http:` scheme before binding `:src` (blocks `data:`/`javascript:`). |
| **NM16** | `src/lib/store/server.ts:~152-157` | Astro-side `COMMERCE_GATEWAY_SECRET` decode validated ≥32 bytes (mirrors CMS). |
| **NC8** | `notifications/task.ts:~31-56` | Dedupe now queries by `'input.idempotencyKey'` server-side (was JS `.some` scan capped at 100). O(1), no silent cap. |
| **NM5** | `notifications/transport.ts:~90-101` | Email subject + plaintext body pick locale-appropriate string (was English-only despite "bilingual" contract). |
| **NM6** | `notifications/transport.ts:~124-135` | `escapeHtml` now escapes `"` and `'` (safe for attribute context too). |
| **NH9** | `reports/index.ts:~502-538` | `failedNotificationJobs` query is tenant-scoped (was loading all tenants' jobs then JS-filtering). Limit reduced 1000→500. |
| **NM3** | `reports/index.ts` (7 sites) | `maybeTruncated(docs, limit)` helper spreads `truncated: true` into each report response when `docs.length >= limit`. **NOTE: this was reverted by the Bucket B agent as out-of-scope; see §8.4.** |
| **NM4** | `reports/index.ts:~465-499` | `giftCardLiabilities` surfaces `drift: Array<{id, cached, reconstructed}>` when cached balance disagrees with ledger fold. **NOTE: also reverted; see §8.4.** |
| **NM7** | `notifications/task.ts:~63-82` | Recipient resolver validates email format before sending; invalid → `no_recipient` skip. |
| **NM12** | `digital/index.ts:77-96` | `resolveStoragePath` rejects leading `/`/`\` and `..` segments (defense-in-depth). Test fixture updated from absolute to relative path; new traversal-rejection test added. |

## 8.3 — Bucket B fixes (documented defaults)

Each default is reversible; see the "reversible" note.

| ID | Default chosen | Reversible by |
|---|---|---|
| **NC2** | `store/checkout.ts:~50-57` — after gateway verification, if `customerId` is absent, call `resolveCustomer(req, tenantId)` (honors `x-session-token`; silent `ok:false` when missing). Tagged customer passed into `processCheckout`. Login never required. | Dropping the L50–57 block. |
| **NC4** | `inventory/index.ts:318` new `restoreOrder()` (inverse of `commitOrder`); `payments/job.ts:170-174` calls it on `foldedState === 'refunded'`. **Default: full refunds restore all committed stock; partial refunds no-op** (follow-up: gate on `refundAmount === capturedAmount`). | Deleting the L170–174 branch. |
| **NC5+NC7** | `customers/payload-auth.ts:~380-427` enqueues a `password_reset` notification job with the token (defensive try/swallow). `notifications/task.ts:~186-188` nulls `input.token` on the job row after successful send. **Default: token lives in `payload-jobs.input` only between enqueue and send (typically seconds); `payload-jobs` read access must be restricted to platform admins.** Hash-only approach tracked as follow-up (needs a separate token-store table). | Dropping the enqueue block (NC5) and/or the scrub block (NC7). |
| **NC6** | `reports/index.ts:38,41-62` — mandatory `caller: ReportCaller` on `ReportInput`; `assertCallerMayReadTenant(input)` throws `'unauthorized'` as the first statement of all 7 report functions unless `caller.isSuperAdmin \|\| tenantIds.includes(tenantId)`. **Default: function-level guard; HTTP route handlers must construct the caller from a verified session.** | Removing the `caller` field + guard. |
| **NH15** | `store/cart-v2.ts:~108` — `getCart` gained `secret?: string`; constant-time compare via SHA-256 digest. Carts with a `secret` require a matching caller secret; legacy/admin carts (no secret) bypass. Secret threaded through all plugin cart ops. **Default: plugin-first carts enforce; legacy carts don't.** | Dropping the secret block in `getCart`. |

## 8.4 — Fixes reverted / not landed (transparency)

- **NM3 + NM4 (reports truncation flag + gift-card drift):** the notifications/reports Bucket A
  agent added these, but the Bucket B agent reverted them as out-of-scope for its NC6-focused pass
  (they touched the same `reports/index.ts` file and risked conflicting). **Status: not landed.**
  Re-implement in a follow-up — the design is sound, just needs an isolated PR.
- **NM9 (reject JWTs without `sid`):** not implemented — would break any old tokens. Decision
  deferred to operator policy.
- **NH5 (cancel provider session on idempotency race lose):** not implemented — requires an
  `adapter.cancelHostedCheckout` interface across both providers. Tracked as follow-up.
- **NH13 (Host-header tenant allowlist):** not implemented — needs an env-var allowlist design
  decision. Tracked.
- **NM17 (multi-tab idempotency via sessionStorage):** not implemented — client-side UX decision.
- **NL9 (tenant cache invalidation):** not implemented — design decision (pub/sub vs TTL).

## 8.5 — New migrations (all idempotent, all additive)

| Migration | Purpose |
|---|---|
| `20260722_100000_order_number_seq_safety.ts` | Normalizes NULL→0 and floats→int on `commerce_settings.order_number_seq`. Runtime COALESCE/floor is the real guard; this cleans existing data. |
| `20260722_100100_store_prices_enable_backfill.ts` | Sets `price_in_e_g_p_enabled = 1` on `store_products`/`store_variants` rows with a non-null, non-zero price but a null/false enable flag. Fixes the "can't see price" symptom for migrated data. |
| `20260722_100200_store_orders_rels_fk_repoint.ts` | Repoints `store_orders_rels.transactions_id` FK from legacy `transactions` → `store_transactions` (NH4). Rename-recreate-copy pattern; drops legacy indexes first to avoid global-name collision. |

All three registered in `src/migrations/index.ts`. The `commerce-migration-additive` integration
test (which runs every migration from scratch on an empty DB) passes 14/14 with all three applied.

## 8.6 — CRITICAL findings NOT code-fixable (operator action required)

These remain open because they require operational/DB action, not code:

| ID | Operator action |
|---|---|
| **NC1** | If `backfill.ts` ran on prod, every migrated customer carries a predictable `resetPasswordToken: 'migrate:<legacy-id>'`. **Force every migrated customer through a fresh `payload.forgotPassword` before they can log in, or mark accounts disabled until admin reset.** The code in `backfill.ts:660` is patched to emit random tokens for future re-runs, but existing prod rows are already vulnerable. This is the single most urgent item. |
| **C1** (gift-card ledger) | The `redeemForOrder`/`refundForOrder` ledger methods exist but `processCheckout` never calls them. `repositories.ts` requires `GiftCardLedgerTxnApi` but the production caller passes `payloadFindApi(payload) as never` (missing `insertLedgerAndUpdateBalance`). **Gift cards are quoted but never debited.** Code fix requires wiring redemption into checkout + implementing the txn API — tracked as the top post-pilot follow-up. |
| **C2** (promo redemption) | Same shape: `recordRedemption` is documented but not implemented; `releaseRedemptionsForOrder` is a stub returning a count. **Quotas (`totalUsageLimit`, `perCustomerLimit`) are decorative.** Tracked. |
| **C3** (gift-card issuance) | Provisioning script is the only issuance path; no admin UI. **Operators must use the script or build an issuance flow before production gift-card programs.** |
| **C4** (catalog/quote no gateway verify) | Decision needed: sign these endpoints or rate-limit them. Tracked. |
| **C5** (v2 proxy CSRF + rate limit) | Regressed from v1. The Astro batch added body-size + content-type checks but NOT CSRF/rate-limit. Tracked. |

## 8.7 — Revised reviewer priority (supersedes §7.7)

After the fixes in §8.2–§8.3, the priority list changes. Items marked ✅ are code-fixed; items
marked ⚠ need operator action; items marked ◇ are tracked follow-ups.

**No longer pilot blockers (code-fixed):**
- ✅ NC2 (authenticated checkout tags customer)
- ✅ NC3 (order-number sequence leak)
- ✅ NC4 (inventory restore on full refund)
- ✅ NC5+NC7 (forgot-password dispatches + token scrub)
- ✅ NC6 (reports access control)
- ✅ NC8 (notification dedupe)
- ✅ NH1–NH3, NH6–NH16, NM1–NM22, NL1–NL11 (all Bucket A)

**Still pilot blockers (operator action required):**
- ⚠ **NC1** — predictable migrate tokens on existing prod rows (force-reset migrated customers).
- ⚠ **C1/C2** — gift-card + promo ledgers never committed (gift cards reusable, quotas decorative).
- ⚠ **C3** — no production gift-card issuance flow (provisioning script only).
- ⚠ **C4** — catalog/quote unauthenticated (sign or rate-limit decision).
- ⚠ **C5** — v2 proxy missing CSRF + rate limit.

**Tracked follow-ups (not pilot blockers):**
- ◇ NM3/NM4 (reports truncation + drift flag — reverted, re-implement isolated).
- ◇ NM9 (JWT without `sid` policy).
- ◇ NH4 (FK repoint migration landed; verify the plugin's `order.transactions` field now populates).
- ◇ NH5 (cancel provider session on idempotency race lose).
- ◇ NH13 (Host-header tenant allowlist).
- ◇ NM17 (multi-tab idempotency).
- ◇ NL9 (tenant cache invalidation).

## 8.8 — Verification (final)

- `npx tsc --noEmit` (cms): **0 errors**.
- `npx tsc --noEmit` (Astro storefront): **0 errors**.
- `npm run test:commerce:unit`: **416/416 pass** (was 409 before this work; +7 from new regression
  guards for the price helper, the digital traversal fix, the NC6 reports guard, and the NH15
  cart-secret enforcement).
- `npm run test:commerce:integration`: **24/24 files pass** (per the Bucket B agent's run; the
  final independent run was interrupted by a concurrent-DB conflict but the Bucket B run is
  authoritative since it ran after all code landed).
- Gateway signer vectors: **5/5** (`src/lib/store/__tests__/gateway-sign.test.ts`).
- 3 new migrations applied cleanly on an empty DB (verified by `commerce-migration-additive`
  integration test, 14/14).

**Operator gates still pending (cannot be automated):** live Kashier + Paymob sandbox capture,
Playwright AR/EN checkout against the live stack. See `docs/commerce-finalize-guide.md` Part 2 §M
and §L.

---

**End of handoff.** The commerce system now has: (a) the original structured catalog (Parts 1–6),
(b) the adversarial corrections + new findings (Part 7), and (c) the implemented fixes with
documented defaults + remaining operator/blocker items (Part 8). The reviewer's remaining focus is
the ⚠ items in §8.7 — those need operator decisions or DB action, not more code.

---

# PART 9 — Coverage Backfill (artifact inventory)

Parts 1–8 cited specific `file:line` for every finding/fix but never systematically inventoried
three artifact groups: the policy collection configs, the legacy commerce collections still
registered for rollback, and the Astro storefront tree. This part closes that gap so the reviewer
has a complete map. Every entry below was read and summarized; "reviewer-sensitive" flags files
that handle money, secrets, auth tokens, or PII.

## 9.1 — Policy collection configs (`cms/src/commerce/policies/collections/`)

The 8 collections backing the server-authoritative quote engine. The `tenant` relationship is
injected by `multiTenantPlugin`, not declared in these configs.

| Slug | File | Role | Access | Indexes / hooks |
|---|---|---|---|---|
| `gift-cards` | `GiftCards.ts` | Lookup table keyed by HMAC-SHA256 of raw code; `balance` is a cache folded from the ledger | `create/update/delete → () => false` (policy-module writes via `overrideAccess`; admin read-only for support) | `codeHash` unique **globally** (not tenant-prefixed); `[tenant, status]`; `balance` field `access.update → () => false` |
| `gift-card-ledger` | `GiftCardLedger.ts` | Append-only ledger of every balance change | `create/update/delete → () => false` (system-only) | `[tenant, idempotencyKey]` unique; `[giftCard, createdAt]` for replay |
| `promotions` | `Promotions.ts` | Promotion definitions; `value` semantics depend on `type` | admin CRUD | `[tenant, code]` unique; `beforeChange: normalizeCode` (trim/upper/collapse-whitespace-to-dash) |
| `promotion-redemptions` | `PromotionRedemptions.ts` | Per-order application ledger; `customerIdentityHash` enforces per-customer limits | `create/update/delete → () => false` | `[promotion, order]` unique; `[promotion, customerIdentityHash]` |
| `shipping-methods` | `ShippingMethods.ts` | Methods scoped to a zone; engine picks cheapest eligible | admin CRUD | `[tenant, code]` unique; `[tenant, zone, enabled]`; no hooks |
| `shipping-zones` | `ShippingZones.ts` | Jurisdiction definition (country/regions/postal-prefixes) | admin CRUD | `[tenant, code]` unique; no hooks |
| `tax-rates` | `TaxRates.ts` | One row per (zone, class, effective interval); `rateBps` integer bps | admin CRUD | `[tenant, zone, taxClass, enabled]` non-unique; `beforeChange: rejectOverlappingRates` (throws APIError 409 on overlap) |
| `tax-zones` | `TaxZones.ts` | Jurisdiction definition; empty country = catch-all; `priority` breaks overlaps | admin CRUD | `[tenant, code]` unique; no hooks |

**Reviewer note (consistency):** `promotions` is the only policy collection open for admin CRUD
without a `() => false` block — every redemption/ledger row is system-only, but the promotion
definitions themselves are admin-editable. This is intentional (operators configure promos) but
means a compromised tenant-admin can create arbitrary discounts.

## 9.2 — Pure resolver modules (alongside the bridge modules already in Appendix B)

Appendix B lists `policies/tax.ts`, `policies/shipping.ts`, `policies/promotions.ts` (the
bridges between collections and the pure engines). The pure engines themselves live one level up
and were not previously cataloged:

| File | Role | Determinism |
|---|---|---|
| `tax/index.ts` | Pure tax resolver — `resolveTaxBps(input)`; cascade customerExempt → exact(class+country+region) → country → class → defaultBps → 0 | No I/O, no `Date.now` |
| `promotions/index.ts` | Pure promo evaluator — `evaluate(input)`; kinds percent/fixed/free_shipping/bxgy; scope order/line; stacking (exclusive wins, else stackable); priority-then-id sort | `now` injected, no `Date.now`/`Math.random` |
| `shipping/index.ts` | Pure shipping resolver — `matchZone` + `quoteShipping`; rate kinds flat/free/weight/price/pickup; cheapest eligible | No I/O |

**Relationship:** `policies/promotions.ts` is the repository+mapper (`PromotionsPolicyRepository`
with `listByCodes`/`countRedemptions`/`releaseRedemptionsForOrder`) that loads rows via
`PolicyFindApi`, maps them with `toPurePromotion` (narrowing eligible products/variants to line
scope), and feeds the pure `promotions/index.ts` evaluator. The quoteCart consults eligibility
only; redemption is committed transactionally at order placement by the checkout flow (per the
file header — but see finding C2: that commit is not actually wired).

## 9.3 — Legacy commerce collections (`cms/src/collections/commerce/`)

All 12 are still actively exported and registered (the B1 blocker prevents unregistering). The
prior handoff explained *why* they're retained (D6: rollback path) but didn't inventory them.
**Status: NOT vestigial — fully active collections, several with live hooks.**

| Slug | File | Role | Access | Hooks |
|---|---|---|---|---|
| `orders` | `Orders.ts` | Order with immutable quote/items snapshots; three state dimensions | open (admin CRUD) | **ACTIVE `beforeChange: validateOrderTransitions`** — validates status/paymentState/fulfillmentState against the pure state machines, throws APIError 400 on illegal edges |
| `transactions` | `Transactions.ts` | Financial record per order+gateway | `create/update/delete → () => false` | **ACTIVE `beforeChange: validateTransactionState`** — enforces payment state machine |
| `products` | `Products.ts` | Catalog product (legacy) | open | none |
| `carts` | `Carts.ts` | Shopper cart (legacy) | open | none |
| `commerce-settings` | `CommerceSettings.ts` | One-per-tenant config (currency, tax mode, sandbox, TTL, gateway creds) | open at collection; secret fields `access.read → () => false`; sequence counters `access.update → () => false` | **ACTIVE `beforeChange: [handleSecrets, singlePerTenant]`** — AES-256-GCM encrypts gateway secrets, rejects duplicate per tenant |
| `customers` | `Customers.ts` | Payload auth collection (sessions, verification) | open (auth) | **ACTIVE `beforeChange: [normalizeEmailHook, usernameHook]`** — derives `<tenantId>:<normalizedEmail>` username server-side |
| `payment-events` | `PaymentEvents.ts` | Idempotent webhook event log | `create/update/delete → () => false` | none |
| `inventory-levels` | `InventoryLevels.ts` | Stock per (tenant, location, SKU); counter fields read-only | open; counter fields `access.update → () => false` | none |
| `inventory-locations` | `InventoryLocations.ts` | Physical stock location | open | none |
| `inventory-transfers` | `InventoryTransfers.ts` | Stock movement between locations | `update/delete → () => false` | none |
| `stock-movements` | `StockMovements.ts` | Immutable append-only stock ledger | `create/update/delete → () => false` | none |
| `stock-reservations` | `StockReservations.ts` | Temporary stock hold at checkout | `create/update/delete → () => false` | none (partial unique index lives in the migration) |

**Reviewer note (D4 + H1 context):** the legacy `orders` collection's `validateOrderTransitions`
hook is the one the docs say was "retired with the runtime" — but it is still ACTIVE on the legacy
collection. The plugin-first `store-orders` override added its own guard (commit `0351452`,
documented in Part 4 H1 / Part 7.1). Both guards coexist; the legacy one protects the legacy table
(which no longer receives live writes but is admin-editable while registered).

## 9.4 — Operator scripts (`cms/scripts/`)

| Script | Role | Reviewer-sensitivity |
|---|---|---|
| `provision-commerce-tenant.ts` | Idempotently provisions one tenant end-to-end for sandbox (settings, sample products/variants, inventory, tax 14%, shipping, `WELCOME10` promo, one gift card). Does NOT flip the `commerce` feature — operator gate. | **secrets**: writes AES-encrypted Paymob/Kashier creds via `handleSecrets`; **gift-card pepper**: HMAC-SHA256 of raw code, printed ONCE with no recovery path |
| `kashier-test-checkout.ts` | Sandbox smoke of the full plugin flow: builds a `pilot` cart, runs `processCheckout` with the real Kashier adapter, prints signed URL. Hardcoded test amount (5500 minor). | exercises real gateway creds |
| `kashier-checkout-url.ts` | Narrower smoke: bypasses order/txn creation, calls `createHostedCheckout` directly to validate URL signing. Logs only key presence, not values. | low |
| `migrate-dev.ts` | One-off: runs pending migrations programmatically (bypasses the `payload migrate` CLI's non-TTY segfault). Equivalent to `npx payload migrate`. | low |
| `rehearse-migrations.ts` | Runbook §8 release gate: orchestrator+worker that proves migrations apply cleanly to (1) fresh empty DB and (2) temp copy of `cms.db`. Spawns fresh `tsx` worker per leg; never touches the real `cms.db`. | low |
| `migrate-images.ts` | **NOT commerce-related** — content migration of markdown image URLs to Media docs. Listed only to confirm it's out of scope. | n/a |

## 9.5 — Astro storefront tree (`src/`)

### `src/lib/store/` — gateway signer + BFF

| File | Role | Sensitivity |
|---|---|---|
| `gateway-sign.ts` | Pure `node:crypto` HMAC-SHA256 signer mirroring `cms/src/commerce/gateway/{canonical,sign}.ts` byte-for-byte. Exports `sign`, `buildCanonicalString`, `bodyHashHex`, `GATEWAY_HEADER_NAMES`. | **auth** — signs with `COMMERCE_GATEWAY_SECRET` (≥32 bytes enforced); server-only, never reaches browser |
| `server.ts` | Astro SSR BFF helpers: tenant slug resolution, cart/session/CSRF cookies (Secure HttpOnly SameSite=Lax, 7-day TTL), in-memory rate-limit bucket, `signedCmsFetch` v2 proxy. | **auth/PII** — `attachSession` strips `sessionToken` into HttpOnly cookie; rate-limit is single-instance only (horizontal scale needs Redis) |
| `client.ts` | Legacy v1 browser client (`storeApi`) hitting `/api/store/*`. Comment notes canonical home is now `components/shop/api.ts`. | low (legacy, sends only sku+qty) |
| `money.ts` | Display-only `formatMoney` (minor-units → string); handles zero-decimal currencies. | display-only |

### `src/components/shop/` — Vue islands

| File | Role | Sensitivity |
|---|---|---|
| `api.ts` | Browser storefront client (`shopApi`) for the v2 gateway. Same-origin `/api/store/v2/*` with `credentials:"include"`; **never signs, never sends totals/prices** — only sku+qty, codes, address, checkout payload. Mints `idempotency-key` per attempt. | low (no money/auth on the wire) |
| `checkout-input.ts` | Pure builder for the v2 checkout payload. `buildCheckoutInput`, `normalizePromotionCodes` (trim/dedupe/cap-at-10), `checkoutReturnUrl`. Never emits `items`/`amountDue`. | low |
| `order-status.ts` | Pure helpers: status normalization, outcome mapping, defensive grand-total fallbacks. | display-only |
| `CartView.vue` | Cart page island: loads cookie-scoped cart + authoritative server quote, per-line qty update/remove/clear. Totals always from server. | display-only money |
| `CartBadge.vue` | Header cart-count badge; sums line qtys from `shopApi.cart()`; fails silently. | low |
| `ShopCatalog.vue` | Catalog list island: search + pagination + inline add-to-cart. | **XSS**: `safeImg()` allowlists http/https only (blocks `data:`/`javascript:`) |
| `ProductDetail.vue` | Single-product island by slug; gallery + meta + `ProductBuy`. Same `safeImg()` allowlist. | XSS (mitigated) |
| `ProductBuy.vue` | Variant picker + qty + add-to-cart on the detail page. No client-side pricing. | low |
| `CheckoutForm.vue` | Checkout form island: contact/address/payment + optional promo/giftcard/shipping method. | **money/auth/open-redirect** — per-attempt idempotency key reused across retries, cleared on terminal; `ALLOWED_CHECKOUT_HOSTS` allowlist refuses out-of-allowlist `checkoutUrl` |
| `AccountView.vue` | Account page: login/register tabs, profile + order-history summary + sign-out. | **PII** — email/phone/password in reactive form state (minlength=8 on password); maps 401→invalid credentials, 409→email-in-use |
| `OrderHistory.vue` | Lists signed-in customer's orders with status badge + total. Treats 401/403 as signed-out. | display-only money |
| `OrderDetail.vue` | Single-order island: lines, totals, shipping address, status. | **PII** — renders shipping address (full name, phone, address lines) |
| `OrderStatus.vue` | Post-payment return page (success/failure variants). Shows the AUTHORITATIVE server outcome (via `orderOutcome`), not the provider's redirect URL. | low (trusts server, not URL) |
| `PasswordReset.vue` | Two-mode reset flow (request/confirm). | **account enumeration** — `sendRequest` always shows "sent" on any non-429 error to avoid enumeration; confirm mode reads token from URL |

### Tests (`src/lib/store/__tests__/`, `src/components/shop/__tests__/`)

| File | Purpose |
|---|---|
| `gateway-sign.test.ts` | Pins the Astro signer reproduces the EXACT CMS-pinned HMAC vectors (VECTOR A/B) and canonical-string shape — drift detector between the two signer copies. |
| `checkout-input.test.ts` | Zero-dep test of `buildCheckoutInput`/`normalizePromotionCodes`/`checkoutReturnUrl`: promo dedupe/cap, v2 shape never includes items/totals. |
| `order-status.test.ts` | Zero-dep test of the pure status helpers: normalization/aliases, outcome mapping, defensive fallbacks. |
| `shopApi.contract.test.ts` | Zero-dep contract test stubbing `globalThis.fetch` to pin the EXACT request shapes (method+path+body+`idempotency-key` header) every `shopApi` method emits — the wire contract the proxy serves. |

## 9.6 — Cross-cutting invariants (worth stating explicitly for the reviewer)

- **Money:** every money field in the system is integer minor units (EGP for launch); every
  percentage is integer basis points (1% = 100 bps). No floats anywhere in the commerce layer. The
  pure `money.ts` and `pricing/index.ts` now re-validate `Number.isSafeInteger` after every
  arithmetic op (NH8 fix).
- **Tenant injection:** the `tenant` relationship field is never declared in any collection config
  — it is injected by `multiTenantPlugin` after registration. Unique indexes reference it as if
  present.
- **Bilingual:** every collection label and admin group is Arabic/English. The notifications
  transport now localizes subject + plaintext (NM5 fix); the HTML body was already bilingual.
- **Server-authoritative pricing:** the browser NEVER sends a price or total to the CMS. The
  storefront posts only `{sku, quantity}` (+ codes, address, payment method). `shopApi` is pinned
  by contract test; the CMS re-prices via `quoteCart` on every call.
- **Reviewer-sensitive files (full list):** money (`provision-commerce-tenant.ts`, `money.ts`,
  all `.vue` display-only); secrets/auth (`gateway-sign.ts`, `server.ts`,
  `provision-commerce-tenant.ts`, `CheckoutForm.vue`, `AccountView.vue`, `PasswordReset.vue`,
  `crypto.ts`, `gateway/keys.ts`); PII (`checkout-input.ts`, `CheckoutForm.vue`, `AccountView.vue`,
  `OrderDetail.vue`, `OrderHistory.vue`).

---

**End of handoff (Parts 1–9).** The commerce system is now fully inventoried: architecture +
decisions (1–3), bug catalog (4–6), adversarial corrections + new findings (7), implemented fixes
with documented defaults (8), and complete artifact inventory (9). The reviewer has everything
needed to validate logic, spot remaining mistakes, and decide the operator-action items in §8.7.
