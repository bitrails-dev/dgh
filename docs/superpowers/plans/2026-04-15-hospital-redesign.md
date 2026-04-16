# Hospital Website Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor the hospital website from a single-page layout with top navbar to a multi-page architecture with persistent sidebar navigation, restructured CMS collections, and dedicated pages for each content section.

**Architecture:** Astro 6 static site with Vue 3 islands for interactivity. Content managed via Decap CMS with bilingual AR/EN support. Sidebar navigation replaces top navbar. Each homepage section becomes a dedicated route. Events & Highlights collection replaces News with gallery/YouTube support.

**Tech Stack:** Astro 6, Vue 3, Tailwind CSS 3, Decap CMS, astro-i18next, Zod schemas

**Spec document:** `docs/superpowers/specs/2026-04-15-hospital-redesign-design.md`

---

## File Map

### Files to Create

| File | Responsibility |
|------|----------------|
| `src/layouts/SidebarLayout.astro` | Structural shell: sidebar + topbar + content slot + footer |
| `src/components/layout/TheSidebar.vue` | Sidebar navigation — hybrid collapse/expand, RTL-aware |
| `src/components/layout/TheTopBar.astro` | Breadcrumb, language toggle, emergency button |
| `src/components/ui/PageHeader.astro` | Reusable page title + subtitle |
| `src/components/ui/FilteredCardGrid.vue` | Filter + pagination + card rendering for articles/events |
| `src/components/ui/CardEvent.astro` | Event card (replaces CardNews) |
| `src/components/ui/YouTubeEmbed.astro` | Responsive YouTube iframe with URL parsing |
| `src/components/ui/ImageGallery.vue` | Gallery grid with accessible lightbox |
| `src/components/sections/HomeHeroPreview.astro` | Condensed hero for landing page |
| `src/components/sections/HomeAchievementsPreview.astro` | Achievements preview cards + "View all" |
| `src/components/sections/HomeEventsPreview.astro` | Events preview cards + "View all" |
| `src/components/sections/ArticleDetail.astro` | Prose column + sticky metadata sidebar |
| `src/components/sections/EventDetail.astro` | Description + YouTube + gallery layout |
| `src/pages/[lang]/about.astro` | About page (mission, vision, values) |
| `src/pages/[lang]/team/index.astro` | Team index (doctors only, no nursing) |
| `src/pages/[lang]/achievements.astro` | Full achievements timeline page |
| `src/pages/[lang]/awards.astro` | Full awards wall page |
| `src/pages/[lang]/testimonials.astro` | Testimonials listing page |
| `src/pages/[lang]/events/index.astro` | Events & Highlights index |
| `src/pages/[lang]/events/[slug].astro` | Event detail page |
| `src/pages/[lang]/contact.astro` | Contact form page |

### Files to Modify

| File | Change |
|------|--------|
| `tailwind.config.mjs` | Add top-level `screens` with `2xl: 1440px` |
| `src/content.config.ts` | Rename news→events, add gallery/youtube fields, add testimonials, remove nursing, remove `lang` from articles |
| `public/admin/config.yml` | Rename news→events, add new fields, remove nursing |
| `src/layouts/BaseLayout.astro` | Remove `<main id="main-content">` wrapper, delegate to SidebarLayout |
| `src/components/layout/TheFooter.astro` | Replace hash-anchor links with page routes, rename `strings.news` → `strings.events` |
| `src/pages/[lang]/index.astro` | Rewrite as landing page (hero + achievements + events previews) |
| `src/pages/[lang]/articles/index.astro` | Use FilteredCardGrid, update string references |
| `src/pages/[lang]/articles/[slug].astro` | Fix bilingual getStaticPaths, use ArticleDetail, fix `strings.news` → `strings.events` |
| `src/pages/[lang]/departments/[slug].astro` | Update to use SidebarLayout, replace hash-anchor links with page routes |
| `src/pages/[lang]/doctors/[id].astro` | Update to use SidebarLayout, replace hash-anchor links with page routes |
| `src/i18n/ar.json` | Add new nav/breadcrumb/events keys, remove nursing, rename news→events |
| `src/i18n/en.json` | Same as ar.json |

### Files to Create (additional)

| File | Responsibility |
|------|----------------|
| `src/pages/[lang]/departments/index.astro` | Departments index page (grid of all departments) |

### Files to Delete

| File | Reason |
|------|--------|
| `src/components/layout/TheNavbar.vue` | Replaced by TheSidebar + TheTopBar |
| `src/components/ui/CardNurse.astro` | Nursing removed |
| `src/components/ui/CardNews.astro` | Replaced by CardEvent |
| `src/components/sections/AchievementsSection.astro` | Split into dedicated pages |
| `src/components/sections/HeroSection.astro` | Replaced by HomeHeroPreview |
| `src/components/sections/MissionStrip.astro` | Content moves to /about page |
| `src/components/sections/DepartmentsSection.astro` | Content moves to /departments |
| `src/components/sections/NewsSection.astro` | Replaced by HomeEventsPreview |
| `src/components/sections/TeamSection.astro` | Content moves to /team (nursing removed) |
| `src/content/nursing/` | Entire directory — nursing removed |
| `src/pages/[lang]/news/` | Entire directory — replaced by /events/ |
| `src/pages/[lang]/achievements/[slug].astro` | Old detail page imports TheNavbar — replaced by dedicated achievements page |
| `src/content/config.ts` | Legacy Astro v5 config file — superseded by `src/content.config.ts` |

### Content Files to Migrate

| From | To | Changes |
|------|----|---------|
| `src/content/news/*.md` | `src/content/events/*.md` | Rename `excerpt`→`summary`, `excerptAr`→`summaryAr`, update `category` values, remove `lang` field |

---

## Parallelization Strategy

Tasks are grouped into **phases**. Tasks within a phase can be executed in parallel by independent agents. Each phase must complete before the next begins.

