# Commerce Review, Remediation, and Next Work

**Review date:** 2026-07-22  
**Branch / baseline:** `feat/multi-tenant` at `c5c7ef3`, including the current uncommitted commerce remediation  
**Detailed historical evidence:** `docs/commerce-reviewer-handoff.md`  
**Current-state authority:** this report supersedes handoff statements that say the legacy four
collections are still registered or that product content is not localized.

## Executive verdict

The implementation is a credible plugin-first commerce foundation, but it is not yet a complete,
production-ready commerce platform. Payload's ecommerce plugin correctly remains the owner of the
base catalog, variant, cart, address, order, and transaction models. Custom code is concentrated in
capabilities the plugin does not provide: tenant isolation, reservation-based inventory, tax,
shipping, promotions, gift cards, payment gateways, notifications, reporting, and storefront APIs.

The duplicate admin/data-model surface has now been removed, and customer-facing product content is
localized in Arabic and English. The largest confirmed product gap is tiered/volume pricing. The
largest launch risks remain incomplete gift-card and promotion accounting, missing edge protection,
and production/operator validation.

This review does not treat “every feature found on any ecommerce site” as a finite acceptance
criterion. A professional platform should instead have a documented capability matrix tied to the
actual B2C/B2B business model, with launch gates for money, inventory, security, and operations.

## Review scope

The review traced the active Payload configuration, plugin overrides, storefront catalog flow,
migrations, and commerce tests. It checked the implementation along two independent axes:

- **Standards:** no actionable violation was found. The localization design follows the repository
  convention: Arabic is the default, English is supported, and each concept uses one Payload
  localized field rather than parallel `nameAr` / `nameEn` fields.
- **Requested behavior:** the duplication and product-localization requirements are implemented.
  The “full-blown commerce” and tiered-pricing requirements remain partial.

## Edits completed

### 1. One canonical commerce data model

The legacy `products`, `carts`, `orders`, and `transactions` Payload collections were removed from
the active configuration and exports. Tenant feature gating no longer references them. The only
active models for these concepts are the plugin-owned collections:

| Concept | Canonical collection |
|---|---|
| Product | `store-products` |
| Cart | `store-carts` |
| Order | `store-orders` |
| Transaction | `store-transactions` |

An invariant test now fails if the four legacy slugs are registered again. Tests that previously
counted or wrote legacy documents were updated to verify only the canonical plugin surface.

Historical legacy database tables were deliberately not dropped. They are inert—not registered in
Payload and not used by runtime reads or writes—but retain rollback/audit value. Dropping them is a
separate production data-retention decision after parity and backup verification.

### 2. Multilingual products

`store-products.name` and `store-products.description` now use Payload localization. Catalog list
and detail requests validate and pass `ar` or `en` through the Astro client, proxy, CMS endpoint, and
Payload query. The catalog integration test stores both translations and verifies locale-specific
reads and search.

A forward/backward migration moves existing scalar product and version content into Payload locale
tables. Existing values are preserved as Arabic, the configured default locale; English can use the
configured fallback until editors provide a translation.

**Pre-deploy data check:** the migration assumes existing scalar content is Arabic. Confirm that
assumption against production data before migration; otherwise classify/backfill affected rows with
an explicit locale rather than silently labelling English content as Arabic.

### 3. Plugin relationship and migration correctness

Removing the legacy transaction collection exposed a plugin factory defect: the default order
relationship still targeted `transactions`. The order override now rewires it to
`store-transactions`, and a corrective migration rebuilds the relation column accordingly.

Previously authored safety/backfill migrations that were imported but not registered are now part
of the migration list. The two new migrations must be included when this working tree is committed.

## Verification performed

| Gate | Result |
|---|---|
| CMS TypeScript typecheck | Pass |
| Commerce unit suite | **418/418 pass** |
| Feature-gating + plugin override invariants | **99/99 pass** |
| Store catalog integration | **14/14 pass**, including AR/EN reads and migrations |
| Storefront API contract | **20/20 pass** |
| Cutover parity integration | **7/7 pass** |
| State enforcement integration | **2/2 pass** |
| Payment durability integration | **9/9 pass** |
| Plugin checkout integration | All 4 subtests pass; Windows libsql exits afterward with the runner's known tolerated teardown code |
| Generated Payload types/import map | Pass; no unexpected generated diff |
| `git diff --check` | Pass; line-ending warnings only |
| Root production build | Environment-blocked: content sync could not reach Payload at `http://localhost:3001` |

