# OpenCode Sequential Execution and Self-Review Handoff

Give this entire file to the configured OpenCode implementer. It is the execution prompt. The
authoritative requirements, architecture decisions, provider capability rules, and gate matrix are in
the companion plan:

`docs/superpowers/plans/2026-07-15-tenant-types-features-social-publishing.md`

## Prompt for OpenCode

<role>
You are the sole implementation agent for this queue. Work inside
`C:\Users\mrt\Desktop\dgh`. Read the companion plan completely before editing. Execute the tasks below
strictly in dependency order. After each task, inspect its diff and run its focused gates before moving
on. At the end, perform a whole-queue review and return a detailed report to the user.
</role>

<starting_state>
The accepted baseline is commits `7196283` and `11c9d1c` on branch `feat/multi-tenant`.

The working tree is intentionally dirty because an interrupted OpenCode run left a partial,
unreviewed Task A implementation. Start with `git status --short` and `git diff`. Treat every
post-`11c9d1c` file as untrusted: preserve correct work, correct defects, finish omissions, and verify
it. Do not discard the partial implementation wholesale and do not assume its tests/migration are
correct merely because files exist.

Likely partial Task A files include, but the actual working tree is authoritative:

- `cms/src/collections/TenantTypes.ts`
- `cms/src/collections/tenantFeatures.ts`
- `cms/src/collections/Tenants.ts`
- `cms/src/admin/ResetTenantFeatures.tsx`
- `cms/src/migrations/20260715_190731_tenant_types.ts`
- `cms/src/migrations/20260715_190731_tenant_types.json`
- `cms/src/migrations/index.ts`
- `cms/src/payload.config.ts`
- `cms/src/plugins/tenantFeatureAccess.ts`
- `cms/scripts/seed-tenants.ts`
- `src/lib/tenant.ts`
- Tenant settings/type tests and generated import map.
</starting_state>

<repository_safety>
- Never write briefs, event streams, result files, checkpoints, or any other task data inside `.git`.
- If temporary files are necessary, use the operating-system temporary directory outside the repo and
  delete them when finished.
- Do not run `git add`, `git commit`, `git reset`, `git checkout`, `git clean`, or rewrite history.
- Leave all implementation changes uncommitted for the human to return to Codex for final review.
- Do not mutate the real `cms/cms.db`. Use scratch databases or verified temporary copies for every
  migration run.
- Do not put provider secrets, access tokens, authorization responses, or real personal data in source,
  fixtures, logs, screenshots, or reports.
- Do not make live social-media posts. Provider tests must use deterministic mocked HTTP/fake adapters;
  live sandbox verification belongs in the final operator checklist.
- Keep scope limited to the companion plan. No unrelated refactors, styling, dependency upgrades, or
  cleanup.
</repository_safety>

<task_a_tenant_types_and_templates>
Audit and complete the partial Task A implementation.

Required outcomes:

1. `tenant-types` is a platform-wide extensible collection with localized name, unique stable slug,
   and a default feature template using the shared code-defined feature catalogue.
2. Access is correct: safe type identity can populate the anonymous public Tenant read; only
   super-admins can create/update/delete; referenced deletion returns a clear 400.
3. `tenants.type` is a required relationship. New Tenant create copies the selected type template only
   when `features` is omitted. Explicit `features: []` remains empty. Type updates do not overwrite
   custom features.
4. Missing/unresolvable required Tenant Types fail closed. Never swallow lookup errors and silently
   continue with missing defaults.
5. Reset endpoint is super-admin-only, explicitly reloads the current Tenant Type, copies its actual
   current template (including empty), and cannot erase features on a failed lookup. The confirmation
   UI is present only for a super-admin editing an existing Tenant.
6. The versioned migration preserves every distinct legacy type, known localized labels, unexpected
   type values, and every existing Tenant feature row. It derives type templates from existing feature
   unions, guards unresolved rows before legacy removal, and supports scratch up/down/up.
7. Remove any one-off migration/snapshot helper accidentally left in tracked source.
8. Generated types/import map/schema and every runtime consumer handle scalar or populated type
   relationships correctly without hardcoding `hospital | clinic`.
