# Commerce remediation and delivery plan

**Date:** 2026-07-18  
**Repository:** `C:\Users\mrt\Desktop\dgh`  
**Branch at planning time:** `feat/multi-tenant`  
**Supersedes for future execution:** the remaining-work and architecture sections of
`2026-07-17-commerce-implementation.md` and `2026-07-18-commerce-storefront-report.md`.
Those files remain historical evidence; do not rewrite them.

## 0. Executor contract

This is an execution plan, not a menu of alternatives. Follow phases and commits in order.
Do not choose a different auth design, reintroduce the Payload ecommerce plugin, delete the
same-origin gateway, widen scope, or enable commerce early.
Do not improvise or substitute an alternative when an instruction is explicit. If an instruction
cannot be executed as written, stop that commit, record the exact blocker and keep commerce disabled.

Rules for every commit:

1. Work only in the current commerce worktree/branch.
2. Inspect `git status --short` before staging. Preserve unrelated and pre-existing changes.
3. Do not combine phases or skip a test because a later phase appears to cover it.
4. Add the smallest regression test that fails before each non-trivial fix.
5. Run the focused gate listed for the commit before continuing.
6. Keep all money as integer minor units and all rates as integer basis points.
7. Never accept a browser-supplied tenant ID, price, discount, tax, payment state, fulfillment
   state, inventory location, customer ID, or order ownership claim.
8. Every tenant-owned database query must constrain `tenant_id`, including raw SQL.
9. Every state-changing external request must be idempotent.
10. Any payment, inventory, gift-card, refund, invoice-number, or entitlement failure must fail
    closed and remain retryable. Never swallow it and report success.
11. Migrations are append-only. Do not edit `20260717_100000` through `100500`, because they may
    already exist in an environment even though commerce is currently disabled.
12. After any Payload collection, field, endpoint, component, or job change, run:
    `npm run generate:types`, `npm run generate:importmap`, and `npx tsc --noEmit` from `cms/`.
13. Integration tests that initialize Payload must run one test file per Node process on Windows.
    A native process crash is not a pass.
14. Do not toggle `commerce` on for any tenant until Phase 15 signs off every release gate.

If an external credential, real production domain, SMTP server, or public webhook tunnel is absent,
record the exact blocked checkpoint and leave commerce disabled. Do not simulate a live acceptance
result.

## 1. Validated baseline

### 1.1 Confirmed defects that this plan must close

| ID | Severity | Defect | Current evidence |
|---|---|---|---|
| C-01 | High | Paying one order commits every active reservation sharing its cart token | `cms/src/commerce/checkout/index.ts:105-120`; `cms/src/commerce/inventory/index.ts:222-246` |
| C-02 | High | Duplicate SKU lines or changed cart quantities reuse an old reservation without matching quantity | `cms/src/commerce/inventory/index.ts:94-100` |
| C-03 | High | Payment-event processing marks an event processed before order/inventory side effects, then the job swallows failures | `cms/src/commerce/payments/events.ts:56-83`; `cms/src/commerce/payments/job.ts:17-28` |
| C-04 | Medium | A session issued for tenant A can resolve a same-ID customer in tenant B | `cms/src/commerce/store/auth.ts:133-160` |
| C-05 | Low | Unknown-email login skips password verification and creates a timing signal | `cms/src/commerce/store/auth.ts:104-115` |

### 1.2 Freshly verified baseline

At planning time:

- `cd cms && npx tsc --noEmit` passed.
- `commerce-capture-commit.test.ts` passed 2/2 but covers only one order per cart.
- `commerce-store-checkout.test.ts` passed 5/5 but does not cover duplicate SKUs, changed
  quantities, or request idempotency.
- `commerce-store-auth.test.ts` passed 7/7 in isolation but its tenant test has no colliding
  tenant-B customer.
- The current reports explicitly leave gateway sandbox capture, SMTP, customer order history,
  admin actions, Playwright E2E, catalog breadth, promotion/gift/shipping/tax storefront wiring,
  invoices, digital delivery, notifications, and reporting incomplete.

### 1.3 Primary-source validation

The architecture below is based on the installed Payload `3.85.1` source plus current official
documentation:

- Payload auth collections provide password hashing, sessions/JWTs, login/logout/refresh/me,
  verification, password reset, cookie configuration, and failed-login lockout:
  <https://payloadcms.com/docs/authentication/overview>
- With `loginWithUsername.allowEmailLogin: false`, Payload makes the email field non-unique and
  authenticates by username. This permits tenant-local duplicate emails when the server creates a
  globally unique tenant-derived username. The installed implementation is
  `cms/node_modules/payload/dist/auth/getAuthFields.js`.
- Payload sessions support revocation on logout:
  <https://payloadcms.com/docs/authentication/operations>
- Payload HTTP-only cookies do not by themselves remove CSRF risk, and cross-domain cookies require
  deliberate CORS/CSRF/cookie configuration:
  <https://payloadcms.com/docs/authentication/cookies>
- Payload has failed-login lockout, not generic IP rate limiting for arbitrary custom endpoints:
  <https://payloadcms.com/docs/production/preventing-abuse>
- Payload jobs retry only when the task throws. A task must not catch a failed durable side effect
  and return success:
  <https://payloadcms.com/docs/jobs-queue/tasks>
- Scheduled tasks require both scheduling and a runner:
  <https://payloadcms.com/docs/jobs-queue/schedules>
- Paymob requires backend intention creation and treats authenticated webhooks as payment truth:
  <https://developers.paymob.com/paymob-docs/integration-paths/apis>
- The Payload ecommerce plugin offers useful generic carts/orders/variants, but its inventory is
  explicitly rudimentary and the attempted plugin transform did not compose safely with this
  repository's existing multi-tenant collections:
  <https://payloadcms.com/docs/ecommerce/plugin>
- Detailed source-by-source architecture research for this decision is preserved in
  `docs/superpowers/research/2026-07-18-payload-commerce-auth-and-bff-architecture.md`.

## 2. Final architecture decisions

These decisions are final for this delivery.

### 2.1 Keep the existing commerce kernel; do not reactivate the ecommerce plugin

- Continue with the repository-owned money, pricing, inventory, payment, order, promotion,
  shipping, tax, gift-card, and digital modules.
- Remove unused `@payloadcms/plugin-ecommerce` after all plugin imports are proven absent.
- Use Payload collections/admin/access/auth/jobs as the platform around the kernel.
- Do not maintain two order, cart, product, transaction, or inventory models.
- Use native Payload querying for catalog search in v1. Remove `@payloadcms/plugin-search` if it
  remains unused after Phase 5.