The root build must be rerun with Payload available before release. Live payment sandbox capture and
an Arabic/English browser checkout remain operator-owned release gates.

## What is still missing

### P0 — Required before pilot or production enablement

1. **Close gift-card accounting.** Checkout can quote a gift card but does not atomically debit the
   ledger. Implement redemption/refund transactions and prove replay and rollback behavior.
2. **Close promotion accounting.** Persist promotion redemption atomically with the order; enforce
   total and per-customer quotas under concurrency; release usage on eligible cancellation.
3. **Provide controlled gift-card issuance.** The provisioning script is not a professional
   operator workflow. Add an authorized admin action with audit history, or disable gift cards.
4. **Protect public commerce edges.** Decide and implement gateway signing and/or rate limiting for
   catalog/quote, plus CSRF and rate limiting for the v2 proxy.
5. **Remediate migrated reset tokens.** If the old backfill ran against production, force fresh
   password-reset issuance or disable affected accounts until reset. A code fix cannot repair
   already-written predictable tokens by itself.
6. **Confirm the product-language backfill rule.** Validate that existing scalar product content is
   Arabic before applying the localization migration, or change the migration/backfill procedure.
7. **Run release proof.** Exercise Kashier and Paymob sandboxes, webhook replay/idempotency,
   inventory recovery, and full AR/EN browser checkout against the deployed stack.

### P1 — Core platform upgrade

1. **Tiered and contextual pricing — highest product priority.** Add one server-owned pricing model
   for quantity breaks, price lists, customer groups, scheduled prices, and optional contract
   prices. Resolve the effective unit price in quote/checkout; never trust a storefront price.
   Persist the chosen rule and price snapshot on cart/order lines for audit and refunds. Enforce
   non-overlapping tiers, currency consistency, tenant scope, date windows, deterministic priority,
   and concurrency-safe publication.
2. **Returns, exchanges, and RMA workflow.** Add request, approval, receipt, disposition, refund or
   exchange, inventory effect, reason codes, customer communication, and operator audit trail.
3. **Financial documents and reconciliation.** Add invoice/credit-note numbering and rendering,
   tax snapshots, settlement reconciliation, dispute/chargeback handling, and exportable audit data.
4. **Order operations.** Add partial fulfillment, shipment/tracking events, split shipments,
   partial cancellation, backorder/preorder policy, and explicit service-level states.
5. **Search and merchandising.** Add filters/facets, sorting, collections/categories, related
   products, canonical SEO metadata, localized slugs/SEO policy, and merchandising rules.
6. **Reconcile the historical handoff.** Update or archive stale sections of
   `docs/commerce-reviewer-handoff.md` so future implementers do not restore the removed legacy
   collections or repeat completed localization work.

### P2 — Expected maturity features, selected by business need

- Wishlists, product reviews/moderation, comparison, recommendations, and recently viewed items.
- Abandoned-cart recovery, consent-aware marketing events, campaign attribution, and analytics.
- Customer service tooling: impersonation with audit controls, notes, resend actions, and timeline.
- Multi-currency display/settlement, additional locales, and market-specific tax/compliance only
  when the business expands beyond the current EGP / AR-EN boundary.
- Subscriptions, marketplace vendors, loyalty, store credit, or B2B approvals only when a validated
  business requirement exists; these should not be speculative core abstractions.

## Recommended next delivery sequence

1. Close the P0 money/security defects and complete live release proof.
2. Design and implement tiered pricing as a plugin extension, not a second product model.
3. Add returns/RMA and financial reconciliation before adding growth features.
4. Add order-operations depth, then search/merchandising.
5. Select P2 features from measured customer/operator demand.

Each phase should keep the plugin-owned `store-*` collections canonical. New capabilities should
attach through Payload fields, hooks, or bounded policy collections; they must not introduce a
parallel product, cart, order, or transaction source of truth.
