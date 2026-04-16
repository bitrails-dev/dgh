# Hospital Website Redesign — Design Specification

**Date:** 2026-04-15
**Status:** Approved
**Reference site:** https://www.seattlechildrens.org/
**Stack:** Astro 6, Vue 3, Tailwind CSS 3, Decap CMS, astro-i18next

---

## 1. Layout Shell & Sidebar Navigation

### Overall Structure

The entire application is wrapped in a max-width container (1440px), centered on the viewport. The shell is composed of a persistent sidebar and a content area containing a top bar, page content, and footer.

```
┌─────────────────────────────────────────────────────┐
│                   max-width: 1440px                  │
│  ┌──────────┬──────────────────────────────────────┐ │
│  │          │  ┌─ Top bar (breadcrumb + toggle) ─┐ │ │
│  │ Sidebar  │  │  Breadcrumb     [AR|EN] 🔴 EMS  │ │ │
│  │  240px   │  └─────────────────────────────────┘ │ │
│  │          │                                      │ │
│  │  Home    │     Page Content Area                │ │
│  │  About   │     (scrollable, padded)             │ │
│  │  Depts   │                                      │ │
│  │  Team    │                                      │ │
│  │  Articles│                                      │ │
│  │  Events  │                                      │ │
│  │  Awards  │                                      │ │
│  │  Contact │                                      │ │
│  │          │                                      │ │
│  │ ──────── │                                      │ │
│  │ Emergency│  ┌─ Footer ────────────────────────┐ │ │
│  │ 📞 12345 │  │  Links · Contact · Socials      │ │ │
│  └──────────┴──┴─────────────────────────────────┘ │ │
└─────────────────────────────────────────────────────┘
```

### Sidebar Behavior (Hybrid)

| Breakpoint | Behavior |
|------------|----------|
| **≥1280px (xl)** | Full sidebar, 240px wide, always visible. White background, `border-inline-end` separator. Logo at top, nav links below, emergency phone pinned to bottom. |
| **768–1279px (md–lg)** | Collapsed rail, ~64px wide, icon-only. Hover/click expands to full 240px as overlay. Tooltip on hover for labels. |
| **<768px (mobile)** | Sidebar hidden entirely. Hamburger button in slim top bar triggers slide-in drawer overlay from inline-start side. |

### Sidebar Styling

- **Background:** White (`#FFFFFF`)
- **Text:** Primary blue (`#1B3F6E`)
- **Active state:** Gold (`#D4A843`) `border-inline-start` (3px) + light gold-tinted background (`#D4A843/10`)
- **Hover state:** Light gray background (`#F8F9FC`)
- **Separator:** `border-inline-end: 1px solid #E5E7EB`
- **Emergency section:** Pinned to bottom with phone icon and number, primary blue background pill

### Top Bar

- Sits inside content area only (does not span sidebar)
- Contains: breadcrumb trail (on inner pages), language toggle button, emergency call button
- Sticky on scroll
- Thin border-bottom separator

### RTL Support

- Sidebar renders on the right side in RTL mode
- All directional CSS uses logical properties (`inline-start`/`inline-end`, `border-inline-start`, `padding-inline-start`)
- Active indicator border flips automatically
- Mobile drawer slides from right in RTL

### Max-Width

- Entire shell (sidebar + content) capped at `1440px`
- Centered with `margin-inline: auto`
- Tailwind `container` config updated with explicit `max-width: 1440px`

### Components

| Component | File | Type | Replaces |
|-----------|------|------|----------|
| `TheSidebar.vue` | `src/components/layout/TheSidebar.vue` | Vue island (`client:load`) | `TheNavbar.vue` |
| `TheTopBar.astro` | `src/components/layout/TheTopBar.astro` | Astro | Part of `TheNavbar.vue` |
| `SidebarLayout.astro` | `src/layouts/SidebarLayout.astro` | Astro | Shell in `BaseLayout.astro` |

---

## 2. Page Architecture & Routing

### Route Map

