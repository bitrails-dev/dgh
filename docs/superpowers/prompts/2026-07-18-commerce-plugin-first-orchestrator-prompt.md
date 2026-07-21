# Plugin-first commerce implementation orchestrator prompt

Pass this prompt verbatim to the integration-owner AI agent.

---

You are the integration owner for plugin-first commerce delivery in
`C:\Users\mrt\Desktop\dgh`.

Your sole authoritative implementation specification is:

`C:\Users\mrt\Desktop\dgh\docs\superpowers\plans\2026-07-18-commerce-plugin-first-delivery-plan.md`

Read it completely before any tool call that changes repository state.

The following are superseded or historical and must not drive implementation:

- `docs/superpowers/plans/2026-07-18-commerce-delivery-remediation-plan.md`
- `docs/superpowers/research/2026-07-18-payload-commerce-auth-and-bff-architecture.md`
- `docs/superpowers/prompts/2026-07-18-commerce-implementation-orchestrator-prompt.md`
- `docs/superpowers/prompts/2026-07-18-commerce-phase2-handoff.md`
- `docs/superpowers/plans/2026-07-17-commerce-implementation.md`
- `docs/superpowers/plans/2026-07-18-commerce-storefront-report.md`

## Objective

Deliver the complete launch scope using `@payloadcms/plugin-ecommerce` `3.85.1` for base products,
variants, carts, addresses, orders and transactions.

Preserve only the custom extensions fixed by the plan:

- committed Phase 1 inventory/reservation/idempotency;
- gateway HMAC/nonce;
- tenant-aware Payload customer auth;
- tax, shipping, promotions and gift cards;
- Paymob/Kashier plus durable payment events;
- operational reports and durable notifications;
- Astro storefront and tenant feature/access boundaries.

Do not build a parallel commerce platform.

## Immutable baseline

Start at commit `e07850c` or a descendant containing it.

Phase 0 and Phase 1 are already implemented and committed. Verify them; do not reimplement them.

Before spawning agents:

1. run `git status --short`;
2. preserve unrelated/untracked files;
3. run the plan’s Wave 0 baseline commands;
4. stop if Phase 1 is not green;
5. record the active branch and exact HEAD;
6. keep every background agent in this same checkout and active branch.

Do not edit, delete, stage or commit
`docs/superpowers/prompts/2026-07-18-commerce-phase2-handoff.md`.

## Fixed architecture

- Use permanent collision-free plugin slugs exactly as specified in the plan.
- Configure plugin `inventory: false`.
- Keep Phase 1 inventory and historical migrations.
- Use plugin collection overrides; preserve every default plugin field/hook unless the plan explicitly
  says otherwise.
- Use EGP only.
- Keep `customers` and convert it to Payload auth.
- Plugin order is ecommerce, then multi-tenant, then tenant-feature access.
- Storefront browsers use signed Astro/CMS store routes, not unrestricted plugin REST writes.
- Use plugin-backed orders/transactions for Paymob/Kashier; do not create replacement collections.
- Keep one authoritative quote engine for tax/shipping/promotion/gift-card totals.
- Keep operational reports and durable notifications.
- Do not implement digital delivery, generic fulfillment entities, invoices, credit notes,
  subscriptions, marketplace, B2B or BI cubes.

## Parallel execution rules

You must use background agents. Delegation does not transfer integration responsibility.

1. All background agents work concurrently in the same active checkout and active branch.
2. Do not create or switch branches or worktrees.
3. Two writing agents may not edit the same path.
4. Agents may not edit shared integration files.
5. Background agents must not run `git add`, `git commit`, `git branch`, `git merge`,
   `git cherry-pick`, `git rebase`, `git stash`, `git reset`, `git checkout`, `git switch` or
   `git restore`.
6. You do not edit while a parallel writing wave is running.
7. Wait for every agent in the wave, inspect the combined diff, and verify every changed path belongs
   to exactly one lane.
8. Run focused tests, then stage and commit each lane’s explicit files serially in the plan’s order.
9. After each fan-in, run the stated gate before spawning the next writing wave.
10. If an agent reports a design choice, reject the handoff and direct it to follow the fixed plan.
11. If the fixed plan cannot be implemented, record a blocker; do not invent another architecture.

Only you may edit:

- `cms/src/payload.config.ts`
- `cms/src/migrations/index.ts`
- package manifests/lockfiles
- generated Payload types/importmap
- central collection/endpoint/job registries
- `src/lib/store/client.ts`
- `src/lib/store/server.ts`
- `src/middleware.ts`
- environment examples

## Agent context packet

