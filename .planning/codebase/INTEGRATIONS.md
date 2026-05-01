# External Integrations
*Generated: 2026-05-01*
*Focus: tech*

## APIs & External Services

**Patient Portal Backend (custom REST API):**
- Base URL: `PUBLIC_PORTAL_API_BASE` env var (fallback: `http://localhost:8080`)
- Client: `src/components/portal/api.ts` — thin `fetch()` wrapper with `credentials: "include"`
- Auth: Cookie-based session (no Authorization header; uses `credentials: "include"`)
- Endpoints consumed:
  - `GET /v1/me` — current patient profile
  - `POST /v1/auth/signup` — patient registration
  - `POST /v1/auth/request-otp` — OTP dispatch (mobile number)
  - `POST /v1/auth/verify-otp` — OTP verification / login
  - `POST /v1/auth/logout`
  - `GET /v1/clinics` — clinic list
  - `GET /v1/visit-types` — appointment type list
  - `GET /v1/providers?clinic_id=` — doctor/provider list
  - `GET /v1/slots?...` — available appointment slots
  - `POST /v1/appointments` — create appointment
  - `POST /v1/appointments/cancel`
  - `POST /v1/appointments/reschedule`
  - `GET /v1/appointments` — patient's appointments
  - Admin endpoints: `POST /v1/admin/bootstrap-demo`, `POST /v1/admin/reception/verify`, `GET|POST /v1/admin/slots`, `POST /v1/admin/slots/delete` — protected by `X-Admin-Key` header

**Contact Form (Formspree):**
- Endpoint: `https://formspree.io/f/xzdknnrw` (hardcoded in `src/components/sections/ContactSection.vue:281`)
- Method: `POST` with JSON body
- No API key required (form ID is public)

**GitHub OAuth API:**
- Used by Decap CMS authentication flow
- Endpoint: `https://github.com/login/oauth/access_token`
- Credentials: `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` (Cloudflare Worker secrets)
- Flow: Authorization Code Grant → token returned to browser via `postMessage`
- Implementation: `cloudflare/oauth-worker/worker.js` and `functions/api/auth.ts`

## Content Management

**Decap CMS (formerly Netlify CMS):**
- Version: `^3.0.0` loaded from CDN `https://unpkg.com/decap-cms@^3.0.0/dist/decap-cms.js`
- Admin UI: `public/admin/index.html` + `public/admin/config.yml`
- Backend: GitHub (`repo: motifyee/dumyat-public-hospital`, `branch: main`)
- Auth endpoint: `https://dgh.bitrails.dev/api/auth` (proxied through Cloudflare Worker)
- Media folder: `public/uploads` (committed to repo)
- Collections managed: settings, articles, achievements, awards, departments, doctors, events, testimonials

## Data Storage

**Databases:**
- None — all content is file-based (Markdown + JSON in `src/content/`)

**File Storage:**
- Local repository (`public/uploads/`) — images uploaded via Decap CMS are committed to GitHub

**Caching:**
- None (static site; HTTP cache headers managed by hosting CDN)

## Authentication & Identity

**Patient Portal Auth:**
- OTP-based (mobile number + SMS code)
- Session maintained via HttpOnly cookies from the backend API
- No third-party auth provider for patients

**CMS Auth:**
- GitHub OAuth via Cloudflare Worker proxy (`cloudflare/oauth-worker/`)
- Env vars required: `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`

## Fonts & CDN

**Google Fonts:**
- Loaded in `src/layouts/BaseLayout.astro` via `https://fonts.googleapis.com`
- Families: `Reem Kufi` (Arabic display), `IBM Plex Sans Arabic` (Arabic body), `Fraunces` (English display), `Inter` (English body), `JetBrains Mono` (code)
- Preconnect to `https://fonts.googleapis.com` and `https://fonts.gstatic.com`

**unpkg CDN:**
- Decap CMS JS bundle: `https://unpkg.com/decap-cms@^3.0.0/dist/decap-cms.js`

## Monitoring & Observability

**Error Tracking:** Not detected

**Analytics:** Not detected

**Logging:** `console.log` only (e.g., `astro.config.mjs` logs `site` and `base` at build time)

## CI/CD & Deployment

**Hosting:**
- Static site: any CDN (deployed to `https://dgh.bitrail.dev` per `astro.config.mjs` default)
- Cloudflare Workers: `decap-oauth` worker (`cloudflare/oauth-worker/wrangler.toml`)

**CI Pipeline:** Not detected (no `.github/workflows/`, no `netlify.toml`, no CI config files)

## Environment Variables

| Variable | Used In | Purpose |
|----------|---------|---------|
| `PUBLIC_SITE` | `astro.config.mjs` | Canonical site URL (default: `https://dgh.bitrail.dev`) |
| `PUBLIC_BASE` | `astro.config.mjs` | Base path prefix (default: `''`) |
| `PUBLIC_PORTAL_API_BASE` | `src/components/portal/api.ts`, `src/env.d.ts` | Patient portal backend URL (default: `http://localhost:8080`) |
| `PORT` | `astro.config.mjs` | Dev server port (default: `4321`) |
| `GITHUB_CLIENT_ID` | `cloudflare/oauth-worker/worker.js`, `functions/api/auth.ts` | GitHub OAuth app client ID |
| `GITHUB_CLIENT_SECRET` | `cloudflare/oauth-worker/worker.js`, `functions/api/auth.ts` | GitHub OAuth app client secret |

**Secrets storage:** `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET` stored as Cloudflare Worker secrets via `wrangler secret put` — never committed.

## Webhooks & Callbacks

**Incoming:**
- `GET /api/auth?code=` — OAuth callback from GitHub (handled by `functions/api/auth.ts` on Cloudflare Pages, or `cloudflare/oauth-worker/` on standalone Workers)

**Outgoing:**
- GitHub OAuth token exchange (`https://github.com/login/oauth/access_token`)
- Formspree form submission (`https://formspree.io/f/xzdknnrw`)
- Patient portal backend API (URL configured via `PUBLIC_PORTAL_API_BASE`)

## Schema.org / SEO

**Structured Data:**
- `Hospital` schema injected inline in `src/layouts/BaseLayout.astro` as `application/ld+json`
- Open Graph and Twitter Card meta tags included in every page

---

*Integration audit: 2026-05-01*