All routes use `[lang]/` prefix. Both `ar` and `en` variants are statically generated via `getStaticPaths()`.

| Route | File | Page | Content Source |
|-------|------|------|----------------|
| `/[lang]/` | `src/pages/[lang]/index.astro` | Home (landing) | Achievements (latest 4), Events (latest 3) |
| `/[lang]/about` | `src/pages/[lang]/about.astro` | About | i18n strings (mission, vision, values) |
| `/[lang]/departments` | `src/pages/[lang]/departments/index.astro` | Departments index | `getCollection('departments')` |
| `/[lang]/departments/[slug]` | `src/pages/[lang]/departments/[slug].astro` | Department detail | Existing — keep as-is |
| `/[lang]/team` | `src/pages/[lang]/team/index.astro` | Team index | `getCollection('doctors')` — featured first, sorted by order |
| `/[lang]/doctors/[id]` | `src/pages/[lang]/doctors/[id].astro` | Doctor detail | Existing — keep as-is |
| `/[lang]/achievements` | `src/pages/[lang]/achievements.astro` | Achievements | `getCollection('achievements')` sorted by year |
| `/[lang]/awards` | `src/pages/[lang]/awards.astro` | Awards | `getCollection('awards')` sorted by year |
| `/[lang]/testimonials` | `src/pages/[lang]/testimonials.astro` | Testimonials | `getCollection('testimonials')` — featured first |
| `/[lang]/articles` | `src/pages/[lang]/articles/index.astro` | Articles index | `getCollection('articles')` sorted by date, client-side filter + pagination |
| `/[lang]/articles/[slug]` | `src/pages/[lang]/articles/[slug].astro` | Article detail | `getEntry('articles', slug)` + related (same category, max 3) |
| `/[lang]/events` | `src/pages/[lang]/events/index.astro` | Events & Highlights index | `getCollection('events')` sorted by date, client-side filter + pagination |
| `/[lang]/events/[slug]` | `src/pages/[lang]/events/[slug].astro` | Event detail | `getEntry('events', slug)` — YouTube + gallery + body |
| `/[lang]/contact` | `src/pages/[lang]/contact.astro` | Contact | i18n strings + form component |
| `/[lang]/privacy` | `src/pages/[lang]/privacy.astro` | Privacy | Existing — keep |
| `/[lang]/terms` | `src/pages/[lang]/terms.astro` | Terms | Existing — keep |

### Homepage Composition

The homepage becomes a lightweight landing page with three preview sections:

1. **Hero preview** (`HomeHeroPreview.astro`) — Condensed hero: headline, tagline, CTA buttons, stats strip. No full SVG hospital illustration.
2. **Achievements preview** (`HomeAchievementsPreview.astro`) — Latest 3–4 achievements in horizontal card row + "View all" link to `/[lang]/achievements`.
3. **Events preview** (`HomeEventsPreview.astro`) — Latest 3 event cards + "View all" link to `/[lang]/events`.

### Sections Removed from Homepage

These move to their own routes: MissionStrip, DepartmentsSection, full TeamSection, AwardsWall, full TestimonialsSection, ContactSection, full NewsSection.

### Shared Page Patterns

- **Index pages** share a common structure: `PageHeader.astro` (title + subtitle + optional filter bar), then a responsive grid of cards.
- **Detail pages** use consistent layout: breadcrumb, back-link, content area.
- **Pagination** — Articles and Events index pages render ALL items statically, then `Pagination.vue` hides/shows batches of 8 client-side. Revisit with static pagination routes if collections exceed ~50 items.

---

## 3. Content Collections & Decap CMS

### Events & Highlights Collection (renamed from "news")

**Folder:** `src/content/events/` (moved from `src/content/news/`)

**Schema:**

```typescript
// In src/content.config.ts
events: defineCollection({
  schema: z.object({
    title: z.string(),
    titleAr: z.string(),
    date: z.date(),
    category: z.enum(['procedure', 'event', 'announcement']),
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
}),
```