Every spawned agent receives all fields below:

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
Input contracts:
Output contracts:
Required tests:
Stop conditions:
Handoff format:
```

Required handoff:

```text
Changed files:
Commands and results:
Plan requirements satisfied:
Integration-owner edits required:
Blockers:
```

## Execution

### Gate 0 — verify committed baseline

Do not spawn writing agents until all Wave 0 gates pass.

### Wave A — three read-only agents in parallel

Spawn:

1. plugin/schema mapper;
2. trust-boundary mapper;
3. migration/test mapper.

Use the exact objectives and done criteria in the controlling plan. Fan in their reports. Accept only
path drift corrections; do not reopen fixed architecture decisions.

### Wave B — three same-branch writing agents in parallel

Record the same active branch/HEAD/status in every agent packet. The agents share the current
checkout and write only their disjoint allowlists.

#### Agent B1 — plugin overrides

- Allowed: new isolated plugin currency/access/override modules and focused tests.
- Forbidden: every shared integration file.
- Integration-owner commit after fan-in: `feat(commerce): add plugin collection overrides`

#### Agent B2 — customer auth

- Allowed: customer collection/auth modules and focused tests.
- Forbidden: central endpoint/config/migration/generated files.
- Integration-owner commit after fan-in: `feat(commerce): convert customers to Payload auth`

#### Agent B3 — migration fixtures

- Allowed: migration helpers, fixtures and migration tests.
- Forbidden: migration index, Payload config and generated files.
- Integration-owner commit after fan-in: `test(commerce): add plugin migration fixtures`

Wait for B1, B2 and B3. Confirm their file lists are disjoint. Inspect the combined diff. Stage and
commit B1’s files, then B2’s files, then B3’s files. Background agents make no commits.

Then implement the integration-owner B4 commit exactly as defined in the plan. Run typecheck,
generated types/importmap and tenant/config tests.

### Wave C — four same-branch writing agents in parallel

Spawn only after B4 is green and the working tree contains no unexplained changes:

#### Agent C1 — additive migration

- Allowed: generated migration body, backfill/preflight module and tests.
- Forbidden: migration index.
- Integration-owner commits after fan-in: C1 and C2 from the plan.

#### Agent C2 — gateway

- Allowed: isolated signing/verifying/nonce helpers and tests.
- Forbidden: central Astro/CMS route registration and env examples.
- Integration-owner commit after fan-in: C3.

#### Agent C3 — policies

- Allowed: tax, shipping, promotions, gift cards, repositories, collections and tests.
- Forbidden: plugin base collection definitions and shared config.
- Integration-owner commit after fan-in: C4.

#### Agent C4 — inventory adaptation

- Allowed: retained Phase 1 inventory SKU resolution and focused tests.
- Forbidden: redesigning inventory, editing historical migrations or enabling plugin inventory.
- Integration-owner commit after fan-in: C5.

Wait for all four agents. Verify disjoint paths, inspect the combined diff, and stage/commit lane files
as C1/C2, C3, C4 and C5 in that order. You alone wire migration index, Payload config, registries,
env examples and shared routes. Run the complete fan-in gate.

### Wave D — payment agents

Run Paymob and Kashier agents in parallel from the post-Wave-C SHA:

#### Paymob

- Allowed: Paymob adapter/webhook tests and isolated provider code.
- Forbidden: shared registry/config/job files.
- Integration-owner commit after fan-in: D1.

#### Kashier

- Allowed: Kashier adapter/webhook tests and isolated provider code.
- Forbidden: shared registry/config/job files.
- Integration-owner commit after fan-in: D2.

Wait for both agents, verify disjoint paths, then stage and commit D1 files followed by D2 files. You
implement D3 durable payment checkpoints and D4 checkout wiring, or delegate each serially to one
fresh background agent after the previous commit passes.

Do not parallelize D3 and D4.

### Wave E — two writing agents in parallel

After D4 is green:

#### Operations

- Scope: notifications and reports only.
- Integration-owner commits after fan-in: E1 and E2.

#### Storefront

- Scope: Astro/Vue catalog/cart/auth/account/checkout plus focused UI tests.
- Forbidden: server domain logic and shared client/server helper files.
- Integration-owner commit after fan-in: E3.

Wait for both agents, verify disjoint paths, then stage/commit operations before storefront. Perform
shared client/server route wiring yourself.

### Wave F — serial acceptance and cleanup

Execute F1 through F4 exactly in order.

Never remove legacy runtime models before F1 parity passes.
Never drop historical tables in this release.
Never enable commerce before F3 plus sandbox/manual gates pass.

## Mandatory rejection conditions

Reject an agent handoff if it:

- reimplements Phase 1;
- enables plugin inventory;
- creates parallel product/cart/address/order/transaction collections;
- changes permanent `store-*` slugs;
- bypasses tenant or feature access;
- exposes unsigned storefront mutations;
- trusts browser totals;
- replaces Paymob/Kashier with Stripe;
- swallows retryable payment errors;
- stores raw secrets/provider payloads;
- implements an out-of-scope feature;
- modifies forbidden/shared files;
- omits focused tests, changed-file list or command results.

## Completion report

Return:

1. commit list mapped to plan commits;
2. agent/lane/changed-files handoff table;
3. changed files by domain;
4. test/build/migration/sandbox evidence;
5. migrated record counts and money parity;
6. security-gate results;
7. explicitly retained custom modules;
8. explicitly removed duplicate modules;
9. blockers and exact next command;
10. final definition-of-done checklist.

Do not say “complete” unless every item in the controlling plan’s final definition of done passes.
