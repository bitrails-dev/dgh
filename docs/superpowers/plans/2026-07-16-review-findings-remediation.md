# Review Findings Remediation — Executor Handoff

Use this document as the execution prompt. The authoritative requirements remain:

- `docs/superpowers/plans/2026-07-15-opencode-sequential-handoff.md`
- `docs/superpowers/plans/2026-07-15-tenant-types-features-social-publishing.md`

## Objective

Correct every gap found during the independent review. Do not claim Tasks D/E complete until the durable job path, all eight provider outcomes, account selection, revocation, documentation, and full gates below are proven.

The accepted code baseline is commit `11c9d1c`; implementation remains uncommitted in the working tree. Preserve correct work. Do not reset, discard, commit, or mutate the real `cms/cms.db`.

## Before editing

1. Read both authoritative plans and `docs/superpowers/plans/2026-07-16-reviewer-summary.md` completely.
2. Inspect `git status --short` and the complete diff from `11c9d1c`.
3. Trace the current Article create flow through:
   - `cms/src/collections/Articles.ts`
   - `cms/src/social/hook.ts`
   - `cms/src/social/job.ts`
   - social publication/connection collections and adapters
4. Verify all Payload Jobs APIs against the installed Payload `3.85.1` types/source. Do not infer APIs or upgrade dependencies.
5. For provider behavior, use current official provider documentation only. Record the API version, scopes, approval constraints, revocation behavior, target discovery, and publish request shape used for each provider.

## Execution order

### 1. Replace fire-and-forget publishing with durable Payload Jobs

Current defect: `queueSocialPublish` starts `runPublications` in-process. A restart can lose work, and no worker executes bounded automatic retries.

Implement the minimum native Payload Jobs solution:

- Register one typed social-publication task in `payload.config.ts` using Payload 3.85.1's jobs API.
- On the first successful Article create, enqueue durable work after the Article transaction succeeds. Article creation must not wait for provider calls and provider failure must not roll back the Article.
- Task input must contain stable IDs and deterministic targets, not decrypted credentials or large document snapshots.
- Keep Article+platform idempotency enforced by the publication record/database path.
- Prevent concurrent processing of the same Article+platform. Use Payload's supported queue/concurrency mechanism; retain the database uniqueness guard as the final defense.
- Retry only failures classified transient by the existing classifier: network/timeout, 429, and 5xx. Use a documented finite attempt limit and backoff. Permanent failures and explicit `skipped` outcomes must not retry.
- Persist attempt count, normalized status, sanitized final error, remote ID/URL, and timestamps. Never persist or log plaintext tokens.
- Add the smallest production worker command/configuration needed to run queued work continuously. Document exactly how it runs in development and deployment.
- Remove comments and code paths describing the in-process implementation as acceptable.

Acceptance checks:

- A test proves Article create queues exactly once; update queues zero jobs; explicit `autoPublish: false` queues zero jobs.
- A test simulates process separation: enqueue first, execute through Payload's job runner later, and observe publication state transition.
- Tests prove transient bounded retry, permanent no-retry, concurrency/idempotency, and Article-save isolation.
- No direct fire-and-forget `runPublications(...)` call remains in the Article hook.

### 2. Complete all eight provider adapters honestly

Current defect: only Facebook, Instagram, LinkedIn, and YouTube adapters exist. X, Threads, Snapchat, and TikTok fall through to generic `platform_not_implemented`.

Required platforms:

`facebook`, `instagram`, `x`, `threads`, `linkedin`, `tiktok`, `snapchat`, `youtube`.

For every platform:

- Provide a typed registered adapter and an explicit capability description.
- Implement executable OAuth/publishing behavior where current public APIs and available configuration allow it.
- Where partner approval, audit, app review, commercial access, domain verification, creator consent, or unsupported media prevents execution, the adapter must return a precise `not_configured` or `approval_required`/`skipped` result. It must never report fake success.
- Every real success must store a provider remote ID and URL.
- Preserve media rules, especially YouTube requiring an owned uploaded video; a YouTube URL/embed is not an owned video.
- Add required environment-variable names to `.env.example` without values or secrets.
- Add mocked contract tests for authorization URLs, scopes, request shapes, success normalization, provider errors, refresh/reconnect behavior, and approval-required behavior.

Do not use a generic missing-adapter fallback for any of the eight planned platforms after this task.

### 3. Implement multi-target account selection

Current defect: Facebook selects `data.data?.[0]`; the OAuth provider contract returns one resolved account, so users cannot select among multiple valid Pages/accounts.

