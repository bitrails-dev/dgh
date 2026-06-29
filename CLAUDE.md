# CLAUDE.md

Public-facing website for **Dumyat Public Hospital** (مستشفى دمياط العام) — a bilingual (Arabic default / English) hospital showcase with a patient portal. Default language is Arabic and the site is RTL-first.

## Monorepo layout

- `/` — Astro frontend (this is the app that ships).
- `cms/` — separate **Payload CMS** app (its own `package.json`, runs independently on port 3001). Authors content; the Astro site reads it live over REST.

## Frontend stack (Astro)

- **Astro 7**, `output: "server"`, **Node.js standalone** adapter (`@astrojs/node`). Not static — pages render on each request.
- **Vue 3 islands** via `@astrojs/vue`, with `appEntrypoint: "/src/app.ts"` registering **Pinia**. Interactive components (sections, portal) are `.vue`; pages and layout are `.astro`.
- **Tailwind CSS 3** via `@astrojs/tailwind` (`applyBaseStyles: false` — global styles live in `src/styles/global.css`). Custom design tokens in `tailwind.config.mjs`: `teal/navy/ivory/ink` scales + `coral/gold/sage` accents, custom font stack (Reem Kufi / IBM Plex Sans Arabic / Fraunces / Inter), and a hand-rolled `rtl` variant (plus `tailwindcss-rtl`).
- Animation: **GSAP** + `@vueuse/motion`; icons via `@lucide/vue`.
- **View Transitions** (`ClientRouter`); client scripts re-init on `astro:page-load`.
- TypeScript: extends `astro/tsconfigs/strict`.

## i18n & routing

- Astro i18n: `defaultLocale: "ar"`, `locales: ["ar","en"]`, `prefixDefaultLocale: false` → Arabic at `/`, English at `/en`.
- All routes live under `src/pages/[...lang]/`. Pages read `Astro.params.lang` (`"en"` or default `"ar"`) and set `dir="rtl|ltr"` + font class.
- UI strings: `src/i18n/{index.ts,ar.json,en.json}` with a typed `t(lang, key)` helper and `localePath()`. Content is also localized (each entry carries `…` + `…Ar` fields).

## Content layer (live from Payload)

- `src/content.config.ts` uses Astro's **content layer** API (v6 loaders, not the old `src/content/config.ts`, which is intentionally empty).
- Each collection (`articles, achievements, awards, departments, doctors, events, testimonials`) has a `loader` that **fetches live from Payload** at request time: `GET {CMS_URL}/api/<slug>?locale=all&depth=1`, then normalizes localized `{en, ar}` fields and prefixes relative upload URLs with `CMS_URL`. Schemas are validated with **Zod**.
- `src/content/**` Markdown is legacy/seed data; the live source of truth is the CMS.

## Patient portal

- Vue island pages under `src/pages/[...lang]/portal/*` (sign-in, sign-up, book, appointments, admin).
- `src/components/portal/api.ts` is the API client. It calls a **separate backend** (set via `PUBLIC_PORTAL_API_BASE`, default `http://localhost:8080`) — endpoints like `/v1/auth/*`, `/v1/clinics`, `/v1/appointments`, and `/v1/admin/*` (guarded by `X-Admin-Key`). This backend is **not** in this repo.

## Payload CMS (`cms/`)

- **Next.js ~15.4** app hosting **Payload**, Lexical editor, **SQLite** via `@payloadcms/db-sqlite` + `@libsql/client`.
- Localized (`ar` default + `en`, fallback on). Collections: Users, Media, Doctors, Departments, Articles, Events, Awards, Achievements, Testimonials; global: HospitalSettings.
- Scripts: `pnpm dev` (port 3001), `pnpm generate:types`, `tsx scripts/export-to-content.ts` / `import-from-content.ts` to sync with `src/content`, `tsx scripts/migrate-images.ts` to (re)link images from markdown to Media uploads.
- Schema is managed by **versioned migrations** (`src/migrations/`), not dev-mode push. Fresh databases require `npx payload migrate` before first boot (the `db.push: false` adapter option disables the auto-push). Re-running `migrate` is a no-op once applied.

## Commands (root)

```bash
pnpm install
pnpm dev       # Astro dev server (default port 4321)
pnpm build     # astro build → .output/
pnpm preview
```

The CMS must be running (`cd cms && pnpm dev`) for content to load.

## Environment variables

Root (Astro) — see `.env.example`:
- `PUBLIC_SITE` — canonical site URL (default `https://dgh.bitrail.dev`)
- `PUBLIC_BASE` — base path (default empty)
- `PORT` — dev server port (default 4321)
- `CMS_URL` — Payload origin (default `http://localhost:3000`; CMS runs on 3001)
- `PUBLIC_PORTAL_API_BASE` — portal backend origin (default `http://localhost:8080`)

CMS (`cms/.env.example`): `PAYLOAD_SECRET`, `DATABASE_URI` (default `file:./cms.db`), `PAYLOAD_PUBLIC_SERVER_URL`.

## Conventions

- New pages go under `src/pages/[...lang]/` and wrap content in `BaseLayout` + `SidebarLayout`, passing `lang` and `strings`.
- Localized content fields come in pairs (`title` / `titleAr`); pick by `lang`.
- Prefer Astro components for static/SSR content; reach for `.vue` (`client:visible` etc.) only when interactivity is needed.
- Keep Tailwind usage on the custom token scales; don't introduce ad-hoc hex colors.
