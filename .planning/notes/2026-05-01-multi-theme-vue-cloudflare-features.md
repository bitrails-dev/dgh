---
date: "2026-05-01 06:11"
updated: "2026-05-01 07:10"
promoted: false
---

## Requirements

* multi-theme, look & feel and structural
* a dynamic Vue Island for dashboard, connected to backend
* use Cloudflare workers and Sqlite for backend
* add common site features (hospital wall, services, booking, listings, procedure requirements & steps, ...)

---

## Recommendations & Implementation Notes

### 1. Multi-Tenant Build-Time Composable Theme System

**Requirement:** Support multiple hospitals (tenants), each with its own theme, layout structure, component set, and content. **The backend is always a pure API — never a rendering backend.** The website is always statically generated HTML/CSS/JS. Different hospitals are different static builds produced from a shared Astro + Vue codebase, shaped by per-hospital config files.

**Core principle: One codebase, many configs, many builds. The config is the tenant. The build is the product.**

---

#### 1a. How It Works (Mental Model)

```
┌─────────────────────────────────────────────────────────────────┐
│                    Shared Base Codebase                          │
│         src/ — Astro pages, Vue components, layouts,            │
│         composables, section registry, content schemas          │
└───────────────────────────┬─────────────────────────────────────┘
                            │
              ┌─────────────┼──────────────┐
              │             │              │
    hospitals/dgh/    hospitals/nmc/   hospitals/xyz/
    config.ts         config.ts        config.ts
              │             │              │
              ▼             ▼              ▼
        astro build   astro build    astro build
              │             │              │
         dist/dgh/     dist/nmc/      dist/xyz/
         (static)      (static)       (static)
              │             │              │
        Cloudflare    Cloudflare     Cloudflare
        Pages         Pages          Pages
        (dgh.com)     (nmc.com)      (xyz.com)
```

Each hospital config is merged with the base at **build time**. The build outputs a fully baked static site — no runtime rendering, no server-side templating, no SSR adapter. The Cloudflare Worker remains a pure JSON API.

---

#### 1b. Hospital Config File Structure

Each hospital lives in `hospitals/{id}/` with the following files:

```
hospitals/
  dgh/
    config.ts          # main config — the single source of truth for this build
    content/           # hospital-specific content (overrides or extends base)
      doctors/         # .md files
      departments/
      events/
      services/
      procedures/
    assets/
      logo.svg
      hero.jpg
      favicon.ico
    i18n/
      ar.json          # overrides/extends base src/i18n/ar.json
      en.json
  nmc/
    config.ts
    content/
    assets/
    i18n/
```

---

#### 1c. HospitalConfig Schema

`hospitals/{id}/config.ts` is a TypeScript file (not JSON — typed, autocomplete, validated at build):

```ts
// hospitals/dgh/config.ts
import type { HospitalConfig } from '../../src/types/hospital-config'

const config: HospitalConfig = {
  id: 'dgh',
  name: 'Dar Al-Ghad Hospital',
  domain: 'dgh.example.com',
  apiBase: 'https://api.dgh.example.com',

  locale: {
    default: 'ar',
    supported: ['ar', 'en'],
  },

  // Layer 1: Design tokens — baked into CSS at build time
  tokens: {
    colorPrimary: '#1a6b3c',
    colorSecondary: '#f0a500',
    colorSurface: '#ffffff',
    colorText: '#1a1a1a',
    fontDisplay: 'Reem Kufi',        // Google Font loaded in BaseLayout
    fontBody: 'IBM Plex Sans Arabic',
    borderRadius: 'soft',            // 'sharp' | 'soft' | 'pill'
    density: 'default',              // 'compact' | 'default' | 'spacious'
  },

  // Layer 2: Layout structure — controls which layout shell is rendered
  layout: {
    variant: 'sidebar-left',         // 'sidebar-left' | 'sidebar-right' | 'top-nav' | 'minimal'
    headerStyle: 'full',
    footerStyle: 'full',
    sidebarCollapsible: true,
  },

  // Layer 3: Page composition — which sections appear, in what order, with what props
  pages: {
    home: [
      { component: 'HeroSection',      props: { variant: 'fullscreen' }, visible: true },
      { component: 'StatsBar',         props: { animated: true },        visible: true },
      { component: 'DepartmentsGrid',  props: { columns: 3 },            visible: true },
      { component: 'HospitalWall',     props: { limit: 6 },              visible: true },
      { component: 'TeamSection',      props: { featured: true },        visible: true },
      { component: 'TestimonialsRow',  props: {},                        visible: false },
    ],
    department: [
      { component: 'DeptHero',         props: {},                        visible: true },
      { component: 'DeptDoctors',      props: {},                        visible: true },
      { component: 'ProcedureList',    props: {},                        visible: true },
    ],
    // ... other pages
  },

  // Layer 4: Feature flags — gates entire sections of the site
  features: {
    booking:       true,
    portal:        true,
    hospitalWall:  true,
    procedures:    true,
    teamDirectory: true,
    awards:        false,
    achievements:  true,
  },

  // Layer 5: Content collection overrides — point to hospital-specific content dirs
  content: {
    doctors:     './hospitals/dgh/content/doctors',
    departments: './hospitals/dgh/content/departments',
    events:      './hospitals/dgh/content/events',
    services:    './hospitals/dgh/content/services',
    procedures:  './hospitals/dgh/content/procedures',
  },
}

export default config
```