```
Phase 1: Foundation (no dependencies — all parallel)
  ├─ Task 1: Tailwind config + max-width
  ├─ Task 2: Content migration (news→events, nursing delete, schema updates)
  ├─ Task 3: i18n updates
  └─ Task 4: Decap CMS config

Phase 2: Layout Shell (sequential — Task 5 then Task 6)
  ├─ Task 5: SidebarLayout + TheSidebar + TheTopBar + PageHeader + CardEvent
  └─ Task 6: BaseLayout integration + TheFooter link fixes (AFTER Task 5)

Phase 3: Standalone Pages (depends on Phase 2 — all parallel)
  ├─ Task 7: About page
  ├─ Task 8: Team index + Departments index pages
  ├─ Task 9: Achievements page
  ├─ Task 10: Awards page
  ├─ Task 11: Testimonials page
  ├─ Task 12: Contact page
  ├─ Task 13: UI components (YouTubeEmbed, ImageGallery)
  ├─ Task 14: FilteredCardGrid component
  └─ Task 15: Update existing detail pages (departments/[slug], doctors/[id])

Phase 4: Content Pages (depends on Phase 3 — all parallel)
  ├─ Task 16: Events index + detail pages
  ├─ Task 17: Articles index + detail pages (fix bilingual paths)
  └─ Task 18: Homepage rewrite (landing with previews)

Phase 5: Cleanup & Verification (depends on Phase 4 — sequential)
  ├─ Task 19: Delete old components and files
  └─ Task 20: Build verification + full-site check

NOTE on intermediate builds: After Phase 1, intermediate `npm run build` will fail
because pages in `src/pages/[lang]/news/` and `src/pages/[lang]/index.astro` still
reference the old `news` collection and `strings.news.*` keys. This is EXPECTED and
resolved in Phases 3-5. Do not abort on these intermediate failures.
```

---

## Phase 1: Foundation

### Task 1: Tailwind Config — Max-Width Cap

**Files:**
- Modify: `tailwind.config.mjs`

- [ ] **Step 1: Read current config**

Read `tailwind.config.mjs` to confirm current state.

- [ ] **Step 2: Add top-level screens override**

