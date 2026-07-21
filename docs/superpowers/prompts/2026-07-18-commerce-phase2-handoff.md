# Commerce remediation — Phase 2+ handoff (fresh-context prompt)

Paste this into a new, empty-context chat. It resumes a multi-phase commerce
remediation after Phase 0 + Phase 1 were completed and committed.

---

You are the integration owner for the commerce delivery work in
`C:\Users\mrt\Desktop\dgh`. A prior session completed Phase 0 and Phase 1
(commits `cce2311` → `acdc6b4`, on branch `feat/multi-tenant`, tree clean).
You are resuming in a fresh context with no memory of that session — everything
you need is below or in the referenced files.

## 1. Authoritative inputs — read completely before changing code

1. **Orchestrator prompt (controlling process + rules):** `@docs/superpowers/prompts/2026-07-18-commerce-implementation-orchestrator-prompt.md`
2. **Controlling spec:** `docs/superpowers/plans/2026-07-18-commerce-delivery-remediation-plan.md`
3. **Architecture research:** `docs/superpowers/research/2026-07-18-payload-commerce-auth-and-bff-architecture.md`
4. Historical evidence only (do not reinterpret the plan from these): `docs/superpowers/plans/2026-07-17-commerce-implementation.md`, `docs/superpowers/plans/2026-07-18-commerce-storefront-report.md`.

Follow the orchestrator prompt **verbatim**: fixed architecture, operating rules,
background-agent protocol, per-commit implementation loop, mandatory security
checks, and required final deliverables. Do not reinterpret, weaken, skip, or
substitute an explicit decision in the controlling plan. When an instruction
cannot be executed as written, stop that commit, record the blocker, keep
commerce disabled, and continue only with independent safe work.

## 2. Progress log (already committed — do not redo)

| Commit | Phase / commit | What it did | Evidence |
|---|---|---|---|
| `cce2311` | baseline | Imported the existing in-progress commerce implementation (116 files: CMS kernel, 6 migrations `20260717_100000`–`100500`, 28 tests, Astro gateway + shop pages, planning docs) as the pre-remediation baseline the plan references by `file:line`. | clean tree |
| `7f90fba` | 0.1 | Added deterministic gate scripts (`typecheck`, `test:commerce:unit`, `test:commerce:integration`, `test:commerce`, `verify:commerce`) + `cms/scripts/run-commerce-integration-tests.mjs` (Node stdlib, one process per file, stop-on-first-fail, no auto-retry). | 13/13 integration + 184 unit green |
| `5d3a5a7` | 1.1 | Wrote the C-01/C-02 exploit tests (TDD red). | 4 cases fail for the right reason on the baseline |
| `e93dd68` | 1.2 | Additive migration `20260718_100000_commerce_order_scoped_reservations`: `orders.checkout_key`/`checkout_fingerprint`/`expires_at` + unique; swapped the active-reservation unique from `(tenant,level,cart_token)` to `(tenant,level,order_ref)`; preflight backfill. | tsc clean; empty + copied-DB migrate; `active_reservations_with_null_order_ref = 0` |
| `819970d` | 1.3 | **Closed C-01/C-02.** Order-scoped `reserve` (exact-match idempotency, `CONFLICT` on mismatch), `commitOrder`/`releaseOrder`, allocate order number before reservation, `commitOrderInventory` no longer cart-scoped, `commitCart` deleted. | exploit tests green; all 13 integration files pass with the fix |
| `acdc6b4` | 1.4 | Checkout `Idempotency-Key` (RFC 4122 v4) end-to-end + SHA-256 payload fingerprint; replay returns same order, changed body → 409, concurrent same-key → one order + one reservation set. | store-checkout 8/8 (3 new idempotency cases), orders 5/5, carts-customers 3/3 |

**Status:** C-01 and C-02 are closed. Checkout request idempotency is done.
184 unit tests + 13 integration files pass; `npx tsc --noEmit` clean; migrations
validated on empty and copied DBs. Phase 0 + Phase 1 are complete and reviewed
adversarially (the one in-scope finding — dead `commitCart` — was deleted).

## 3. FIRST TASK — review the committed changes

Before writing any new code, review the six commerce commits against the plan
(§3 invariants, §4–§5) and report findings. Fix any real defect before proceeding.

```
git log --oneline 4ad44eb..HEAD        # 4ad44eb = pre-commerce "multi-tenants" base
git diff 4ad44eb..HEAD                 # full commerce diff
```

Run `/code-review` (or `/review`) on that range, and/or fan out read-only
background agents per dimension (correctness/invariants, security/tenant
isolation, migration safety, idempotency/concurrency). Trace callers of every
changed shared function. Report only actionable findings, most-severe first,
then resolve them in small commits before starting Phase 2.

## 4. THEN — complete Phases 2–15 using background agents

Execute the remaining phases in the plan's dependency order. Use background
agents for **bounded workstreams and independent review** (per the orchestrator's
background-agent protocol and per-commit loop): for each commit, one agent
inspects callers + existing tests, you implement the smallest root-cause change,
add the named regression test, run the focused gate, then an independent agent
adversarially reviews the diff. You retain responsibility for integration,
security decisions, migrations, tests, and the final report. Background agents
may write only in isolated worktrees/branches or remain read-only; never let two
agents modify shared files (`payload.config.ts`, migration index, package
manifests, middleware, storefront route helpers) concurrently.