9. Tests prove access, referenced deletion, default/explicit-empty behavior, type-change preservation,
   reset 401/403/success/empty-template behavior, unexpected legacy types, feature-row invariants, and
   migration round-trip.

Review Task A tests first for weakened assertions/skips, then run focused tests and the full CMS suite.
Do not begin Task B until Task A is demonstrably correct.
</task_a_tenant_types_and_templates>

<task_b_aggregate_lists_and_inline_creation>
Implement the companion plan's Task B.

Required outcomes:

1. Override Payload multi-tenant's injected `tenant` relationship so list column and list filter are
   enabled.
2. Show `tenant` by default on all tenant-scoped collections: Media, Categories, Doctors,
   Departments, Articles, Events, Awards, Achievements, Testimonials.
3. Super-admin aggregate access remains unrestricted and filterable; non-super users remain
   constrained to selected/assigned tenants. UI visibility must not broaden API access.
4. Add a global client admin provider using installed Payload 3.85.1 public hooks. On a successful
   relationship `create` event with an originating `drawerSlug`, close exactly that drawer after the
   new document has been assigned.
5. Do not close update/edit drawers, failed creates, unrelated modals, or parent forms.
6. Do not patch `node_modules` or add `patch-package`. Upload/media creation already closes correctly
   and must remain correct.
7. Add configuration/component tests and exact manual gates for Article -> Category, Tenant -> Tenant
   Type, invalid create, and Media upload.
</task_b_aggregate_lists_and_inline_creation>

<task_c_social_profiles_and_publishing_settings>
Implement the companion plan's Task C.

Required outcomes:

1. Preserve `contact.whatsapp` as the canonical WhatsApp number.
2. Tenant social links cover Facebook, Instagram, X, Threads, Snapchat, YouTube, LinkedIn, and TikTok.
3. Update Tenant schema, URL validation, generated types/schema, public normalization, import/export,
   fixtures/tests, and existing footer data consumption so fields are not dead admin-only state.
4. Add the `socialPublishing` setting entitlement group and server-side enforcement.
5. Add master allow/deny, default Article auto-publish, and per-platform inclusion toggles for the eight
   publishing platforms. WhatsApp is not a public-feed target.
6. Backfill the new entitlement only for tenants that previously had the complete old entitlement set;
   preserve intentionally restricted tenants.
7. Migration preserves existing Facebook/X/YouTube/WhatsApp values and is reversible on scratch DB.
</task_c_social_profiles_and_publishing_settings>

<task_d_publication_core_jobs_and_security>
Implement the companion plan's Task D.

Required outcomes:

1. Article `autoPublish` defaults dynamically from its Tenant only when omitted; explicit false stays
   false.
2. Current CMS has no draft lifecycle, so queue only on the first successful Article create. Updates
   never automatically duplicate posts. External failures never roll back Article creation.
3. Add Article-specific thumbnail OG metadata, safe canonical Tenant URL construction, localized post
   copy, and deterministic video/image selection. A YouTube embed is a link, not an owned video.
4. Add hidden OAuth connection/state and publication-record collections with strict access.
5. OAuth state is HMAC-signed, expiring, one-time, and redirect-safe. Tokens are AES-256-GCM encrypted
   with a versioned key derived from `PAYLOAD_SECRET`; tampering fails closed; plaintext never reaches
   clients/logs.
6. Add Payload job task/queue, concurrency key, Article+platform idempotency, normalized statuses,
   remote IDs/URLs, bounded transient retry, permanent-failure classification, sanitized errors, and
   authorized explicit retry.
7. Use fake provider adapters/mocked fetch in tests. Prove no-queue conditions, create-once behavior,
   update non-duplication, failure isolation, crypto/state safety, state transitions, and media rules.
</task_d_publication_core_jobs_and_security>

<task_e_oauth_ui_and_provider_adapters>
Implement the companion plan's Task E using current official provider documentation and exact API
versions/scopes. Do not infer provider behavior from memory when local/current official docs disagree.

Required outcomes:

1. Per-platform Tenant admin controls show include toggle, Connect/Disconnect, account identity/status,
   reconnect-required/not-configured state, and last publication result without exposing tokens.
2. Implement authenticated connect, validated callback, disconnect/revoke where supported, and account
   selection when a provider returns multiple valid targets.
