# Architecture
*Generated: 2026-05-01*
*Focus: arch*

## System Overview

```
┌──────────────────────────────────────────────────────────────────────┐
│                    Astro Static Site (output: static)                │
│                    Deployed to Cloudflare Pages                      │
├─────────────────────┬────────────────────────┬───────────────────────┤
│   Public Pages      │     Patient Portal     │   Content Collections │
│  `src/pages/`       │  `src/pages/.../portal`│  `src/content/`       │
│  Astro components   │  Vue SPA islands       │  Markdown + JSON      │
└──────────┬──────────┴────────────┬───────────┴──────────┬────────────┘
           │                       │                       │
           ▼                       ▼                       ▼
┌──────────────────┐  ┌────────────────────────┐  ┌──────────────────┐
│  Layout Layer    │  │  Vue Island Components  │  │  External REST   │
│ `src/layouts/`   │  │  `src/components/portal`│  │  API (backend)   │
│ BaseLayout.astro │  │  portalApi client       │  │  PUBLIC_PORTAL_  │
│ SidebarLayout    │  │  `src/components/       │  │  API_BASE        │
│ PortalLayout     │  │   portal/api.ts`        │  └──────────────────┘
└──────────────────┘  └─────────────────────────┘
           │
           ▼
┌──────────────────────────────────────────────────────────────────────┐
│                  i18n / String Layer                                  │
│  `src/i18n/ar.json`, `src/i18n/en.json`, `src/i18n/index.ts`        │
│  Strings injected as props top-down; `getStrings(lang)` at page root │
└──────────────────────────────────────────────────────────────────────┘
```

## Overall Architecture Pattern

**Astro SSG (Static Site Generation) + Selective Vue Hydration (Islands Architecture)**

The site is compiled to fully static HTML at build time (`output: 'static'`). Interactive behavior is delivered via Vue components mounted as Astro Islands with explicit hydration directives (`client:load`, `client:visible`). The patient portal section is a Vue-driven interactive flow embedded within static Astro shell pages.

## Layout Layer

Three layout files wrap all pages:

| Layout | File | Used By |
|--------|------|---------|
| `BaseLayout` | `src/layouts/BaseLayout.astro` | All pages — provides `<html>`, `<head>`, SEO meta, Schema.org JSON-LD, fonts, back-to-top button, Astro View Transitions |
| `SidebarLayout` | `src/layouts/SidebarLayout.astro` | All public pages — provides `TheTopBar`, `TheSidebar`, `TheFooter`, breadcrumb strip |
| `PortalLayout` | `src/layouts/PortalLayout.astro` | Portal pages — extends `BaseLayout` with `PortalNav` instead of `TheSidebar`; sets `noindex: true` |

Composition pattern: pages wrap `BaseLayout > SidebarLayout > <sections>` or `BaseLayout > PortalLayout > <vue-component>`. The `strings` prop (full i18n object) is passed from page root downward. `SidebarLayout` prunes `strings` before serialising to the Vue `TheSidebar` island to reduce hydration payload.

## Routing Strategy

**Dual-path i18n routing:**
- Arabic (default): routes at `/`, `/departments/`, `/portal/` etc. — no language prefix
- English: routes at `/en/`, `/en/departments/`, `/en/portal/` etc.

Implemented via:
- `src/pages/index.astro` — Arabic home (hardcoded `lang = "ar"`)
- `src/pages/[...lang]/` — catch-all for English and other locales via `getStaticPaths` returning `[{ params: { lang: "en" } }]`
- `astro.config.mjs` i18n config: `defaultLocale: 'ar'`, `prefixDefaultLocale: false`
- `src/components/ui/ArRedirect.astro` — used inside `[slug].astro` pages to issue a redirect when `Astro.params.lang === 'ar'` (canonical URL strips the `ar` prefix)

Dynamic collection routes use `getStaticPaths` with `getCollection()` to emit one page per content entry per supported locale.

## Data Flow

### Public Page Request (SSG)

1. Build-time: `getStaticPaths()` in `src/pages/[...lang]/departments/[slug].astro` calls `getCollection('departments')`, emitting one static HTML file per department × locale.
2. `getStrings(lang)` loads the full i18n object from `src/i18n/ar.json` or `src/i18n/en.json`.
3. Strings and content entry data are passed as props down through `BaseLayout → SidebarLayout → section components`.
4. Static HTML delivered; Vue islands hydrate in browser using the serialised props.

### Portal Request (Client-side)

1. Astro shell page at `src/pages/[...lang]/portal/sign-in/index.astro` renders `PortalLayout` + Vue component with `client:load`.
2. Vue component (`PortalSignIn.vue`, `PortalBook.vue`, etc.) calls `portalApi` functions in `src/components/portal/api.ts`.
3. `portalApi` fetches from `PUBLIC_PORTAL_API_BASE` (env var) using `fetch` with `credentials: "include"` (cookie-based session).
4. Navigation between portal views is done via `window.location.href` assignments (full-page navigations, not client-side SPA routing).

### i18n String Flow

- All translatable strings live in `src/i18n/ar.json` and `src/i18n/en.json`.
- `getStrings(lang)` in `src/i18n/index.ts` returns the full typed object.
- The `strings` object is passed as a prop from every page root into every child layout and component.
- Vue components receive `strings` as a `defineProps` field and read nested keys directly.
- `localePath(path, lang)` in `src/i18n/index.ts` prefixes paths with `/en` for English, returns bare path for Arabic.

