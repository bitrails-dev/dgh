# Plugin-first commerce delivery plan

**Date:** 2026-07-18  
**Repository:** `C:\Users\mrt\Desktop\dgh`  
**Verified implementation baseline:** `e07850c` on `feat/multi-tenant`  
**Status:** controlling implementation plan  

This plan supersedes:

- `docs/superpowers/plans/2026-07-18-commerce-delivery-remediation-plan.md`
- the implementation sequence in
  `docs/superpowers/prompts/2026-07-18-commerce-implementation-orchestrator-prompt.md`
- `docs/superpowers/prompts/2026-07-18-commerce-phase2-handoff.md`
- any earlier instruction to avoid `@payloadcms/plugin-ecommerce`

The earlier documents remain historical evidence. Do not execute their phases after this plan exists.

## 0. Executor contract

This is a decision-complete implementation specification. It is not a list of alternatives.

1. Read this file completely before modifying code.
2. Use `@payloadcms/plugin-ecommerce` `3.85.1` for every capability identified as plugin-owned
   below.
3. Do not create another product, variant, cart, address, order or transaction model.
4. Do not reimplement Phase 0 or Phase 1. They are committed through `e07850c`.
5. Preserve the Phase 1 inventory/reservation integrity layer. The installed plugin inventory is not
   equivalent; configure the plugin with `inventory: false`.
6. Keep the custom gateway HMAC/nonce protocol.
7. Keep custom tax, shipping, promotions and gift-card policy engines and persistence.
8. Keep Paymob and Kashier as narrow payment extensions over plugin orders/transactions.
9. Keep durable operational reports and complex notification orchestration.
10. Use Payload native auth/session behavior for customers; do not retain custom password/session
    cryptography.
11. Commerce stays disabled for all tenants until every release gate in this plan passes.
12. When an instruction cannot be followed exactly, stop that commit and report the blocker. Do not
    select another architecture.
13. Preserve unrelated work. Do not edit, remove, stage or commit the untracked
    `docs/superpowers/prompts/2026-07-18-commerce-phase2-handoff.md`.
14. Never modify or delete already-applied historical migrations during this cutover.

## 1. Verified facts and final decisions

### 1.1 Installed packages

- Payload: `3.85.1`
- `@payloadcms/plugin-ecommerce`: `3.85.1`
- `@payloadcms/plugin-multi-tenant`: `3.85.1`
- database adapter: `@payloadcms/db-sqlite` `3.85.1`
- the ecommerce plugin is installed but currently not imported or configured

Primary sources:

- <https://payloadcms.com/docs/ecommerce/plugin>
- <https://payloadcms.com/docs/ecommerce/payments>
- <https://payloadcms.com/docs/ecommerce/frontend>
- <https://payloadcms.com/docs/ecommerce/advanced>
- <https://payloadcms.com/docs/plugins/multi-tenant>
- installed source under `cms/node_modules/@payloadcms/plugin-ecommerce/dist`

### 1.2 Already complete — do not repeat

The following work is the immutable starting baseline:

| Commit | Completed work |
| --- | --- |
| `7f90fba` | deterministic commerce gate scripts |
| `5d3a5a7` | exploit tests for C-01/C-02 |
| `e93dd68` | order-scoped reservation migration |
| `819970d` | order-scoped reservation implementation |
| `acdc6b4` | checkout idempotency |
| `e07850c` | Phase 1 idempotency review fixes |

The implementation agent must run the Phase 1 tests and record the results. It must not create a
new “Phase 1” commit.

### 1.3 Why Phase 1 remains

The installed ecommerce plugin inventory:

- is one numeric inventory field;
- performs validate-then-decrement behavior;
- has no locations, transfers, movement ledger or order-scoped reservations;
- does not provide the existing atomic non-negative reservation invariant;
- contains no replacement for the committed order/checkout idempotency rules.

Therefore “plugin-supported inventory” is not equivalent to this repository’s required integrity
contract. Set `inventory: false` in the ecommerce plugin and retain:

- `inventory-locations`
- `inventory-levels`
- `stock-movements`
- `stock-reservations`
- `inventory-transfers`
- `cms/src/commerce/inventory/index.ts`
- Phase 1 migrations and regression tests

Do not add new inventory features. Only adapt existing reservation references from legacy products
to plugin product/variant identifiers while preserving immutable SKU keys.

## 2. Fixed launch scope

### 2.1 Plugin-owned capabilities

The plugin owns the base schema and standard operations for:

- products;
- normalized variants;
- variant types and variant options;
- EGP price fields and currency formatting;
- carts and guest-cart secrets;
- add/update/remove/clear/merge cart operations;
- addresses;
- base order records;
- base transaction records;
- customer relationships from commerce documents to `customers`;
- Payload admin CRUD for those collections.

Custom code may extend plugin collections through documented overrides. It must preserve all default
plugin fields, hooks, endpoints and access behavior unless this plan explicitly removes an endpoint.