Reason: the own-collection path already contains the money and concurrency invariants the generic
plugin does not provide, and the attempted plugin transform produced duplicate/conflicting
collections.

### 2.2 Do not delete the Astro same-origin gateway in this release

Dropping it is not secure or operationally feasible under the current topology:

- Astro and Payload are separate Node/Next processes.
- One Astro deployment serves arbitrary tenant domains resolved from the request host.
- Payload has a separate configured origin.
- Direct Payload cookies from an unrelated CMS domain would be third-party cookies and cannot be
  relied upon across tenant-owned domains.
- Exposing a bearer token to browser JavaScript would regress XSS impact.
- No production edge-rewrite configuration exists in the repository that can prove same-origin
  routing for every tenant domain.

The retained gateway is deliberately narrow:

- Browser-facing path stays `/api/store/*`.
- It derives the tenant only from `Astro.locals.tenant`.
- It owns host-only HTTP-only cart and customer-session cookies.
- It enforces same-origin/CSRF and coarse IP throttling.
- It signs forwarded non-webhook commerce requests with a server-only gateway secret so callers
  cannot bypass the gateway and reserve inventory directly against the public CMS origin.
- It forwards normalized request bodies and Payload bearer tokens.
- It contains no pricing, inventory, promotion, tax, shipping, order, payment, or ownership logic.
- Read-only SSR catalog pages continue calling Payload server-to-server directly; do not add proxy
  hops to those reads.

A future infrastructure-only replacement may remove these Astro routes only after an edge proxy
serves Payload commerce endpoints beneath every tenant origin and passes the cookie, CSRF, host
binding, rate-limit, and E2E gates in this plan. That is not part of this release.

### 2.3 Replace custom customer credentials and HMAC sessions with Payload auth

Configure `customers` as a Payload auth collection:

- `useSessions: true`
- `tokenExpiration: 7 days`
- `maxLoginAttempts: 5`
- `lockTime: 15 minutes`
- `verify: true` once SMTP is configured
- `removeTokenFromResponses: false` because the trusted Astro gateway must receive the token and
  move it into its HTTP-only cookie
- `loginWithUsername`:
  - `allowEmailLogin: false`
  - `requireEmail: true`
  - `requireUsername: true`

The browser never supplies a username. The CMS registration/login wrappers derive it as:

`<tenant numeric ID>:<server-normalized email>`

The username field is hidden from admin lists, public reads, API responses, logs, emails, and
browser requests. Email remains unique only within a tenant through the existing compound database
index. Payload's globally unique username provides race-safe identity uniqueness.

Keep thin CMS auth wrappers under `/api/commerce/store/:tenantSlug/auth/*` so the route tenant is
resolved before username construction. The wrappers call Payload Local Auth operations; they do not
hash passwords or sign sessions.

The Astro gateway stores the Payload token in `store_session`, forwards it as
`Authorization: JWT <token>`, strips tokens from browser responses, and calls Payload logout before
clearing the cookie.

`removeTokenFromResponses: false` is deliberate only while the retained gateway invokes the
tenant-aware CMS auth wrappers. The token crosses one authenticated server-to-server hop and is
never returned to storefront JavaScript. If a future same-origin reverse proxy replaces the Astro
gateway and the browser uses Payload's native cookie flow, change this setting to `true` and pass
every BFF-deletion gate in the research note.

### 2.4 Launch scope

"Deliverable commerce" in this plan means a production-operable v1 store:

- Tenant-isolated catalog with categories, brands, products, variants, media, stock and one tenant
  currency.
- Customer registration, verification, login, logout, password reset, profile and addresses.
- Guest and customer carts.
- Server-authoritative prices, tax, promotions, gift cards and shipping.
- COD, bank transfer, Paymob and Kashier hosted checkout.
- Durable webhook processing, reconciliation, void and full/partial refunds where supported.
- Order history/detail, fulfillment, cancellation and returns.
- Printable commercial invoices and credit notes.
- Protected digital downloads.
- Operational email notifications.
- Payload admin workflows for catalog, settings, inventory, orders, fulfillment and refunds.
- Arabic/English storefront, product SEO/search/filtering, accessibility and Playwright E2E.
- Migration rehearsal, security tests, production runbook and monitored tenant enablement.

The following are explicitly not v1 and must not be invented by the executor:

- Marketplace aggregation, commissions, pooled settlement or split payouts.
- A shared cross-tenant customer identity.
- PCI card collection or storage.
- Egypt Tax Authority electronic-invoice submission. V1 documents are clearly labelled commercial
  invoices/credit notes, not government e-invoices.
- Recurring subscriptions or stored payment mandates. Neither gateway contract has been live
  validated for the required recurring semantics.
- Appointment/room/resource bookings. The portal/HIS booking source of truth is outside this repo.
- A separate B2B purchasing product, negotiated contracts, credit limits or approval chains.
- Advanced BI, recommendation engines, loyalty points, reviews, wishlists, multi-currency, multi-
  warehouse routing optimization, or marketplace search.

These exclusions are not incomplete implementation; they require separate product and provider
specifications.

## 3. Permanent domain invariants

1. An order owns its reservations through `order_ref`; a cart never owns committed inventory.
2. One checkout request has one tenant-scoped idempotency key and at most one order.
3. Duplicate cart lines are normalized to one sellable variant and one total quantity before
   pricing or reservation.
4. A reservation retry is idempotent only when order, inventory level, SKU, and quantity all match.
   A mismatch returns a conflict and changes no counters.
5. Payment capture commits only that order's active reservations.
6. Failed/cancelled/expired unpaid orders release only that order's active reservations.
7. `on_hand`, `reserved`, gift-card balances, promotion usage, and document sequences change inside
   database transactions and write immutable ledgers.
8. A payment event is complete only after event folding, order state synchronization, inventory
   side effect, transaction record, and required enqueue operations all succeed.
9. Webhook redirects never determine payment truth.
10. Refund does not automatically restock. Restock occurs only through an explicit return/restock
    action because payment reversal and physical receipt are different facts.
11. Historical orders, invoices, refunds and fulfillments use immutable snapshots.
12. Customers can read only their own tenant-bound records. Guest order access requires an
    unguessable per-order access token stored only as a hash.
13. Direct collection updates cannot mutate protected order/payment/fulfillment/inventory/refund
    state. All such changes go through domain actions.
14. Commerce remains disabled unless its tenant has exactly one valid live `commerce-settings`
    document.
15. Every quote, cart, auth, checkout, account and order request reaching the CMS must carry a valid
    server-to-server gateway signature. Payment webhooks use their provider signatures instead.
    Public catalog GETs may remain unsigned.

