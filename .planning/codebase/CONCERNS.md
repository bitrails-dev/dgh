# CONCERNS
*Generated: 2026-05-01*
*Focus: concerns*

---

## High Severity

### Admin Panel Has No Route-Level Authentication

**Issue:** The admin portal page (`src/pages/[...lang]/portal/admin/index.astro`) is a publicly accessible static route with no server-side auth guard. Any visitor who navigates to `/portal/admin/` can see the admin UI. The only protection is the `X-Admin-Key` header the UI sends to the backend API — meaning the admin interface itself is completely exposed to the public internet.

**Files:**
- `src/pages/[...lang]/portal/admin/index.astro`
- `src/components/portal/PortalAdmin.vue`
- `src/components/portal/api.ts` (lines 42–71)

**Impact:** Exposes slot creation, deletion, and patient NID verification UI to unauthenticated users. The admin key is stored in `localStorage` (`portal_admin_key`), making it visible in browser dev tools to anyone with physical access to an admin machine.

**Fix approach:** Add a server-side middleware or redirect to check an admin session before rendering the page. At minimum, add `noindex` to the route and obfuscate the path. Long term: replace the plaintext `X-Admin-Key` header pattern with a proper session-based admin role.

---

### Duplicate and Conflicting OAuth Auth Implementations

**Issue:** There are two separate CMS OAuth handlers:
1. `functions/api/auth.ts` — a Cloudflare Pages Function at `/api/auth` that handles only the callback step and uses `window.opener.postMessage('authorization:github:' + ..., '*')` (wildcard origin, which is insecure).
2. `cloudflare/oauth-worker/worker.js` — a standalone Cloudflare Worker with both `/auth` and `/callback` routes using the correct Decap message format (`authorization:github:success:...`).

The Decap CMS config (`public/admin/config.yml`) points to `https://dgh.bitrails.dev` with `auth_endpoint: /api/auth`, but it is unclear which handler is actually in production. The `functions/api/auth.ts` handler sends a **wildcard-origin postMessage**, which can be exploited by any malicious page that can trick a user into opening the OAuth popup.

**Files:**
- `functions/api/auth.ts` (line 52)
- `cloudflare/oauth-worker/worker.js`
- `public/admin/config.yml`

**Impact:** Potential token leakage via postMessage to any origin. Two separate auth flows in flight creates maintenance confusion.

**Fix approach:** Remove `functions/api/auth.ts`. Use only `cloudflare/oauth-worker/worker.js` which already handles both steps correctly and restricts the postMessage. Update `public/admin/config.yml` to point to the deployed worker URL.

---

### Hardcoded Formspree Endpoint in ContactSection

**Issue:** The contact form POSTs to a hardcoded third-party Formspree endpoint `https://formspree.io/f/xzdknnrw` with no environment variable indirection.

**Files:**
- `src/components/sections/ContactSection.vue` (line 281)

**Impact:** Changing form providers or rotating the endpoint requires a code change and redeployment. The endpoint ID is committed to version history and publicly visible in the compiled JS bundle.

**Fix approach:** Move to a `PUBLIC_CONTACT_FORM_URL` environment variable read at build time or via a Cloudflare Worker proxy.

---

### Missing `.env.example` — No Secrets Documentation

**Issue:** No `.env.example` or `.env.template` file exists in the project root. The project requires at least `PUBLIC_PORTAL_API_BASE`, `PUBLIC_SITE`, and `PUBLIC_BASE` at build time, but there is no documented list of required variables.

**Files:**
- `src/components/portal/api.ts` (line 3) — `PUBLIC_PORTAL_API_BASE`
- `astro.config.mjs` (lines 7–8) — `PUBLIC_SITE`, `PUBLIC_BASE`, `PORT`
- `src/layouts/BaseLayout.astro` (line 29) — falls back to `"https://yourhospital.eg"` if `SITE` is unset

**Impact:** New developers or fresh deployments will silently use wrong defaults (`http://localhost:8080` for the API, `https://yourhospital.eg` as the canonical URL in production).

**Fix approach:** Create `.env.example` documenting every required and optional variable.

---

### `console.log` Left in `astro.config.mjs`

**Issue:** `astro.config.mjs` line 9 contains `console.log(site, base)` which prints the site URL and base path on every build. This is debug output committed to the main branch.

**Files:**
- `astro.config.mjs` (line 9)

**Impact:** Leaks deployment configuration in CI logs. Clutters build output.

**Fix approach:** Remove the `console.log` call.

---

### Dual Lockfile Conflict (npm + pnpm)

**Issue:** Both `package-lock.json` (npm) and `pnpm-lock.yaml` (pnpm) exist in the repository root. The CI workflow (`.github/workflows/deploy.yml`) uses `npm ci` and caches npm, but local development may use pnpm. The two lockfiles can diverge, causing different dependency trees in CI vs local.