### 2.2 Retained custom capabilities

Keep only these custom domains:

- tenant-aware Payload customer auth adapter;
- Phase 1 inventory/reservations/idempotency;
- Paymob and Kashier initiation, confirmation, signed webhooks, refunds and reconciliation;
- gateway HMAC, timestamp, nonce and replay protection;
- tax zones/rates;
- shipping zones/methods;
- promotions and redemption limits;
- gift cards and append-only balance ledger;
- server-authoritative quote calculation;
- durable order/payment notifications;
- operational commerce reports;
- Astro storefront and same-origin gateway;
- tenant feature gating and tenant-scoped permissions.

### 2.3 Explicitly removed from launch scope

Do not implement:

- a custom base product/variant model;
- a custom base cart model or cart mutation engine;
- a custom address collection;
- a parallel order collection;
- a parallel transaction collection;
- plugin inventory;
- a new inventory/reservation design;
- subscriptions;
- marketplace/vendor settlement;
- B2B pricing or purchase orders;
- multi-currency checkout; launch currency is EGP only;
- protected digital downloads;
- generic fulfillment/shipment entities;
- invoices, credit notes or Egyptian e-invoice submission;
- forecasting, BI warehouse or precomputed reporting cubes;
- a custom commerce admin application;
- replacement storefront React providers when the existing Astro/Vue client is sufficient.

If a published legacy product has `productKind = digital`, the migration preflight must block the
cutover and report its product ID. Do not silently downgrade it to physical.

## 3. Permanent collection and API contracts

### 3.1 Collision-free plugin slugs

Use these permanent slugs through `slugMap`; do not use the plugin defaults and do not reuse legacy
slugs:

| Capability | Permanent plugin slug |
| --- | --- |
| products | `store-products` |
| variants | `store-variants` |
| variant types | `store-variant-types` |
| variant options | `store-variant-options` |
| carts | `store-carts` |
| addresses | `store-addresses` |
| orders | `store-orders` |
| transactions | `store-transactions` |
| customers | existing `customers` |

Collision-free slugs permit additive migration and side-by-side parity checks. These slugs are
permanent; do not rename them back after cutover.

### 3.2 Plugin order

The `plugins` array in `cms/src/payload.config.ts` must be ordered:

1. `ecommercePlugin(pluginConfig)`
2. `multiTenantPlugin(...)`
3. `tenantFeatureAccessPlugin()`

The ecommerce plugin creates collections by appending them to the incoming config. The multi-tenant
plugin must run afterward so it can add tenant fields/access to the generated collections. The
feature plugin runs last so commerce-disabled tenants cannot access them.

Add every `store-*` slug plus `customers` and retained policy/inventory collections to the
multi-tenant collection map.

The ecommerce plugin configuration must have this shape:

```ts
ecommercePlugin({
  access: commercePluginAccess,
  addresses: {
    supportedCountries: ['EG'],
    addressesCollectionOverride: overrideStoreAddresses,
  },
  carts: {
    allowGuestCarts: true,
    cartItemMatcher: defaultCartItemMatcher,
    cartsCollectionOverride: overrideStoreCarts,
  },
  currencies: {
    defaultCurrency: 'EGP',
    supportedCurrencies: [EGP],
  },
  customers: { slug: 'customers' },
  inventory: false,
  orders: { ordersCollectionOverride: overrideStoreOrders },
  payments: {
    paymentMethods: [paymobAdapter(), kashierAdapter()],
  },
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
  transactions: {
    transactionsCollectionOverride: overrideStoreTransactions,
  },
})
```

`commercePluginAccess` is fixed:

- `adminOnlyFieldAccess`: true only for an authenticated staff user with the tenant’s
  `manageCommerce` permission;
- `adminOrPublishedStatus`: staff with permission, otherwise tenant-scoped published products only;
- `isAdmin`: authenticated staff with `manageCommerce`;
- `isAuthenticated`: any authenticated Payload user;
- `isCustomer`: authenticated `customers` user;
- `isDocumentOwner`: staff with permission, otherwise a query restricting `customer` to the current
  customer ID;
- `publicAccess`: read only, and only for the dedicated published catalog path.

The multi-tenant plugin intersects these results with tenant access. Do not use
`overrideAccess: true` before trust-boundary verification. A signed store endpoint may use a single
`withVerifiedCommerceGateway` helper that:

1. verifies signature/timestamp/nonce;
2. resolves the signed tenant slug;
3. authenticates the optional customer;
4. validates cart/customer ownership;
5. executes one Local API operation with the resolved tenant explicitly written and queried.

Only that helper may use `overrideAccess: true` for guest operations. No route may call it with a
browser-supplied tenant ID.