- Change provider discovery to return all valid publish targets with stable IDs and safe labels; never return tokens to the browser.
- If exactly one target exists, complete connection directly.
- If multiple targets exist, persist a short-lived, authenticated, one-time selection session and redirect to an admin selection UI.
- Add a tenant-authorized selection endpoint that validates the session, selected target, tenant, platform, expiry, and one-time use before encrypting/storing credentials.
- A different tenant/user must not be able to consume the selection session.
- Never silently choose the first target.
- Cover zero, one, multiple, expired, replayed, cross-tenant, and tampered selection cases.

### 4. Revoke provider credentials on disconnect where supported

Current defect: disconnect removes only the local connection.

- Extend the provider contract with optional revocation capability.
- For providers with a supported revoke/deauthorize endpoint, attempt revocation before deleting local credentials.
- Define and test failure semantics explicitly: do not claim provider revocation succeeded when it failed. Return a sanitized actionable result while preserving a safe local state.
- For providers without revocation support, report `local_only` honestly and document the operator action required.
- Ensure authorization checks remain tenant-scoped and no token enters responses/logs.
- Add mocked tests for supported success, supported failure, unsupported/local-only, and unauthorized requests.

### 5. Consolidate social-platform metadata

Current defect: platform keys, labels, credentials, and Tier-1 lists are independently maintained across collection, OAuth, adapter, and admin files.

- Create one existing-module-level typed platform metadata table; do not add a framework or registry abstraction beyond what current consumers need.
- Derive platform types/options, localized labels, adapter capability, OAuth credential environment names, and UI-visible platform lists from it where practical.
- Keep the public Astro normalization mapping separate only where its runtime boundary requires it; add a parity test instead of a “keep in sync” comment.
- Delete redundant constants and comments.

### 6. Correct architecture and operator documentation

- Update `CLAUDE.md` and `docs/CMS-ARCHITECTURE.md` so they describe tenant-scoped settings and the current live CMS/public-site data flow. Remove stale `HospitalSettings` and export-only claims.
- Update deployment/admin documentation with worker startup, queue operation, retry policy, OAuth callbacks, account selection, revocation limitations, all environment variables, provider approvals, and manual verification.
- Correct `2026-07-16-reviewer-summary.md`: do not retain “Tasks D/E complete” until every acceptance gate here passes. List any genuinely external live-provider gate separately from implementation completeness.
- Ensure docs never contain secrets or fabricated provider capability claims.

## Required verification

Review changed tests before trusting results: no skipped/commented tests, weakened assertions, or mocks bypassing the production path.

Run in `cms`:

```powershell
node --import tsx --test tests/*.test.ts
npm run generate:types
npm run generate:importmap
npx tsc --noEmit --pretty false
npm run build
```

Migration gates must use scratch databases or verified copies only:

1. Clean database migrate up.
2. Copy of current database migrate up with row/data invariants.
3. New migrations down then up.
4. Confirm schema snapshot matches collection config with no unrelated drift.

Run at repository root with the CMS reachable as required:

```powershell
npm run build
git diff --check
git status --short
```

Also run repository-wide searches proving:

- no direct in-process Article publishing remains;
- every planned platform has a registered explicit adapter/outcome;
- no arbitrary first-account selection remains;
- stale `HospitalSettings`/export-only architecture claims are removed;
- no plaintext secret/token logging exists;
- no unplanned dependency upgrade or `node_modules` patch was added.

## Manual gates

Using sandbox/provider test applications only:

1. Create an auto-publishing Article and prove the request survives web-process restart and is completed by the worker.
2. Prove one provider transient failure retries then succeeds; a permanent failure does not retry.
3. Connect a provider returning multiple targets and select a non-first target.
4. Reject expired/replayed/cross-tenant selection.
5. Disconnect once with supported revocation and once with documented local-only behavior.
6. Confirm every platform shows one honest state: connected, reconnect-required, not-configured, approval-required, or skipped with a precise reason.

Do not make real public posts.

## Final report contract

Return:

1. Status of each numbered remediation task: complete, partial, or blocked.
2. Files changed, grouped by production code, generated files, tests, and docs.
3. Exact Payload Jobs design: task slug/input, queue, concurrency/idempotency, retries, and worker command.
4. Eight-platform capability matrix: OAuth, publishing, revocation, approval requirements, tested outcome.
5. Automated gate commands with exact counts/exits.
6. Migration evidence and data invariants.
7. Manual-gate evidence and any live external gate not executed.
8. Remaining blockers without overstating completion.

Leave changes uncommitted and finish with: `Changes are uncommitted and ready for Codex review.`
