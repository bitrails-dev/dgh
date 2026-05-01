# Coding Conventions
*Generated: 2026-05-01*
*Focus: quality*

## Language & Type Safety

- **TypeScript strict mode** — `tsconfig.json` extends `astro/tsconfigs/strict`
- **No ESLint or Prettier config found** — no `.eslintrc.*`, `.prettierrc.*`, or `biome.json` at project root; formatting is unenforced by tooling
- **Type annotations used selectively** — function parameters typed, but component `props.strings` is typed as `any` throughout (e.g., `src/components/portal/PortalSignIn.vue:51`, `src/components/layout/TheSidebar.vue:107`); this is a recurring loose type
- **Zod v4 used for content schemas** — `src/content.config.ts` uses `zod/v4` to define and validate all content collections; this is the only strict validation layer present
- **`import.meta.env` for env access** — used in `src/components/portal/api.ts:3` and `src/layouts/BaseLayout.astro:29`

## File & Component Naming

- **Astro components** — PascalCase `.astro` files (e.g., `CardBase.astro`, `HeroSection.astro`, `PageHeader.astro`)
- **Vue components** — PascalCase `.vue` files (e.g., `PortalBook.vue`, `TheSidebar.vue`, `FilteredCardGrid.vue`)
- **Layout components** — prefix `The` for singleton layout components (`TheFooter.astro`, `TheSidebar.vue`, `TheTopBar.astro`)
- **Portal components** — prefix `Portal` for patient-portal screens (`PortalBook.vue`, `PortalSignIn.vue`, `PortalAdmin.vue`)
- **Card components** — prefix `Card` for card variants (`CardBase.astro`, `CardDepartment.astro`, `CardDoctor.astro`, `CardEvent.astro`, `CardNurse.astro`)
- **Section components** — suffix `Section` for page sections (`HeroSection.astro`, `DepartmentsSection.astro`, `TeamSection.astro`)
- **Composables** — camelCase with `use` prefix in `src/composables/` (`useRTL.ts`, `useCounter.ts`, `useScrollAnimation.ts`)
- **Store files** — camelCase noun in `src/stores/` (`locale.ts`, `ui.ts`)
- **Content files** — kebab-case slugs (e.g., `cardiothoracic-surgery.md`, `2025-05-15-maternal-research.md`)
- **Page files** — `index.astro` for collection/list routes; `[slug].astro` or `[id].astro` for dynamic detail routes

## Directory Structure Conventions

```
src/
  components/
    layout/     — singleton layout pieces (The* prefix)
    portal/     — patient portal screens + api.ts
    sections/   — full-width page sections
    ui/         — reusable UI atoms (Card*, Badge*, etc.)
  composables/  — Vue composition functions (use* prefix)
  content/      — Astro Content Collections (MD + JSON)
  i18n/         — translation JSON files + index.ts helper
  layouts/      — page layout wrappers (BaseLayout, PortalLayout, SidebarLayout)
  pages/        — file-based routing under [...lang]/
  stores/       — module-level reactive singletons (locale.ts, ui.ts)
  styles/       — global.css (Tailwind base + custom utilities)
```

## Import Patterns

- **Relative imports throughout** — no path aliases configured; all imports use relative paths
  - Example: `import { localePath } from '../../i18n';` (`src/components/ui/CardDepartment.astro:4`)
  - Example: `import { useUiStore } from '../../stores/ui';` (`src/components/layout/TheSidebar.vue:103`)
- **Named imports preferred** — from `vue`, `lucide-vue-next`, and internal modules
- **`astro:content`** used for collection access in page files
- **`astro:transitions`** used for `ClientRouter` in `src/layouts/BaseLayout.astro:3`

## CSS Approach

- **Tailwind CSS v3** is the primary styling tool — utility classes applied inline on every element
- **Custom design tokens** defined in `tailwind.config.mjs`:
  - Color scales: `teal`, `navy`, `ivory`, `ink`, plus accent singles `coral`, `gold`, `sage`
  - Custom spacing scale: `s-0` through `s-9` (4px–128px)
  - Typography: separate font families for Arabic (`display-ar`, `body-ar`) and English (`display-en`, `body-en`)
  - Custom font sizes: `display`, `section`, `body-lg`, `body`, `label`
  - Named shadows: `soft`, `layered`, `deep`
- **`src/styles/global.css`** defines semantic utility classes on top of Tailwind:
  - Typography classes: `.h-display`, `.h-eyebrow`
  - Button variants: `.btn`, `.btn-primary`, `.btn-teal`, `.btn-ghost`, `.btn-text`
  - Layout helpers: `.section`, `.section-sm`, `.card`, `.prose`, `.frosted-card`
  - Animation helpers: `.lnum` (lining numerals), `.animate-float`
  - Scroll reveal: `[data-animate="fade"]` + `.is-visible` driven by IntersectionObserver in `BaseLayout.astro`