Both `paymobAdapter().initiatePayment`/`confirmOrder` and
`kashierAdapter().initiatePayment`/`confirmOrder` must verify the gateway signature before any
write. Do not rely on the plugin’s global payment path to establish tenant identity. Resolve the
signed tenant slug to its tenant ID, re-read the cart/order/transaction within that tenant, and
ignore any unscoped document supplied by the wrapper. Provider webhook adapter endpoints skip the
gateway check and perform provider-signature verification instead.

### 3.3 Currency

Define one exported `EGP` currency:

```ts
{
  code: 'EGP',
  decimals: 2,
  label: 'Egyptian Pound',
  symbol: 'E£',
  symbolDisplay: 'symbol',
}
```

Configure:

```ts
currencies: {
  defaultCurrency: 'EGP',
  supportedCurrencies: [EGP],
}
```

All persisted amounts remain integer minor units. Browser-provided totals are ignored.

### 3.4 Inventory

Configure:

```ts
inventory: false
```

Plugin product and variant overrides must append:

- `sku`: indexed text, trimmed and uppercased by a server hook;
- `trackInventory`: checkbox, default `true`;

Create raw unique indexes:

- `(tenant_id, sku)` for non-null product SKUs;
- `(tenant_id, sku)` for non-null variant SKUs.

Simple products store SKU on `store-products`. Variant products store SKU on each
`store-variants` row. A product with variants must have a null product-level SKU.

The retained inventory layer continues to reserve by immutable SKU. Store plugin document IDs in
reservation metadata only for traceability; SKU remains the allocation key.

### 3.5 Product and variant extension fields

The `store-products` override must preserve every default plugin field and append:

- `slug`: required, indexed text;
- `description`: localized rich text or the existing supported content field;
- `sku`: nullable indexed text;
- `trackInventory`: checkbox;
- `taxClass`: required select with `standard`, `reduced`, `zero`, `exempt`;
- `taxBps`: nullable integer override constrained to `0..10000`;
- `images`: relationship array to `media`;
- `legacyProductId`: nullable indexed integer, hidden/read-only in admin;

The `store-variants` override must preserve every default field and append:

- `sku`: required indexed text;
- `legacyVariantKey`: nullable indexed text, hidden/read-only in admin;
- `images`: relationship array to `media`.

Do not preserve the legacy JSON `variants` field after migration.

### 3.6 Customer auth

`customers` remains an application collection because the ecommerce plugin only references a
customer slug. Convert it to Payload auth with:

- `useSessions: true`;
- `tokenExpiration: 604800`;
- `maxLoginAttempts: 5`;
- `lockTime: 900000`;
- `verify: true` after SMTP validation;
- `removeTokenFromResponses: false` while the trusted Astro gateway receives and strips the token;
- `loginWithUsername.allowEmailLogin: false`;
- `loginWithUsername.requireEmail: true`;
- `loginWithUsername.requireUsername: true`.

The CMS auth wrapper derives:

`<immutable tenant numeric ID>:<normalized email>`

The browser never sends or receives this username. Tenant, username and email are immutable in the
v1 self-service profile.

Existing custom scrypt hashes are not migrated into Payload password fields. Preflight the customer
count:

- zero non-test customers: proceed;
- any non-test customer: migrate identity/profile, invalidate old sessions, and send a forced
  password-reset message after SMTP is verified.

### 3.7 Cart contract

Use plugin `store-carts` with:

- `allowGuestCarts: true`;
- default product/variant item identity;
- plugin guest-cart secret;
- plugin add/update/remove/clear/merge operations.

In `overrideStoreCarts`, set the collection HTTP `endpoints` array to empty. Reuse the plugin’s
exported `addItem`, `updateItem`, `removeItem`, `clearCart` and `mergeCart` server operations only
from signed CMS store endpoints. This prevents the generated guest-cart HTTP endpoints from
bypassing the gateway while retaining the plugin implementation.

Append only:

- `selectedShippingMethod`: relationship to retained shipping methods;
- `promotionCodes`: normalized text array, maximum 10;
- `giftCardTokenHash`: nullable text; never store a raw gift-card code;
- `quoteVersion`: integer, default `1`.

Do not add a second items field, subtotal calculation or customer ownership system.

The Astro cookie name becomes `store_cart_v2`. Do not migrate active legacy carts. At cutover:

1. stop new checkout for a short maintenance window;
2. expire `store_cart`;
3. issue `store_cart_v2` on the next cart operation;
4. retain legacy cart rows read-only for audit.

### 3.8 Order extension fields

Use plugin `store-orders` and preserve its default items, shipping address, customer/email,
transactions, amount/currency and status fields.

Append:

- `orderNumber`;
- `checkoutKey`;
- `checkoutFingerprint`;
- `paymentState`;
- `fulfillmentState` as the existing simple enum only; no fulfillment collection;
- `customerPhone`;
- `subtotal`;
- `totalDiscount`;
- `shippingPrice`;
- `totalTax`;
- `giftCardApplied`;
- `amountDue`;
- `quoteHash`;
- `quoteSnapshot`;
- `billingAddress`;
- `placedAt`;
- `expiresAt`;
- `providerReference`;
- `legacyOrderId`, hidden/read-only.