## 4. Required test command foundation

### Commit 0.1 — add deterministic commerce gate scripts

Modify `cms/package.json`:

- Add `typecheck`.
- Add `test:commerce:unit` for pure non-Payload files.
- Add `test:commerce:integration` that launches every Payload integration test in a separate
  process, sequentially, and returns non-zero if any process crashes or fails.
- Add `test:commerce` that runs unit then integration.
- Add `verify:commerce` that runs typecheck, commerce tests, generated type/import-map checks, and
  `git diff --check`.

Add `cms/scripts/run-commerce-integration-tests.mjs` using only Node standard library:

- Maintain an explicit ordered list of integration test files.
- Spawn `npx tsx --test <file>` synchronously, inheriting output.
- Stop on the first non-zero exit.
- Print the failed filename and exit code.
- Do not retry a failing file automatically; retries hide flakes.

Focused gate:

- Run `npm run test:commerce:integration`.
- Confirm the script reports the current exact count and exits zero.

## 5. Phase 1 — close inventory/order integrity defects

### Commit 1.1 — write failing exploit tests

Extend `cms/tests/commerce-capture-commit.test.ts` with:

1. Two orders share cart token C. Order 1 contains cheap and expensive SKUs. Order 2 contains only
   cheap. Capturing Order 2 must commit only Order 2's reservation; expensive stock and Order 1's
   reservation remain unchanged.
2. Two separate lines for the same SKU are normalized and reserve their summed quantity.
3. Reusing one cart token for a later checkout with a different quantity creates a distinct,
   correctly sized order reservation.
4. Committing one order twice is idempotent.
5. Releasing one order cannot release another order's reservation.

Do not change production code in this commit. Confirm at least tests 1-3 fail for the expected
reason.

### Commit 1.2 — create additive order-reservation migration

Generate a new Payload migration; use the generated timestamp/name, conceptually
`commerce_order_scoped_reservations`.

Migration up:

- Add `checkout_key` and `expires_at` to `orders`.
- Add a unique index on `(tenant_id, checkout_key)` where `checkout_key IS NOT NULL`.
- Add an index on `(tenant_id, order_ref, status)` to `stock_reservations`.
- Replace the active reservation uniqueness rule with
  `(tenant_id, level_id, order_ref) WHERE status='active'`.
- Keep `cart_token` for cart correlation/audit, but remove it from reservation identity.
- Add the required Payload document-lock relationship columns/indexes for any changed collection
  generated by Payload.

Legacy-data preflight in the migration:

- Count active reservations with null `order_ref`.
- If zero, proceed.
- If non-zero, backfill only when exactly one non-terminal order for the same tenant/cart exists.
- Abort the migration with a descriptive error if any cart maps to zero or multiple candidate
  orders. Do not guess.

Migration down must restore indexes only when the data still satisfies the old uniqueness rule.
Document that down is development-only after order-scoped data exists.

Copy-test gate:

1. Copy the current SQLite database to a scratch file.
2. Run all migrations against the copy.
3. Run a query proving no active reservation has null `order_ref`.
4. Run `npm run test:commerce:integration`.

### Commit 1.3 — allocate order identity before reservation

Modify:

- `cms/src/commerce/checkout/index.ts`
- `cms/src/commerce/orders/create.ts`
- `cms/src/commerce/orders/numbering.ts`
- `cms/src/commerce/inventory/index.ts`

Required behavior:

- Normalize input lines by trimmed canonical SKU before any product lookup.
- Reject blank SKUs, non-integer quantities, quantities below 1, and totals above a documented
  per-line/per-order ceiling.
- Sum duplicate SKU quantities with safe-integer overflow checks.
- Allocate `orderNumber` exactly once before the first reservation.
- Accept the preallocated number in `createOrder`; remove its internal allocation.
- Pass `orderRef: orderNumber` into every `reserve`.
- Write `order_ref` in the reservation INSERT.
- On idempotent reserve, load quantity/SKU/order and return success only on an exact match.
- Replace `commitCart` in capture flow with `commitOrder`.
- Add `releaseOrder`.
- Retain `commitCart`/`releaseCart` only temporarily if another verified caller needs them; otherwise
  delete them and their tests.
- If any reservation or order creation fails, release all active reservations for that order before
  returning. If compensation itself fails, throw; do not return a normal checkout error.
- Order-number gaps after failed checkout are accepted and documented. Never decrement/reuse a
  sequence.

Focused gate:

- Run capture, checkout and inventory integration tests independently.
- All new exploit tests pass.

### Commit 1.4 — add checkout request idempotency

Modify the CMS checkout endpoint, Astro checkout route, store client, and Checkout Vue component.

Contract:

- Browser sends an RFC 4122 UUID in `Idempotency-Key`.
- `CheckoutForm` creates one key when a submission begins and reuses it for network retries.
- A user editing cart/address/payment method after a completed or failed business response receives
  a new key.
- Astro validates the header shape and forwards it.
- CMS stores it as `orders.checkoutKey`.
- Repeating the key for the same tenant returns the already-created order response.
- Repeating the key with a different normalized checkout payload returns `409
  idempotency_conflict`.
- Store a SHA-256 request fingerprint over normalized line IDs/quantities, address, shipping method,
  promotion codes, gift-card code hash, and payment method.

Tests:

- Concurrent same-key requests create one order and one reservation set.
- Same key/different body returns 409.
- Same key on different tenants is independent.

## 6. Phase 2 — make payment processing durable

### Commit 2.1 — reproduce lost-side-effect failure

Add tests to `cms/tests/commerce-payments-ingest.test.ts` and
`commerce-capture-commit.test.ts`:

- Inject a failure after event folding but before order sync.
- Inject a failure after order sync but before inventory commit.
- Assert the task rejects.
- Retry and assert every unfinished step completes exactly once.
- Assert no duplicate stock movement or transaction is created.

### Commit 2.2 — add explicit payment processing checkpoints

Add a migration and collection fields to `payment-events`:

- `foldedAt`
- `orderSyncedAt`
- `inventoryAppliedAt`
- `transactionRecordedAt`
- `processedAt`
- `lastErrorCode`
- `attemptCount`

Do not use one early `processed` Boolean as the source of truth. Keep it temporarily for backward
compatibility and set it only with `processedAt`.

Add unique idempotency constraints:

- payment event: `(tenant_id, gateway, provider_event_id)`
- transaction: `(tenant_id, gateway, provider_transaction_id, type)`
- stock commit movement: unique reservation/commit semantics already enforced by reservation status