- **RTL support** via `tailwindcss-rtl` plugin and a custom `rtl:` variant in `tailwind.config.mjs`; logical CSS properties used (`ps-`, `pe-`, `ms-`, `me-`, `start-`, `end-`)
- **Scoped `<style>` blocks** used sparingly in Vue SFCs (e.g., `TheSidebar.vue` fade transition)
- **Inline styles** used in Astro files when Tailwind cannot express the exact value (e.g., `style='font-size: clamp(44px, 5.2vw, 82px)'` in `HeroSection.astro:36`)
- **No CSS modules or BEM** — not used anywhere

## i18n / l10n Patterns

- **Dual-locale site**: Arabic (`ar`, default, RTL) and English (`en`, LTR)
- **URL routing**: Arabic is the root prefix-free route (`/`), English is prefixed with `/en/` — configured in `astro.config.mjs` via `i18n.routing.prefixDefaultLocale: false`
- **Translation files**: flat-to-nested JSON at `src/i18n/ar.json` and `src/i18n/en.json`
- **Custom `t()` helper** in `src/i18n/index.ts` provides type-safe dot-notation key access (e.g., `t(lang, 'nav.home')`)
- **`localePath()` helper** in `src/i18n/index.ts` builds locale-aware URLs; used throughout Astro components for link hrefs
- **Inline locale switch** via the `lp()` pattern in Vue components:
  ```ts
  const lp = (path: string) => props.lang === "ar" ? path : `/en${path}`;
  ```
  This appears in `PortalBook.vue`, `PortalSignIn.vue`, and `TheSidebar.vue`
- **Content collections** store bilingual fields with `En`/`Ar` suffix convention (e.g., `nameAr`/`name`, `descriptionAr`/`description`, `titleAr`/`title`) — used in all 7 collections in `src/content.config.ts`
- **Direction** set on `<html dir="rtl|ltr">` in `BaseLayout.astro`; `lang-en` CSS class added to `<body>` for English, used to switch font families (`.lang-en .h-display`)
- **`useRTL()` composable** (`src/composables/useRTL.ts`) provides reactive `isRTL` ref for Vue islands via MutationObserver on `document.documentElement.dir`
- **`astro-i18next`** integration installed but minimally used — `astro.config.mjs` includes it but i18n is primarily handled by the custom `src/i18n/index.ts` system

## Props Patterns (Vue)

- **`defineProps<{...}>()`** with inline TypeScript generics — no `withDefaults`, no `PropType`:
  ```ts
  const props = defineProps<{ lang: "ar" | "en"; strings: any }>();
  ```
- **`strings: any`** is the universal prop type for passing the full translation object to portal components
- **`lang: "ar" | "en"`** is a standard prop on all interactive Vue components and most Astro components
- **`currentPath: string`** passed to layout/nav components for active state detection

## Props Patterns (Astro)

- **TypeScript interfaces** defined in frontmatter with `interface Props { ... }` then destructured from `Astro.props`
- Example from `src/layouts/BaseLayout.astro`:
  ```ts
  interface Props {
    lang?: "ar" | "en";
    title: string;
    description: string;
    ogImage?: string;
    noindex?: boolean;
  }
  ```
- Optional props use `?` and default values destructured inline

## State Management

- **No Pinia stores used at runtime** — both `src/stores/locale.ts` and `src/stores/ui.ts` are module-level `reactive()` singletons (comments note they are "drop-in replacements for the old Pinia store")
- **Pinia** is listed as a dependency but not actually used in current code

## Comments

- Inline comments explain non-obvious logic (e.g., `// Tracks the current page path -- updated via astro:page-load` in `TheSidebar.vue:115`)
- `@type` JSDoc on config files only (`tailwind.config.mjs`, `astro-i18next.config.mjs`)
- No JSDoc on TypeScript functions — not a documented convention

## Error Handling (Vue)

- `try/catch/finally` blocks in all async functions
- Error messages stored in a reactive `error` ref and displayed in template with `v-if="error"`
- Pattern from `PortalSignIn.vue`:
  ```ts
  const error = ref<string | null>(null);
  try { ... } catch (e: any) { error.value = e?.message || "Error"; } finally { busy.value = false; }
  ```
- Navigation on auth failure via `window.location.href` (not router-based)

---

*Convention analysis: 2026-05-01*