Retain unique `(tenant_id, order_number)` and partial unique
`(tenant_id, checkout_key) WHERE checkout_key IS NOT NULL`.

The plugin status is the administrative lifecycle. The retained `paymentState` is the payment
lifecycle. Do not merge these fields.

### 3.9 Transaction extension fields

Use plugin `store-transactions` and preserve its default items, payment method, billing address,
customer/email, order, cart, amount, currency and status.

Paymob and Kashier adapter groups append:

- provider transaction ID;
- provider order/reference ID;
- captured amount;
- refunded amount;
- last provider status;
- last provider event timestamp;
- reconciliation status;
- raw payload hash, never raw sensitive payload;
- legacy transaction ID, hidden/read-only.

Retain `payment-events` as the append-only signed-event and retry ledger. Do not create a second
transaction collection.

### 3.10 Retained policy persistence

Create tenant-scoped collections:

- `tax-zones`: `code`, localized `name`, normalized `country`, optional `regions`, optional postal
  prefixes, `priority`, `enabled`;
- `tax-rates`: `zone`, `taxClass`, integer `rateBps`, `pricesIncludeTax`, `effectiveFrom`,
  `effectiveTo`, `enabled`;
- `shipping-zones`: `code`, localized `name`, normalized `country`, optional `regions`, optional
  postal prefixes, `priority`, `enabled`;
- `shipping-methods`: `zone`, `code`, localized `name`, integer `basePrice`, integer
  `freeAboveSubtotal`, optional integer `minimumSubtotal`, optional integer `maximumSubtotal`,
  `enabled`;
- `promotions`: normalized `code`, `type` (`percentage`, `fixed`, `free_shipping`), integer `value`,
  integer `minimumSubtotal`, optional integer `maximumDiscount`, `startsAt`, `endsAt`,
  `totalUsageLimit`, `perCustomerLimit`, `exclusive`, eligible product/variant relationships,
  `enabled`;
- `promotion-redemptions`: `promotion`, `order`, `customerIdentityHash`, integer `discountAmount`,
  `redeemedAt`;
- `gift-cards`: `codeHash`, `lastFour`, `currency`, integer `initialBalance`, integer cached
  `balance`, `status`, `expiresAt`;
- `gift-card-ledger`: `giftCard`, optional `order`, `kind` (`issue`, `redeem`, `refund`,
  `adjustment`), signed integer `amount`, `idempotencyKey`, `createdAt`.

All money values are minor units. All rates are integer basis points. Gift-card balances change only
through append-only ledger entries in the same database transaction as the order/payment transition.

Required database constraints:

- tax-zone code unique per tenant;
- one active tax rate per tenant/zone/tax class/effective interval; reject overlapping intervals;
- shipping-zone code unique per tenant;
- shipping-method code unique per tenant;
- normalized promotion code unique per tenant;
- promotion redemption unique by promotion/order;
- gift-card `codeHash` unique globally;
- gift-card ledger idempotency key unique per tenant.

Store gift-card lookup as `HMAC-SHA256(COMMERCE_GIFT_CARD_PEPPER, normalizedRawCode)`. Show the raw
code once at issuance. Never store or log it.

One quote function is authoritative:

`quoteCart({ tenantId, cartId, shippingAddress, billingAddress, shippingMethodId, promotionCodes, giftCardCode })`

It:

1. loads the plugin cart and plugin product/variant documents server-side;
2. reads base EGP prices;
3. calculates merchandise subtotal;
4. applies eligible line promotions, then eligible order promotions;
5. rejects stacking when any applied promotion is exclusive;
6. calculates the selected shipping method from the discounted merchandise subtotal and normalized
   address;
7. applies free-shipping promotion after shipping eligibility is established;
8. calculates line and shipping tax using their resolved tax classes;
9. calculates `grandTotal = discountedMerchandise + shippingPrice + totalTax`;
10. validates the gift card and applies at most `grandTotal`;
11. calculates `amountDue = grandTotal - giftCardApplied`;
12. distributes percentage-rounding residuals deterministically to the highest-priced eligible line,
    breaking ties by product ID then variant ID;
13. returns integer totals and an immutable snapshot;
14. hashes canonical JSON with recursively sorted object keys and stable array order;
15. never trusts browser totals or eligibility results.

Promotion schedules use the tenant timezone. Promotion limits are checked and redeemed
transactionally at order placement. A failed/expired payment releases the redemption. Gift-card
redemption is committed with order placement, refunded through an idempotent compensating ledger
entry, and can never make a balance or payable total negative.

## 4. Gateway HMAC and endpoint boundary

Keep the same-origin Astro `/api/store/**` gateway. It may perform:

- tenant derivation from `locals.tenant`;
- cookie transport;
- CSRF validation;
- request size/content-type validation;
- rate limiting;
- gateway signing;
- response token stripping.

It may not calculate price, tax, discount, shipping, stock, payment or order state.

### 4.1 Signature protocol

Use exactly:

```text
v1
<UPPERCASE_METHOD>
<CANONICAL_CMS_PATH_AND_QUERY>
<LOWERCASE_TENANT_SLUG>
<DECIMAL_UNIX_SECONDS>
<LOWERCASE_UUID_V4_NONCE>
<LOWERCASE_SHA256_HEX_OF_EXACT_BODY_BYTES>
```

Fields are separated by one ASCII LF and there is no trailing LF. Use UTF-8 and
`HMAC-SHA256`. Send:

- `X-Commerce-Gateway-Key-Id`
- `X-Commerce-Gateway-Timestamp`
- `X-Commerce-Gateway-Nonce`
- `X-Commerce-Gateway-Signature`

Environment variables:

- Astro and CMS: `COMMERCE_GATEWAY_KEY_ID`, `COMMERCE_GATEWAY_SECRET`;
- CMS during rotation only: `COMMERCE_GATEWAY_PREVIOUS_KEY_ID`,
  `COMMERCE_GATEWAY_PREVIOUS_SECRET`.

Secrets must decode to at least 32 random bytes and must not reuse `PAYLOAD_SECRET` or provider
secrets. Astro signs only with the current key. CMS accepts current and optional previous key. Remove
the previous pair after all Astro instances use the current key.

Reject:

- unknown key IDs;
- non-decimal timestamps;
- timestamps more than 300 seconds from server time;
- non-v4 UUID nonces;
- signatures not exactly 64 lowercase hexadecimal characters;
- body hash mismatch;
- tenant/path/query/method mismatch;
- replayed nonce.

Add `commerce-gateway-nonces` with `id`, `key_id`, SHA-256 `nonce_hash`, `created_at`,
`expires_at`, unique `(key_id, nonce_hash)`, and an expiry index. Insert after a valid signature and
before business work. A failed business operation still consumes the nonce; a retry uses a new nonce
plus the existing checkout idempotency key. Delete expired nonces in the scheduled commerce sweep.

Use constant-time signature comparison. Serialize a request body once; hash and send the same bytes.
CMS verifies the raw bytes before JSON parsing.

Production rate limits:

- register/forgot-password/resend-verification: 5 per IP per hour;
- login/reset-password: 10 per IP per 15 minutes;
- checkout: 20 per IP per 15 minutes;
- cart/quote: 120 per IP per 15 minutes.

The in-memory limiter is permitted only for one Astro Node replica. More than one replica blocks
release until the limiter uses a shared edge/store.

### 4.2 Plugin endpoint exposure

Storefront browsers do not call plugin collection REST endpoints directly.

- Admin/staff access uses Payload admin and tenant-scoped collection access.
- Storefront access uses signed CMS store endpoints that call exported plugin operations through
  Local API.
- Public catalog reads may use a dedicated read-only route with tenant and published-status filters.
- Paymob/Kashier webhooks are exempt from gateway signatures and require provider signatures.

Cart collection HTTP endpoints are removed by the collection override. Plugin-generated payment
initiate/confirm endpoints remain registered only because payment adapters require them; the first
executable operation in every adapter function is the gateway verification/tenant re-read described
in §3.2. Direct unsigned calls receive 403 and perform no write.

## 5. Data migration contract

Migration is additive and side-by-side because plugin slugs are collision-free.

### 5.1 Preflight

Before generating or applying migration:

1. count legacy products, variants, carts, customers, orders and transactions per tenant;
2. count active reservations and unpaid orders;
3. verify every order item SKU resolves to exactly one legacy product/variant in its tenant;
4. verify every transaction resolves to exactly one order;
5. verify no published digital product exists;
6. verify no duplicate non-null SKU exists within a tenant;
7. verify all money fields are safe integers;
8. verify Phase 1 tests pass at `e07850c`.

Any failure aborts migration without writes.

### 5.2 Product migration

For each legacy product:

1. create one `store-products` document;
2. set `legacyProductId`;
3. copy localized name/title, slug, description, images and published state;
4. convert `price` to plugin `priceInEGP`;
5. copy tax fields and `trackInventory`;
6. for no-variant products, copy SKU to the product;
7. for variant products, leave product SKU null;
8. normalize each legacy JSON variant into one `store-variants` document;
9. create/reuse variant type and option rows deterministically by normalized label/value;
10. copy each variant SKU, price override and images;
11. write a migration mapping record or deterministic audit log containing old/new IDs.

Do not mutate legacy product rows during this step.

### 5.3 Customer migration

For each customer:

1. resolve immutable tenant ID;
2. derive the internal username;
3. copy email, normalized email, name, phone, locale and status;
4. do not copy password hash or salt;
5. revoke/invalidate legacy sessions;
6. mark password reset required;
7. preserve the old customer ID in hidden migration metadata until order migration completes.

### 5.4 Cart migration

Do not migrate carts. Legacy carts are ephemeral and may contain client-mutable JSON. Expire them at
cutover as specified in §3.7.

### 5.5 Order migration

For each legacy order:

1. create one `store-orders` row;
2. preserve order number, timestamps, status, payment state and simple fulfillment state;
3. map each item SKU to the migrated product/variant ID;
4. preserve the original immutable item snapshot inside the plugin item plus extension snapshot;
5. preserve all integer totals;
6. preserve shipping/billing address snapshots;
7. preserve quote hash/snapshot;
8. preserve checkout key/fingerprint and expiry;
9. link migrated customer when one exists; otherwise preserve customer email;
10. set `legacyOrderId`.

### 5.6 Transaction and payment-event migration

For each transaction:

1. create one `store-transactions` row;
2. link its migrated order;
3. copy amount/currency/status;
4. map gateway to the Paymob or Kashier plugin adapter group;
5. copy provider IDs, captured/refunded amounts and reconciliation state;
6. set hidden legacy transaction ID.

Retain existing payment-event rows. Update their order/transaction references through additive
columns; retain external `orderNumber` as the merchant reference.

### 5.7 Cutover

1. rehearse on an empty database;
2. rehearse on a copied-real database;
3. compare counts and money totals;
4. freeze checkout;
5. rerun a delta migration for orders/transactions created after rehearsal snapshot;
6. switch signed store routes to `store-*`;
7. expire legacy cart cookie;
8. run smoke checkout;
9. unfreeze checkout;
10. retain legacy tables read-only for one release.

Do not drop legacy tables in the cutover release.

## 6. Parallel-agent execution topology

### 6.1 Non-negotiable coordination rules

- All agents work in the same active checkout and active branch.
- Do not create or switch branches or worktrees.
- Background agents must not run `git add`, `git commit`, `git merge`, `git cherry-pick`,
  `git rebase`, `git stash`, `git checkout`, `git switch`, `git reset` or file-restoration commands.
- Parallel writing agents receive disjoint allowlisted paths and never edit the same file.
- The integration owner does not edit while a parallel writing wave is running.
- After every parallel wave, the integration owner waits for all agents, inspects the combined
  working tree, runs focused tests, stages each lane’s explicit files and creates the commits
  serially in the order specified below.
- Only the integration owner edits shared wiring files.
- Every agent starts from the same recorded active-branch HEAD and unchanged working tree supplied by
  the integration owner.
- Every agent returns a changed-file list, commands/results, required integration edits and blockers.
- A blocker is reported; it is never resolved by changing an architecture decision.

Only the integration owner may edit:

- `cms/src/payload.config.ts`
- `cms/src/migrations/index.ts`
- `cms/package.json` and lockfiles
- generated Payload types/importmap
- central collection, endpoint and job registries
- `src/lib/store/client.ts`
- `src/lib/store/server.ts`
- `src/middleware.ts`
- `.env.example` and `cms/.env.example`

### 6.2 Same-branch parallel lanes

The integration owner records `git rev-parse HEAD` and `git status --short` before each wave. Agents
share that checkout. Each lane may create/edit only its allowlist:

| Lane | Allowed paths |
| --- | --- |
| plugin schema | new `cms/src/commerce/plugin/**`; focused new plugin config tests |
| customer auth | `cms/src/collections/commerce/Customers.ts`; isolated customer auth modules/tests |
| migration fixtures | new migration helper/fixture/test files; never `migrations/index.ts` |
| gateway | new isolated gateway signer/verifier/nonce helpers/tests |
| policy | tax/shipping/promotion/gift-card modules, collections, repositories and focused tests |
| inventory adaptation | `cms/src/commerce/inventory/**` and its focused tests; no historical migration edits |
| Paymob | Paymob-only adapter/provider files and Paymob-only tests |
| Kashier | Kashier-only adapter/provider files and Kashier-only tests |
| operations | new notification/report modules, tasks and focused tests |
| storefront | shop pages/components and new focused UI tests, excluding shared store helpers |

If a necessary edit falls outside a lane allowlist, the agent records it under “integration-owner
edits required” and does not perform it.

## 7. Execution waves and tiny commits

### Wave 0 — serial baseline verification

#### Commit 0 — no new commit

At HEAD `e07850c`:

- run `npm --prefix cms run typecheck`;
- run Phase 1 inventory, checkout and capture tests;
- run `npm --prefix cms run test:commerce`;
- record failures without modifying Phase 1.

Gate: baseline must be green before parallel execution. If not green, stop and report the exact
failure.

### Wave A — parallel read-only contracts

Run three background agents in parallel without edits:

1. plugin/schema mapper;
2. trust-boundary mapper;
3. migration/test mapper.