### Commit 2.3 — rewrite event processing as a retryable saga

Modify `payments/events.ts` and `payments/job.ts`:

- Each stage reads its checkpoint and skips only a completed stage.
- Fold provider state deterministically.
- Synchronize the order payment state idempotently.
- On captured state, call `commitOrder`.
- On terminal failed/voided state before capture, call `releaseOrder`.
- Record/update the provider transaction idempotently.
- Mark `processedAt` only after every required stage succeeds.
- On any failure, store a redacted error code/attempt count, then throw.
- Remove catch-and-return-success behavior.
- Set Payload task retries to 5.
- Set a per-order concurrency key so events for the same order serialize while different orders can
  proceed.

### Commit 2.4 — schedule reconciliation and reservation expiry

Add Payload tasks:

- `reconcile-payment-events`, every 5 minutes on `commerce`
- `expire-commerce-reservations`, every minute on `commerce`

Reconciliation:

- Find unprocessed or partially processed events oldest first.
- Queue the normal event task; do not duplicate processing logic.
- Bound each sweep to 100 rows.

Expiry:

- Select active expired reservations by order.
- Skip captured/partially captured orders and raise an operational error for manual reconciliation.
- Release unpaid expired orders idempotently.
- Move eligible orders to the existing cancelled/failed terminal state with reason `expired`.
- Never release a captured order.

Update the jobs config so the `commerce` schedule and runner use the same queue. Keep the documented
single long-running CMS process deployment assumption.

Gate:

- Kill/restart between saga stages in an integration test and prove recovery.
- Run the scheduler/runner locally and prove an expired order releases stock.

## 7. Phase 3 — migrate customer auth to Payload

### Commit 3.1 — add auth migration tests before schema changes

Add tests for:

- Same normalized email registers independently in two tenants.
- The same password/email login resolves the route tenant only.
- A tenant-A token is rejected on tenant B even when customer IDs collide.
- Payload logout revokes the current session.
- `allSessions=false` preserves another active session.
- Five bad passwords trigger Payload lockout.
- Unknown email and wrong password return the same public error and perform equivalent password
  work through Payload.
- Public responses never contain username, token, salt, hash, sessions, reset token or verification
  token.
- Tenant and internal username are immutable after account creation.
- Customer self-service profile changes name, phone, locale and addresses only. Email change is not
  part of v1 because it changes the tenant-derived login identity and requires a separate
  re-verification/recovery design.

### Commit 3.2 — convert Customers to Payload auth additively

Modify `Customers.ts` with the exact auth configuration in §2.3.

Field/access decisions:

- Keep tenant relationship required.
- Keep customer email as the visible address.
- Payload-generated `username` is internal and inaccessible to public reads.
- Customer collection admin access is denied to customer-authenticated users; staff access continues
  through existing tenant permissions.
- Public collection create/update/delete remains denied. Registration uses the tenant-aware wrapper.
- Customer self-read/update is exposed only through explicit store endpoints.

Migration:

- Generate Payload auth/session fields.
- Preserve legacy `passwordHash`, `passwordSalt`, verification/reset fields for one migration phase.
- Run a preflight count of existing customers.
- Because commerce has never been enabled, the expected production count is zero. If any non-test
  customer exists, stop and produce a forced-password-reset migration report; do not delete or
  silently rehash credentials.

### Commit 3.3 — replace custom auth orchestration

Rewrite `commerce/store/auth.ts`:

- Registration resolves the tenant, normalizes email, derives username, and calls Payload create
  with password.
- Login resolves tenant, derives username, and calls Payload login.
- After login, verify returned user tenant equals route tenant before returning the token.
- `me` authenticates the forwarded Payload token, verifies `req.user.collection === 'customers'`,
  and checks tenant equality before returning the public customer projection.
- Logout calls Payload logout so the database session is revoked.
- Add forgot-password and reset-password wrappers that derive/verify tenant identity without
  revealing account existence.
- Add resend-verification wrapper with uniform response.
- Delete `signSession`, `verifySession`, custom password hashing, custom attempt tracking, and timing
  workaround only after no callers remain.
- Keep gateway-secret encryption functions in `commerce/crypto.ts`.

### Commit 3.4 — minimize and harden the Astro gateway

Modify `src/lib/store/server.ts` and all `/api/store` routes:

- Rename comments from "BFF business layer" to "same-origin commerce gateway".
- Continue deriving tenant from `locals.tenant`; never accept it from path/body/query/header.
- Store only the Payload token in the HTTP-only session cookie.
- Forward it as `Authorization: JWT`.
- Strip token/cookie headers from the browser-visible JSON response.
- Logout Payload first; clear local cookie even if Payload reports an already-ended session.
- Reject mutating requests unless:
  - `Origin` exactly equals the request origin;
  - the CSRF cookie exists;
  - `X-CSRF-Token` exists and constant-time matches;
  - content type is `application/json`;
  - body is within the explicit size ceiling.
- Use `Astro.clientAddress`/adapter-provided address, not an arbitrary first
  `X-Forwarded-For` value.
- Apply limits:
  - register/forgot/resend: 5 per IP per hour
  - login/reset: 10 per IP per 15 minutes
  - checkout: 20 per IP per 15 minutes
  - cart/quote: 120 per IP per 15 minutes
- Add lazy expiry cleanup to the in-memory bucket map to prevent unbounded growth.
- Document and enforce the production invariant: one Astro Node replica. If deployment uses more
  than one replica, release is blocked until rate limiting is moved to a shared edge/store.
- Keep cookies host-only, `HttpOnly`, `SameSite=Lax`, `Secure` in production and `Path=/`.

Add server-to-server gateway authentication:

- Add `COMMERCE_GATEWAY_KEY_ID` and a separate `COMMERCE_GATEWAY_SECRET` to the root and CMS server
  environments and document both in `.env.example` and `cms/.env.example`. The key ID is a
  non-secret deployment label. The secret must decode to at least 32 random bytes and must not reuse
  `PAYLOAD_SECRET` or a payment-provider secret.
- Support `COMMERCE_GATEWAY_PREVIOUS_KEY_ID` plus `COMMERCE_GATEWAY_PREVIOUS_SECRET` on CMS only
  during a coordinated rotation. Astro always signs with the current key. Remove the previous pair
  after all Astro instances use the new key.