**Category definitions:**
- `procedure` — Notable surgery, first-of-its-kind operation, medical milestone
- `event` — Conferences, ceremonies, community health days, visits
- `announcement` — General hospital updates, new services, partnerships

### Articles Collection (unchanged)

Keeps existing schema: `title, titleAr, date, author, category, thumbnail, featured, body, bodyAr`.
Categories remain: `hospital-news`, `health-tips`, `research`, `events`.

### Nursing Collection — DELETED

- Remove `src/content/nursing/` directory entirely
- Remove nursing collection from `src/content.config.ts`
- Remove nursing collection from `public/admin/config.yml`
- Remove all nursing-related UI components and strings

### Other Collections (no schema changes)

- `departments` — keep as-is
- `doctors` — keep as-is
- `achievements` — keep as-is
- `awards` — keep as-is
- `testimonials` — keep as-is

### Decap CMS Config Changes (`public/admin/config.yml`)

1. Rename "News" collection → "Events & Highlights"
2. Update folder path: `src/content/news` → `src/content/events`
3. Add `youtubeUrl` string widget (label: "YouTube Video URL", required: false)
4. Add `gallery` list widget with nested fields: `url` (image), `caption` (string), `captionAr` (string), `alt` (string, required)
5. Update category select options: `procedure`, `event`, `announcement`
6. Remove nursing collection entirely
7. Keep slug format: `{{year}}-{{month}}-{{day}}-{{slug}}`

### Content Migration

1. Move all files from `src/content/news/` → `src/content/events/`
2. **Rename frontmatter fields** in all moved files: `excerpt` → `summary`, `excerptAr` → `summaryAr` (the existing news files use `excerpt`/`excerptAr`, but the new schema uses `summary`/`summaryAr`)
3. Update `category` values in moved files to match new enum (`procedure` | `event` | `announcement`)
4. **Remove `lang` field** from all moved event files (bilingual content uses `title`/`titleAr` pairs, not per-file lang)
5. Delete `src/content/nursing/` directory

### Articles Collection — Schema Fix

The existing articles schema includes a `lang` field used by `getStaticPaths` to generate only one language variant per entry. This is a bug — it must be fixed:

1. **Remove `lang` field** from the articles Zod schema in `src/content.config.ts`
2. **Remove `lang` field** from all article frontmatter files
3. **Fix `getStaticPaths`** in `articles/[slug].astro` and `events/[slug].astro` to generate both language variants:

```typescript
// CORRECT pattern for all detail pages
export async function getStaticPaths() {
  const entries = await getCollection('articles'); // or 'events'
  return entries.flatMap((entry) =>
    ['ar', 'en'].map((lang) => ({
      params: { lang, slug: entry.id },
      props: { entry },
    }))
  );
}
```

This pattern must be used consistently for ALL detail pages: `articles/[slug]`, `events/[slug]`, `departments/[slug]`, `doctors/[id]`.

---

## 4. Component Architecture

### New Components

| Component | File | Type | Hydration | Purpose |
|-----------|------|------|-----------|---------|
| `TheSidebar.vue` | `src/components/layout/TheSidebar.vue` | Vue | `client:load` | Sidebar nav — hybrid collapse/expand, RTL-aware |
| `TheTopBar.astro` | `src/components/layout/TheTopBar.astro` | Astro | — | Breadcrumb, language toggle, emergency button |
| `SidebarLayout.astro` | `src/layouts/SidebarLayout.astro` | Astro | — | New shell: sidebar + content + top bar + footer (see composition below) |
| `PageHeader.astro` | `src/components/ui/PageHeader.astro` | Astro | — | Reusable page title + subtitle + optional filter bar |
| `CategoryFilter.vue` | `src/components/ui/CategoryFilter.vue` | Vue | `client:visible` | Category filter tabs — see API spec below |
| `Pagination.vue` | `src/components/ui/Pagination.vue` | Vue | `client:visible` | Client-side pagination — see API spec below |
| `FilteredCardGrid.vue` | `src/components/ui/FilteredCardGrid.vue` | Vue | `client:visible` | Wraps filter + pagination + card rendering in one island |
| `ArticleDetail.astro` | `src/components/sections/ArticleDetail.astro` | Astro | — | Prose column + sticky metadata sidebar (TOC, author, date, related) |
| `EventDetail.astro` | `src/components/sections/EventDetail.astro` | Astro | — | Description + YouTube embed + image gallery |
| `YouTubeEmbed.astro` | `src/components/ui/YouTubeEmbed.astro` | Astro | — | Responsive YouTube iframe — see URL parsing spec below |
| `ImageGallery.vue` | `src/components/ui/ImageGallery.vue` | Vue | `client:visible` | Grid of gallery images with accessible lightbox (see a11y spec below) |
| `HomeHeroPreview.astro` | `src/components/sections/HomeHeroPreview.astro` | Astro | — | Condensed hero for landing page |
| `HomeAchievementsPreview.astro` | `src/components/sections/HomeAchievementsPreview.astro` | Astro | — | 3–4 achievement cards + "View all" |
| `HomeEventsPreview.astro` | `src/components/sections/HomeEventsPreview.astro` | Astro | — | 3 latest event cards + "View all" |

