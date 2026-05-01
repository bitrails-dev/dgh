# Codebase Structure
*Generated: 2026-05-01*
*Focus: arch*

## Top-Level Directory Layout

```
codex-v2/
├── src/                    # All source code
├── public/                 # Static assets served as-is
├── functions/              # Cloudflare edge functions (separate from Astro)
├── cloudflare/             # Cloudflare deployment config/scripts
├── dist/                   # Build output (generated, not committed)
├── docs/                   # Project documentation
├── .astro/                 # Astro build cache (generated)
├── .planning/              # GSD planning documents
├── .claude/                # Claude/AI assistant config and skills
├── .github/                # GitHub Actions workflows
├── astro.config.mjs        # Astro framework configuration (i18n, integrations)
├── astro-i18next.config.mjs # astro-i18next plugin config
├── tailwind.config.mjs     # Tailwind CSS theme (colors, fonts, spacing tokens)
├── postcss.config.cjs      # PostCSS pipeline
├── tsconfig.json           # TypeScript config
├── package.json            # npm dependencies and scripts
├── pnpm-lock.yaml          # pnpm lockfile (primary package manager)
└── package-lock.json       # npm lockfile (secondary)
```

## `src/` Directory Breakdown

```
src/
├── pages/                  # Astro file-based routing
│   ├── index.astro         # Arabic home (default locale, no prefix)
│   ├── 404.astro           # Custom 404 page
│   └── [...lang]/          # English + explicit-lang routes
│       ├── index.astro     # Home for /en/
│       ├── about.astro
│       ├── achievements.astro
│       ├── awards.astro
│       ├── contact.astro
│       ├── privacy.astro
│       ├── terms.astro
│       ├── testimonials.astro
│       ├── articles/
│       │   ├── index.astro       # Article listing
│       │   └── [slug].astro      # Dynamic article detail
│       ├── departments/
│       │   ├── index.astro       # Department listing
│       │   └── [slug].astro      # Dynamic department detail
│       ├── doctors/
│       │   └── [id].astro        # Dynamic doctor profile
│       ├── events/
│       │   ├── index.astro
│       │   └── [slug].astro
│       ├── team/                 # Team listing page(s)
│       └── portal/               # Patient portal (Vue-driven)
│           ├── index.astro       # Portal home / dashboard
│           ├── admin/
│           │   └── index.astro
│           ├── appointments/
│           │   └── index.astro
│           ├── book/
│           │   └── index.astro
│           ├── sign-in/
│           │   └── index.astro
│           └── sign-up/
│               └── index.astro
│
├── layouts/                # Page shell layouts
│   ├── BaseLayout.astro    # Root HTML shell: <html>, <head>, SEO, fonts, scripts
│   ├── SidebarLayout.astro # Public page chrome: TopBar + Sidebar + Footer + breadcrumbs
│   └── PortalLayout.astro  # Portal chrome: PortalNav + Footer (noindex)
│
├── components/             # All reusable components
│   ├── layout/             # Global chrome components
│   │   ├── TheTopBar.astro        # Top navigation bar (Astro)
│   │   ├── TheSidebar.vue         # Mobile/desktop sidebar nav (Vue, client:load)
│   │   ├── TheFooter.astro        # Site footer (Astro)
│   │   └── WaveDivider.astro      # Decorative SVG wave section divider
│   │
│   ├── sections/           # Full-width page section components
│   │   ├── HeroSection.astro           # Homepage hero with stats
│   │   ├── DepartmentsSection.astro    # Department cards grid
│   │   ├── MissionStrip.astro          # About/mission band
│   │   ├── AchievementsSection.astro   # Timeline/stats band
│   │   ├── AchievementsTimeline.vue    # Interactive timeline (Vue)
│   │   ├── TeamSection.astro           # Doctor cards section
│   │   ├── TestimonialsSection.vue     # Testimonial carousel (Vue, client:visible)
│   │   ├── AwardsWall.astro            # Awards display grid
│   │   ├── AwardsListSection.astro     # Awards list with year column
│   │   ├── ContactSection.vue          # Contact form (Vue, client:visible)
│   │   └── StatsBlock.vue              # Animated number counters (Vue)
│   │
│   ├── ui/                 # Reusable UI primitives
│   │   ├── CardBase.astro         # Base card shell with all variants
│   │   ├── CardDepartment.astro   # Department-specific card
│   │   ├── CardDoctor.astro       # Doctor profile card
│   │   ├── CardEvent.astro        # Event card
│   │   ├── CardNurse.astro        # Nurse profile card
│   │   ├── CardGrid.astro         # Static card grid wrapper
│   │   ├── FilteredCardGrid.vue   # Client-side filterable card grid (Vue)
│   │   ├── ImageGallery.vue       # Lightbox image gallery (Vue)
│   │   ├── PageHeader.astro       # Inner-page header with title/description
│   │   ├── YouTubeEmbed.astro     # Lazy YouTube embed
│   │   ├── GoldHeading.astro      # Styled section heading with gold accent
│   │   ├── SectionLabel.astro     # Small uppercase label above headings
│   │   ├── BadgeExcellence.astro  # "Center of Excellence" badge
│   │   └── ArRedirect.astro       # Client-side redirect for /ar/... canonical URLs
│   │
│   └── portal/             # Patient portal Vue components
│       ├── api.ts                 # Typed HTTP client for backend REST API
│       ├── PortalNav.vue          # Portal navigation bar
│       ├── PortalHome.vue         # Portal dashboard / patient home
│       ├── PortalSignIn.vue       # OTP sign-in flow
│       ├── PortalSignUp.vue       # Patient registration form
│       ├── PortalAppointments.vue # Appointment list + cancel/reschedule
│       ├── PortalBook.vue         # Appointment booking wizard
│       └── PortalAdmin.vue        # Admin panel (bootstrap, slot management, verification)
│
├── content/                # Astro Content Collections (Markdown + JSON)
│   ├── content.config.ts   # Collection schemas (lives at src/ root, not src/content/)
│   ├── articles/           # Blog/news articles (.md)
│   ├── achievements/       # Hospital achievement timeline (.md)
│   ├── awards/             # Awards (.md)
│   ├── departments/        # Department entries (.md)
│   ├── doctors/            # Doctor profiles (.md)
│   ├── events/             # Events and announcements (.md)
│   ├── testimonials/       # Patient testimonials (.md)
│   └── settings/           # Dynamic configuration JSON
│       ├── hero.json            # Hero section stats (years, departments, patients, staff)
│       └── contact.json         # Contact details
│
├── i18n/                   # Internationalisation strings
│   ├── ar.json             # Full Arabic string tree (~13 KB)
│   ├── en.json             # Full English string tree (~11 KB)
│   └── index.ts            # getStrings(), localePath(), t() helpers
│
├── stores/                 # Vue reactive state singletons
│   ├── locale.ts           # useLocaleStore() — current locale + localStorage persistence
│   └── ui.ts               # useUiStore() — mobile menu open/close state
│
├── composables/            # Vue composition API utilities
│   ├── useRTL.ts           # Reactive isRTL ref watching document.documentElement.dir
│   ├── useCounter.ts       # Animated number counter
│   └── useScrollAnimation.ts # Motion variant presets
│
├── styles/
│   └── global.css          # Global CSS: Tailwind directives, custom animations, data-animate fade utility
│
├── content.config.ts       # Astro Content Collection schema definitions (zod)
└── env.d.ts                # Astro env type reference
```