**Files:**
- `package-lock.json`
- `pnpm-lock.yaml`
- `.github/workflows/deploy.yml` (line 18, 21)

**Impact:** Reproducibility risk — dependency versions may differ between local pnpm installs and CI npm installs. `npm ci` ignores `pnpm-lock.yaml`.

**Fix approach:** Pick one package manager and delete the other lockfile. If pnpm is preferred locally, update CI to use `pnpm install --frozen-lockfile`.

---

## Medium Severity

### Pervasive `any` Types in Portal API Layer

**Issue:** The entire portal API surface in `src/components/portal/api.ts` uses `any[]` for all response shapes (`clinics`, `providers`, `slots`, `appointments`, `visitTypes`). All portal Vue components also type their reactive state as `any[]` and their props as `strings: any`.

**Files:**
- `src/components/portal/api.ts` (lines 26–72)
- `src/components/portal/PortalAdmin.vue` (lines 203, 213–216)
- `src/components/portal/PortalAppointments.vue` (lines 118, 125–126, 129)
- `src/components/portal/PortalBook.vue` (line 119)

**Impact:** TypeScript provides no safety on API responses. Shape changes in the backend will produce silent runtime failures, not compile errors. The `labelFor` utility in `PortalAdmin.vue` and `PortalAppointments.vue` does triple-key duck-typing (`entry.provider_id === id || entry.visit_type_id === id || entry.clinic_id === id`) because types are unknown.

**Fix approach:** Define interfaces for `Clinic`, `Provider`, `VisitType`, `Slot`, and `Appointment` in `src/components/portal/api.ts` and propagate them through all portal components.

---

### 17 Inline Bilingual String Literals Bypassing the i18n System

**Issue:** At least 17 locations use `isAr ? 'عربي' : 'English'` inline ternaries instead of pulling strings from the `ar.json`/`en.json` translation files. Examples include hardcoded section headings in `AwardsListSection.astro`, `AwardsWall.astro`, `DepartmentsSection.astro`, `MissionStrip.astro`, `ContactSection.vue`, and `BaseLayout.astro`.

**Files:**
- `src/components/sections/AwardsListSection.astro` (line 18)
- `src/components/sections/AwardsWall.astro` (lines 8–36)
- `src/components/sections/DepartmentsSection.astro` (line 46)
- `src/components/sections/MissionStrip.astro` (line 25)
- `src/components/sections/ContactSection.vue` (lines 99, 244, 249, 253, 276, 294, 296, 299)
- `src/layouts/BaseLayout.astro` (lines 101, 109)

**Impact:** Content editors using Decap CMS cannot update these strings. Adding a third language requires code changes across multiple files rather than a single JSON file. The i18n system is partially undermined.

**Fix approach:** Move all hardcoded bilingual strings into `src/i18n/ar.json` and `src/i18n/en.json` and reference them via the `t()` function or `strings` prop.

---

### `AwardsWall.astro` Contains Hardcoded Static Article Data

**Issue:** `src/components/sections/AwardsWall.astro` defines three articles as hardcoded JavaScript objects (ICU Modernization, Cardiac Surgery, Hospital Accreditation) with inline bilingual strings. These are not backed by any content collection entry and will not appear in the CMS.

**Files:**
- `src/components/sections/AwardsWall.astro` (lines 6–25)

**Impact:** Content cannot be managed through Decap CMS. Updates require code deployments. Dates are hardcoded to 2025 and will become stale.

**Fix approach:** Replace with a query against the `articles` or `events` content collection, filtered for featured/recent items.

---

### Missing `src/content/settings/general.json` — CMS Schema Mismatch

**Issue:** `public/admin/config.yml` defines a `settings/general` collection that writes to `src/content/settings/general.json`, but that file does not exist. Any content manager saving the General Settings in Decap CMS will create it, but until then any code attempting to import it will fail or produce missing-file errors.

**Files:**
- `public/admin/config.yml` (line 29)
- `src/content/settings/general.json` — absent

**Impact:** The CMS UI exposes a settings panel that writes to a file no code currently reads, creating false confidence. If code is written to read `general.json` before the CMS creates it, builds will fail.

**Fix approach:** Either create `src/content/settings/general.json` with default values committed to the repo, or remove the `general` collection from `public/admin/config.yml` until it is wired up in code.

---

### Testimonials Content Collection Has Zero Entries

**Issue:** `src/content/testimonials/` is empty (no markdown files). The schema in `src/content.config.ts` and the `TestimonialsSection.vue` component exist but there is no sample data.

**Files:**
- `src/content/testimonials/` (empty directory)
- `src/components/sections/TestimonialsSection.vue`

**Impact:** The Testimonials section on the homepage renders with no content. Visitors see an empty section.