### Layout Composition

`BaseLayout.astro` remains the outermost document shell — it owns `<!doctype html>`, `<html>`, `<head>`, `<body>`. `SidebarLayout.astro` is a structural component used INSIDE `BaseLayout`'s `<body>`. It does NOT produce its own `<html>` or `<body>` tags.

```
BaseLayout.astro (owns <html>, <head>, <body>)
  └─ SidebarLayout.astro (structural: sidebar + content grid)
       ├─ TheSidebar.vue (navigation)
       ├─ TheTopBar.astro (breadcrumb, lang toggle)
       ├─ <slot /> (page content)
       └─ TheFooter.astro (footer)
```

Each page file (e.g. `about.astro`) uses `BaseLayout` as its layout. `BaseLayout` renders `SidebarLayout` around its default slot. This avoids duplicate `<html>`/`<body>` tags.

### Components to Modify

| Component | File | Change |
|-----------|------|--------|
| `BaseLayout.astro` | `src/layouts/BaseLayout.astro` | Replace current `<TheNavbar>` + `<main>` + `<TheFooter>` with `<SidebarLayout>` wrapping the slot |
| `TeamSection.astro` | `src/components/sections/TeamSection.astro` | Remove entire nursing grid section |
| `TheFooter.astro` | `src/components/layout/TheFooter.astro` | Replace hash-anchor links with new page routes (see footer link mapping below) |
| `CardNews.astro` | `src/components/ui/CardNews.astro` | Rename to `CardEvent.astro`, update props for new schema (category enum, optional thumbnail) |

### Footer Link Mapping

| Old link | New link |
|----------|----------|
| `/{lang}/#about` | `/{lang}/about` |
| `/{lang}/#departments` | `/{lang}/departments` |
| `/{lang}/#achievements` | `/{lang}/achievements` |
| `/{lang}/#team` | `/{lang}/team` |
| `/{lang}/#news` | `/{lang}/events` |
| `/{lang}/#contact` | `/{lang}/contact` |

### Components to Delete

| Component | File | Reason |
|-----------|------|--------|
| `TheNavbar.vue` | `src/components/layout/TheNavbar.vue` | Replaced by `TheSidebar.vue` + `TheTopBar.astro` |
| `CardNurse.astro` | `src/components/ui/CardNurse.astro` | Nursing section removed |
| `AchievementsSection.astro` | `src/components/sections/AchievementsSection.astro` | Split — `AchievementsTimeline.vue` used directly in `/achievements` page, `AwardsWall.astro` used directly in `/awards` page |
| `HeroSection.astro` | `src/components/sections/HeroSection.astro` | Replaced by `HomeHeroPreview.astro` (condensed, no SVG illustration) |
| `MissionStrip.astro` | `src/components/sections/MissionStrip.astro` | Content moves to `/about` page directly |
| `DepartmentsSection.astro` | `src/components/sections/DepartmentsSection.astro` | Content moves to `/departments` index page |
| `NewsSection.astro` | `src/components/sections/NewsSection.astro` | Replaced by `HomeEventsPreview.astro` on homepage, full listing on `/events` |