- Create one gateway-signing helper in Astro and one verification helper in CMS. Both helpers must
  implement the following format literally; do not invent a different canonicalization:

  ```text
  v1
  <UPPERCASE_METHOD>
  <CANONICAL_PATH_AND_QUERY>
  <LOWERCASE_TENANT_SLUG>
  <DECIMAL_UNIX_SECONDS>
  <LOWERCASE_UUID_V4_NONCE>
  <LOWERCASE_SHA256_HEX_OF_EXACT_BODY_BYTES>
  ```

  The notation above shows fields separated by one ASCII LF byte. There is no trailing LF after the
  body hash. `CANONICAL_PATH_AND_QUERY` is the CMS pathname followed, when present, by `?` and query
  entries sorted by percent-encoded key and then percent-encoded value; retain duplicate entries.
  Encode spaces as `%20`, never `+`. Use UTF-8 for both the canonical string and body bytes. A
  bodyless request hashes the zero-length byte string.
- Serialize a JSON request body exactly once in Astro. Hash and send those same bytes; never hash one
  object serialization and send another. CMS reads the body as text/bytes exactly once, verifies the
  hash and signature, consumes the nonce, and only then parses JSON.
- Compute `HMAC-SHA256(secret, canonical_string)` and send the lowercase 64-character hex digest.
  Send key ID, timestamp, nonce and signature in
  `X-Commerce-Gateway-Key-Id`, `X-Commerce-Gateway-Timestamp`,
  `X-Commerce-Gateway-Nonce` and `X-Commerce-Gateway-Signature`.
- Reject malformed key IDs, non-decimal timestamps, non-v4 UUID nonces and non-64-character
  lowercase-hex signatures before comparison. CMS verifies the signature with a constant-time
  comparison before parsing or acting on the body.
- Reject timestamps outside a five-minute window.
- Add the `commerce-gateway-nonces` table in the Phase 3 migration with `id`, `key_id`,
  `nonce_hash`, `created_at` and `expires_at`. Add `UNIQUE(key_id, nonce_hash)` and an
  `expires_at` index. Store SHA-256 of the nonce, not the raw nonce. Insert the nonce after signature
  verification and before the business operation. A unique violation is a 403 replay rejection.
  The nonce remains consumed if the business operation fails; a legitimate retry creates a new
  nonce and relies on the operation's idempotency key. Delete expired nonces in the existing
  commerce sweep.
- Bind the signed tenant slug to the route tenant. A signature for tenant A is invalid on tenant B.
- Sign quote/cart/auth/checkout/account/order requests. Public catalog GETs may remain unsigned.
- Do not apply this signature to Paymob/Kashier webhooks; they retain their provider-specific
  signature verification.
- Reject direct unsigned CMS state-changing commerce requests with 403 before any database write.
- Never log the gateway secret, raw signature, customer token, reset token, gift-card code or a
  request body containing a password.

Add gateway unit tests with mocked cookies/request context for every route. Ensure no auth or
business calculations remain in Astro.

Add CMS integration tests proving:

- unsigned direct checkout cannot reserve stock;
- unsigned direct register/login/cart/quote/order access is rejected;
- expired and replayed signatures are rejected;
- changing path, method, body or tenant invalidates the signature;
- a correctly signed request succeeds once.

Add a shared JSON fixture under `tests/fixtures/commerce-gateway-signatures.json` containing at least
five fixed inputs and expected canonical strings, body hashes and HMACs: empty GET, Arabic JSON,
duplicate query keys, percent-encoded spaces and a changed-body negative case. Run the same fixture
through the Astro signer test and CMS verifier test. The two packages do not pass this commit unless
every expected byte and digest matches.

### Commit 3.5 — SMTP and auth lifecycle

Configure `@payloadcms/email-nodemailer` from validated `SMTP_*` variables.

- Production startup with commerce enabled must fail clearly if SMTP is absent.
- Development may use a documented local capture server.
- Add Arabic and English templates for verification and password reset.
- Links return to the tenant host and language that initiated the request.
- Do not place customer existence, tokens, passwords or gateway secrets in logs.

After verified migration:

- Remove legacy credential fields in a separate cleanup migration.
- Remove custom credential tests replaced by Payload-auth integration tests.

## 8. Phase 4 — normalize catalog and sellable variants

### Commit 4.1 — add catalog collections

Create tenant-scoped, commerce-gated collections:

- `product-categories`
- `brands`
- `product-variants`
- `price-lists`
- `price-list-entries`

Schema decisions:

- Product is descriptive/catalog content.
- Every purchasable SKU is one `product-variants` document, including a single "Default" variant for
  products without options.
- `(tenant_id, sku)` is unique in one table, eliminating cross-product/base/variant SKU collisions.
- Variant fields: product, sku, title, option values, base price, compare-at price, tax class,
  weight grams, active status, inventory tracking and sort order.
- Product fields: localized name/description, tenant-unique slug, status, brand, categories, media
  relationship, product kind, SEO title/description and sort order.
- Category supports optional parent; a hook rejects cross-tenant parents and cycles.
- Price list has priority, active dates and optional customer group/channel.
- Price-list entry targets exactly one variant and stores one integer price.

Register every collection in:

- `payload.config.ts`
- multi-tenant plugin collection map
- `tenantFeatureAccess` policy map
- migration lock-document relationships

### Commit 4.2 — backfill current Product JSON safely

Migration/backfill script:

1. Parse every existing product `images` and `variants`.
2. Validate the entire dataset without writing:
   - unique tenant/SKU
   - valid JSON shapes
   - integer prices/tax
   - referenced media exists in the same allowed scope
3. Abort and print product IDs/reasons on any invalid row.
4. Create one default variant for each base product.
5. Create one variant per legacy variant JSON entry.
6. Convert image IDs to Payload relationships.
7. Re-run and prove idempotency.

Keep old columns read-only for one phase. Remove them only after storefront, checkout and tests use
the normalized collections and a parity script proves identical sellable SKUs/prices.

### Commit 4.3 — remove the 500-product price resolver ceiling

Rewrite `resolvePricedLines`:

- Accept normalized requested SKUs.
- Query only matching active variants for the resolved tenant.
- Enforce that every requested SKU resolves exactly once.
- Load related products in a bounded second query.
- Apply active price-list resolution deterministically by priority/date/customer context.
- Reject malformed database data; never skip it and continue with a partial quote.

Tests:

- More than 500 catalog products with requested SKU beyond the old boundary.
- Duplicate SKU migration rejection.
- Inactive product or variant rejection.
- Cross-tenant identical SKU resolves only the route tenant.
- Base/default and option variants use one path.

### Commit 4.4 — catalog HTTP and storefront filters

Update catalog endpoints/pages:

- Pagination with bounded `page`/`limit`.
- Search by localized product name and SKU.
- Filter category, brand, availability and integer price range.
- Sort newest, name, price ascending/descending.
- Product detail addresses by tenant-unique slug.
- Return only active product/variant/media projections.
- Return availability, never raw stock counters or internal IDs not needed by UI.