In `tailwind.config.mjs`, move `container` out of `extend` (it's already at top level in `theme`), and add a top-level `screens` key. The `container` plugin reads from `theme.screens` — not from nested `container.screens`.

```javascript
// tailwind.config.mjs — theme object becomes:
theme: {
  screens: {
    sm: '640px',
    md: '768px',
    lg: '1024px',
    xl: '1280px',
    '2xl': '1440px',
  },
  container: {
    center: true,
    padding: {
      DEFAULT: '1.25rem',
      lg: '2rem',
      xl: '3rem',
    },
  },
  extend: {
    // existing colors, fontFamily, fontSize, boxShadow, keyframes, animation — unchanged
  },
},
```

- [ ] **Step 3: Verify build and check for layout impact**

Run: `npm run build`
Expected: Build succeeds. Container max-width is now 1440px at the 2xl breakpoint.

NOTE: This changes the `2xl` breakpoint from the Tailwind default of 1536px to 1440px. Any existing `2xl:` utility classes will now activate at 1440px instead of 1536px. Grep `src/` for `2xl:` to verify no layout shifts — the current codebase does not appear to use `2xl:` classes, but confirm before committing.

- [ ] **Step 4: Commit**

```bash
git add tailwind.config.mjs
git commit -m "feat: cap container max-width at 1440px via screens override"
```

---

### Task 2: Content Migration — News to Events + Schema Updates

**Files:**
- Modify: `src/content.config.ts`
- Move: `src/content/news/*.md` → `src/content/events/*.md`
- Delete: `src/content/nursing/` (entire directory)

- [ ] **Step 1: Read current content.config.ts**

Read `src/content.config.ts` fully.

- [ ] **Step 2: Move news content files to events directory**

```bash
mkdir -p src/content/events
cp src/content/news/*.md src/content/events/
```

- [ ] **Step 3: Update frontmatter in all moved event files**

For each file in `src/content/events/`:
1. Rename `excerpt:` → `summary:`
2. Rename `excerptAr:` → `summaryAr:`
3. Remove the `lang:` field entirely
4. Update `category:` values to one of: `procedure`, `event`, `announcement`
   - Map existing categories: `hospital-news` → `announcement`, `health-tips` → `announcement`, `research` → `procedure`, `events` → `event`

- [ ] **Step 4: Update content.config.ts — rename news to events with new fields**

Replace the `news` collection (lines 71-84) with the following. **IMPORTANT:** This project uses the Astro v6 `glob()` loader API — NOT the v5 `type: 'content'` API. All collections use `loader: glob(...)`.

```typescript
const events = defineCollection({
  loader: glob({ pattern: "**/*.md", base: "./src/content/events" }),
  schema: z.object({
    title: z.string(),
    titleAr: z.string(),
    date: z.coerce.date(),
    category: z.enum(["procedure", "event", "announcement"]),
    summary: z.string(),
    summaryAr: z.string(),
    thumbnail: z.string().optional(),
    featured: z.boolean().default(false),
    youtubeUrl: z.string().url().optional(),
    gallery: z.array(z.object({
      url: z.string(),
      caption: z.string().optional(),
      captionAr: z.string().optional(),
      alt: z.string(),
    })).optional(),
    body: z.string().optional(),
    bodyAr: z.string().optional(),
  }),
});
```

Also update the `collections` export (lines 98-106) to replace `news` with `events` and remove `nursing`.

- [ ] **Step 5: Remove `lang` field from articles collection**

In the articles collection (line 15), remove:
```typescript
lang: z.enum(["ar", "en"]).default("ar"),
```

Also remove `lang` from all article frontmatter files in `src/content/articles/`.

- [ ] **Step 6: Add testimonials collection**

First create the testimonials content directory (required for the glob loader):

```bash
mkdir -p src/content/testimonials
```

Then add after the events collection:

```typescript
const testimonials = defineCollection({
  loader: glob({ pattern: "**/*.md", base: "./src/content/testimonials" }),
  schema: z.object({
    name: z.string(),
    nameAr: z.string(),
    quote: z.string(),
    quoteAr: z.string(),
    caseType: z.string().optional(),
    caseTypeAr: z.string().optional(),
    avatar: z.string().optional(),
    featured: z.boolean().default(false),
  }),
});
```

Add `testimonials` to the `collections` export object.

- [ ] **Step 7: Remove nursing collection**

Delete the nursing collection definition (lines 86-96) from `src/content.config.ts`.

```bash
rm -rf src/content/nursing
```

- [ ] **Step 8: Delete old news directory**

```bash
rm -rf src/content/news
```

- [ ] **Step 9: Verify build**

Run: `npm run build`
Expected: Build succeeds with new collection schemas. May have page errors (pages still reference old collections) — that's expected and will be fixed in later tasks.

- [ ] **Step 10: Commit**

```bash
git add src/content/ src/content.config.ts
git commit -m "feat: migrate news→events collection, add testimonials, remove nursing, remove lang field"
```

---

### Task 3: i18n Updates

**Files:**
- Modify: `src/i18n/ar.json`
- Modify: `src/i18n/en.json`
- Modify: `src/i18n/index.ts` (if types need updating)

- [ ] **Step 1: Read current ar.json and en.json**

Read both files fully to understand current key structure.

- [ ] **Step 2: Update en.json**

Changes to make:
1. Replace `nav` section with complete final state:
```json
"nav": {
  "home": "Home",
  "about": "About",
  "departments": "Departments",
  "team": "Our Team",
  "achievements": "Achievements",
  "awards": "Awards",
  "testimonials": "Testimonials",
  "articles": "Articles",
  "events": "Events & Highlights",
  "contact": "Contact Us",
  "toggleToEn": "English",
  "toggleToAr": "العربية",
  "emergency": "Emergency"
}
```

2. Rename `news` section to `events` and update:
```json
"events": {
  "title": "Events & Highlights",
  "subtitle": "Latest events, procedures, and announcements from the hospital",
  "cta": "View All Events",
  "category": {
    "all": "All",
    "procedure": "Procedures",
    "event": "Events",
    "announcement": "Announcements"
  }
}
```

3. Add `breadcrumb` section:
```json
"breadcrumb": {
  "home": "Home",
  "about": "About",
  "departments": "Departments",
  "team": "Our Team",
  "achievements": "Achievements",
  "awards": "Awards",
  "testimonials": "Testimonials",
  "articles": "Articles",
  "events": "Events & Highlights",
  "contact": "Contact Us"
}
```

4. Add `common` section:
```json
"common": {
  "viewAll": "View All",
  "backTo": "Back to"
}
```

5. Add `sidebar` section:
```json
"sidebar": {
  "expand": "Expand menu",
  "collapse": "Collapse menu",
  "emergency": "Emergency"
}
```

6. Remove any nursing-related keys (check `team` section).

- [ ] **Step 3: Update ar.json**

Mirror all en.json changes with Arabic translations:
1. `nav` — full Arabic nav keys
2. `events` section (renamed from `news`)
3. `breadcrumb` section
4. `common` section
5. `sidebar` section
6. Remove nursing keys

- [ ] **Step 4: Verify build**

Run: `npm run build`
Expected: May have errors from pages referencing old `strings.news` — expected, fixed later.

- [ ] **Step 5: Commit**

```bash
git add src/i18n/
git commit -m "feat: update i18n — add nav/breadcrumb/sidebar/events keys, rename news→events, remove nursing"
```

---

### Task 4: Decap CMS Config

**Files:**
- Modify: `public/admin/config.yml`

- [ ] **Step 1: Read current config.yml**

Read `public/admin/config.yml` fully.

- [ ] **Step 2: Rename News collection to Events & Highlights**

At lines 146-170, change:
- `name: news` → `name: events`
- `label: "الأخبار"` → `label: "فعاليات وإنجازات — Events & Highlights"`
- `folder: src/content/news` → `folder: src/content/events`
- Update `category` widget options from `hospital-news, health-tips, research, events` to `procedure, event, announcement`
- Rename `summary`/`summaryAr` fields (these already use `summary` in CMS, so keep them)

- [ ] **Step 3: Add youtubeUrl field to Events collection**

Add after the `thumbnail` field:
```yaml
- { label: "YouTube Video URL", name: "youtubeUrl", widget: "string", required: false }
```

- [ ] **Step 4: Add gallery field to Events collection**

Add after `youtubeUrl`:
```yaml
- label: "Image Gallery"
  name: "gallery"
  widget: "list"
  required: false
  fields:
    - { label: "Image", name: "url", widget: "image" }
    - { label: "Caption (English)", name: "caption", widget: "string", required: false }
    - { label: "Caption (Arabic)", name: "captionAr", widget: "string", required: false }
    - { label: "Alt Text", name: "alt", widget: "string" }
```

- [ ] **Step 5: Remove nursing collection**

Delete the entire nursing collection block from config.yml.

- [ ] **Step 6: Remove lang field from articles collection**

In the articles collection (lines 53-76), remove the `lang` field widget.

- [ ] **Step 7: Commit**

```bash
git add public/admin/config.yml
git commit -m "feat: update Decap CMS — rename news→events, add gallery/youtube, remove nursing"
```

---

## Phase 2: Layout Shell

### Task 5: Sidebar + TopBar + SidebarLayout + PageHeader + CardEvent

**Files:**
- Create: `src/components/layout/TheSidebar.vue`
- Create: `src/components/layout/TheTopBar.astro`
- Create: `src/layouts/SidebarLayout.astro`
- Create: `src/components/ui/PageHeader.astro`
- Create: `src/components/ui/CardEvent.astro`

NOTE: PageHeader and CardEvent are created here (not Phase 3) because all Phase 3 standalone pages depend on them.

- [ ] **Step 1: Create TheSidebar.vue**

Create `src/components/layout/TheSidebar.vue` — the main navigation component.

Key requirements:
- **Props:** `lang` (string), `currentPath` (string), `strings` (object from i18n)
- **Nav items array:** Map route paths from the spec's route table (Section 2). Each item: `{ id, label, icon, href }`. Icons use inline SVG or lucide-vue-next (already installed).
- **Responsive behavior:**
  - `xl:` (≥1280px) — full 240px sidebar, always visible
  - `md–lg` (768–1279px) — 64px rail, icon-only. On hover/click → expand to 240px overlay
  - `<md` (mobile) — hidden. Hamburger in topbar triggers slide-in drawer
- **Active state:** Compare `currentPath` against each nav item's `href`. Apply gold border-inline-start + tinted background.
- **Emergency section:** Pinned to bottom with phone icon and emergency number.
- **RTL:** Use logical CSS properties (`inline-start`, `inline-end`). Detect from `document.dir` or `lang` prop.
- **Style:** White background, primary blue text, gold active accent. See spec Section 1 for exact colors.
- **Hydration:** `client:load` — must be interactive immediately.

The sidebar emits no events — it's self-contained navigation.

- [ ] **Step 2: Create TheTopBar.astro**

Create `src/components/layout/TheTopBar.astro`.

Key requirements:
- **Props:** `breadcrumbs` (array of `{ label: string, href?: string }`), `lang` (string), `strings` (object)
- **Renders:**
  1. Visual breadcrumb trail: `<nav aria-label="Breadcrumb"><ol>` with links for all items except last (current page)
  2. Language toggle button (switches between `/ar/...` and `/en/...`)
  3. Emergency call button (pill style)
  4. Hamburger button (visible only on `<md`, toggles sidebar drawer)
- **JSON-LD:** Renders `<script type="application/ld+json">` with `BreadcrumbList` schema from breadcrumbs prop
- **Sticky:** `position: sticky; top: 0; z-index: 40;` with white background and thin border-bottom

- [ ] **Step 3: Create SidebarLayout.astro**

Create `src/layouts/SidebarLayout.astro`.

Key requirements:
- **Props:** `lang`, `strings`, `breadcrumbs`, `currentPath`
- **Does NOT produce `<html>` or `<body>`** — this is a structural component inside BaseLayout's body
- **Structure:**

```astro
---
// Props
const { lang, strings, breadcrumbs, currentPath } = Astro.props;
---
<div class="mx-auto flex max-w-[1440px]">
  <!-- Sidebar -->
  <TheSidebar lang={lang} currentPath={currentPath} strings={strings} client:load />

  <!-- Content area -->
  <div class="min-h-screen flex-1">
    <TheTopBar breadcrumbs={breadcrumbs} lang={lang} strings={strings} />
    <main id="main-content" class="px-6 py-8 lg:px-8">
      <slot />
    </main>
    <TheFooter lang={lang} strings={strings} />
  </div>
</div>
```

- [ ] **Step 4: Create PageHeader.astro**

```astro
---
interface Props {
  title: string;
  subtitle?: string;
}
const { title, subtitle } = Astro.props;
---
<header class="mb-8">
  <h1 class="text-section font-bold text-primary">{title}</h1>
  {subtitle && <p class="mt-3 max-w-2xl text-sm text-muted">{subtitle}</p>}
  <slot /> <!-- Optional slot for filter bar or actions -->
</header>
```

- [ ] **Step 5: Create CardEvent.astro**

Based on current `CardNews.astro` but updated for events schema:
- Props: `title`, `titleAr`, `date`, `category`, `summary`, `summaryAr`, `thumbnail`, `slug`, `lang`
- Display category as a colored pill (procedure=secondary, event=primary, announcement=accent)
- Link to `/${lang}/events/${slug}`

- [ ] **Step 6: Verify components render**

Run: `npm run dev`
Manually import SidebarLayout in one test page to confirm it renders without errors. Check that the sidebar appears at xl breakpoint.

- [ ] **Step 7: Commit**

```bash
git add src/components/layout/TheSidebar.vue src/components/layout/TheTopBar.astro src/layouts/SidebarLayout.astro src/components/ui/PageHeader.astro src/components/ui/CardEvent.astro
git commit -m "feat: add sidebar navigation, topbar, sidebar layout shell, PageHeader, and CardEvent"
```

---

### Task 6: BaseLayout Integration + Footer Link Fixes

**Files:**
- Modify: `src/layouts/BaseLayout.astro`
- Modify: `src/components/layout/TheFooter.astro`

- [ ] **Step 1: Read BaseLayout.astro**

Read `src/layouts/BaseLayout.astro` to understand current structure.

- [ ] **Step 2: Update BaseLayout to use SidebarLayout**

**CRITICAL:** `BaseLayout.astro` currently has `<main id="main-content"><slot /></main>` (line 97-98). `SidebarLayout.astro` also renders `<main id="main-content">`. You MUST remove the `<main>` wrapper from BaseLayout to avoid duplicate `<main>` elements and duplicate IDs.

Replace BaseLayout's body content. Before:
```html
<main id="main-content">
  <slot />
</main>
```

After:
```html
<SidebarLayout lang={lang} strings={strings} breadcrumbs={breadcrumbs} currentPath={currentPath}>
  <slot />
</SidebarLayout>
```

Remove any TheNavbar import/usage if present. BaseLayout must accept and pass through: `lang`, `strings`, `breadcrumbs`, `currentPath` props to SidebarLayout.

- [ ] **Step 3: Read TheFooter.astro**

Read `src/components/layout/TheFooter.astro`.

- [ ] **Step 4: Update footer hash-anchor links**

Replace the quick links section (lines 28-39) using this mapping:
| Old | New |
|-----|-----|
| `${basePath}/#about` | `/${lang}/about` |
| `${basePath}/#departments` | `/${lang}/departments` |
| `${basePath}/#achievements` | `/${lang}/achievements` |
| `${basePath}/#team` | `/${lang}/team` |
| `${basePath}/#news` | `/${lang}/events` |

Keep Privacy and Terms links as-is.

**ALSO:** Update any `strings.nav.news` references to `strings.nav.events` (the i18n key was renamed in Task 3).

- [ ] **Step 5: Verify build**

Run: `npm run build`
Expected: Build may partially fail because pages still import old section components — that's fine for this task.

- [ ] **Step 6: Commit**

```bash
git add src/layouts/BaseLayout.astro src/components/layout/TheFooter.astro
git commit -m "feat: integrate SidebarLayout into BaseLayout, fix footer links to page routes"
```

---

## Phase 3: Standalone Pages + Reusable Components

### Task 7: About Page

**Files:**
- Create: `src/pages/[lang]/about.astro`

- [ ] **Step 1: Read MissionStrip.astro for reference**

Read `src/components/sections/MissionStrip.astro` to understand the current mission/vision/values content and layout.

- [ ] **Step 2: Create about.astro**

Create `src/pages/[lang]/about.astro`:

```astro
---
import BaseLayout from '../../layouts/BaseLayout.astro';
import { getStrings } from '../../i18n';

export function getStaticPaths() {
  return [{ params: { lang: 'ar' } }, { params: { lang: 'en' } }];
}

const { lang } = Astro.params;
const strings = getStrings(lang);
const breadcrumbs = [
  { label: strings.breadcrumb.home, href: `/${lang}/` },
  { label: strings.breadcrumb.about },
];
---
<BaseLayout lang={lang} strings={strings} breadcrumbs={breadcrumbs} currentPath={`/${lang}/about`}>
  <!-- Mission, Vision, Values content adapted from MissionStrip -->
</BaseLayout>
```

Adapt the mission/vision/values markup from MissionStrip.astro. Use the i18n strings for all text. Add a PageHeader at the top.

- [ ] **Step 3: Verify page renders**

Run: `npm run dev` → Navigate to `/en/about` and `/ar/about`.

- [ ] **Step 4: Commit**

```bash
git add src/pages/[lang]/about.astro
git commit -m "feat: add standalone About page with mission/vision/values"
```

---

### Task 8: Team Index + Departments Index Pages

**Files:**
- Create: `src/pages/[lang]/team/index.astro`
- Create: `src/pages/[lang]/departments/index.astro`

- [ ] **Step 1: Read current TeamSection.astro and DepartmentsSection.astro for reference**

Read `src/components/sections/TeamSection.astro` and `src/components/sections/DepartmentsSection.astro`.

- [ ] **Step 2: Create team/index.astro**

Create the team index page. Query `getCollection('doctors')`, display featured doctors first (larger cards), then all doctors in a grid. Use `CardDoctor.astro` for rendering. No nursing section.

```typescript
export async function getStaticPaths() {
  return [{ params: { lang: 'ar' } }, { params: { lang: 'en' } }];
}
```

Include breadcrumbs, PageHeader.

- [ ] **Step 3: Create departments/index.astro**

Create the departments index page. Query `getCollection('departments')`, display in a responsive grid using `CardDepartment.astro`. Include breadcrumbs, PageHeader.

NOTE: Currently only `departments/[slug].astro` exists — the index page is NEW and must be created.

```typescript
export async function getStaticPaths() {
  return [{ params: { lang: 'ar' } }, { params: { lang: 'en' } }];
}
```

- [ ] **Step 4: Verify pages render**

Run: `npm run dev` → Navigate to `/en/team`, `/ar/team`, `/en/departments`, `/ar/departments`.

- [ ] **Step 5: Commit**

```bash
git add src/pages/[lang]/team/ src/pages/[lang]/departments/index.astro
git commit -m "feat: add standalone Team and Departments index pages"
```

---

### Task 9: Achievements Page

**Files:**
- Create: `src/pages/[lang]/achievements.astro`

- [ ] **Step 1: Create achievements.astro**

Use `AchievementsTimeline.vue` directly (it's kept as-is). Query `getCollection('achievements')` sorted by year descending. Include breadcrumbs, PageHeader.

- [ ] **Step 2: Verify page renders**

Run: `npm run dev` → Navigate to `/en/achievements`.

- [ ] **Step 3: Commit**

```bash
git add src/pages/[lang]/achievements.astro
git commit -m "feat: add standalone Achievements page"
```

---

### Task 10: Awards Page

**Files:**
- Create: `src/pages/[lang]/awards.astro`

- [ ] **Step 1: Create awards.astro**

Use `AwardsWall.astro` directly (kept as-is). Query `getCollection('awards')` sorted by year descending. Include breadcrumbs, PageHeader.

- [ ] **Step 2: Verify page renders**

Run: `npm run dev` → Navigate to `/en/awards`.

- [ ] **Step 3: Commit**

```bash
git add src/pages/[lang]/awards.astro
git commit -m "feat: add standalone Awards page"
```

---

### Task 11: Testimonials Page

**Files:**
- Create: `src/pages/[lang]/testimonials.astro`

- [ ] **Step 1: Create testimonials.astro**

Query `getCollection('testimonials')` — featured first. Use `TestimonialsSection.vue` (kept as-is) or render a grid of testimonial cards. Include breadcrumbs, PageHeader.

Note: The testimonials collection was just added to `content.config.ts` in Task 2. If no content files exist yet in `src/content/testimonials/`, the page renders empty — that's fine, CMS editors will add content.

- [ ] **Step 2: Verify page renders**

Run: `npm run dev` → Navigate to `/en/testimonials`.

- [ ] **Step 3: Commit**

```bash
git add src/pages/[lang]/testimonials.astro
git commit -m "feat: add standalone Testimonials page"
```

---

### Task 12: Contact Page

**Files:**
- Create: `src/pages/[lang]/contact.astro`

- [ ] **Step 1: Create contact.astro**

Use `ContactSection.vue` directly (kept as-is, `client:visible`). Include breadcrumbs, PageHeader with contact info from i18n strings.

- [ ] **Step 2: Verify page renders**

Run: `npm run dev` → Navigate to `/en/contact`.

- [ ] **Step 3: Commit**

```bash
git add src/pages/[lang]/contact.astro
git commit -m "feat: add standalone Contact page"
```

---

### Task 13: UI Components (YouTubeEmbed + ImageGallery)

**Files:**
- Create: `src/components/ui/YouTubeEmbed.astro`
- Create: `src/components/ui/ImageGallery.vue`

NOTE: `PageHeader.astro` and `CardEvent.astro` were already created in Task 5.

- [ ] **Step 1: Create YouTubeEmbed.astro**

```astro
---
interface Props {
  url: string;
}
const { url } = Astro.props;

function extractYouTubeId(url: string): string | null {
  const match = url.match(
    /(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([\w-]{11})/
  );
  return match ? match[1] : null;
}

const videoId = extractYouTubeId(url);
---
{videoId && (
  <div class="aspect-video w-full overflow-hidden rounded-lg">
    <iframe
      src={`https://www.youtube.com/embed/${videoId}`}
      title="YouTube video"
      allowfullscreen
      loading="lazy"
      class="h-full w-full"
    ></iframe>
  </div>
)}
```

- [ ] **Step 2: Create ImageGallery.vue**

Create `src/components/ui/ImageGallery.vue`:
- Props: `images` (array of `{ url, caption, captionAr, alt }`), `lang` (string)
- Grid layout: 2 columns on mobile, 3 on desktop
- Click opens lightbox overlay:
  - `role="dialog"`, `aria-modal="true"`, `aria-label` from current image alt
  - Focus trap: Tab cycles close button + prev/next arrows
  - Keyboard: Escape closes, ArrowLeft/ArrowRight navigates (reversed in RTL)
  - Caption in `<figcaption>` below image
- Hydration: `client:visible`

- [ ] **Step 3: Commit**

```bash
git add src/components/ui/YouTubeEmbed.astro src/components/ui/ImageGallery.vue
git commit -m "feat: add YouTubeEmbed and ImageGallery components"
```

---

### Task 14: FilteredCardGrid Component

**Files:**
- Create: `src/components/ui/FilteredCardGrid.vue`

- [ ] **Step 1: Create FilteredCardGrid.vue**

Single Vue island that owns filtering, pagination, and card rendering.

**Props:**
```typescript
interface Props {
  items: Array<{
    id: string;
    slug: string;
    title: string;
    titleAr: string;
    category: string;
    thumbnail?: string;
    date?: string;
    summary?: string;
    summaryAr?: string;
  }>;
  categories: Array<{ value: string; labelAr: string; labelEn: string }>;
  lang: 'ar' | 'en';
  basePath: string;
  itemsPerPage?: number; // default 8
  cardType: 'article' | 'event';
}
```

**Internal structure:**
- `CategoryFilter` sub-component: horizontal pill tabs, "All" + each category. Emits selected category.
- `Pagination` sub-component: page number buttons with prev/next. Shows current page / total.
- Card rendering: filters items by selected category, paginates, renders cards inline using Vue `<template>` markup (NOT Astro components — `CardEvent.astro` cannot be imported from Vue). The Vue island must implement its own card markup for both article and event card styles. The `cardType` prop determines which template is used.
- `<noscript>` is handled by the parent Astro page, not this component.
- `CardEvent.astro` remains useful for server-rendered contexts (homepage previews, noscript fallback).

- [ ] **Step 2: Verify component works**

Temporarily import in an existing page to test with sample data.

- [ ] **Step 3: Commit**

```bash
git add src/components/ui/FilteredCardGrid.vue
git commit -m "feat: add FilteredCardGrid with category filter and pagination"
```

---

### Task 15: Update Existing Detail Pages

**Files:**
- Modify: `src/pages/[lang]/departments/[slug].astro`
- Modify: `src/pages/[lang]/doctors/[id].astro`
- Delete: `src/pages/[lang]/achievements/[slug].astro`

- [ ] **Step 1: Read departments/[slug].astro and doctors/[id].astro**

Read both files to identify all hash-anchor links and TheNavbar imports.

- [ ] **Step 2: Update departments/[slug].astro**

1. Remove `TheNavbar` import and usage (if present) — the page now inherits sidebar from BaseLayout
2. Replace all hash-anchor links with page routes:
   - `${basePath}/#contact` → `/${lang}/contact`
   - `${basePath}/#team` → `/${lang}/team`
   - `${basePath}/#departments` → `/${lang}/departments`
   - Any other `/#section` → corresponding `/${lang}/section`
