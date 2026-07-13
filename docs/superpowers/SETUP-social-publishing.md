# Social auto-publishing — setup runbook

Auto-publish a hospital article (and its video) to Facebook, YouTube, TikTok,
Instagram and LinkedIn the moment it's saved in the CMS.

Everything in the codebase is **done**. This document is the **manual setup** you
run once (create the apps, get the tokens, paste them into `cms/.env`). Until you
do, the CMS runs normally and every platform is recorded as
`skipped: not configured` — nothing breaks, nothing posts.

---

## 1. What was built & how it behaves

- **`Videos` collection** — a `video/*` upload collection. Files land in
  `public/uploads/videos/` and are served at `/uploads/videos/…`.
- **Article fields** — `Article → Video` (upload) and an **Social publishing**
  group: `Auto-publish on save` (default **on**), an optional `Custom caption`
  override, and a read-only `Publish results` log.
- **On every save** of an article with `Auto-publish` on, it fans out **in
  parallel** (`Promise.allSettled` → truly simultaneous):

  | Platform  | With a video                    | Without a video (link only) |
  |-----------|---------------------------------|-----------------------------|
  | Facebook  | native **video** post           | **link** post to the Page   |
  | YouTube   | uploaded as a video             | skipped (`no video`)        |
  | TikTok    | posted (pull-from-URL)          | skipped (`no video`)        |
  | Instagram | posted as a **Reel**            | skipped (`no video`)        |
  | LinkedIn  | **article link** share          | **article link** share      |

- **Title/description** are auto-generated from the article: the Arabic title, the
  first paragraph as an excerpt, the canonical article link
  (`{SITE_URL}/articles/{slug}`), and hashtags. A `Custom caption` overrides the
  body text (the link is still appended).
- **Idempotent** — a platform that already succeeded is never re-posted, so
  re-saving is safe. Failed/skipped platforms retry on the next save (handy: add
  the tokens, hit Save again, the stragglers go out).
- **Non-blocking** — Save returns instantly; uploads run in the background and
  write their results back onto the article.

> **Behaviour note:** if you create an article *without* a video (Facebook gets a
> link post) and add the video in a *later* edit, Facebook already succeeded on the
> link post and won't re-post the native video (dedup by success). For the native
> FB video, add the video on the **first** save, or clear the `facebook` entry in
> `Publish results` before re-saving. YouTube/TikTok/Instagram are unaffected —
> they were `skipped: no video` the first time and publish on the edit.

---

## 2. Required first: apply the schema migration

The new collection/fields need a DB migration. It's written and wired
(`cms/src/migrations/20260713_120000_social_publishing.ts`). **Copy-test first**
(the project convention), then apply:

```powershell
cd cms
# 1. copy-test on a throwaway DB (migrations run in a transaction — safe)
Copy-Item cms.db cms.test.db
$env:DATABASE_URI = "file:./cms.test.db"; $env:PAYLOAD_CONFIG_PATH = "src/payload.config.ts"
"y`n" | node node_modules/payload/bin.js migrate
# boot-check the copy if you like, then discard it
Remove-Item cms.test.db
# 2. apply to the real DB
$env:DATABASE_URI = "file:./cms.db"
"y`n" | node node_modules/payload/bin.js migrate
node node_modules/payload/bin.js generate:types
```

The `up` was copy-tested against the live `cms.db` (applies cleanly; columns
present; FK round-trips). It's purely additive (`CREATE TABLE` / `ADD COLUMN`), so
it avoids the `migrate:create` FK-nullable bug this project hit before.

**Prefer generator-verified SQL?** Delete the migration file + its line in
`cms/src/migrations/index.ts`, then `node node_modules/payload/bin.js migrate:create
social_publishing` — additive changes generate correctly.

> After this migration, the next time you run `migrate:create` for an unrelated
> change, review its snapshot diff — this migration ships without a `.json` schema
> snapshot, so the generator diffs against the previous one.

---

## 3. Global config (both required for real posting)

In `cms/.env`:

```ini
SITE_URL=https://dgh.bitrail.dev          # builds the article link
PUBLIC_MEDIA_BASE=https://dgh.bitrail.dev  # must publicly serve /uploads/videos/*
```

**Critical:** Facebook, TikTok and Instagram **pull the video from its URL**, so
`PUBLIC_MEDIA_BASE` + `/uploads/videos/<file>` must be reachable from the public
internet over HTTPS. On localhost these three will fail; use your deployed origin
(or a tunnel like Cloudflare Tunnel / ngrok) when testing video posts. YouTube and
LinkedIn don't need this (YouTube uploads bytes; LinkedIn shares the article link).

---

## 4. Per-platform setup

Each subsection = create an app → grant scopes → get a token → paste env vars.
Skip any platform you don't want; it just stays `skipped`.

### 4a. Facebook Page  → `FB_PAGE_ID`, `FB_PAGE_ACCESS_TOKEN`
1. Create a Facebook **Page** for the hospital (if none).
2. developers.facebook.com → **Create App** → type **Business**.
3. Add the **Facebook Login** product. Add permissions: `pages_manage_posts`,
   `pages_read_engagement`, `pages_show_list` (and `publish_video` is covered by
   `pages_manage_posts`).
4. In **Graph API Explorer**: select your app, generate a **User** token with those
   scopes, then `GET /me/accounts` to read the **Page ID** and the Page's
   `access_token`.
5. Exchange for a **long-lived** token (User token → 60 days), then get a
   **never-expiring Page token**: `GET /{page-id}?fields=access_token` using the
   long-lived user token. Put the Page id + Page token in env.
6. **App Review**: posting to a Page you own works in dev mode; to post on behalf of
   Pages you don't admin, submit the permissions for review.

### 4b. YouTube  → `YT_CLIENT_ID`, `YT_CLIENT_SECRET`, `YT_REFRESH_TOKEN`
1. console.cloud.google.com → new project → enable **YouTube Data API v3**.
2. **OAuth consent screen**: External, add your Google account as a **Test user**
   (test mode is fine; no Google verification needed for your own channel).
3. **Credentials → OAuth client ID → Desktop app**. Copy client id + secret.
4. Get a refresh token once (scope `https://www.googleapis.com/auth/youtube.upload`):
   use the **OAuth Playground** (developers.google.com/oauthplayground → gear icon →
   "Use your own OAuth credentials" → authorize the YouTube upload scope → exchange
   for tokens) and copy the **refresh token**.