Remaining roadmap + stop conditions:

| Phase | Focus | Stop condition |
|---|---|---|
| 2 (commits 2.1–2.4) | Durable payment processing — **C-03** | A simulated crash can never mark work complete before inventory/order side effects finish; events idempotent + retryable + reconciled. |
| 3 (3.1–3.5) | Payload customer auth + thin signed gateway + SMTP — **C-04/C-05** | An unsigned CMS call cannot reserve stock; no tenant/session leak; v1 HMAC gateway protocol verbatim + shared signature fixture. |
| 4–6 | Catalog/sellable variants, tax/shipping/promotions/gift cards, cart + checkout lifecycle | Each domain: schema + service + admin + API + storefront + tests. |
| 7 (7.1–7.3) | Payments/refunds/reconciliation | 7.3 live sandbox is **externally blocked** (real Paymob + Kashier creds + public webhook URL). |
| 8–11 | Account/orders, admin ops, fulfillment/invoices/digital, notifications/reports | Sandbox/SMTP evidence only. |
| 12 | Storefront AR/EN completeness, SEO, accessibility | After stable APIs from 4–11. |
| 13 | Playwright harness + E2E matrix + adversarial/security suite + performance ceilings | No oversell/duplicate/negative-counter/lock-leak under load. |
| 14 | Migration parity + remove `@payloadcms/plugin-ecommerce`, `@payloadcms/plugin-search`, dead cart-scoped code (`releaseCart`) | `rg` proves no callers; both lockfile installs + builds clean. |
| 15 | Release gates + controlled enablement | Automated + manual + pilot gates; commerce enabled only for the approved tenant. Several items **externally blocked** (SMTP, pilot tenant, 24h monitoring, merchant approval). |

## 5. Carry-over items (do not lose)

- **C-03 / commit 2.3 (Phase 2 entry point):** `cms/src/commerce/payments/job.ts`
  still swallows failures with `.catch(() => {})` on `setOrderPaymentState` and
  `commitOrderInventory` (the task returns success and Payload marks it complete
  even when the order/inventory side effect failed). Remove the catch-and-return-
  success; make the task `throw` so Payload's `retries` engages and the event stays
  pending for reprocessing. Rewrite event processing as a checkpointed saga (commit 2.2
  adds `foldedAt`/`orderSyncedAt`/`inventoryAppliedAt`/`transactionRecordedAt`/
  `processedAt`/`lastErrorCode`/`attemptCount` + idempotency uniques).
- **Commit 2.4:** refresh reservation TTL on idempotent re-reserve; the `commitOrder`
  skip-on-corruption path currently `continue`s silently (make it fail closed or
  surface skipped reservations). Add `reconcile-payment-events` (5 min) and
  `expire-commerce-reservations` (1 min) tasks on the `commerce` queue.
- **`commitCart`** was deleted in 1.3; **`releaseCart`** is retained (still has a
  direct test) — Phase 14.2 removes it.
- **Environmental (not a code defect):** on Windows the integration suite
  intermittently native-crashes (`@libsql/client` GC, `0xC0000005`) on the heaviest
  file (`commerce-capture-commit`). Every file passes when run individually; CI/Linux
  should be stable. A one-off native crash on a file that passes individually is an
  environmental flake — re-run that file; do not treat it as a test failure or
  "fix" it by deleting tests.

## 6. Hard external blockers — report as blocked, never fake

Phase 7.3 (real Paymob + Kashier sandbox credentials + a public webhook URL),
Phase 3.5 / 11.1 (real SMTP), Phase 15 (dedicated pilot tenant + 24h monitoring +
explicit merchant approval + a real production SQLite DB copy for the
copied-real-DB migration gate). The plan forbids simulating live acceptance.

## 7. Commands + conventions

- **cms = npm; root = pnpm.** Working dir is the repo root; `cd cms && ...` for CMS work.
- Commerce tests: `cd cms && npm run test:commerce:integration` (13 files, one Node process each);
  `npm run test:commerce:unit`; full gate `npm run verify:commerce`.
- Single file: `cd cms && npx tsx --test tests/<file>.test.ts`.
- **Rule 12:** after any Payload collection/field/endpoint/component/job change, run
  `cd cms && npm run generate:types && npm run generate:importmap && npx tsc --noEmit`.
  `cms/src/payload-types.ts` is **gitignored** (do not commit it); `cms/src/app/(payload)/admin/importMap.js` is tracked.
- Migrations are append-only; never edit `20260717_100000`–`100500` or `20260718_100000`.
  New migration next: a `20260718_HHMMSS_*` timestamp that sorts after the existing ones.
- Small reviewable commits with the plan's commit labels; no unrelated changes; end
  commit messages with `Co-Authored-By: Claude <noreply@anthropic.com>`.

## 8. Final deliverable

A release-readiness report that maps every item in the plan's "Final definition of
done" (§21) to **pass / fail / blocked / not started**, with the next exact command
or external dependency for each blocker. Separate completed code work from
externally-blocked work. "Complete" is allowed only when every item is pass and one
approved tenant is enabled deliberately.