3. Add breadcrumbs prop to BaseLayout usage
4. Replace any `strings.news.*` references with `strings.events.*`

- [ ] **Step 3: Update doctors/[id].astro**

Same changes as departments/[slug].astro:
1. Remove TheNavbar import/usage
2. Replace hash-anchor links with page routes
3. Add breadcrumbs
4. Fix stale string references

- [ ] **Step 4: Delete achievements/[slug].astro**

This page imports `TheNavbar` directly and uses hash-anchor breadcrumbs. The achievements are displayed on the dedicated `/achievements` page (Task 9) via `AchievementsTimeline.vue`. Individual achievement detail pages are not in the spec's route map.

```bash
rm "src/pages/[lang]/achievements/[slug].astro"
```

If the achievements page needs to link to individual items, the timeline component can use anchor IDs within the single page.

- [ ] **Step 5: Verify build**

Run: `npm run dev` → Navigate to a department detail and doctor detail page. Verify links work.

- [ ] **Step 6: Commit**

```bash
git add "src/pages/[lang]/departments/[slug].astro" "src/pages/[lang]/doctors/[id].astro"
git rm "src/pages/[lang]/achievements/[slug].astro"
git commit -m "feat: update detail pages for sidebar layout, fix hash-anchor links"
```

---

## Phase 4: Content Pages