---

#### 1d. Build System

A build script accepts a hospital ID and drives the Astro build with that config injected:

```ts
// scripts/build-hospital.ts
// Usage: npx tsx scripts/build-hospital.ts dgh

const hospitalId = process.argv[2]
const config = await import(`../hospitals/${hospitalId}/config.ts`)

// Write resolved config to a temp file that Astro reads at build time
await writeFile('.tmp/active-hospital.json', JSON.stringify(config.default))

// Set env vars so Astro build picks up the right API base, site URL, etc.
process.env.PUBLIC_HOSPITAL_ID   = config.default.id
process.env.PUBLIC_PORTAL_API_BASE = config.default.apiBase
process.env.PUBLIC_SITE          = `https://${config.default.domain}`

// Run Astro build — output goes to dist/{hospitalId}/
execSync(`astro build --outDir dist/${hospitalId}`, { stdio: 'inherit' })
```

`package.json` scripts:
```json
{
  "scripts": {
    "build:dgh": "tsx scripts/build-hospital.ts dgh",
    "build:nmc": "tsx scripts/build-hospital.ts nmc",
    "build:all": "tsx scripts/build-all.ts"
  }
}
```

CI/CD runs `build:all` and deploys each `dist/{id}/` to its Cloudflare Pages project.

---

#### 1e. Config Consumption at Build Time

The active hospital config is loaded once in a shared utility:

```ts
// src/utils/hospital.ts
import config from '../../.tmp/active-hospital.json'
export const hospital = config as HospitalConfig

// helpers used in .astro files:
export const hasFeature = (flag: string) => hospital.features[flag] ?? false
export const pageSlots  = (page: string) => hospital.pages[page]?.filter(s => s.visible) ?? []
```

**BaseLayout.astro** uses it at build time:
```astro
---
import { hospital } from '../utils/hospital'
const { tokens, layout } = hospital
---
<html data-layout={layout.variant} data-density={tokens.density}>
  <head>
    <!-- Tokens baked directly into a <style> block — no JS needed to apply them -->
    <style define:vars={{
      colorPrimary:   tokens.colorPrimary,
      colorSecondary: tokens.colorSecondary,
      colorSurface:   tokens.colorSurface,
      colorText:      tokens.colorText,
    }}>
      :root {
        --color-primary:   var(--colorPrimary);
        --color-secondary: var(--colorSecondary);
        --color-surface:   var(--colorSurface);
        --color-text:      var(--colorText);
      }
    </style>
  </head>
```

Tokens are **baked into the HTML at build time** — zero JS required, no flash of unstyled content, full SSG.

---

#### 1f. Dynamic Section Composition (Build-Time)

Pages read their slot list from the hospital config and render a static component registry:

```astro
---
// src/pages/[...lang]/index.astro
import { pageSlots } from '../../utils/hospital'
import DynamicSection from '../../components/DynamicSection.astro'