## Component Architecture

Components are split into four groups by responsibility:

| Group | Directory | Technology | Hydration |
|-------|-----------|-----------|-----------|
| Layout chrome | `src/components/layout/` | Mixed: `TheTopBar.astro`, `TheFooter.astro` (Astro); `TheSidebar.vue` (Vue) | `TheSidebar`: `client:load` |
| Page sections | `src/components/sections/` | Mixed: most Astro; interactive ones Vue | Vue sections: `client:visible` |
| UI primitives | `src/components/ui/` | Mostly Astro; `FilteredCardGrid.vue`, `ImageGallery.vue` Vue | Vue primitives: `client:visible` |
| Portal | `src/components/portal/` | All Vue | `client:load` |

**Astro components** handle static structure, SEO markup, and server-rendered content queries.
**Vue components** handle interactivity: mobile sidebar toggle, testimonial carousel, filterable grids, contact form, portal flows.

## State Management

No Pinia or Vuex. Two module-level reactive singletons (documented as "drop-in replacements for old Pinia stores"):

- `src/stores/locale.ts` — exports `useLocaleStore()` backed by `reactive({ current: "ar" })`. Persists to `localStorage`. Applies `lang`/`dir` attributes to `document.documentElement`.
- `src/stores/ui.ts` — exports `useUiStore()` backed by `reactive({ mobileMenuOpen: false })`. Controls mobile sidebar open/close state shared between `TheSidebar.vue` and `TheTopBar.astro` (via `client:load` island).

Vue composables in `src/composables/`:
- `useRTL.ts` — reactive `isRTL` ref derived from `document.documentElement.dir` via `MutationObserver`.
- `useScrollAnimation.ts` — returns animation variant objects for motion.
- `useCounter.ts` — animated number counter for stats display.

## Content Architecture

Astro Content Collections (`src/content.config.ts`) define seven typed collections backed by Markdown files:

| Collection | Directory | Key Fields |
|------------|-----------|------------|
| `articles` | `src/content/articles/` | title/titleAr, date, category, featured |
| `achievements` | `src/content/achievements/` | year, title/titleAr, description/descriptionAr |
| `awards` | `src/content/awards/` | name/nameAr, year, badgeImage |
| `departments` | `src/content/departments/` | name/nameAr, description/descriptionAr, icon, centerOfExcellence |
| `doctors` | `src/content/doctors/` | name/nameAr, specialty/specialtyAr, department, featured, order |
| `events` | `src/content/events/` | title/titleAr, date, category, gallery, youtubeUrl |
| `testimonials` | `src/content/testimonials/` | name/nameAr, quote/quoteAr, featured |

All bilingual content stores both `en` and `Ar` variants in the same file. JSON settings in `src/content/settings/` (e.g., `hero.json`, `contact.json`) provide dynamic configuration outside the i18n strings.

## RTL / Bilingual Design

The site is Arabic-first with RTL as the default layout direction. Key patterns:
- `<html lang dir>` set at `BaseLayout` build time based on `lang` prop.
- Tailwind uses logical CSS properties (`ms-`, `me-`, `ps-`, `pe-`) and a custom `rtl:` variant for directional overrides.
- Font families switch per locale: Arabic uses `Reem Kufi` (display) + `IBM Plex Sans Arabic` (body); English uses `Fraunces` (display) + `Inter` (body).
- `useRTL.ts` composable lets Vue components react to direction changes at runtime.

## View Transitions

Astro's `<ClientRouter />` is included in `BaseLayout`, enabling cross-page View Transition animations without a full page reload. `initScrollReveal()` and `initBackToTop()` reinitialise on every `astro:page-load` event to survive navigation.

## Portal API Integration

`src/components/portal/api.ts` is a thin typed HTTP client:
- Base URL from `PUBLIC_PORTAL_API_BASE` env var (defaults to `http://localhost:8080`).
- All requests use `credentials: "include"` for cookie-based auth.
- Auth flow: phone number → OTP request → OTP verify → session cookie set by backend.
- Admin endpoints accept `X-Admin-Key` header for privileged operations.

## SEO Architecture

- `BaseLayout` injects Schema.org `Hospital` JSON-LD on every page.
- `SidebarLayout` injects `BreadcrumbList` JSON-LD when breadcrumbs have 2+ items.
- Dynamic slug pages inject `Department` / `Article` specific structured data inline.
- `@astrojs/sitemap` generates a bilingual sitemap at build time.
- Canonical URLs are computed from `SITE` env var.
- Portal pages are `noindex: true` by default.

## Key Architectural Constraints

- **Threading:** Single-threaded browser JS. No workers.
- **No client-side router:** Portal navigation uses `window.location.href`. Public navigation uses Astro View Transitions (not a JS router).
- **Global state:** Two module-level `reactive()` singletons in `src/stores/`. These are shared across all Vue islands on the same page.
- **Props over context:** All i18n strings flow as component props, not Vue `provide/inject`. Every component that needs strings must receive them explicitly.
- **Static output only:** No SSR adapters. The Cloudflare Functions in `functions/` are separate edge functions, not Astro middleware.

---

*Architecture analysis: 2026-05-01*