### Task 16: Events Index + Detail Pages (renamed from News)

**Files:**
- Create: `src/pages/[lang]/events/index.astro`
- Create: `src/pages/[lang]/events/[slug].astro`
- Create: `src/components/sections/EventDetail.astro`

- [ ] **Step 1: Create events/index.astro**

Query `getCollection('events')`, sort by date descending. Pass all items as JSON to `FilteredCardGrid.vue` with `cardType="event"` and events categories.

```astro
---
import BaseLayout from '../../../layouts/BaseLayout.astro';
import FilteredCardGrid from '../../../components/ui/FilteredCardGrid.vue';
import { getStrings } from '../../../i18n';
import { getCollection } from 'astro:content';

export function getStaticPaths() {
  return [{ params: { lang: 'ar' } }, { params: { lang: 'en' } }];
}

const { lang } = Astro.params;
const strings = getStrings(lang);
const events = (await getCollection('events')).sort((a, b) =>
  new Date(b.data.date).getTime() - new Date(a.data.date).getTime()
);

const items = events.map(e => ({
  id: e.id,
  slug: e.id,
  title: e.data.title,
  titleAr: e.data.titleAr,
  category: e.data.category,
  thumbnail: e.data.thumbnail,
  date: e.data.date.toISOString(),
  summary: e.data.summary,
  summaryAr: e.data.summaryAr,
}));

const categories = [
  { value: 'procedure', labelEn: 'Procedures', labelAr: 'إجراءات طبية' },
  { value: 'event', labelEn: 'Events', labelAr: 'فعاليات' },
  { value: 'announcement', labelEn: 'Announcements', labelAr: 'إعلانات' },
];

const breadcrumbs = [
  { label: strings.breadcrumb.home, href: `/${lang}/` },
  { label: strings.breadcrumb.events },
];
---
<BaseLayout lang={lang} strings={strings} breadcrumbs={breadcrumbs} currentPath={`/${lang}/events`}>
  <FilteredCardGrid
    items={items}
    categories={categories}
    lang={lang}
    basePath={`/${lang}/events`}
    cardType="event"
    client:visible
  />
  <noscript>
    <!-- Fallback: plain grid of all items for no-JS users -->
  </noscript>
</BaseLayout>
```