const slots = pageSlots('home')
---
{slots.map(slot => (
  <DynamicSection slot={slot} lang={lang} strings={strings} />
))}
```

`DynamicSection.astro` — a build-time registry, not a runtime fetch:
```astro
---
// src/components/DynamicSection.astro
import HeroSection    from './sections/HeroSection.astro'
import StatsBar       from './sections/StatsBar.astro'
import DepartmentsGrid from './sections/DepartmentsGrid.astro'
import HospitalWall   from './sections/HospitalWall.astro'
import TeamSection    from './sections/TeamSection.astro'
// ... all base components imported statically

const { slot, lang, strings } = Astro.props
const registry = { HeroSection, StatsBar, DepartmentsGrid, HospitalWall, TeamSection }
const Component = registry[slot.component]
---
{Component && <Component {...slot.props} lang={lang} strings={strings} />}
```

Astro tree-shakes unused components at build time — a hospital that has `TestimonialsRow: visible: false` will not include that component's JS in the output bundle.

---

#### 1g. Content Collections (Per-Hospital)

Astro's content config resolves collection directories from the hospital config:

```ts
// src/content.config.ts
import { hospital } from './utils/hospital'

export const collections = {
  doctors:     defineCollection({ base: hospital.content.doctors,     schema: doctorSchema }),
  departments: defineCollection({ base: hospital.content.departments, schema: deptSchema }),
  events:      defineCollection({ base: hospital.content.events,      schema: eventSchema }),
  services:    defineCollection({ base: hospital.content.services,    schema: serviceSchema }),
  procedures:  defineCollection({ base: hospital.content.procedures,  schema: procedureSchema }),
}
```

Each hospital's content directory is resolved at build time. Hospital DGH and NMC have completely independent doctor/department/event data — no bleed between builds.

---

#### 1h. i18n Merging

The hospital's `i18n/ar.json` is **deep-merged over** the base `src/i18n/ar.json` at build time:

```ts
// src/i18n/index.ts
import baseAr from './ar.json'
import baseEn from './en.json'
import hospitalAr from '../../.tmp/i18n/ar.json'  // copied from hospitals/{id}/i18n/
import hospitalEn from '../../.tmp/i18n/en.json'

export const strings = {
  ar: deepMerge(baseAr, hospitalAr),  // hospital overrides win
  en: deepMerge(baseEn, hospitalEn),
}
```

Hospital configs only need to override strings they change — the base strings serve as fallback.

---

#### 1i. Repository Structure

```
codex-v2/
  src/                          # shared base — never hospital-specific
    components/
      sections/                 # all registered section components
      layout/
      portal/
      ui/
      DynamicSection.astro      # build-time registry dispatcher
    layouts/
    pages/
    composables/
    stores/
    i18n/                       # base translation strings (ar.json, en.json)
    types/
      hospital-config.ts        # HospitalConfig TypeScript interface
    utils/
      hospital.ts               # reads .tmp/active-hospital.json
    content.config.ts           # resolves dirs from hospital config

  hospitals/                    # per-hospital configs — one folder per tenant
    dgh/
      config.ts
      content/
      assets/
      i18n/
    nmc/
      config.ts
      ...

  scripts/
    build-hospital.ts           # single hospital build
    build-all.ts                # iterate all hospitals/*/config.ts

  .tmp/                         # gitignored — populated by build script
    active-hospital.json
    i18n/

  dist/                         # gitignored — one subdir per hospital
    dgh/
    nmc/
```

---

#### 1j. What the Backend Never Does

The Cloudflare Worker (API backend) is **never involved in rendering**. It does not know about layouts, components, or tokens. It serves:
- Auth (OTP, session)
- Appointments / booking data
- Doctor availability
- Patient dashboard data
- Admin operations

The hospital's static build bakes `PUBLIC_PORTAL_API_BASE` pointing to that hospital's Worker. The Worker is scoped to one hospital's D1 database. Static site talks to it via `fetch` from Vue islands — exactly as it does today with `src/components/portal/api.ts`.

---

**Pitfalls to avoid:**
- Don't read the hospital config at runtime in Vue — it's build-time only; tokens and layout are already baked into the HTML
- Don't put component implementations in the hospital config — configs declare names and props, the base codebase owns all implementations
- Don't share a single D1 database across hospitals — each hospital gets its own D1 database binding in its Worker deployment; data isolation is non-negotiable
- Don't put hospital content inside `src/content/` — it belongs in `hospitals/{id}/content/` so the base codebase stays hospital-agnostic
- Don't `deepMerge` at runtime — do it in the build script and write the result to `.tmp/`; Astro builds must be deterministic and fast

---

### 1k. Per-Section Variant System (Layouts, Animations, Data Structures)

Each section — Hero, Doctors, Departments, and every other — is not a single fixed component. It is a **family of variants** with different layouts, animation styles, and data shapes. The hospital config selects which variant to use and what data to pass. All variants are built from the same base design tokens so they stay on-brand regardless of which is chosen.

---

#### Section Slot Config (Extended)

The `ComponentSlot` in `HospitalConfig` gains `variant` and `animation` fields:

```ts
interface ComponentSlot {
  component: string           // section family: 'HeroSection' | 'DoctorsSection' | 'DepartmentsSection' | ...
  variant: string             // which layout variant within that family
  animation?: AnimationConfig // optional — omit for no animation
  props?: Record<string, unknown>
  visible: boolean
}