### Files to Delete

| Path | Reason |
|------|--------|
| `src/content/nursing/` (entire directory) | Nursing removed |
| Nursing collection in `src/content.config.ts` | Nursing removed |
| Nursing collection in `public/admin/config.yml` | Nursing removed |
| All nursing-related i18n strings | Nursing removed |

### Components Kept As-Is

`CardDepartment.astro`, `CardDoctor.astro`, `GoldHeading.astro`, `SectionLabel.astro`, `BadgeExcellence.astro`, `WaveDivider.astro`, `AchievementsTimeline.vue`, `AwardsWall.astro`, `TestimonialsSection.vue`, `ContactSection.vue`, `StatsBlock.vue`

### FilteredCardGrid, CategoryFilter & Pagination — API Spec

The Astro page cannot easily communicate with sibling Vue islands. Instead, use a single **`FilteredCardGrid.vue`** island that owns filtering, pagination, and card rendering together. The Astro page passes all items as a JSON prop.

**`FilteredCardGrid.vue` props:**
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
  basePath: string;        // e.g. '/en/events' — for card links
  itemsPerPage: number;    // default 8
  cardType: 'article' | 'event'; // determines card rendering style
}
```

**Internal composition:** `FilteredCardGrid` renders `CategoryFilter` and `Pagination` as child components (not separate islands). This avoids the DOM-selector problem entirely — Vue owns the full rendering lifecycle.

**`CategoryFilter` sub-component:** Emits `update:category` with the selected value (or `'all'`). Renders as horizontal tab pills.

**`Pagination` sub-component:** Receives `totalItems` and `currentPage`. Emits `update:page`. Renders numbered page buttons with prev/next.

### YouTubeEmbed — URL Parsing Spec

`YouTubeEmbed.astro` accepts a `url` prop (any YouTube URL) and extracts the video ID via regex to render a responsive iframe.

**Supported URL formats:**
- `https://www.youtube.com/watch?v=VIDEO_ID`
- `https://youtu.be/VIDEO_ID`
- `https://www.youtube.com/embed/VIDEO_ID`
- `https://www.youtube.com/shorts/VIDEO_ID`

**Extraction logic:**
```typescript
function extractYouTubeId(url: string): string | null {
  const match = url.match(
    /(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([\w-]{11})/
  );
  return match ? match[1] : null;
}
```

**Render:** `<iframe src="https://www.youtube.com/embed/{id}" allowfullscreen loading="lazy" class="aspect-video w-full rounded-lg">`. If ID extraction fails, render nothing (fail silently — CMS editor may enter invalid URL).

### ImageGallery — Accessibility Spec

`ImageGallery.vue` lightbox must be accessible:

- **Focus trapping:** When lightbox opens, focus is trapped inside. Tab cycles through close button and navigation arrows only.
- **Keyboard:** `Escape` closes lightbox, `ArrowLeft`/`ArrowRight` navigate images.
- **ARIA:** Lightbox container uses `role="dialog"`, `aria-modal="true"`, `aria-label` with the current image's alt text.
- **RTL:** Arrow navigation reverses direction in RTL mode (ArrowLeft = next, ArrowRight = prev).
- **Image rendering:** Each image gets `alt` from gallery data. Captions rendered below image in `<figcaption>`.

### Testimonials Page Spec

The `/[lang]/testimonials` page uses the `testimonials` content collection. The collection must be added to `src/content.config.ts` (currently defined in Decap CMS config but missing from the Zod schema):

```typescript
testimonials: defineCollection({
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
}),
```

The page renders a grid of testimonial cards. Featured testimonials display first with a larger card variant. Uses `PageHeader.astro` with title/subtitle from i18n.

### BreadcrumbList Structured Data

`TheTopBar.astro` receives a `breadcrumbs` prop from each page:

```typescript
interface BreadcrumbItem {
  label: string;    // Displayed text (from i18n)
  href?: string;    // URL — omit for current page (last item)
}
// Example: [{ label: "Home", href: "/en/" }, { label: "Events", href: "/en/events" }, { label: "Cardiac Conference" }]
```

`TheTopBar.astro` renders both:
1. Visual breadcrumb trail (`<nav aria-label="Breadcrumb"><ol>...</ol></nav>`)
2. JSON-LD `BreadcrumbList` schema in a `<script type="application/ld+json">` tag

---

## 5. Styling & i18n

### Tailwind Config (`tailwind.config.mjs`)

Override the top-level `screens['2xl']` breakpoint to cap the container at 1440px. Tailwind's `container` plugin reads from `theme.screens` — placing `screens` inside `container` has no effect.

```javascript
theme: {
  screens: {
    sm: '640px',
    md: '768px',
    lg: '1024px',
    xl: '1280px',
    '2xl': '1440px',  // Capped from default 1536px
  },
  container: {
    center: true,
    padding: {
      DEFAULT: '1.25rem',
      lg: '2rem',
      xl: '3rem',
    },
  },
  extend: { /* existing colors, fonts, etc. — unchanged */ },
},
```

No changes to colors, typography, or font config.

### Global CSS Additions (`src/styles/global.css`)

- `.sidebar-rail` — collapsed icon-only sidebar styles (width: 64px)
- `.sidebar-expanded` — full sidebar styles (width: 240px)
- `.sidebar-overlay` — overlay backdrop for mobile drawer
- `.sidebar-transition` — smooth width/transform transitions (200ms ease)
- `.active-nav-item` — gold `border-inline-start: 3px solid #D4A843` + `background: rgba(212, 168, 67, 0.08)`
- Keep all existing utilities unchanged

### i18n String Updates

**Complete final state of `nav.*` keys** (showing EN values; AR file mirrors with Arabic text):

```json
{
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
  },
  "events": {
    "title": "Events & Highlights / فعاليات وإنجازات",
    "subtitle": "...",
    "category": {
      "procedure": "Procedures / إجراءات طبية",
      "event": "Events / فعاليات",
      "announcement": "Announcements / إعلانات"
    }
  },
  "breadcrumb": {
    "home": "Home / الرئيسية",
    "about": "About / عن المستشفى",
    "departments": "Departments / الأقسام",
    "team": "Our Team / فريقنا",
    "achievements": "Achievements / الإنجازات",
    "awards": "Awards / الجوائز",
    "testimonials": "Testimonials / آراء المرضى",
    "articles": "Articles / المقالات",
    "events": "Events / فعاليات",
    "contact": "Contact / تواصل معنا"
  },
  "common": {
    "viewAll": "View all / عرض الكل",
    "backTo": "Back to / العودة إلى"
  },
  "sidebar": {
    "expand": "Expand menu / توسيع القائمة",
    "collapse": "Collapse menu / طي القائمة",
    "emergency": "Emergency / طوارئ"
  }
}
```

**Keys to remove:** All nursing-related strings (`team.nursingTitle`, etc.)

**Keys to rename:** `nav.news` → `nav.events`, `news.*` → `events.*`

### SEO

- Each page gets `<title>` and `<meta name="description">` from i18n strings
- `BreadcrumbList` structured data (JSON-LD) on all inner pages — generated by `TheTopBar.astro` from its `breadcrumbs` prop (see Section 4 BreadcrumbList spec)
- Existing `Hospital` schema.org markup stays on homepage

---

## 6. Data Flow & Rendering

### Static Generation

All pages use `getStaticPaths()` generating `ar` + `en` variants. Output mode: `static`. No SSR.

### Content Queries Per Page