**Fix approach:** Add at least two or three sample testimonial markdown files so the section is visually complete for review and demo.

---

### Missing Photo in `MissionStrip.astro` — Permanent Placeholder

**Issue:** The About section in `src/components/sections/MissionStrip.astro` contains a CSS gradient placeholder with the label `[ ABOUT_IMAGE · hospital-interior.jpg · 4:5 ]`. No actual hospital photo is wired up.

**Files:**
- `src/components/sections/MissionStrip.astro` (lines 11–17)

**Impact:** The about section shows a decorative placeholder that looks unfinished on the live site.

**Fix approach:** Add an actual hospital interior image to `public/images/` and replace the placeholder `<div>` with an `<img>` or `<Image />` element.

---

### Pinia Listed as Dependency but Not Used

**Issue:** `pinia` (`^3.0.4`) is listed in `package.json` dependencies. Both stores (`src/stores/locale.ts`, `src/stores/ui.ts`) explicitly say "Drop-in replacement for the old Pinia store" and use plain Vue `reactive()` instead. Pinia is never imported anywhere in the source tree.

**Files:**
- `package.json` (line 26)
- `src/stores/locale.ts` (comment line 17)
- `src/stores/ui.ts` (comment line 6)

**Impact:** Pinia is bundled and shipped unnecessarily, adding to the dependency footprint.

**Fix approach:** Remove `pinia` from `package.json` dependencies.

---

### Three Composables Are Defined but Never Imported

**Issue:** `src/composables/useRTL.ts`, `src/composables/useScrollAnimation.ts`, and `src/composables/useCounter.ts` are defined but no component in `src/components/` imports them.

**Files:**
- `src/composables/useRTL.ts`
- `src/composables/useScrollAnimation.ts`
- `src/composables/useCounter.ts`

**Impact:** Dead code that inflates the codebase surface area and creates confusion about what is actually used. RTL direction is handled by the locale store instead; scroll animation is handled inline in components via `@vueuse/motion`.

**Fix approach:** Delete all three files, or wire them into components that need them if they represent intentional future abstractions.

---

### `astro-i18next` Integration Installed but Functionally Unused

**Issue:** `astro-i18next` is listed in `package.json` and registered in `astro.config.mjs`. However, no component imports `useTranslation` or calls `t()` from `i18next`. All translations use the custom `src/i18n/index.ts` system (`getStrings()`, `localePath()`, `t()`). The `astro-i18next.config.mjs` exists but the integration adds build overhead without contributing functionality.

**Files:**
- `package.json` (line 22)
- `astro.config.mjs` (lines 4, 46)
- `astro-i18next.config.mjs`

**Impact:** Unused integration increases build time and installs `i18next` as a peer dependency. The dual i18n setup (Astro built-in `i18n` config + `astro-i18next`) could conflict on routing.

**Fix approach:** Remove `astro-i18next` from integrations and `package.json`. Astro's native `i18n` routing config is already in place and sufficient alongside the custom `src/i18n/index.ts` helpers.

---

### Pervasive Inline `style=""` Grid Layouts Bypassing Tailwind

**Issue:** 41 occurrences of `style="..."` attributes define grid layouts across the codebase (e.g., `style="grid-template-columns: 1fr 1.6fr;"`, `style="display:grid; grid-template-columns: repeat(3, 1fr); gap: 1.25rem;"`). Responsive overrides for these grids are then applied via `@media` blocks with `!important` selectors like `div[style*="grid-template-columns: repeat(3"] { grid-template-columns: 1fr !important; }`.

**Files:**
- `src/components/sections/AchievementsSection.astro` (lines 40, 56, 62)
- `src/components/sections/AwardsListSection.astro` (lines 14, 34, 55)
- `src/components/sections/AwardsWall.astro` (lines 32, 48, 80–86)
- `src/components/sections/ContactSection.vue` (lines 5, 318)
- `src/components/sections/DepartmentsSection.astro` (lines 41, 98)
- `src/components/sections/HeroSection.astro` (lines 24, 139, 150)
- `src/components/sections/MissionStrip.astro` (line 9)
- `src/components/sections/TestimonialsSection.vue` (lines 6, 24, 140, 150)
- `src/pages/[...lang]/about.astro` (lines 25, 63–64)

**Impact:** The attribute-selector CSS override pattern (`div[style*="..."]`) is fragile — it breaks if the inline style string changes even slightly. It also defeats Tailwind's purging/JIT and makes responsive behavior hard to reason about.

**Fix approach:** Migrate grid layouts to Tailwind utility classes (e.g., `grid grid-cols-3`, `lg:grid-cols-[360px_1fr]`) and remove the `!important` media query overrides.

---

## Low Severity

### Emergency Phone Number in `contact.json` is a Placeholder