interface AnimationConfig {
  style: 'fade' | 'slide-up' | 'slide-in' | 'scale' | 'stagger' | 'parallax' | 'none'
  duration?: number           // ms, default 400
  delay?: number              // ms, default 0
  easing?: string             // CSS easing or GSAP ease string
}
```

Example in a hospital config:
```ts
pages: {
  home: [
    {
      component: 'HeroSection',
      variant:   'split-media',          // fullscreen | split-media | minimal | carousel | video-bg
      animation: { style: 'fade', duration: 600 },
      props: { ctaLabel: 'Book Now', mediaPosition: 'right' },
      visible: true,
    },
    {
      component: 'DoctorsSection',
      variant:   'card-grid',            // card-grid | horizontal-scroll | featured-spotlight | list
      animation: { style: 'stagger', delay: 80 },
      props: { limit: 6, showSpecialty: true },
      visible: true,
    },
    {
      component: 'DepartmentsSection',
      variant:   'icon-tiles',           // icon-tiles | accordion | sidebar-nav | full-cards | masonry
      animation: { style: 'slide-up' },
      props: { columns: 4, showDoctorCount: true },
      visible: true,
    },
  ],
}
```

---

#### File Structure for Section Families

Each section family is a directory, not a single file. Variants live as siblings inside it:

```
src/components/sections/
  hero/
    index.ts                  # re-exports all variants + family type definitions
    HeroFullscreen.astro      # edge-to-edge image/video, centered CTA
    HeroSplitMedia.astro      # text left, media right (or RTL-flipped)
    HeroMinimal.astro         # text-only, no media, compact
    HeroCarousel.astro        # rotating slides, Vue island
    HeroVideoBg.astro         # background video with overlay text

  doctors/
    index.ts
    DoctorsCardGrid.astro     # CSS grid of portrait cards
    DoctorsHorizontalScroll.astro  # Vue island, draggable scroll
    DoctorsFeaturedSpotlight.astro # one large featured + supporting grid
    DoctorsList.astro         # compact text list with filters

  departments/
    index.ts
    DepartmentsIconTiles.astro     # icon + name grid
    DepartmentsAccordion.vue       # expandable list with description, Vue island
    DepartmentsSidebarNav.astro    # left-nav + content panel layout
    DepartmentsFullCards.astro     # large cards with image and stats
    DepartmentsMasonry.astro       # variable-height card grid

  hospital-wall/
    index.ts
    HospitalWallTimeline.astro
    HospitalWallMasonry.astro
    HospitalWallCarousel.vue

  services/
    index.ts
    ServicesGrid.astro
    ServicesList.astro
    ServicesAccordion.vue

  procedures/
    index.ts
    ProceduresSteps.astro          # step-by-step numbered flow
    ProceduresCards.astro
    ProceduresTable.astro          # requirements as a comparison table

  stats/
    index.ts
    StatsBar.astro                 # horizontal strip of counters
    StatsGrid.astro                # 2×2 or 3×2 grid
    StatsCircles.astro             # circular progress indicators

  # ... one directory per section family
