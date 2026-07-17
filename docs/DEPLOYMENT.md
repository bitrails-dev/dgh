# Deployment Guide

Two long-running Node services: the **Astro public site** (SSR) and the **Payload CMS**. There is no
Cloudflare Pages/Workers deployment and no `worker/` directory — the site is server-rendered on Node
and reads the CMS live over REST. (An older guide described a static Cloudflare build; that flow is retired.)

## Architecture

```
Browser ──► Astro (Node SSR, PORT default 4321) ──REST──► Payload CMS (Next.js, :3001) ──► SQLite (libSQL)
                                                       │
                                                       └─ social-publishing job worker (drains payload-jobs)
```

## Prerequisites

- Node.js 20+ (developed on 22), pnpm
- A persistent volume for the CMS SQLite file (`cms.db`) — it is the source of truth
- For social publishing: provider OAuth apps (see `docs/superpowers/plans/2026-07-16-social-publishing-setup.md`)

## CMS (`cms/`)

### First boot / schema

Schema is managed by **versioned migrations** (`src/migrations/`, `push: false`). Apply before first
boot and on every deploy that ships new migrations — it is idempotent (a no-op once applied):

```bash
cd cms
npx payload migrate         # apply all pending migrations
npx payload migrate:status  # confirm 0 pending
```

> Rehearse on a copy first; never rehearse on the real `cms.db`:
> `copy cms\cms.db cms\cms.db.bak` then point `DATABASE_URI` at a temp copy.

### Build & run

```bash
cd cms
npm run generate:types        # regenerate payload-types.ts (after schema/config changes)
npm run generate:importmap    # regenerate admin import map (after admin component changes)
npm run build                 # next build → .next/
npm run start                 # next start -p 3001  (set PORT to change)
```

### Environment (`cms/.env.example`)

- `PAYLOAD_SECRET` — long random; also derives the AES-256-GCM token key + HMAC OAuth-state key.
- `DATABASE_URI` — e.g. `file:./cms.db` (embedded) or a `turso dev`/libSQL URL. `DATABASE_AUTH_TOKEN` if needed.
- `PAYLOAD_PUBLIC_SERVER_URL` — CMS origin (e.g. `https://cms.dgh.bitrail.dev`).
- Social: `SOCIAL_SITE_URL`, `SOCIAL_MEDIA_BASE`, `SOCIAL_REDIRECT_BASE`, and per Tier-1 platform
  `SOCIAL_{FB,IG,LINKEDIN,YOUTUBE}_CLIENT_{ID,SECRET}`. Register
  `${SOCIAL_REDIRECT_BASE}/api/social/callback/<platform>` at each provider.

### Social-publishing worker

On Article create, the CMS enqueues a durable `payload-jobs` row. The queue is drained **in-process**
every minute via `jobs.autoRun` (sufficient for a single Node host). For higher throughput or process
isolation, run a dedicated worker alongside the web process:

```bash
cd cms
payload jobs:run --queue default --limit 10 --cron '* * * * *'
```

> `autoRun` is **not** suitable for serverless platforms (Vercel/Lambda) — run the dedicated worker
> command there instead. Retry policy: up to 6 attempts, exponential backoff (≈5s→160s), transient
> only (429/5xx/network); permanent failures and explicit `skipped` outcomes do not retry.

## Public site (repo root)

```bash
pnpm install
pnpm build      # astro build → .output/  (requires the CMS reachable on CMS_URL for the live content layer)
pnpm preview    # or run via the Node standalone adapter in production
```

Environment (`.env.example`): `PUBLIC_SITE` (canonical URL), `PUBLIC_BASE`, `PORT`, `CMS_URL`
(default `http://localhost:3000`; the CMS runs on 3001), `PUBLIC_PORTAL_API_BASE`.

The site carries no schema of its own — deploy it after the CMS migration + build so live content resolves.

## Post-deploy verification (manual gates)

- A tenant resolves by host; content is tenant-scoped (cross-tenant reads are denied).
- A super-admin sees the **Tenant** column + filter on scoped collections; tenant admins do not.
- (Social, sandbox apps only) Connect a platform → create an auto-publishing Article → a real post
  appears and `social-publications` shows `published` with the remote URL; updating the Article
  produces **no duplicate**; revoking the token at the provider yields a `reconnect_required` result.
- For a provider returning multiple accounts, the connect flow opens the selection page and the
  chosen (possibly non-first) account is connected; an expired/replayed/cross-tenant selection is rejected.

## Rollback

Each migration is reversible: `npx payload migrate:down` rolls back the last migration only (run
repeatedly to step back). Restore `cms.db` from the pre-deploy backup if needed. The Astro deploy is
independent — redeploy the previous `.output/`.
