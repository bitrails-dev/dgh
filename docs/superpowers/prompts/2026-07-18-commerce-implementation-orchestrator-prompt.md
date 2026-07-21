# SUPERSEDED — Commerce implementation orchestrator prompt

Do not use this prompt. Use
`docs/superpowers/prompts/2026-07-18-commerce-plugin-first-orchestrator-prompt.md`, which follows the
plugin-first controlling plan.

Use this prompt verbatim with the implementation agent.

---

You are the integration owner for the commerce delivery work in
`C:\Users\mrt\Desktop\dgh`. Implement the complete approved commerce plan. You must use background
agents, but you retain responsibility for integration, security decisions, tests, migrations and the
final report.

## Authoritative inputs — read these completely before changing code

1. `C:\Users\mrt\Desktop\dgh\docs\superpowers\plans\2026-07-18-commerce-delivery-remediation-plan.md`
2. `C:\Users\mrt\Desktop\dgh\docs\superpowers\research\2026-07-18-payload-commerce-auth-and-bff-architecture.md`
3. `C:\Users\mrt\Desktop\dgh\docs\superpowers\plans\2026-07-17-commerce-implementation.md`
4. `C:\Users\mrt\Desktop\dgh\docs\superpowers\plans\2026-07-18-commerce-storefront-report.md`

The remediation and delivery plan is the controlling specification. The first two historical reports
are evidence only. Do not reinterpret, weaken, skip, or replace an explicit decision in the
controlling plan. Do not ask the user to select between alternatives already resolved there.

## Fixed architecture — do not change it

- Keep the Astro `/api/store` layer for this release, but reduce it to a same-origin commerce gateway.
  It must contain transport, cookie, CSRF, rate-limit, and server-to-server signing concerns only;
  it must not contain commerce business logic.
- Do **not** delete the gateway/BFF in this release. Direct CMS store-state endpoints must require the
  signed gateway protocol defined in the plan. A future infrastructure project may remove the gateway
  only after every plan gate for same-origin ingress, rate limiting, CSRF, cookies and end-to-end
  testing passes.
- Use Payload auth sessions for customers. Delete custom customer password hashing, HMAC sessions,
  custom session verification, and custom login-attempt tracking only after their replacement is
  proven.
- Preserve tenant-local duplicate customer email addresses by using the internal immutable composite
  Payload username exactly as specified: `<tenant numeric ID>:<server-normalized email>`. The browser
  never sends or receives that username.
- Keep the existing custom commerce domain modules. Do not install or migrate to the Payload ecommerce
  plugin.
- Implement the exact HMAC gateway protocol, nonce table, canonical-string format, key rotation, and
  shared test vectors in the plan. Do not substitute a different signature format.
- Commerce remains disabled for every tenant until the release gates pass and one tenant is explicitly
  approved.

## Operating rules

1. Work from a clean, current branch/worktree. Preserve unrelated dirty changes. Do not reset, revert,
   delete, stage, or commit unrelated work.
2. One integration owner is the only writer to a given worktree at a time. Background agents may write
   only in an isolated worktree/branch, or remain read-only. Never let two agents modify shared files
   such as `payload.config.ts`, migration indexes, package manifests, middleware, or storefront route
   helpers concurrently.
3. Use background agents for bounded workstreams and independent review. Give each agent the exact
   phase, input paths, allowed files, required tests, and done criteria. Require a concise report with
   changed files, commands run, test output, assumptions, and blockers.
4. Before merging any agent change, inspect its diff yourself, trace all callers of changed shared
   functions, run its focused tests, and run the applicable repository gates.
5. Make small reviewable commits in the order below. Do not batch unrelated phases into one commit.
6. Use additive migrations first. Copy-test generated migrations against empty and copied-real
   databases before production migration. A migration failure blocks the release.
7. Never use production secrets, production customer data, live payment credentials, or real payment
   captures in automated tests. Redact tokens, card data, signatures, passwords, reset links and gift
   card codes from logs and reports.
8. When an explicit plan instruction cannot be executed, stop that commit, record the exact blocker,
   retain the prior safe state, and continue only with independent safe work. Do not invent a design
   change.

## Background-agent protocol

First create these read-only background assignments in parallel. They produce implementation-ready
notes; they do not edit production files:

1. **Baseline and call-graph agent**
   - Scope: current commerce code, tests, migrations, package scripts, and tenant middleware.
   - Output: exact baseline commands/results, current call graph for inventory reserve/commit/release,
     checkout/order creation, payment event processing, customer auth, and every public store route.
   - Done when: every plan-mentioned file is confirmed present or a precise path correction is reported.

2. **Migration and data-integrity agent**
   - Scope: existing schema and migration conventions only.
   - Output: ordered additive migration map for reservation `order_ref`, payment work/checkpoints,
     Payload customer auth/session fields, gateway nonce table, and every later launch-scope collection.
   - Done when: it identifies constraints/indexes/backfill/preflight/rollback requirements without
     proposing alternatives to the plan.