**Issue:** `src/content/settings/contact.json` has `"emergencyNumber": "12345"` — clearly a placeholder, not a real emergency number.

**Files:**
- `src/content/settings/contact.json` (line 3)

**Impact:** If this value is displayed to patients, it will direct them to a non-working number in an emergency.

**Fix approach:** Replace with the actual hospital emergency contact number before going live.

---

### `BaseLayout.astro` Falls Back to `"https://yourhospital.eg"` as Canonical URL

**Issue:** `src/layouts/BaseLayout.astro` line 29 has `const siteUrl = import.meta.env.SITE ?? "https://yourhospital.eg"`. If the `SITE` env var is not set at build time, all canonical URLs, OG tags, and Schema.org data will reference this non-existent placeholder domain.

**Files:**
- `src/layouts/BaseLayout.astro` (line 29)

**Impact:** SEO damage — search engines would index with incorrect canonicals. OG previews would show wrong URLs.

**Fix approach:** Make `SITE` a required build variable and add validation in `astro.config.mjs` that throws if it is missing.

---

### No Tests of Any Kind

**Issue:** No test files exist anywhere in the project. No Jest, Vitest, Playwright, or Cypress configuration is present. The `package.json` `scripts` block has no `test` command.

**Files:**
- `package.json` (scripts section — no `test` entry)

**Impact:** Any regression in portal auth flows, i18n string resolution, or content collection schemas will only be caught manually.

**Fix approach:** Add Vitest for unit tests on `src/i18n/index.ts` (key resolution, `localePath` correctness) and Playwright for critical portal flows (sign-in, booking, cancellation).

---

### No Error Boundaries in Vue Portal Components

**Issue:** Vue island components (`PortalBook.vue`, `PortalAppointments.vue`, `PortalHome.vue`) handle API errors by setting a reactive `error` string ref and displaying it inline. There is no Vue `errorCaptured` hook or `<Suspense>` boundary. An unhandled exception during `onMounted` (outside the try/catch) would crash the entire island silently.

**Files:**
- `src/components/portal/PortalBook.vue`
- `src/components/portal/PortalAppointments.vue`
- `src/components/portal/PortalHome.vue`

**Impact:** Unhandled errors produce a blank island with no user feedback and no error reporting.

**Fix approach:** Wrap islands in an error boundary component. At minimum, wrap the full `onMounted` bodies in try/catch.

---

### CMS Decap `local_backend: true` Is Committed

**Issue:** `public/admin/config.yml` line 1 has `local_backend: true`, which routes CMS API calls to a local proxy server when developing. If this config is deployed to production, editors who visit `/admin/` in a browser will have the CMS attempt to connect to `localhost:8081` instead of the GitHub backend.

**Files:**
- `public/admin/config.yml` (line 1)

**Impact:** The CMS will not work for any editor in a production environment unless they happen to be running the local backend proxy on their machine.

**Fix approach:** Remove `local_backend: true` from the committed config and add it only in a gitignored local override, or use a build-time variable to conditionally include it.

---

### Appointment Status Display Uses Raw Backend Enum Values

**Issue:** In `src/components/portal/PortalAppointments.vue` line 25, the appointment status badge displays `a.status` directly (e.g., `"cancelled"`, `"pending"`) with no mapping to a human-readable or translated label.

**Files:**
- `src/components/portal/PortalAppointments.vue` (line 25)

**Impact:** Patients see raw snake_case backend enum values in the UI. No Arabic translation of status labels exists.

**Fix approach:** Add a status label map to the `ar.json`/`en.json` i18n files and look up the display string from `a.status`.

---

### Slot `start_at` Timestamps Are Displayed as Raw ISO Strings

**Issue:** In `PortalAppointments.vue` (line 27) and `PortalBook.vue` (line 102), `slot.start_at` and `a.start_at` are rendered directly without any date/time formatting. Patients see strings like `2025-05-12T09:00:00Z` rather than a localized date and time.

**Files:**
- `src/components/portal/PortalAppointments.vue` (line 27)
- `src/components/portal/PortalBook.vue` (line 102)

**Impact:** Poor user experience. Arabic users expect Hijri or formatted Gregorian dates, not ISO 8601.

**Fix approach:** Format timestamps with `Intl.DateTimeFormat` using the active locale (`ar-EG` or `en-US`).

---

### `src/content/config.ts` Is an Empty Stub

**Issue:** `src/content/config.ts` contains only a comment that it was "migrated" and `export {}`. It still exists in the file tree and imports in older code might reference it.

**Files:**
- `src/content/config.ts`

**Impact:** Confusing to new developers. The real config is in `src/content.config.ts`.

**Fix approach:** Delete `src/content/config.ts` if nothing imports it.

---

*Concerns audit: 2026-05-01*