- [ ] **Step 2: Create EventDetail.astro**

Create `src/components/sections/EventDetail.astro`:
- Props: `entry` (the event collection entry), `lang`
- Renders: date, category pill, summary, YouTube embed (if youtubeUrl exists), image gallery (if gallery exists), markdown body (if body exists)
- Uses `YouTubeEmbed.astro` and `ImageGallery.vue`

- [ ] **Step 3: Create events/[slug].astro**

```typescript
export async function getStaticPaths() {
  const events = await getCollection('events');
  return events.flatMap((entry) =>
    ['ar', 'en'].map((lang) => ({
      params: { lang, slug: entry.id },
      props: { entry },
    }))
  );
}
```

Render `EventDetail` with breadcrumbs.

- [ ] **Step 4: Verify both pages**

Run: `npm run dev` → Navigate to `/en/events` and click into a detail page. Verify filter and pagination work.

- [ ] **Step 5: Commit**

```bash
git add src/pages/[lang]/events/ src/components/sections/EventDetail.astro
git commit -m "feat: add Events & Highlights index and detail pages"
```

---

### Task 17: Articles Index + Detail Pages

**Files:**
- Modify: `src/pages/[lang]/articles/index.astro`
- Modify: `src/pages/[lang]/articles/[slug].astro`
- Create: `src/components/sections/ArticleDetail.astro`