3. **Security and edge-boundary agent**
   - Scope: Astro gateway, CMS custom endpoints, Payload auth config, cookies, CSRF, rate limiting,
     tenant resolution and webhooks.
   - Output: route-by-route trust-boundary table and a test matrix for unsigned/replayed/mutated gateway
     calls, cross-tenant sessions, auth timing, CSRF, rate limits and provider webhooks.
   - Done when: it confirms the plan's fixed architecture is implementable in the current repository.

4. **Acceptance and release agent**
   - Scope: existing test/build/Playwright setup and payment/SMTP sandbox configuration.
   - Output: command-level acceptance matrix for phases 0–15, including manual UAT and release rollback
     evidence.
   - Done when: each plan gate has an executable command or an explicitly identified external blocker.

Read all four reports, reconcile only path/name corrections with the controlling plan, then begin
implementation. If reports conflict with the controlling plan, follow the controlling plan.

For implementation, use this dependency order. You may parallelize only read-only investigation or
isolated worktrees whose changed-file sets do not overlap. Do not start a dependent phase until its
listed acceptance gate passes.

| Sequence | Plan phase / commit group | Required dependency and stop condition |
| --- | --- | --- |
| 0 | Phase 0 | Baseline scripts and focused regression harness are green before changing behavior. |
| 1 | Phase 1, commits 1.1–1.4 | Fix C-01 and C-02 completely: order-scoped reservations, quantity reconciliation, idempotency, expiry/release, and two-orders-one-cart regression. Stop on any inventory invariant failure. |
| 2 | Phase 2, commits 2.1–2.4 | Fix C-03 with durable payment-event processing, retryable side effects, reconciliation and expiry. Stop if a simulated crash can mark work complete before inventory/order effects finish. |
| 3 | Phase 3, commits 3.1–3.5 | Fix C-04/C-05 through Payload auth, thin signed gateway, SMTP lifecycle, and cleanup sequencing. Stop if an unsigned CMS call can reserve stock or any tenant/session test leaks data. |
| 4 | Phases 4–6 | Normalize catalog, price lists, tax, shipping, promotions, gift cards, carts and orders. Complete each domain's schema, service, admin, API, storefront and tests before proceeding. |
| 5 | Phases 7–11 | Payment providers/refunds, account area, staff operations, fulfillment/documents/digital delivery, notifications/reporting. Use sandbox evidence only. |
| 6 | Phase 12 | Complete Arabic/English storefront UX, SEO and accessibility only after stable APIs/contracts from phases 4–11. |
| 7 | Phases 13–15 | Security, performance and Playwright suites; migration rehearsal; tenant-enable runbook; pilot and rollback evidence. Stop release if any definition-of-done item is missing. |

## Per-commit implementation loop

For every commit group above:

1. Restate the exact plan section and invariants being implemented.
2. Ask one background agent to inspect all callers and existing tests for the affected shared functions.
3. Implement the smallest root-cause change that satisfies the stated invariant. Reuse existing project
   patterns and dependencies; do not add a library unless the plan requires it and the existing codebase
   cannot provide the capability.
4. Add the regression test named in the plan before declaring the fix complete.
5. Run focused tests, typecheck/lint/build gates relevant to modified packages, then inspect the diff.
6. Ask an independent background agent to adversarially review the diff against the relevant plan section
   and report only actionable findings.
7. Resolve findings, rerun gates, commit with the plan's commit label, and record the evidence in the
   execution log.

## Mandatory security checks

Do not mark any phase complete unless its relevant checks pass:

- A paid cheap order cannot commit reservations belonging to an unpaid expensive order sharing the same
  cart token.
- Duplicate SKU lines and changed quantities reserve exactly the final requested quantity.
- Payment events are idempotent, durable, retryable and reconciled after worker/process failure.
- A Payload session/token for tenant A cannot read or mutate tenant B, including colliding customer IDs.
- Unknown-email and wrong-password login paths have the uniform public result and equivalent password
  work required by the plan.
- Every non-catalog CMS store endpoint rejects unsigned, expired, replayed, path-mutated, body-mutated,
  method-mutated and tenant-mutated gateway requests before parsing credentials or touching commerce
  data.
- Gateway CSRF, origin, cookie flags, body-size limits and rate limits are enforced. If more than one
  Astro replica is required, block release until rate limiting becomes shared/distributed as specified.
- Paymob/Kashier webhooks retain their provider signature verification and are never accepted through
  the gateway signature as a substitute.
- Server-authoritative price, tax, shipping, promotion, stock and payment state are never accepted from
  a browser request.

## Required final deliverables

1. Implemented, tested commits for every completed plan phase, with no unrelated changes.
2. Generated migrations and evidence that empty and copied-real-DB migration rehearsals passed.
3. A concise execution log mapping every plan commit to changed files, test commands/results, migration
   evidence, reviewer findings and resolution.
4. Sandbox evidence for Paymob, Kashier and SMTP, with secrets redacted.
5. A final release-readiness report that checks every item in “Final definition of done” in the
   controlling plan as pass, fail, blocked, or not started. “Complete” is allowed only when every item
   is pass and one approved tenant is enabled deliberately.

Do not claim delivery merely because code compiles or a focused test passes. The final report must
separate completed work from blocked work and state the next exact command or external dependency for
each blocker.
