# Round 3 Remediation — Social Publishing

Follows `2026-07-16-remediation-review-round-2.md`. Closes the correctness/security gaps
a second reviewer found (and that the round-2 completion report over-stated as "complete").

Same hard constraints as round 2: no `node_modules` patching, no dependency upgrades, no
mutation of the real `cms/cms.db`, no live public posts. Provider changes are implemented to
**current-documented API shape** with mocked-HTTP tests; live sandbox confirmation remains an
external gate (the operator's apps). All work uncommitted.

Root cause the round-2 gates missed: the suite is dominated by **mocked-HTTP unit tests**, so
provider-correctness defects (missing scope, TikTok privacy rejection, async-as-success, token
expiry, stale hash) were invisible. Round-3 tests must not mock away the production decision path.

## Decisions (logged)

1. **payloadHash on retry** — write the current hash on *every* attempt (at the `processing`
   step), so the record always reflects the content actually published this attempt. The spec's
   "preserve original hash" default is overridden by the explicit-retry "new audited attempt"
   escape clause; an automatic retry that re-publishes drifted content is the bug this prevents.
   (Alternative rejected: snapshot PublishInput at enqueue — bigger refactor, not justified.)
2. **Atomic consume** — compensation, not a cross-collection transaction. Payload Local API
   doesn't expose one cleanly; on `storeConnection` failure after a won consume, reset
   `consumed_at = NULL` so the session is reusable and no partial state remains. Satisfies the
   spec's "where supported / no partial state" criterion.
3. **Supersession** — drop `supersedes: true` (keep `exclusive` + article key). Per-article
   serialization is preserved; `[article,platform]` idempotency handles same-platform dedup; no
   cross-platform retry is silently dropped.
4. **Cancellation records** — record as `skipped` + `skippedReason: 'cancelled_article_deleted'`
   /`'cancelled_tenant_mismatch'` per target platform. Reuses an existing status → **no migration**.
5. **Locale** — derive from the reloaded Article's populated title (en-only → 'en', else 'ar').
   Proper fix is a Tenant `locale` field (deferred — no tenant-locale field exists today).
6. **TikTok async** — bounded in-call status poll (`/post/publish/status/fetch/`); only return
   `published` when `PROCESSED`. Timeout → `failed`/transient so the job re-attempts and resolves.
7. **Token refresh** — store `refreshToken`+`expiresAt` in the encrypted blob at connect for
   X/TikTok/Threads; refresh on near-expiry in `publishOne`, persisting the refreshed token.

## Phase A — Integrity (code-verifiable, no provider)

- `job.ts` (`publishOne`): add `payloadHash` to the `processing` `setPub` so every attempt
  re-stamps the hash matching the content being published. Test: change article between attempts
  → record hash changes (goes through `publishOne`, not a stubbed consume).
- `endpoints.ts` (`performSelection`): wrap consume→store; on `storeConnection` throw, call
  `releaseSession` (new, in `consume.ts`) to un-consume, then surface the error (no partial state).
  `consume.ts`: add `releaseSession(req, id)`. Test: inject failing store → session un-consumed,
  zero connections.
- `jobs.ts` (`runSocialPublishJob`): on `article_deleted`/`tenant_mismatch`, write one
  `social-publications` row per target (`status:'skipped'`, `skippedReason:'cancelled_*'`) before
  returning. Test: deleted article → N skipped rows with the cancellation reason.
- `jobs.ts` (task `concurrency`): remove `supersedes: true`. Test: two same-article different-platform
  retries both produce records (no drop).
- `jobs.ts` (`runSocialPublishJob`): replace hardcoded `locale:'ar'` with a derivation from the
  reloaded article's populated title.

## Phase B — Safety / UX

- `endpoints.ts` (`isSameOrigin`): compare scheme+host (full origin), not host-only. Add
  `isSameOrigin(req)` guard to the disconnect POST. Test: cross-origin/scheme disconnect → 403.
- `admin/SocialConnectionsPanel.tsx`: add a Retry button on failed connections; POST
  `/api/social/retry-publication` with `{tenantId, articleId, platform}`; show success/failure.
  (No `articleId` in current status payload — extend `/social-status` to include the last failed
  `articleId`, or retry by platform+last article. Decision: include `lastArticleId` in status.)

## Phase C — Provider correctness (documented shape; mocked tests; pending live confirm)

- `providers.ts` (facebook/instagram `scope`): add `pages_show_list` (required for `/me/accounts`).
- `adapters/threads.ts`: after `threads_publish`, `GET /{container_id}?fields=permalink` for the
  real permalink; stop fabricating `@{numericId}` URLs. Keep remoteId.
- `adapters/tiktok.ts`: `POST /user/info/details/` for `privacy_level_options` (pick the most
  public available; fall back to the most restricted if PUBLIC absent); bounded status poll after
  `init`; only `published` on `PROCESSED`.
- `providers.ts` + `endpoints.ts` + `job.ts`: store + use refresh tokens for x/threads/tiktok;
  refresh-on-near-expiry in `publishOne`, persist refreshed token + new expiry to the connection.

## Gates (run in `cms/`)

`node --import tsx --test tests/*.test.ts` · `npm run generate:types` · `npm run generate:importmap`
· `npx tsc --noEmit --pretty false` · `npm run build`. Then root `pnpm build` + `git diff --check`.
Migrations: only if Phase A/C force a schema change (currently none expected — reusing existing
fields/statuses). All scratch DBs.

## Honest limits (unchanged from round 2 + these)

Provider specifics (FB scope, TikTok creator/poll, Threads permalink, token refresh) are
implemented to current docs and mocked-tested only; they need the operator's sandbox apps to
confirm. TikTok async posts may still need a separate background status resolver if in-call polling
proves too short for PULL_FROM_URL latency — noted, not built speculatively.