- [ ] **Step 1: Read current articles pages**

Read `src/pages/[lang]/articles/index.astro` and `src/pages/[lang]/articles/[slug].astro`.

- [ ] **Step 2: Update articles/index.astro**

Rewrite to use `FilteredCardGrid.vue` with `cardType="article"` and the articles categories. Use `BaseLayout` with breadcrumbs.

- [ ] **Step 3: Create ArticleDetail.astro**

Create `src/components/sections/ArticleDetail.astro`:
- **Prose column** (~720px max-width): title, author, date, rendered markdown body
- **Sticky metadata sidebar** (right in LTR, left in RTL): author info, date, category pill, table of contents (generated from headings), related articles (same category, max 3)
- Layout: `grid grid-cols-1 lg:grid-cols-[1fr_280px] gap-8`

- [ ] **Step 4: Fix articles/[slug].astro bilingual paths**

Replace the broken `getStaticPaths` with:

```typescript
export async function getStaticPaths() {
  const articles = await getCollection('articles');
  return articles.flatMap((entry) =>
    ['ar', 'en'].map((lang) => ({
      params: { lang, slug: entry.id },
      props: { entry },
    }))
  );
}
```

Use `ArticleDetail` component. Add breadcrumbs.

**ALSO:** The existing `articles/[slug].astro` (line 20) references `strings.news.category[entry.data.category]` — this MUST be updated to `strings.events.category[entry.data.category]` since Task 3 renamed `news` → `events` in i18n.

- [ ] **Step 5: Verify both pages**

Run: `npm run dev` → Navigate to `/en/articles` and `/ar/articles`. Click into a detail page. Verify filter, pagination, metadata sidebar.

- [ ] **Step 6: Commit**

```bash
git add src/pages/[lang]/articles/ src/components/sections/ArticleDetail.astro
git commit -m "feat: rewrite articles pages with FilteredCardGrid and ArticleDetail"
```

---

### Task 18: Homepage Rewrite

**Files:**
- Modify: `src/pages/[lang]/index.astro`
- Create: `src/components/sections/HomeHeroPreview.astro`
- Create: `src/components/sections/HomeAchievementsPreview.astro`
- Create: `src/components/sections/HomeEventsPreview.astro`

- [ ] **Step 1: Create HomeHeroPreview.astro**

Condensed hero for the landing page:
- Headline, tagline, CTA buttons (from i18n strings)
- Stats strip (using `StatsBlock.vue`)
- No SVG hospital illustration
- Full-width primary blue background section
- Responsive, RTL-compatible

Reference current `HeroSection.astro` for content/strings but simplify the markup significantly.

