# Technology Stack
*Generated: 2026-05-01*
*Focus: tech*

## Languages

**Primary:**
- TypeScript — all Vue components, Astro pages, content schemas, API utilities
- JavaScript — Cloudflare Worker (`cloudflare/oauth-worker/worker.js`), PostCSS config

**Secondary:**
- Astro (`.astro` template syntax) — pages, layouts, UI components
- YAML — Decap CMS config (`public/admin/config.yml`)
- Markdown — content files in `src/content/**/*.md`

## Runtime

**Environment:**
- Node.js v24.x (detected: v24.13.1 on dev machine; no `.nvmrc` pinning)

**Package Manager:**
- npm (primary; `package-lock.json` lockfileVersion 3 present)
- pnpm also present (`pnpm-lock.yaml`) — dual lockfiles indicate mixed usage
- Lockfile: `package-lock.json` (npm v3 format)

## Frameworks

**Core:**
- `astro` ^6.1.5 — static site generator, handles all routing and build
- `vue` ^3.5.31 — interactive islands (portal, navigation, forms)

**Astro Integrations:**
- `@astrojs/vue` ^6.0.1 — Vue island support within Astro
- `@astrojs/tailwind` ^6.0.2 — Tailwind CSS integration with `applyBaseStyles: false`
- `@astrojs/sitemap` ^3.7.2 — sitemap generation with i18n locale mapping
- `astro-i18next` ^1.0.0-beta.21 — i18n routing bridge between Astro and i18next

**Testing:**
- Not detected — no test framework configured

**Build/Dev:**
- Vite (bundled within Astro) — configured in `astro.config.mjs` with `optimizeDeps.force: true`
- PostCSS — `postcss.config.cjs` with `tailwindcss` and `autoprefixer` plugins

## Key Dependencies

**Critical:**
- `astro` ^6.1.5 — entire site build pipeline
- `vue` ^3.5.31 — reactive UI for patient portal and interactive sections
- `tailwindcss` ^3.4.19 (devDependency) — primary styling system
- `i18next` ^26.0.7 — translation engine; Arabic/English bilingual support
- `astro-i18next` ^1.0.0-beta.21 — bridges i18next into Astro's routing

**UI & Interaction:**
- `@vueuse/core` ^14.2.1 — Vue composable utilities
- `@vueuse/motion` ^3.0.3 — animation composables for Vue components
- `gsap` ^3.14.2 — scroll-driven and timeline animations (`src/composables/useScrollAnimation.ts`)
- `lucide-vue-next` ^1.0.0 — icon library for Vue components

**State Management:**
- `pinia` ^3.0.4 — listed as dependency but stores in `src/stores/` use plain Vue `reactive()` singletons (Pinia is not actively used; see comments in `locale.ts` and `ui.ts`)

**Styling Extras:**
- `tailwindcss-rtl` ^0.9.0 — RTL variant utilities; custom `rtl` variant also defined in `tailwind.config.mjs`
- `autoprefixer` — vendor prefix injection via PostCSS

## Build Output

- **Mode:** `output: 'static'` — fully pre-rendered HTML, no SSR
- **Site URL:** `PUBLIC_SITE` env var (default: `https://dgh.bitrail.dev`)
- **Base path:** `PUBLIC_BASE` env var (default: `''`)

## Configuration Files

| File | Purpose |
|------|---------|
| `astro.config.mjs` | Astro build, integrations, i18n routing |
| `tailwind.config.mjs` | Design tokens, custom colors, RTL plugin |
| `tsconfig.json` | Extends `astro/tsconfigs/strict` |
| `postcss.config.cjs` | Tailwind + autoprefixer pipeline |
| `astro-i18next.config.mjs` | Default locale `ar`, locales `[ar, en]` |

## i18n / Localization

- Default locale: `ar` (Arabic, RTL)
- Secondary locale: `en` (English, LTR)
- Route prefix: only `/en/` prefix added for English; Arabic served at root
- Font stacks: Arabic (`Reem Kufi`, `IBM Plex Sans Arabic`) and English (`Fraunces`, `Inter`) loaded separately from Google Fonts

## Cloudflare Worker (Edge)

- `cloudflare/oauth-worker/` — standalone Wrangler-deployed worker
- Runtime: Cloudflare Workers (V8 isolates, no Node.js)
- Config: `cloudflare/oauth-worker/wrangler.toml` (compatibility date `2024-01-01`)

## Platform Requirements

**Development:**
- Node.js 24.x (inferred)
- `astro dev` on port 4321 (configurable via `PORT` env var)

**Production:**
- Static file hosting (any CDN/server)
- Cloudflare Workers for OAuth proxy
- External backend API (configurable via `PUBLIC_PORTAL_API_BASE`)

---

*Stack analysis: 2026-05-01*