| Page | Query |
|------|-------|
| Home | `getCollection('achievements')` (latest 4 by year), `getCollection('events')` (latest 3 by date) |
| About | Pure i18n strings — no collection query |
| Departments index | `getCollection('departments')` |
| Department detail | `getEntry('departments', slug)` + `getCollection('doctors').filter(d => d.data.department === slug)` |
| Team index | `getCollection('doctors')` — featured first, then sorted by order |
| Doctor detail | `getEntry('doctors', id)` |
| Achievements | `getCollection('achievements')` sorted by year descending |
| Awards | `getCollection('awards')` sorted by year descending |
| Testimonials | `getCollection('testimonials')` — featured first |
| Articles index | `getCollection('articles')` sorted by date descending |
| Article detail | `getEntry('articles', slug)` + related articles (same category, max 3) |
| Events index | `getCollection('events')` sorted by date descending |
| Event detail | `getEntry('events', slug)` |
| Contact | Pure i18n strings + `ContactSection.vue` |

### Vue Island Hydration Strategy

| Component | Hydration | Rationale |
|-----------|-----------|-----------|
| `TheSidebar.vue` | `client:load` | Must be interactive immediately (toggle, hover, mobile drawer) |
| `FilteredCardGrid.vue` | `client:visible` | Owns filter + pagination + card rendering; `CategoryFilter` and `Pagination` are internal sub-components, not separate islands |
| `ImageGallery.vue` | `client:visible` | Lightbox interaction on demand |
| `ContactSection.vue` | `client:visible` | Form validation — existing pattern |
| `TestimonialsSection.vue` | `client:visible` | Carousel — existing pattern |
| `AchievementsTimeline.vue` | `client:visible` | Animation — existing pattern |
| `StatsBlock.vue` | `client:visible` | Counter animation — existing pattern |

### Client-Side Pagination

Articles and Events index pages pass ALL items as a JSON prop to `FilteredCardGrid.vue`. The Vue island renders cards client-side, so there is no flash-of-unhidden-content — items are only rendered after hydration. The Astro page provides a `<noscript>` fallback showing all items in a plain grid for non-JS users. Revisit with static pagination routes if collections exceed ~50 items.

---

## 7. Cleanup Checklist

After migration is complete:

- [ ] Delete `TheNavbar.vue`
- [ ] Delete `CardNurse.astro`
- [ ] Delete `src/content/nursing/` directory
- [ ] Remove nursing collection from `src/content.config.ts`
- [ ] Remove nursing collection from `public/admin/config.yml`
- [ ] Remove nursing-related i18n strings
- [ ] Remove unused hash-navigation logic from any remaining components
- [ ] Remove old single-page section imports from homepage
- [ ] Delete `src/pages/[lang]/news/` directory (old news routes replaced by `/events/`)
- [ ] Verify all internal links point to new routes (not hash anchors)
- [ ] Verify Decap CMS admin panel loads with updated config
- [ ] Verify both `ar` and `en` builds succeed
- [ ] Verify RTL sidebar behavior
- [ ] Verify mobile drawer behavior

---

## Decisions Log

| # | Decision | Rationale |
|---|----------|-----------|
| 1 | Hybrid sidebar (full ≥1280, rail md–lg, drawer mobile) | Scales for growing nav, matches reference site |
| 2 | Light sidebar (white bg, blue text, gold active accent) | Spacious feel, good contrast, aligns with Seattle Children's |
| 3 | Max-width 1440px on shell | Prevents ultrawide stretching |
| 4 | Homepage = landing with Hero + Achievements + Events previews | Lightweight entry, drives users to dedicated pages |
| 5 | Every section → own page | Clean separation, deep-linkable, scalable |
| 6 | Rename News → Events & Highlights | Better represents hospital content (procedures, events, announcements) |
| 7 | Events categories: procedure, event, announcement | Covers notable surgeries, hospital events, general updates |
| 8 | Structured gallery (url + caption + captionAr + alt) | Accessible, flexible, CMS-friendly |
| 9 | Article detail: prose + sticky metadata sidebar | Credibility, navigability for long-form clinical content |
| 10 | Client-side pagination (8 per page) | Simple for static generation, revisit at ~50 items |
| 11 | Remove nursing section entirely | User decision — simplify team structure |
| 12 | Keep articles categories as-is | No change needed for existing content model |