3. Implement typed adapters for Facebook Pages, Instagram professional accounts, X, Threads,
   LinkedIn, TikTok, Snapchat Public Profile, and YouTube according to the capability/approval rules in
   the companion plan.
4. Every actual success stores a remote ID/URL. Never use a fake-success fallback.
5. If an API requires partner/commercial approval or an unavailable app review, implement honest
   not-configured/approval-required behavior and a precise `skipped` result; do not claim publishing.
6. YouTube only publishes an owned uploaded video. With the present Article model, a YouTube URL alone
   yields `no_owned_video`; image-only YouTube publication is forbidden.
7. TikTok/Snapchat approval, domain verification, creator consent/privacy, and audit restrictions must
   be reflected honestly in UI/status and documentation.
8. Document every required environment variable, callback URL, provider-console setting, scope, app
   review/audit requirement, and job-runner configuration. No secret example values.
9. Contract tests verify authorization URLs, callback validation, token refresh/reconnect behavior,
   request shapes, media capability routing, provider errors, and skips without live calls.
</task_e_oauth_ui_and_provider_adapters>

<task_f_whole_queue_review_and_evidence>
After Tasks A-E, review everything before reporting completion.

1. Review edits to existing tests before trusting gates. Reject skips, commented tests, loosened
   assertions, or mocks that bypass the behavior under test.
2. Read the complete diff against both documents. Remove scope creep, dead helpers, duplicate
   abstractions, fake defaults, swallowed errors, unverified imports, and comments that no longer match
   behavior.
3. Verify every new library/API against the installed version and lockfile. Do not upgrade dependencies
   unless the plan requires it and the report explicitly justifies it.
4. Regenerate Payload types/import map/schema once after the final config.
5. Replay every new migration on a clean scratch DB.
6. Run new migrations up on a verified temporary copy of the current DB and assert data invariants.
7. Run down then up again on scratch DB; check snapshot/config drift and unrelated nullability changes.
8. Search repo-wide for stale fixed Tenant type unions, incomplete social mappings, plaintext token
   fields/logging, duplicate-publication paths, and dangling migration references.
9. Run the full gate set below. Fix regressions in scope. Report pre-existing unrelated errors with exact
   files/messages; do not change unrelated code merely to make a gate look green.
</task_f_whole_queue_review_and_evidence>

<gate_commands>
Use the repository's installed package manager/commands. Minimum final gates:

```powershell
cd C:\Users\mrt\Desktop\dgh\cms
node --import tsx --test tests/*.test.ts
npm run generate:types
npm run generate:importmap
npx tsc --noEmit --pretty false
npm run build

cd C:\Users\mrt\Desktop\dgh
npm run build
git diff --check
git status --short
```

Run focused tests after each task, not only at the end. Migration commands must target scratch DBs or
temporary copies, never `cms/cms.db`.
</gate_commands>

<stop_conditions>
Stop and ask the user instead of broadening scope or faking success if:

- Correct completion conflicts with an explicit decision in the companion plan.
- A provider needs credentials, paid access, partner approval, or app-review details that prevent a
  real implementation from being truthfully represented.
- OAuth target/account selection needs a product decision absent from the plan.
- A legacy type/feature row cannot be preserved by migration.
- Payload 3.85.1 lacks a required public hook and the only route is dependency patching/upgrading.
- Any step would require writing secrets, posting live content, or mutating the real database.
</stop_conditions>

<final_report_contract>
Do not commit. Return one detailed final report to the user with:

1. Task-by-task status (A-E): complete, partial, or blocked.
2. What changed and why, grouped by task.
3. Complete touched-file list grouped by production code, migrations, generated files, tests, docs.
4. Review findings you corrected, including issues found in the interrupted partial Task A work.
5. Migration evidence: clean up, current-DB-copy up, down/up, row/data invariants, snapshot drift.
6. Gate outcomes with exact commands, counts, and exact remaining failures.
7. Provider capability/approval matrix and which adapters are actually executable versus honestly
   skipped until configuration/approval.
8. Required environment variables and external provider-console setup, without secret values.
9. Exact manual browser/sandbox verification steps.
10. Open decisions/blockers and anything the final Codex reviewer must inspect closely.

Finish with: `Changes are uncommitted and ready for Codex review.`
</final_report_contract>
