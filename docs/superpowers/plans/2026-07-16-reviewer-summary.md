# Reviewer Summary — Multi-tenant + Social Auto-Publishing (round-2 remediated)

Self-contained brief for a reviewer model. Branch `feat/multi-tenant`, **all changes uncommitted**.
Scope driver: `2026-07-16-remediation-review-round-2.md` (round-2 findings, all addressed).

## TL;DR
- **Round-2 findings closed.** Round 1 overstated completion; round 2 found 13 gaps (atomic selection,
  placeholder adapters, no retry, default queue, non-deterministic targets, unused payloadHash,
  duplicated panel metadata, bannered-not-fixed docs). All are corrected here.
- **Gates: `218/218` runtime tests (0 skipped) · `tsc --noEmit` 0 errors · CMS `npm run build` EXIT 0 ·
  full 12-migration chain applies on a fresh scratch DB.**
- Social publishing is built entirely against **mocked providers** (no live calls). The single
  remaining gate is **external**: live-provider verification in sandbox (needs the operator's apps).
- Every platform has an explicit, honest outcome — nothing fakes success.

## Round-2 changes (what was actually fixed)
1. **Atomic one-time selection.** Selection is a **POST** (same-origin/CSRF enforced); GET is read-only.
   Consumption is a single atomic `UPDATE … WHERE consumed_at IS NULL RETURNING *` — exactly one
   concurrent caller wins; the connection is stored only after winning. Failure leaves no partial state.
2. **Real adapters for all 8 platforms.** X (OAuth 2.0 PKCE + media upload), Threads (2-step),
   TikTok (Content Posting photo), Facebook + LinkedIn **image** paths (LinkedIn registers→uploads
   bytes→ugcPosts). Snapchat is honestly `approval_required` (Public Profile API is allowlist-gated —
   not self-serve). No generic `not_implemented` fallback for a planned platform.
3. **Authorized explicit retry.** `POST /api/social/retry-publication` re-enqueues a `failed` record on
   the `social-publishing` queue (super-admin / tenant-authorized only; reuses the idempotent row).
4. **Dedicated queue + deterministic targets.** Jobs run on `social-publishing`; task input carries the
   **target-platform snapshot** from the create event (validated against the catalogue); the worker
   reloads the Article (cancelled if deleted / moved to another tenant) and never adds targets.
5. **payloadHash.** Canonical SHA-256 over post-affecting fields (excludes ids/locale/secrets; tag/key
   order independent), written on first attempt and preserved across retries.
6. **Single platform catalogue.** `src/social/platforms.ts` drives options/env-keys/labels/capabilities;
   the admin panel + status response derive from it (no duplicated label map; parity test for the
   frontend). Revoke added to the provider contract (Google/YouTube + X + TikTok; FB/IG/LinkedIn honest
   `local_only`).
7. **Docs corrected, not bannered.** CLAUDE.md, CMS-ARCHITECTURE.md, DEPLOYMENT.md, README,
   TECH-STACK, ADMIN-PANEL-GUIDE, DOCUMENTATION-STATUS describe the live multi-tenant Payload + Astro
   SSR flow; retired Cloudflare/export-only/`HospitalSettings` claims removed.

## Eight-platform capability matrix
| Platform | OAuth | Publish path | Revocation | Approval | Tested outcome |
|---|---|---|---|---|---|
| facebook | Meta (v25.0) | `/photos` (image) or `/feed` (link) | local_only | — | published / failed / skipped(missing_creds) |
| instagram | Meta | container→media_publish (image) | local_only | IG pro on a FB Page | published / skipped(no_eligible_media) |
| linkedin | OAuth v2 | ARTICLE link, or registerUpload→PUT bytes→IMAGE | local_only | — | published (both paths) |
| youtube | Google | — (owned-video only) | RFC 7009 | — | skipped(no_owned_video) |
| x | OAuth 2.0 **PKCE** | `/2/tweets` (+ media/upload) | `/2/oauth2/revoke` | pay-per-use API | published (text + image) |
| threads | Threads OAuth | container→threads_publish (TEXT/IMAGE) | none (deauth callback) | App Review (threads_content_publish) | published |
| tiktok | Login Kit v2 | `/v2/post/publish/content/init/` PHOTO | `/v2/oauth/revoke/` | domain verify + app audit | published / skipped(no_eligible_media) |
| snapchat | — | — | — | **allowlist-gated (not self-serve)** | skipped(approval_required) |

API versions/scopes verified against current official docs (see the setup runbook for sources).

## Job / queue design
- Task `social-publish-article`, queue **`social-publishing`**, input `{ tenantId, articleId, platforms }`
  (snapshot, catalogue-validated). Exclusive per-article concurrency (`supersedes`).
- Retry: throw only on transient (429/5xx/network) → ≤6 attempts, exponential backoff ≈5s→160s.
- Cancellation: deleted Article → `article_deleted`; Article moved to another tenant → `tenant_mismatch`.
- Worker: in-process `autoRun` (every minute) or `payload jobs:run --queue social-publishing --limit 10 --cron '* * * * *'`.

## Selection / retry / hash semantics
- Selection: GET renders candidates (no tokens); POST atomically consumes + stores one target.
  Concurrent POSTs → one 302, one 410. Cross-tenant / expired / replayed / tampered / cross-origin rejected.
- Retry: only `failed` records; reuses the `[article,platform]` row; enqueues `[platform]` on
  `social-publishing`; concurrent retries collapse to ≤1 effective run (per-article concurrency + supersedes).
- payloadHash: canonical SHA-256 over platform/title/titleEn/description/link/imageUrl/hasOwnedVideo/sorted-tags;
  written at first attempt, preserved on retry (content drift after enqueue is a new event).

## Gates (exact)
```powershell
cd C:\Users\mrt\Desktop\dgh\cms
node --import tsx --test tests/*.test.ts   # 218 pass / 0 fail / 0 skipped
npm run generate:types                     # current
npm run generate:importmap                 # "No new imports found"
npx tsc --noEmit --pretty false            # 0 errors
npm run build                              # EXIT 0
```
Root Astro build (`pnpm build`) requires the CMS reachable on `CMS_URL` (it fetches live) —
environmental. The round-2 plan requires it run with the CMS on :3001.

## Migration & publish — exact steps
> 12 migrations now (10 from round 1 + `social_publishing_jobs` + `social_oauth_pkce`). Rehearse on a
> copy; never rehearse on the real `cms.db`.

```powershell
copy cms\cms.db cms\cms.db.bak
$env:DATABASE_URI="file:$env:TEMP/cms-copy.db"; copy cms\cms.db $env:TEMP\cms-copy.db
cd cms
npx payload migrate:status        # expect pending
npx payload migrate               # applies all
npx payload migrate:status        # 0 pending
# spot-check: payload_jobs + payload_jobs_log tables; social_oauth_states.code_verifier column;
# social_oauth_states.encrypted_candidates/return_to columns present.
npm run generate:types; npm run generate:importmap; npm run build
cd ..; pnpm build                 # Astro — CMS must be reachable on CMS_URL
# rollback (each migration reversible): npx payload migrate:down
```
The real `cms.db` was never mutated during this work (all runs used scratch DBs).

## Known limits / decisions
1. Snapchat has no self-serve API — `approval_required` (allowlist); route via an MMSP or post manually.
2. X API is pay-per-use (free tier closed Feb 2026); a configured client is billed per post.
3. TikTok posts are async (`publish_id` is the handle; no immediate permalink; status via `/status/fetch`).
4. LinkedIn image upload requires the server to fetch + PUT the public image bytes (LinkedIn doesn't fetch).
5. `autoRun` is not for serverless — run the dedicated worker there.
6. Live-provider verification (sandbox) is the sole remaining **external** gate.