Fan-in output must confirm the exact slugs, fields, access functions, routes, migrations and tests in
this plan. The integration owner corrects path drift only; no agent changes architecture.

### Wave B — plugin foundation

#### Commit B1 — `feat(commerce): add plugin collection overrides`

Plugin-schema agent may add:

- plugin currency module;
- plugin access functions;
- product/variant/cart/address/order/transaction override modules;
- focused config tests using a constructed Payload config.

It may not edit `payload.config.ts`.

Tests must prove:

- every override preserves default fields and hooks;
- expected extension fields exist once;
- plugin slugs match §3.1;
- plugin inventory is disabled;
- public writes are denied.

#### Commit B2 — `feat(commerce): convert customers to Payload auth`

Auth agent:

- adapts `Customers.ts`;
- adds server-only username derivation;
- rewrites registration/login/logout/me/reset/verify wrappers;
- adds tenant-collision tests;
- leaves shared endpoint registration to the integration owner.

Delete legacy password/session helpers only after replacement tests pass.

#### Commit B3 — `test(commerce): add plugin migration fixtures`

Migration agent adds:

- empty-database fixture;
- copied-schema fixture;
- legacy product/variant/order/transaction fixtures;
- preflight failure fixtures;
- count and money-parity assertions.

It does not create the final generated migration or edit the migration index.

#### Fan-in B — integration owner

After all three agents finish, the integration owner verifies that their changed files are disjoint.
Review and stage only B1 files, commit B1; then stage only B2 files, commit B2; then stage only B3
files, commit B3. No background agent creates these commits. Then create:

#### Commit B4 — `feat(commerce): activate tenant-scoped ecommerce plugin`

Integration owner:

- imports `ecommercePlugin`;
- keeps legacy plugin-replaced collections registered read-only during side-by-side migration;
- orders plugins per §3.2;
- adds `store-*` slugs to multi-tenant and feature maps;
- wires customer slug, EGP, overrides and `inventory: false`;
- generates types/importmap;
- runs config and tenant tests.

Feature flag remains off.

### Wave C — migration plus retained extensions

After B4 is green, fan out from its SHA.

#### Commit C1 — `migrate(commerce): add plugin-first additive schema`

Migration agent generates and audits the additive schema migration. Integration owner alone adds it
to `migrations/index.ts`.

The migration must create `store-*`, policy and nonce tables without dropping legacy tables.

#### Commit C2 — `migrate(commerce): backfill plugin commerce documents`

Migration agent implements §5 preflight/backfill with dry-run and apply modes. It must be rerunnable
without duplicates.

#### Commit C3 — `feat(commerce): retain signed gateway boundary`

Gateway agent implements:

- canonical signer;
- verifier;
- nonce ledger;
- timestamp and replay rules;
- key rotation;
- shared fixed test vectors;
- route-level reject-before-parse behavior.

It may add isolated helpers/tests only. Integration owner wires shared routes/env files.

#### Commit C4 — `feat(commerce): persist quote policies`

Policy agent:

- preserves existing pure tax/shipping/promotion/gift-card logic;
- adds the collections in §3.10;
- adds repositories;
- implements one `quoteCart`;
- tests rounding, exclusivity, limits, ledger atomicity and cross-tenant denial.

It may not create cart/product/order/transaction collections.

#### Commit C5 — `feat(commerce): adapt inventory to plugin sellables`

Inventory agent:

- does not change Phase 1 invariants;
- adapts SKU resolution to `store-products`/`store-variants`;
- adds tenant/SKU uniqueness tests;
- proves two orders on one cart cannot steal reservations;
- proves duplicate SKU lines reserve summed quantity;
- proves plugin document IDs cannot bypass tenant scoping.

### Wave D — payments and checkout integration

#### Commit D1 — `feat(commerce): implement Paymob plugin adapter`

Use plugin transaction/order documents but retain provider HMAC verification, event ledger,
idempotency and retry behavior. Do not use Stripe.

#### Commit D2 — `feat(commerce): implement Kashier plugin adapter`

Apply the same rules independently. Provider-specific canonical strings remain isolated.

#### Commit D3 — `fix(commerce): make payment side effects retryable`

Complete C-03:

- event receipt and work checkpoints are separate;
- an event is complete only after order, transaction, inventory, gift-card and notification enqueue
  checkpoints succeed;
- task throws on unfinished work;
- duplicate signed events are harmless;
- reconciliation retries unfinished work.

#### Commit D4 — `feat(commerce): wire plugin-first checkout`

Integration owner wires:

1. signed gateway request;
2. load plugin cart;
3. authoritative quote;
4. idempotent plugin order draft;
5. Phase 1 reservation;
6. plugin transaction;
7. Paymob/Kashier initiation or offline confirmation;
8. payment event processing;
9. reservation commit only after captured/approved state;
10. immutable order snapshot.

No legacy product/cart/order/transaction writes occur after this commit.