- [ ] **Step 2: Create HomeAchievementsPreview.astro**

- Query `getCollection('achievements')`, take latest 4 (sorted by year descending)
- Horizontal card row (flex or grid)
- Each card: year, title, description, icon
- "View all" link to `/${lang}/achievements`
- Use `SectionLabel` + `GoldHeading` for section title

- [ ] **Step 3: Create HomeEventsPreview.astro**

- Query `getCollection('events')`, take latest 3 (sorted by date descending)
- 3-card grid using `CardEvent.astro`
- "View all" link to `/${lang}/events`
- Use `SectionLabel` + `GoldHeading` for section title

- [ ] **Step 4: Rewrite index.astro**

Replace ALL current section imports with:

```astro
---
import BaseLayout from '../../layouts/BaseLayout.astro';
import HomeHeroPreview from '../../components/sections/HomeHeroPreview.astro';
import HomeAchievementsPreview from '../../components/sections/HomeAchievementsPreview.astro';
import HomeEventsPreview from '../../components/sections/HomeEventsPreview.astro';
import { getStrings } from '../../i18n';

export function getStaticPaths() {
  return [{ params: { lang: 'ar' } }, { params: { lang: 'en' } }];
}

const { lang } = Astro.params;
const strings = getStrings(lang);
---
<BaseLayout lang={lang} strings={strings} breadcrumbs={[{ label: strings.breadcrumb.home }]} currentPath={`/${lang}/`}>
  <HomeHeroPreview lang={lang} strings={strings} />
  <HomeAchievementsPreview lang={lang} strings={strings} />
  <HomeEventsPreview lang={lang} strings={strings} />
</BaseLayout>
```

- [ ] **Step 5: Verify homepage**

Run: `npm run dev` → Navigate to `/en/` and `/ar/`. Verify hero, achievements preview, events preview all render. Check mobile responsive. Check RTL.

- [ ] **Step 6: Commit**

```bash
git add src/pages/[lang]/index.astro src/components/sections/HomeHeroPreview.astro src/components/sections/HomeAchievementsPreview.astro src/components/sections/HomeEventsPreview.astro
git commit -m "feat: rewrite homepage as landing page with hero, achievements, and events previews"
```

---

## Phase 5: Cleanup & Verification

### Task 19: Delete Old Components and Files

**Files to delete:**

- [ ] **Step 1: Delete replaced components**

```bash
rm src/components/layout/TheNavbar.vue
rm src/components/ui/CardNurse.astro
rm src/components/ui/CardNews.astro
rm src/components/sections/AchievementsSection.astro
rm src/components/sections/HeroSection.astro
rm src/components/sections/HeroParticles.vue
rm src/components/sections/MissionStrip.astro
rm src/components/sections/DepartmentsSection.astro
rm src/components/sections/NewsSection.astro
rm src/components/sections/TeamSection.astro
rm src/content/config.ts  # Legacy Astro v5 config — superseded by content.config.ts
```

- [ ] **Step 2: Delete old news pages**

```bash
rm -rf src/pages/[lang]/news
```

- [ ] **Step 3: Search for stale imports**

Grep the entire `src/` directory for:
- `TheNavbar` — should have zero references
- `CardNurse` — should have zero references
- `CardNews` — should have zero references
- `NewsSection` — should have zero references
- `MissionStrip` — should have zero references
- `DepartmentsSection` — should have zero references
- `HeroSection` — should have zero references (HomeHeroPreview replaced it)
- `AchievementsSection` — should have zero references
- `TeamSection` — should have zero references
- `nursing` — should have zero references in imports
- `news` collection — should reference `events` everywhere
- `strings.news` — should be zero (all replaced with `strings.events`)
- `/#about`, `/#team`, `/#news`, `/#departments`, `/#achievements`, `/#contact` — should be zero (all replaced with page routes)

Fix any remaining stale references found.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "chore: remove old navbar, nursing, news components and stale imports"
```

---

### Task 20: Build Verification + Full-Site Check

- [ ] **Step 1: Full build**

Run: `npm run build`
Expected: Build succeeds with zero errors. All static pages generated for both `ar` and `en`.

- [ ] **Step 2: Check generated routes**

```bash
ls -R dist/ar/ dist/en/
```

Verify these routes exist:
- `dist/en/index.html`, `dist/ar/index.html` (homepage)
- `dist/en/about/index.html`, `dist/ar/about/index.html`
- `dist/en/departments/index.html` + `dist/en/departments/*/index.html`
- `dist/en/team/index.html`
- `dist/en/doctors/*/index.html`
- `dist/en/achievements/index.html`
- `dist/en/awards/index.html`
- `dist/en/testimonials/index.html`
- `dist/en/articles/index.html` + `dist/en/articles/*/index.html`
- `dist/en/events/index.html` + `dist/en/events/*/index.html`
- `dist/en/contact/index.html`
- `dist/en/privacy/index.html`, `dist/en/terms/index.html`

Verify NO `dist/en/news/` directory exists.

- [ ] **Step 3: Preview and manual check**

Run: `npm run preview`
Check in browser:
1. Homepage — hero, achievements preview, events preview render
2. Sidebar — visible on xl, rail on md, drawer on mobile
3. Active state — correct gold highlight on current page
4. RTL — switch to `/ar/` and verify sidebar flips to right
5. Navigation — click each sidebar link, verify it loads the correct page
6. Events index — filter by category, paginate
7. Event detail — YouTube embed (if any), gallery, back link
8. Articles index — filter, paginate
9. Article detail — prose + metadata sidebar, related articles
10. Footer — all links point to new routes (no hash anchors)

- [ ] **Step 4: Check Decap CMS**

Navigate to `/admin/` and verify:
- Events & Highlights collection appears with new fields
- Articles collection works (no `lang` field shown)
- Nursing collection is gone
- Creating a test event with gallery and YouTube URL works

- [ ] **Step 5: Final commit**

```bash
git add -A
git commit -m "chore: verify clean build and full-site check complete"
```