5. Optional: `YT_PRIVACY` (`public`/`unlisted`/`private`), `YT_CATEGORY_ID`.
   > Apps in OAuth "testing" mode upload as **unlisted/limited** until verified for
   > public uploads — fine for review, request verification for public reach.

### 4c. TikTok  → `TIKTOK_ACCESS_TOKEN`
1. developers.tiktok.com → register → create an app → add **Content Posting API**.
2. Add scope `video.publish`. Complete **URL Prefix / domain verification** for
   `PUBLIC_MEDIA_BASE` (TikTok only pulls from verified domains).
3. Do the OAuth flow (`video.publish`) to get a user **access token**; store it.
   (Access tokens expire — refresh periodically, or wire the refresh token later.)
4. `TIKTOK_PRIVACY`: unaudited apps can only post **`SELF_ONLY`** (private draft).
   After TikTok audits the app you may use `PUBLIC_TO_EVERYONE`.

### 4d. Instagram Reels  → `IG_USER_ID`, `IG_ACCESS_TOKEN`
1. Convert the IG account to **Business/Creator** and **link it to the Facebook
   Page** from 4a (Meta Business Suite).
2. Same Meta app as Facebook; add permissions `instagram_basic`,
   `instagram_content_publish`, `pages_read_engagement`.
3. `IG_ACCESS_TOKEN` = the same long-lived token as Facebook works.
   `IG_USER_ID` = `GET /{page-id}?fields=instagram_business_account`.
4. Video must be a public MP4/MOV (H.264/AAC), ≤ ~1GB, aspect within Reels limits.

### 4e. LinkedIn  → `LINKEDIN_ACCESS_TOKEN`, `LINKEDIN_AUTHOR_URN`
1. linkedin.com/developers → create an app, associated with the hospital's
   **LinkedIn Page**.
2. Request the **Share on LinkedIn** / **Community Management** product for scope
   `w_member_social` (person) or organization posting.
3. OAuth to get an access token. `LINKEDIN_AUTHOR_URN`:
   `urn:li:organization:<pageId>` to post as the Page, or `urn:li:person:<id>`.
   (Videos aren't uploaded to LinkedIn — it always gets the article **link** share.)

---

## 5. Test it

1. Fill `cms/.env` for at least one platform + `SITE_URL`/`PUBLIC_MEDIA_BASE`.
2. Verify the pure logic (no network/DB needed):
   ```powershell
   cd cms; npx tsx src/social/content.selfcheck.ts   # → ✓ social content self-check passed
   ```
3. Start the CMS, create an article, attach a video, **Save**.
4. Watch the CMS logs: `[social] article <id> (video) → facebook:success youtube:success …`.
5. Open the article again — **Publish results** shows each platform's status + URL/id.

---

## 6. Platform menu & notes

- **Included:** Facebook, YouTube, TikTok, **Instagram**, **LinkedIn** — all free.
- **Excluded:** X/Twitter (paid API), as you asked.
- **Other free options you could add later** (same adapter shape): a **Telegram**
  channel (`sendVideo` via a bot — trivial, no review), **Pinterest** (video pins,
  free), a **WhatsApp** Business/Channel broadcast, or a Facebook **Story/Reel**.
  Say the word and I'll add any of these.

### Known ceilings (deliberate, documented)
- **No durable queue** — a CMS restart mid-upload loses that attempt; it retries on
  the next save. Add a job queue only if publishing volume grows.
- **YouTube** reads the whole file into memory (fine for normal clips; stream for
  multi-GB).
- **TikTok** records the `publish_id` only (posting is async on TikTok's side); it
  doesn't poll for the final URL.
- **Token expiry** — Facebook/IG long-lived tokens (~60d) and TikTok/LinkedIn/Google
  tokens expire; refresh them (or add refresh-token flows) before they lapse.
- Uploaded videos in `public/uploads/videos/` can be large — consider a
  `.gitignore` entry or object storage rather than committing them.