### Wave E — parallel storefront and operations

#### Commit E1 — `feat(commerce): add durable commerce notifications`

Notifications agent adds Payload jobs for:

- account verification;
- password reset;
- order placed;
- payment captured;
- payment failed;
- refund completed;
- order cancelled.

Use deterministic event keys. Never send inside the payment database transaction. Retry by throwing.

#### Commit E2 — `feat(commerce): add operational commerce reports`

Reports read `store-orders`, `store-transactions`, payment events, reservations and policy ledgers.
Provide:

- sales totals by date/tenant/status;
- payment reconciliation exceptions;
- unpaid/expired orders;
- low stock;
- promotion usage;
- gift-card liabilities;
- failed notification jobs.

Reports are tenant-scoped queries, not new shadow order/transaction tables.

#### Commit E3 — `feat(storefront): switch catalog cart account and checkout`

Storefront agent adapts Astro/Vue clients to signed routes backed by `store-*`.

Required paths:

- catalog list/detail;
- add/update/remove cart;
- guest cart;
- login/register/logout/me/reset;
- address selection;
- quote;
- checkout;
- payment redirect/return;
- confirmation/failure;
- order history/detail.

Retain Arabic and English, keyboard access, error summaries and loading/empty states.

### Wave F — serial cleanup and release

#### Commit F1 — `test(commerce): prove plugin cutover parity`

Required tests:

- product/variant count and price parity;
- order count and total parity;
- transaction amount/state parity;
- tenant isolation for every `store-*` collection;
- guest-cart secret isolation;
- Payload session cross-tenant replay regression;
- HMAC unsigned/expired/replayed/path/body/method/tenant mutations;
- checkout idempotency;
- Phase 1 reservation regressions;
- payment crash/retry/duplicate webhook;
- tax/shipping/promotion/gift-card quote and ledger;
- reports/notifications;
- Paymob and Kashier sandbox flows.

#### Commit F2 — `refactor(commerce): remove replaced runtime models`

After F1 passes, remove runtime registration and callers for:

- legacy `Products.ts`;
- legacy `Carts.ts`;
- legacy `Orders.ts`;
- legacy `Transactions.ts`;
- legacy product JSON variant access;
- legacy cart operations;
- legacy base order creation;
- custom session/password cryptography.

Do not remove historical migrations or legacy database tables.

Keep:

- Customers adapted to Payload auth;
- CommerceSettings;
- PaymentEvents;
- Phase 1 inventory collections/modules;
- policies;
- gateway;
- provider adapters;
- reports/notifications.

#### Commit F3 — `test(commerce): complete release gates`

Run:

- CMS typecheck;
- commerce unit tests;
- integration tests one file/process on Windows;
- `generate:types`;
- `generate:importmap`;
- empty DB migration;
- copied-real DB migration;
- root Astro build with reachable CMS;
- Playwright Arabic/English checkout;
- `git diff --check`.

#### Commit F4 — `docs(commerce): add plugin-first release runbook`

Document:

- required environment variables;
- worker process;
- SMTP;
- Paymob/Kashier sandbox/live switch;
- migration preflight/apply/rollback;
- checkout freeze/delta/cutover;
- tenant enablement;
- monitoring;
- rollback to legacy read-only tables;
- incident response for payment/inventory divergence.

Enable commerce for one explicitly approved tenant only after F3 and manual sandbox evidence pass.

## 8. Background-agent context packet

Every implementation agent receives:

```text
Task:
Objective:
Active branch:
Recorded starting HEAD:
Shared checkout:
Authoritative plan sections:
Allowed files:
Forbidden files:
Forbidden git operations:
Fixed input contracts:
Required output contracts:
Required tests:
Stop conditions:
Handoff format:
```

Handoff format is:

```text
Changed files:
Commands run and results:
Plan requirements satisfied:
Integration-owner edits still required:
Known blockers:
```

No agent may return “choose one of these options.” It must implement the fixed plan or return a
blocker.

## 9. Final definition of done

Commerce is deliverable only when:

- Payload ecommerce owns the base products, variants, carts, addresses, orders and transactions;
- no parallel custom base model remains active;
- Phase 1 remains green and was not reimplemented;
- plugin inventory is disabled;
- Paymob and Kashier work through plugin-backed orders/transactions;
- C-03 durable payment processing is fixed;
- customer auth uses Payload sessions and is tenant-bound;
- HMAC/nonce gateway tests pass;
- tax, shipping, promotion and gift-card policies are persisted and server-authoritative;
- operational reports and durable notifications work;
- legacy data migration parity passes;
- legacy tables remain recoverable for the cutover release;
- Arabic/English storefront checkout passes;
- empty and copied-real DB rehearsals pass;
- all security, build, sandbox and manual gates pass;
- commerce is enabled only for the approved pilot tenant.

Anything less is partial, blocked or failed—not complete.