Use native Payload query/indexes. Do not add a second search index in v1.

## 9. Phase 5 — persist and integrate tax, shipping, promotions and gift cards

### Commit 5.1 — add policy collections

Create tenant-scoped collections:

- `tax-classes`
- `shipping-zones`
- `promotions`
- `promotion-redemptions`
- `gift-cards`
- `gift-card-ledger`

Required constraints:

- Tax class code unique per tenant; rate is integer basis points; optional country/region overrides.
- Shipping zone contains normalized country/region/postal rules and typed rate rows.
- Promotion code is stored normalized and unique per tenant.
- Promotion usage is an immutable redemption row unique by promotion/order.
- Gift-card raw code is shown once at issuance, then only its SHA-256/HMAC lookup hash and last four
  characters are stored.
- Gift-card ledger is immutable and each entry has a unique idempotency key.
- Gift-card balance is cached but reconstructable from the ledger.

### Commit 5.2 — connect pure policy modules to repositories

Add thin repository/adaptor functions that map Payload documents into existing pure:

- tax resolver
- shipping quote
- promotion evaluator
- gift-card ledger

Do not duplicate formulas in endpoints or Vue.

Validation:

- Reject overlapping/ambiguous shipping definitions at save.
- Promotion schedules use tenant timezone from commerce settings.
- Usage limits are checked and incremented transactionally.
- Gift-card redemption and refund are atomic and order-scoped.
- Free shipping is represented as an applied promotion and cannot make totals negative.

### Commit 5.3 — replace flat checkout quote

The authoritative quote order is:

1. Resolve tenant/settings/customer context.
2. Normalize sellable variants and quantities.
3. Resolve active price list.
4. Calculate merchandise subtotal.
5. Evaluate eligible promotion codes.
6. Quote selected shipping method against normalized address and total weight.
7. Resolve line/shipping tax classes.
8. Apply gift card capped at the payable total.
9. Produce immutable line, discount, shipping, tax and gift-card snapshots.
10. Hash the entire canonical snapshot.

The gateway amount is `grandTotal - giftCardApplied`, never the pre-discount subtotal.

Add quote, cart and checkout tests for inclusive/exclusive tax, discount stacking, free shipping,
partial gift-card payment, zero-due gift-card orders, rounding residuals and tenant isolation.

### Commit 5.4 — storefront policy UI

Add:

- promotion-code entry/removal with explicit error messages
- gift-card entry/removal without echoing full codes after application
- address form with country/region/postal normalization
- shipping method selection
- line/discount/shipping/tax/gift-card/grand-total breakdown

The browser displays server-returned quote values only.

## 10. Phase 6 — complete cart and checkout lifecycle

### Commit 6.1 — typed cart contract and merge behavior

Cart items store variant ID/SKU and quantity only; prices remain server-derived.

- Merge guest cart into customer cart on login by variant.
- Cap quantities at the checkout ceiling.
- Requote after every mutation.
- Removed/inactive variants remain visible as unavailable intent and block checkout.
- Expired carts are closed by a scheduled task.
- Empty cart clears its pending quote and promotion/gift-card selections.

### Commit 6.2 — order snapshot and guest access schema

Extend Orders with:

- customer relationship
- checkout key/fingerprint
- normalized billing/shipping snapshots
- shipping method snapshot
- applied promotion snapshots
- gift-card applied amount/reference
- quote hash
- locale
- expiresAt
- public access token hash
- cancellation/expiry reason

Add immutable `order-events` for state/audit history.

Guest checkout:

- Generate a random 256-bit access token.
- Store only its hash.
- Put the raw token in a separate host-only HTTP-only order-access cookie.
- Order status/detail requires either the owning customer session or matching guest token.

### Commit 6.3 — complete offline and zero-due flows

- COD and bank-transfer orders remain payment-pending and stock-reserved.
- Zero-due gift-card orders transition through the same captured side-effect path without a gateway.
- Bank transfer exposes tenant-configured instructions only after order creation.
- Admin confirmation of COD/bank payment writes a transaction/event, never edits payment state
  directly.
- Unpaid expiry releases order inventory and returns gift-card redemption.

### Commit 6.4 — confirmation and failure UX

Add order confirmation/status page:

- Never claim paid based on gateway redirect parameters.
- Poll the tenant-bound order status endpoint with bounded backoff.
- Show pending, paid, failed and expired states.
- Gateway return URLs carry only the order number/reference needed for lookup; ownership still
  requires customer/guest authentication.
- Refreshing the page does not recreate checkout.

## 11. Phase 7 — complete payments, refunds and reconciliation

### Commit 7.1 — freeze provider contracts against current docs

For each Paymob/Kashier adapter:

- Record sandbox/live base URL and credential names.
- Record exact hosted-checkout request/response fields.
- Record webhook signature fields/order/encoding.
- Record capture, void, full refund and partial refund support.
- Record provider idempotency/reference limits.
- Reject unsupported operations using capability results; never fake success.

Update fixture tests to match provider documentation and store sanitized fixtures.

### Commit 7.2 — add refund/void domain and collections

Create:

- `refunds`
- optional `disputes` only if provider webhook fixtures expose a stable dispute event

Refund fields:

- tenant/order/transaction
- requested amount/reason
- provider reference
- state
- idempotency key
- requested/processed timestamps
- requester actor

Rules:

- Sum of successful and pending refunds cannot exceed captured amount.
- Void only an authorized, uncaptured transaction and only if provider supports it.
- Partial/full refund calls the adapter, waits for webhook/provider truth, updates payment state,
  writes transaction/order event and issues credit note.
- Restock is a separate explicit return action.

### Commit 7.3 — live sandbox acceptance

This commit cannot be marked complete without real credentials and a public webhook URL.

For both gateways:

1. Create hosted checkout for a sandbox order.
2. Complete a successful payment.
3. Prove signed webhook ingestion.
4. Prove duplicate webhook idempotency.
5. Prove order capture and exact inventory commit.
6. Perform supported void/refund operations.
7. Prove refund webhook/state/credit note.
8. Submit an invalid signature and prove no state changes.
9. Save redacted request IDs, timestamps and expected database state in the runbook.

Browser redirects are not acceptance evidence.

## 12. Phase 8 — customer account and order APIs

### Commit 8.1 — profile and addresses

Add tenant-scoped customer addresses with explicit owner access.

- Customer may create/read/update/delete only own addresses.
- Address tenant is taken from authenticated customer, not body.
- Prevent deleting an address referenced by an active cart; historical orders retain snapshots.
- Support default billing/shipping per tenant customer.

