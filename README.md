---
marp: false
---

# Al Noor Public Hospital Showcase

A static Astro + Vue 3 Islands website for a public hospital showcase in Egypt. Built for high-impact storytelling, bilingual content, and managed through Decap CMS.

## Stack

- Astro (static output)
- Vue 3 islands (interactive sections)
- Tailwind CSS v3
- Astro Content Collections + Decap CMS
- Cloudflare Pages deployment

## Local Development

```bash
npm install
npm run dev
```

## Build

```bash
npm run build
```

## Deployment (Cloudflare Pages)

- Build command: `astro build`
- Output directory: `dist`

## CMS Access

Decap CMS is available at `/admin` and uses GitHub OAuth for authentication.

## Post-Deploy Security Steps

1. **CLOUDFLARE ACCESS**
   - Create a Cloudflare Access application targeting `/admin/*`
   - Policy: allow only whitelisted email addresses
   - This blocks all unauthorized users before OAuth even runs

2. **GITHUB REPOSITORY**
   - Branch protection on `main`: require PR review before merge
   - Enforce 2FA on all collaborator accounts
   - Editors invited with `Write` role only (not Admin)

3. **OAUTH APP**
   - GitHub OAuth App homepage URL: `https://yourhospital.eg`
   - Callback URL: `https://yourhospital.eg/api/auth`
   - Client secret stored only in Cloudflare Pages environment variables

## Required Cloudflare Environment Variables

- `GITHUB_CLIENT_ID`
- `GITHUB_CLIENT_SECRET`
## Patient Portal (MVP)

Portal pages are under `/{lang}/portal/*` and talk to the Go API.

Dev env var:

- `PUBLIC_PORTAL_API_BASE` (example: `http://localhost:8080`)

Run the API from `api/` (see `api/README.md`).

## Admin Tools

- Admin portal: `/{lang}/portal/admin/`
- Requires `PORTAL_ADMIN_KEY` for the backend admin endpoints.
- Use `POST /v1/admin/bootstrap-demo` to seed demo clinics, providers, and slots.

## Admin Schedule Editor

- Admin portal: `/{lang}/portal/admin/`
- Use `POST /v1/admin/bootstrap-demo` first to seed a test clinic/provider set.
- The schedule editor can then create, list, and delete unbooked slots.

- Patient appointments can be cancelled or rescheduled from the portal.

## Audit Trail

- The portal backend now records audit events for account and scheduling actions.