## Key File Locations

**Entry Points:**
- `src/pages/index.astro` — Arabic homepage (default locale)
- `src/pages/[...lang]/index.astro` — English homepage

**Configuration:**
- `astro.config.mjs` — Framework config: output mode, i18n locales, integrations
- `tailwind.config.mjs` — Design tokens: custom color palette, font families, spacing scale, shadow presets
- `src/content.config.ts` — Content collection schemas (zod-validated)
- `tsconfig.json` — TypeScript settings
- `astro-i18next.config.mjs` — astro-i18next plugin configuration

**Core Logic:**
- `src/i18n/index.ts` — `getStrings()`, `localePath()`, `t()` — all i18n helpers
- `src/components/portal/api.ts` — All backend API calls
- `src/stores/locale.ts` — Locale state management
- `src/stores/ui.ts` — UI state management

**Layouts:**
- `src/layouts/BaseLayout.astro` — HTML shell, SEO, Schema.org
- `src/layouts/SidebarLayout.astro` — Public page chrome
- `src/layouts/PortalLayout.astro` — Portal chrome

## Where to Add New Code

**New public page:**
- Create `src/pages/[...lang]/my-page.astro`
- Mirror Arabic version at `src/pages/my-page.astro` (hardcode `lang = "ar"`)
- Wrap with `<BaseLayout> <SidebarLayout>` pattern
- Add breadcrumb array and pass `strings = getStrings(lang)`