```

Each `index.ts` exports the variant map so `DynamicSection` can look up by name:

```ts
// src/components/sections/hero/index.ts
export { default as HeroFullscreen }     from './HeroFullscreen.astro'
export { default as HeroSplitMedia }     from './HeroSplitMedia.astro'
export { default as HeroMinimal }        from './HeroMinimal.astro'
export { default as HeroCarousel }       from './HeroCarousel.astro'
export { default as HeroVideoBg }        from './HeroVideoBg.astro'

// Variant name → component map (used by DynamicSection registry)
export const heroVariants = {
  'fullscreen':   HeroFullscreen,
  'split-media':  HeroSplitMedia,
  'minimal':      HeroMinimal,
  'carousel':     HeroCarousel,
  'video-bg':     HeroVideoBg,
} as const

export type HeroVariant = keyof typeof heroVariants
```

---

#### DynamicSection Dispatcher (Updated for Variants)

```astro
---
// src/components/DynamicSection.astro
import { heroVariants }        from './sections/hero'
import { doctorsVariants }     from './sections/doctors'
import { departmentsVariants } from './sections/departments'
import { hospitalWallVariants } from './sections/hospital-wall'
import { servicesVariants }    from './sections/services'
import { proceduresVariants }  from './sections/procedures'
import { statsVariants }       from './sections/stats'
// ... all section families

const registry: Record<string, Record<string, any>> = {
  HeroSection:        heroVariants,
  DoctorsSection:     doctorsVariants,
  DepartmentsSection: departmentsVariants,
  HospitalWall:       hospitalWallVariants,
  ServicesSection:    servicesVariants,
  ProceduresSection:  proceduresVariants,
  StatsSection:       statsVariants,
}

const { slot, lang, strings } = Astro.props
const familyVariants = registry[slot.component]
const Component      = familyVariants?.[slot.variant]
---

{Component
  ? <Component {...slot.props} animation={slot.animation} lang={lang} strings={strings} />
  : <p>Unknown section: {slot.component}/{slot.variant}</p>
}
```

The fallback `<p>` renders only in development builds — a misconfigured hospital config is caught at dev time before deployment.

---

#### Animation Layer

Animations are not hardcoded inside variant components. They are applied by a wrapper that reads `slot.animation` and applies the appropriate motion strategy. This keeps variant components pure layout — no animation logic inside them.

```astro
---
// src/components/AnimatedSection.astro
// Wraps any section variant and applies the animation config
const { animation } = Astro.props
const motionClass = animation ? `anim-${animation.style}` : ''
const motionVars  = animation ? `--anim-duration:${animation.duration ?? 400}ms; --anim-delay:${animation.delay ?? 0}ms` : ''
---
<div class={`section-wrapper ${motionClass}`} style={motionVars} data-animation={animation?.style}>
  <slot />
</div>
```

Animation styles are implemented in `src/styles/animations.css` (file already exists in this codebase). The `data-animation` attribute is picked up by `useScrollAnimation.ts` (composable already exists) for GSAP-driven scroll reveals — no new animation infrastructure needed.

`DynamicSection` wraps every section in `AnimatedSection`:
```astro
<AnimatedSection animation={slot.animation}>
  <Component {...slot.props} lang={lang} strings={strings} />
</AnimatedSection>
```

---

#### Data Structure Per Variant

Different variants of the same section family may need different data shapes. The data structure is declared as a typed `props` schema per variant, not one monolithic prop type for the whole family.

**Example — DoctorsSection variants have different prop shapes:**

```ts
// src/components/sections/doctors/index.ts

// Card grid just needs a list + display options
interface DoctorsCardGridProps {
  limit?: number
  showSpecialty?: boolean
  columns?: 2 | 3 | 4
  department?: string      // filter by dept
}

// Spotlight needs a featured doctor ID + supporting list
interface DoctorsFeaturedSpotlightProps {
  featuredDoctorId: string
  supportingLimit?: number
}

