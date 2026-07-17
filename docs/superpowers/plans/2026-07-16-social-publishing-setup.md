# Social Auto-Publishing — Setup Runbook

Real adapters ship for **Facebook, Instagram, LinkedIn, YouTube, X, Threads, TikTok** (each publishes
when its OAuth client is configured + connected). **Snapchat** is honestly `approval_required` — its
Public Profile API is allowlist-gated (not self-serve).

The publish pipeline, OAuth (incl. PKCE for X), encryption, durable job, and collections are built and
unit/contract-tested with mocked providers. **Live verification requires the provider apps below.**
Exact scopes/endpoints were authored from current official docs (API versions + sources in the
capability matrix of `2026-07-16-reviewer-summary.md`) — re-confirm before going live, and verify the
callback round-trip in a sandbox.

## How it works (end to end)
1. A super-admin grants a tenant the `socialPublishing` setting entitlement (default: all groups).
2. The tenant admin enables `socialPublishing.enabled`, sets `defaultAutoPublish`, picks `includedPlatforms`.
3. The admin connects each platform (Connect button → OAuth → encrypted token stored in `social-connections`).
4. On **create** of an Article whose `autoPublish` is on (defaulted from the tenant), a durable
   Payload **job** (`social-publish-article`) is enqueued and a worker publishes to each included +
   connected platform. A process restart never loses the work (it is a persisted `payload-jobs` row).
   Re-saves never duplicate (idempotent `social-publications` rows keyed by `[article, platform]`).
   Failures never roll back the article. Transient failures (429/5xx/network) retry with bounded
   exponential backoff (≤6 attempts); permanent failures and explicit skips never retry.
5. Results (published / failed / skipped + remote URL) show in the connection panel + publications.

> Tokens are AES-256-GCM encrypted at rest (key derived from `PAYLOAD_SECRET`). Plaintext never
> reaches clients or logs. OAuth state is HMAC-signed, expiring, one-time.

## Environment (see `cms/.env.example`)
```
PAYLOAD_SECRET=<long random>          # derives the token + state keys
SOCIAL_SITE_URL=https://dgh.bitrail.dev      # canonical article links (the public site)
SOCIAL_MEDIA_BASE=https://cms.dgh.bitrail.dev # public image URL prefix (providers fetch these)
SOCIAL_REDIRECT_BASE=https://cms.dgh.bitrail.dev # OAuth redirect base
SOCIAL_FB_CLIENT_ID / SOCIAL_FB_CLIENT_SECRET
SOCIAL_IG_CLIENT_ID / SOCIAL_IG_CLIENT_SECRET
SOCIAL_LINKEDIN_CLIENT_ID / SOCIAL_LINKEDIN_CLIENT_SECRET
SOCIAL_YOUTUBE_CLIENT_ID / SOCIAL_YOUTUBE_CLIENT_SECRET
```

**OAuth redirect URI to register at each provider:**
`https://<SOCIAL_REDIRECT_BASE>/api/social/callback/<platform>`
e.g. `https://cms.dgh.bitrail.dev/api/social/callback/facebook`

## Per-platform setup

### Facebook (Page post)
- **App:** Meta for Developers → create an app → add the **Facebook Login** product.
- **Scopes:** `pages_manage_posts`, `pages_read_engagement` (App Review → make them available, or use
  a test app/test users for sandbox).
- **Redirect URI:** register the callback URL above in the app's valid OAuth redirect URIs.
- **On connect:** the user picks a Page they manage; the app exchanges the user token for a **Page**
  token via `/me/accounts` and stores `{ pageId, accessToken }`.