### Commit 8.2 — order history/detail

Add:

- `GET /orders` paginated newest first
- `GET /orders/:orderNumber`
- `POST /orders/:orderNumber/cancel`

Ownership:

- Customer relation and tenant must both match session.
- Guest requires the order access token.
- List is never available to guest tokens.

Cancellation calls the domain cancellation guard, releases inventory/gift-card use when allowed,
queues notification, and writes an order event.

### Commit 8.3 — account storefront

Replace "not available yet" with:

- verified profile
- address management
- order list
- order detail/timeline
- allowed cancellation
- invoice/credit-note links
- digital entitlements
- password change and session logout

Arabic and English text must be complete; no placeholder copy.

## 13. Phase 9 — safe Payload admin operations

### Commit 9.1 — expand and enforce commerce permissions

Use the existing 10-key commerce permission matrix as the only staff authorization source.
Map each action explicitly:

- catalog manage
- inventory view/adjust/transfer
- orders view/manage
- fulfillment
- payments view/capture/manual confirm
- refunds
- promotions/gift cards
- settings
- reports

Sensitive action handlers call `reloadEffectivePermissions` immediately before mutation.
Super-admin bypass remains explicit.

### Commit 9.2 — lock protected fields

In Orders, Transactions, Refunds, InventoryLevels, Reservations, GiftCards and ledgers:

- Make computed/state/sequence/counter/provider fields read-only in admin.
- Deny field-level direct updates even when the transition would be legal.
- Keep immutable ledgers create/update/delete denied through REST/GraphQL/admin.
- Domain modules use `overrideAccess` only after authorization and invariant checks.

### Commit 9.3 — add admin action endpoints and minimal controls

Build actions, not a second admin application:

- stock receive/adjust/damage
- inventory transfer request/ship/receive/cancel
- mark bank/COD payment confirmed
- fulfill partial/full quantities
- add tracking carrier/number
- mark shipped/delivered/returned
- cancel order
- request refund/void
- restock returned items
- resend order email

Each button:

- appears only with permission and legal state
- opens a confirmation form for required reason/quantity/reference
- calls one endpoint
- shows returned error without optimistic state changes
- refreshes the document after success

### Commit 9.4 — order detail panel

Add a read-only admin panel showing:

- immutable order lines/totals/address
- payment transactions/events
- reservations/stock movements
- fulfillments/tracking
- refunds/credit notes
- order event timeline

Reuse Payload components and existing admin styling. Do not build a custom dashboard framework.

## 14. Phase 10 — fulfillment, documents and digital delivery

### Commit 10.1 — fulfillment model

Create `fulfillments` with immutable line quantities and tracking snapshots.

- Total fulfilled per order line cannot exceed ordered quantity.
- Partial fulfillment derives order fulfillment state.
- Shipping/delivery transitions follow the state machine.
- Returns reference fulfilled quantities and cannot exceed them.
- Restock writes inventory movements at the selected location.

### Commit 10.2 — invoices and credit notes

Create tenant-scoped:

- `invoices`
- `credit-notes`

Use atomic per-tenant sequences from CommerceSettings.

- Issue invoice on capture or explicit offline-payment confirmation.
- Issue credit note on successful refund.
- Snapshot seller identity, customer identity, lines, discounts, tax, totals, currency and source
  order/refund.
- Records are immutable after issuance.
- Expose printable Arabic/English HTML with print CSS and stable URLs.
- Clearly label them "Commercial Invoice" / "Credit Note"; do not claim ETA submission/compliance.

No PDF library is added in v1. Browser print-to-PDF covers delivery until a legal e-invoice
integration is specified.

### Commit 10.3 — protected digital products

Create a private `digital-files` upload collection and `download-entitlements`.

- Direct public read of digital files is denied.
- Digital variants reference private files.
- Capture creates an entitlement idempotently per order line/file/customer or guest access token.
- Download endpoint verifies tenant, entitlement, ownership, expiry/download limits and signed
  short-lived token.
- Resolve storage paths through the existing safe path resolver.
- Stream files without returning filesystem paths.
- Log download audit metadata without tokens.

Test path traversal, expired/tampered token, cross-tenant entitlement and direct media URL denial.

## 15. Phase 11 — notifications and operational reporting

### Commit 11.1 — durable email tasks

Add queued, retryable notifications:

- account verification
- password reset
- order placed
- payment confirmed/failed
- bank-transfer instructions
- order cancelled/expired
- shipment/tracking
- delivered
- refund/credit note
- digital entitlement

Use immutable event/idempotency keys so retry does not send duplicates. Store delivery status and a
redacted error. Choose Arabic/English from order/customer locale.

### Commit 11.2 — operational reports

Add tenant-scoped, permission-checked report endpoints:

- sales by day/payment method
- order/payment/refund counts
- tax/discount/shipping totals
- low/out-of-stock variants
- reserved inventory aging
- unprocessed payment events
- expiring carts/unpaid orders
- gift-card liability

Queries use bounded date ranges and database aggregation. Add CSV export using Node standard
library/string escaping; no BI dependency.

Add a minimal Payload admin report view with filters and download links.

## 16. Phase 12 — storefront completeness, SEO and accessibility

### Commit 12.1 — catalog pages

Complete:

- category and brand pages
- search/filter/sort/pagination
- variant option selection
- image gallery with alt text
- availability and low-stock messaging
- localized money/labels
- empty/error/loading states

### Commit 12.2 — SEO

- Per-product/category/brand title and description.
- Canonical tenant-domain URLs.
- Arabic/English `hreflang`.
- Product JSON-LD using server-authoritative price/currency/availability.
- Product/category URLs in sitemap only when commerce is enabled and content active.
- Noindex cart, checkout, account, order status and search-result pages.

### Commit 12.3 — accessibility

- Keyboard-operable variant, cart, dialog and checkout controls.
- Visible focus.
- Programmatic labels and error summaries.
- `aria-live` for cart/quote status.
- Logical CSS properties and correct RTL order.
- WCAG AA contrast.
- Do not use color alone for payment/stock/order status.

## 17. Phase 13 — complete automated acceptance

### Commit 13.1 — Playwright harness

Add root Playwright configuration and scripts that:

- create/migrate/seed a unique temporary SQLite database
- start CMS and Astro on free deterministic ports
- wait for health endpoints
- run tests serially where money/inventory state is shared
- always stop processes and remove the temporary DB
- preserve trace/screenshot on failure

### Commit 13.2 — E2E matrix

Cover:

1. Disabled tenant receives 404 for shop and store APIs.
2. Tenant A catalog/cart/customer/order never appears on tenant B host.
3. Guest browse → cart → promotion → shipping → COD → confirmation.
4. Register → verify → login → cart merge → checkout → order history.
5. Same email exists in two tenants with isolated sessions.
6. Duplicate submit creates one order.
7. Paymob/Kashier mocked hosted redirect does not mark paid.
8. Signed webhook marks paid and commits exact order inventory.
9. Failed webhook signature changes nothing.
10. Expired unpaid order releases inventory and gift card.
11. Admin fulfills and customer sees tracking.
12. Refund produces payment state and credit note without implicit restock.
13. Explicit return/restock changes inventory exactly once.
14. Digital entitlement downloads; cross-tenant/tampered URL fails.
15. Arabic and English checkout/account paths.

### Commit 13.3 — adversarial/security suite

Automate:

- original cheap-order inventory drain exploit
- duplicate/change quantity under-reservation
- payment side-effect retry failures
- cross-tenant colliding customer session
- login timing regression at function-work level
- CSRF missing/mismatch/cross-origin
- tenant slug/body spoofing
- order-number enumeration without ownership
- idempotency replay with changed body
- promotion/gift-card concurrency
- webhook replay/out-of-order delivery
- refund over-capture
- path traversal and signed download tampering
- direct protected collection mutation

### Commit 13.4 — performance ceilings

Record and test explicit v1 ceilings:

- 100 distinct lines/order
- 999 quantity/line unless product policy is lower
- 1 MiB JSON request body
- 100 products/catalog page
- 100 orders/account page maximum
- report date range maximum 366 days
- sweep batch maximum 100

Load-test concurrent reservation of the last unit and concurrent same-key checkout. No oversell,
duplicate order, negative counter or SQLite lock leak is allowed.

## 18. Phase 14 — migrations, cleanup and dependency removal

### Commit 14.1 — schema parity and cleanup gate

Before destructive cleanup:

- Run parity scripts for product/variant SKUs/prices/media.
- Prove no legacy customer credential is needed.
- Prove no null order_ref on active reservations.
- Prove every captured order has committed reservations or a recorded non-stock product reason.
- Prove cached inventory/gift-card counters reconstruct from ledgers.

Only then generate cleanup migrations for:

- legacy Product JSON images/variants/base sellable fields
- custom customer password/session fields
- obsolete payment `processed` Boolean if all code uses checkpoints
- unused cart-scoped inventory indexes

### Commit 14.2 — remove unused dependencies/code

- Remove `@payloadcms/plugin-ecommerce`.
- Remove `@payloadcms/plugin-search` if native search remains final.
- Keep `@payloadcms/email-nodemailer`.
- Delete dead custom auth crypto/password code.
- Delete dead cart-scoped commit/release functions.
- Run `rg` proving no imports/callers remain before deletion.

Run both lockfile installs/builds and `git diff --check`.

## 19. Phase 15 — release and tenant enablement

### 19.1 Automated release gate

All must pass from a clean checkout:

- CMS install with lockfile
- root install with lockfile
- Payload types generation
- Payload import-map generation
- CMS TypeScript
- root Astro build while CMS is reachable
- CMS Next production build
- all commerce unit tests
- all commerce integration tests, one process per file
- all existing non-commerce regression suites
- Playwright E2E
- migration from empty DB
- migration on a copy of the current real DB
- migration/backfill idempotency scripts
- `git diff --check`

### 19.2 Manual security/operations gate

- Review every public commerce endpoint and response projection.
- Verify production cookie flags and origin/CSRF rejection.
- Verify generic rate-limit topology is one Astro replica or a shared edge limiter.
- Verify CMS is a long-running process with persistent SQLite volume and exactly one writer.
- Verify WAL backup/restore and restore a backup in a scratch environment.
- Verify commerce job schedules and runner.
- Verify SMTP deliverability.
- Verify both real sandbox gateway flows.
- Verify webhook monitoring and reconciliation.
- Verify no secrets/card data/tokens in logs or stored webhook payloads.
- Verify staff permissions with super-admin, tenant admin, inventory-only, fulfillment-only,
  refund-only and unauthorized users.

### 19.3 Controlled enablement

1. Keep all existing tenants disabled.
2. Create a dedicated internal pilot tenant.
3. Configure complete settings, SMTP and sandbox gateways.
4. Run the full UAT checklist and record pass/fail evidence.
5. Enable commerce for the pilot only.
6. Monitor 24 hours:
   - job failures
   - unprocessed payment events
   - reservation aging
   - order/payment/inventory mismatches
   - email failures
7. Reconcile every pilot transaction manually.
8. Only after zero unresolved discrepancies, enable one real tenant in sandbox/training mode.
9. Production gateway activation requires explicit merchant approval and a final low-value
   end-to-end transaction/refund.

## 20. Required documentation

Before release, create/update:

- `docs/commerce/architecture.md`
- `docs/commerce/api-contracts.md`
- `docs/commerce/state-machines.md`
- `docs/commerce/security-model.md`
- `docs/commerce/admin-runbook.md`
- `docs/commerce/payment-reconciliation-runbook.md`
- `docs/commerce/migration-runbook.md`
- `docs/commerce/gateway-sandbox-evidence.md`
- `docs/commerce/release-checklist.md`

Each runbook includes exact commands, expected output, rollback/stop conditions, and whom/what needs
manual intervention. Never copy live secrets or full customer PII into documentation.

## 21. Final definition of done

Commerce is deliverable only when:

- C-01 through C-05 have regression tests and fixes.
- No cart-scoped operation can commit/release order inventory.
- Payment work survives process failure and retries unfinished side effects.
- Customer auth uses Payload sessions and tenant-derived identity; custom HMAC sessions/password
  storage are gone.
- The Astro gateway contains transport/security only and has passed same-origin/CSRF/cookie tests.
- Every non-catalog CMS store endpoint rejects unsigned, expired, replayed or tenant-mismatched
  gateway requests before parsing credentials or touching commerce data.
- Every launch-scope module in §2.4 has schema, domain wiring, API/admin/storefront exposure and
  tests.
- Admin staff can operate catalog, inventory, orders, payments, fulfillment and refunds without
  directly editing protected state.
- Customers can complete and inspect a real order in Arabic and English.
- Paymob and Kashier sandbox evidence exists.
- SMTP evidence exists.
- Empty and copied-real-DB migrations pass.
- Automated, manual and pilot gates all pass.
- Commerce is enabled only for the explicitly approved tenant.

Anything less must be reported as partial, blocked, or failed—not complete.