// Horizontal scroll needs scroll behavior config
interface DoctorsHorizontalScrollProps {
  limit?: number
  cardWidth?: number        // px
  autoplay?: boolean
}
```

The hospital config's `props` field maps to whichever variant's interface is selected. TypeScript enforces this at config-authoring time when the config file is typed against `HospitalConfig`.

**Type-safe slot config:**
```ts
// src/types/hospital-config.ts
type SectionSlot =
  | { component: 'HeroSection';        variant: HeroVariant;        props: HeroPropsMap[HeroVariant];        animation?: AnimationConfig; visible: boolean }
  | { component: 'DoctorsSection';     variant: DoctorsVariant;     props: DoctorsPropsMap[DoctorsVariant];  animation?: AnimationConfig; visible: boolean }
  | { component: 'DepartmentsSection'; variant: DepartmentsVariant; props: DeptPropsMap[DepartmentsVariant]; animation?: AnimationConfig; visible: boolean }
  | { component: string;               variant: string;             props: Record<string, unknown>;           animation?: AnimationConfig; visible: boolean }
  // last line is the escape hatch for custom/future sections
```

Authoring a hospital config gives autocomplete on `variant` once `component` is set, and autocomplete on `props` once `variant` is set. Wrong props = TypeScript error at config-write time, not a broken page in production.

---

#### Shared vs Variant-Specific Styling

- **Shared (from tokens):** colors, fonts, spacing density, border-radius — all variants consume the same CSS custom properties baked into `:root` at build time, so every variant automatically stays on-brand
- **Layout-specific (in variant file):** grid columns, flex direction, image aspect ratios, overlay styles — each variant owns its own layout CSS via Tailwind classes
- **Animation-specific (in `AnimatedSection`):** motion timing, easing, trigger thresholds — applied via wrapper, not inside variants

This separation means:
- Swapping a variant never breaks the brand
- Changing a token (e.g. `colorPrimary`) instantly updates every variant in the build
- Adding a new variant requires zero changes to tokens or the animation system

---

#### Adding a New Section Variant (Workflow)

1. Create `src/components/sections/{family}/{NewVariant}.astro` (or `.vue` for interactive ones)
2. Define its props interface in `src/components/sections/{family}/index.ts`
3. Add it to the family's variant map in `index.ts`
4. Add props type to the discriminated union in `src/types/hospital-config.ts`
5. Reference it in a hospital config: `{ component: 'DoctorsSection', variant: 'new-variant', ... }`
6. Run `build:dgh` — it appears in the build, tree-shaken from any hospital that doesn't use it

No changes to `DynamicSection.astro` needed — it reads from the family's `index.ts` map.

---

### 2. Vue Dashboard Island (connected to backend)

**Recommendation:** Extend the existing portal pattern — a new `PortalDashboard.vue` island, API calls via the existing `src/components/portal/api.ts` client.

**Why:** The portal (`PortalBook.vue`, `PortalAdmin.vue`, etc.) is already a proven Vue island pattern with cookie-based auth. Dashboard is just another view in this system.

**Implementation:**
- New page: `src/pages/[...lang]/portal/dashboard/index.astro` → mounts `<PortalDashboard client:load />`
- Add dashboard endpoints to `src/components/portal/api.ts`:
  ```ts
  export const getDashboardStats = () => apiGet('/dashboard/stats')
  export const getPatientSummary = () => apiGet('/patient/summary')
  ```
- Use `@vueuse/core`'s `useIntervalFn` for polling live stats (already in deps)
- Split dashboard into panels: appointments today, pending bookings, doctor availability
- **State:** keep panel data in local `ref()` per panel component — no global store needed at this scale

**Pitfall to avoid:** Don't use `window.location.href` for dashboard navigation (current portal anti-pattern). Use Vue `v-if`/`v-show` panel switching instead — the dashboard is a SPA-within-island.

---

### 3. Cloudflare Workers + SQLite Backend

**Recommendation:** Cloudflare Workers + **D1** (Cloudflare's SQLite-compatible managed DB). Do NOT use a self-hosted SQLite file.

**Why:** D1 is Cloudflare's native SQLite offering — fully compatible with the SQLite wire protocol, globally replicated read replicas, zero cold starts when co-located with Workers. The project already has a `cloudflare/oauth-worker/` showing Wrangler familiarity.

**Implementation:**
- New worker: `cloudflare/api-worker/` (separate from oauth-worker — keep concerns separate)
- Stack: **Hono** (lightweight Cloudflare-native router, TypeScript-first) + **Drizzle ORM** (SQLite dialect, D1 adapter)
- `wrangler.toml` bindings:
  ```toml
  [[d1_databases]]
  binding = "DB"
  database_name = "codex-hospital"
  database_id = "<id from wrangler d1 create>"
  ```
- API surface (prefix `/api/v1/`):
  - `POST /auth/otp/request` — phone → send OTP
  - `POST /auth/otp/verify` — OTP → set session cookie
  - `GET  /dashboard/stats` — admin stats
  - `GET  /patient/summary` — authenticated patient view
  - `GET  /appointments` — list
  - `POST /appointments` — book
  - `GET  /doctors` — list with availability
  - `GET  /services` — service catalog
  - `GET  /procedures/:id` — steps + requirements
- Auth: Cloudflare **KV** for session tokens (TTL 24h), not D1 — KV is faster for key lookups
- Update `PUBLIC_PORTAL_API_BASE` env var to point to the deployed worker URL

**Pitfall to avoid:** D1 has no connection pooling concept (Workers are stateless). Use Drizzle's `drizzle(env.DB)` per request — don't try to maintain a persistent connection.

---

### 4. Common Hospital Site Features

**Recommendation:** Model each as an Astro Content Collection (static) + optional live data overlay from the Workers API.

| Feature | Collection | Dynamic layer |
|---|---|---|
| Hospital Wall (news/events) | `src/content/events/` (already exists) | None needed — static |
| Services catalog | New: `src/content/services/` | None |
| Booking | Already: `PortalBook.vue` | Extend with doctor/slot data from API |
| Listings (doctors, depts) | Already: `doctors`, `departments` | Filter by D1 availability data |
| Procedure requirements & steps | New: `src/content/procedures/` | None — static is fine |

**Procedure requirements & steps — content schema:**
```ts
// src/content.config.ts addition
const procedures = defineCollection({
  schema: z.object({
    name: z.string(), nameAr: z.string(),
    department: z.string(),
    steps: z.array(z.object({ step: z.number(), label: z.string(), labelAr: z.string() })),
    requirements: z.array(z.object({ item: z.string(), itemAr: z.string(), required: z.boolean() })),
    estimatedDuration: z.string().optional(),
  })
})
```

**Hospital Wall:** Promote existing `events` collection to a featured wall on the homepage — a `HospitalWallSection.astro` pulling `featured: true` entries, with a masonry/timeline layout.

**Structural theme for features:** Procedure and service pages should use a new `DetailLayout.astro` (sidebar TOC + main content) rather than the generic `SidebarLayout` — the sidebar TOC can be a Vue island with `client:visible` for scroll-spy.

---

## Suggested Build Order

1. **`HospitalConfig` TypeScript interface** (`src/types/hospital-config.ts`) — the contract all other work is built against; defines all layers (tokens, layout, pages, features, content, i18n)
2. **Build script** (`scripts/build-hospital.ts`) — populates `.tmp/active-hospital.json`, sets env vars, runs `astro build --outDir dist/{id}`
3. **`DynamicSection.astro` + section registry** — static import registry; pages iterate `pageSlots()` to render sections from config
4. **Token system** — `BaseLayout.astro` uses `define:vars` to bake tokens into HTML `<style>`; `tailwind.config.mjs` references CSS vars; `data-layout` + `data-density` on `<html>`
5. **First hospital config** (`hospitals/dgh/config.ts`) — prove the pipeline end-to-end; one build, one hospital, verify output
6. **Content collection per-hospital dirs** (`hospitals/{id}/content/`) — doctors, departments, events, services, procedures; wired via `content.config.ts`
7. **i18n merge** — build script deep-merges `hospitals/{id}/i18n/` over `src/i18n/`; hospital strings win
8. **Workers + D1 per hospital** — Cloudflare Workers API (Hono + Drizzle), one D1 database binding per hospital deployment; auth, booking, appointments
9. **Dashboard island** — `PortalDashboard.vue` island, `client:load`, polls Worker API via existing `portal/api.ts` pattern
10. **Second hospital config** (`hospitals/nmc/config.ts`) — validate that the pipeline truly is hospital-agnostic; different tokens, different sections, different content
11. **Site features** — hospital wall, procedure pages, services, listings; all rendered as static sections via `DynamicSection`
12. **Booking integration** — wire `PortalBook.vue` to real slot data from Worker API
13. **CI/CD `build:all`** — `scripts/build-all.ts` iterates all `hospitals/*/config.ts`, deploys each `dist/{id}/` to its Cloudflare Pages project