- **Publishes:** a Page feed link post (OG preview from the article's canonical URL).

### Instagram (image)
- **Prerequisite:** an Instagram professional (Business/Creator) account linked to a Facebook Page.
- **App:** a Meta app (can be the same as Facebook) with the Instagram Graph product; scopes
  `instagram_basic`, `instagram_content_publish`.
- **On connect:** resolves the IG business account id behind a managed Page; stores
  `{ igUserId, accessToken }`.
- **Publishes:** a single image (the article thumbnail / first image). REELS is never used (the
  Article model has no owned video). Requires an eligible public image or the publish is skipped.

### LinkedIn (member link share)
- **App:** LinkedIn Developers → create an app → add **Sign In with LinkedIn using OpenID Connect**
  + share products; request the `w_member_social` scope (and 2-legged for org posts if needed).
- **Redirect URI:** register the callback URL in the app's authorized redirect URLs.
- **On connect:** resolves the member id via `/v2/me`; stores `{ authorUrn: urn:li:person:<id>, accessToken }`.
- **Publishes:** an ARTICLE link share (the crawler renders the OG preview).

### YouTube (owned video only)
- **App:** Google Cloud → OAuth client (type: Web) with scope `https://www.googleapis.com/auth/youtube.upload`.
- **On connect:** stores the refresh token (`access_type=offline`, `prompt=consent` required to obtain it).
- **Publishes:** **nothing yet** — every Article is `skipped: no_owned_video` because the Article
  model has YouTube embed links, not owned uploads. Connect now so the account is ready when owned
  uploads are added; the resumable-upload flow goes in `social/adapters/youtube.ts`.

## Migration & deploy
Four social-publishing migrations ship and run idempotently (data-safe; see the reviewer summary):
```
20260715_231356_social_publishing_collections   # connections / publications / oauth-states tables
20260715_233507_article_auto_publish            # articles.auto_publish column
20260716_122728_social_publishing_jobs          # payload-jobs + payload-jobs-log tables (durable queue)
20260716_135203_social_oauth_pkce               # social-oauth-states.code_verifier (X PKCE)
```
```powershell
copy cms\cms.db cms\cms.db.bak-20260716
cd cms; npx payload migrate
npm run generate:types; npm run generate:importmap; npm run build
```

## Live verification gate (do this once, per platform, in sandbox)
1. Set the platform's `SOCIAL_*_CLIENT_*` env + register the callback URL.
2. As a tenant admin: enable `socialPublishing`, include the platform, click **Connect** → approve →
   returned to the panel showing `connected`.
3. Create an article with `autoPublish` on → a durable job is enqueued on `social-publishing` → the
   worker publishes → confirm one real post exists and `social-publications` shows `published` with the
   remote URL.
4. Update the article → confirm **no duplicate** post (idempotent `[article, platform]` row).
5. Revoke the token at the provider → re-publish → confirm a `reconnect_required`/failed result (no
   silent success, no article rollback). A failed record can be retried via `POST /api/social/retry-publication`.

## Connect behavior (multi-account selection + revocation)
- **All targets returned.** Each provider's `listTargets` returns *every* publishable account (e.g.
  every manageable Facebook Page). A single target completes the connection directly; **multiple**
  targets open a one-time, tenant-bound selection page. Candidates are AES-encrypted server-side; only
  labels/ids reach the browser.
- **Selection is POST + atomic.** GET only renders candidates; the choice is a same-origin POST
  (CSRF-guarded). Consumption is a single conditional `UPDATE … WHERE consumed_at IS NULL RETURNING *`
  — exactly one concurrent request wins; the others are rejected as replays. Expired / cross-tenant /
  tampered selections are rejected with no partial state.
- **Disconnect revokes where supported.** Google/YouTube (RFC 7009), X, and TikTok tokens are revoked
  before the local record is deleted. Facebook/Instagram/LinkedIn have no usable revoke endpoint with
  the stored token, so disconnect reports `local_only` (the operator must also revoke via the provider
  console). A failed revocation keeps the local record so it can be retried.

## Worker
Jobs run on the **`social-publishing`** queue. It drains in-process every minute (`jobs.autoRun`) on a
single Node host. For isolation or serverless, run a dedicated worker:
`cd cms && payload jobs:run --queue social-publishing --limit 10 --cron '* * * * *'`.
Retry: ≤6 attempts, exponential backoff (transient only). Full deploy/ops detail: `docs/DEPLOYMENT.md`.

## Honest outcomes (every platform has an explicit, registered adapter)
- **Facebook / Instagram / LinkedIn / X / Threads / TikTok:** real adapters — publish when configured +
  connected (see the capability matrix in `2026-07-16-reviewer-summary.md`). X uses OAuth 2.0 PKCE; X's
  API is pay-per-use. LinkedIn image shares require the server to fetch + upload the image bytes.
- **YouTube:** `skipped: no_owned_video` (the Article model has embed links, not owned uploads).
- **Instagram / TikTok without an eligible image:** `skipped: no_eligible_media`.
- **Snapchat:** `skipped: approval_required` — the Public Profile API is allowlist-gated (not
  self-serve); route via an allowlisted MMSP or post manually at my.snapchat.com.
- **Any included platform with no connection / unconfigured client:** connect returns `503 not
  configured`; publish records `skipped: not_connected`. `not_implemented` remains only as a defensive
  invariant for a genuinely unknown platform.