**New content collection:**
- Add Markdown files to a new `src/content/<collection>/` directory
- Register the collection with schema in `src/content.config.ts`
- Query with `getCollection('<collection>')` in page `getStaticPaths`

**New page section:**
- Static: create `src/components/sections/MySection.astro`
- Interactive: create `src/components/sections/MySection.vue`, mount with `client:visible`

**New UI primitive:**
- Static: `src/components/ui/MyWidget.astro`
- Interactive: `src/components/ui/MyWidget.vue` with `client:visible` or `client:idle`

**New portal view:**
- Create `src/components/portal/PortalMyView.vue`
- Create `src/pages/[...lang]/portal/my-view/index.astro` using `PortalLayout`
- Add any API calls to `src/components/portal/api.ts`

**New i18n strings:**
- Add keys to both `src/i18n/ar.json` and `src/i18n/en.json` under the same key path
- TypeScript will infer the new keys automatically from `getStrings()` return type

**New translatable content settings:**
- Static configuration values: add a JSON file to `src/content/settings/`
- Read with `import settings from '../../content/settings/my-setting.json'` in Astro frontmatter

## Naming Conventions

**Files:**
- Astro components: `PascalCase.astro` (e.g., `HeroSection.astro`, `CardDoctor.astro`)
- Vue components: `PascalCase.vue` (e.g., `TheSidebar.vue`, `PortalBook.vue`)
- TypeScript modules: `camelCase.ts` (e.g., `useRTL.ts`, `locale.ts`)
- Content files: `kebab-case.md` (e.g., `general-surgery.md`, `ayman-el-najjar.md`)
- JSON settings: `kebab-case.json` (e.g., `hero.json`, `contact.json`)

**Component name prefixes:**
- `The*` — Singleton layout chrome (only one instance per page): `TheTopBar`, `TheSidebar`, `TheFooter`
- `Portal*` — Patient portal components: `PortalBook`, `PortalSignIn`
- `Card*` — Card display components: `CardDoctor`, `CardDepartment`
- `*Section` — Full-width page sections: `HeroSection`, `DepartmentsSection`
- `use*` — Vue composables: `useRTL`, `useCounter`

## Public Assets

```
public/
├── logo/           # SVG logo variants (primary, hex, themed)
├── images/         # Static images (OG default, photos)
├── uploads/        # User-uploaded content (doctor photos, etc.)
├── admin/          # Admin static assets
├── favicon.svg
├── icon.png
├── robots.txt
└── site.webmanifest
```

## Special Directories

**`.planning/`:**
- Purpose: GSD planning documents (phases, codebase maps)
- Generated: Partially (by AI tooling)
- Committed: Yes

**`dist/`:**
- Purpose: Astro build output — full static site
- Generated: Yes (by `astro build`)
- Committed: No (in `.gitignore`)

**`functions/`:**
- Purpose: Cloudflare Pages Functions (edge API handlers, separate from Astro build)
- Committed: Yes

**`.astro/`:**
- Purpose: Astro framework build cache and type generation
- Generated: Yes
- Committed: No

---

*Structure analysis: 2026-05-01*
