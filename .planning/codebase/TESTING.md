# Testing Patterns
*Generated: 2026-05-01*
*Focus: quality*

## Test Framework

**Runner:** None configured

**Test config files found:** None
- No `vitest.config.*`, `jest.config.*`, or `playwright.config.*` at project root
- No `cypress.config.*` or other e2e config found

**Run Commands:**
```bash
# No test scripts defined in package.json
# The only scripts present are:
npm run dev       # astro dev
npm run build     # astro build
npm run preview   # astro preview
```

## Test File Locations

**No test files exist anywhere in the project.**

A glob search for `**/*.{test,spec}.{ts,js,vue}` in `src/` returned zero results. There are no `__tests__/` or `test/` directories under `src/` or at the project root.

## Test Coverage

**Current coverage: 0%**

No tests exist. No coverage tooling is configured.

## Types of Tests

| Type | Status |
|------|--------|
| Unit tests | Not present |
| Integration tests | Not present |
| Component tests | Not present |
| E2E tests | Not present |
| Snapshot tests | Not present |

## CI/CD Integration

No CI configuration files were found:
- No `.github/workflows/` directory
- No `Makefile`, `Taskfile`, or pipeline config

Testing is not part of any automated pipeline.

## What Would Need Testing (Gaps)

Given the codebase structure, the following are the highest-priority untested areas:

**`src/i18n/index.ts` — custom i18n helpers**
- `t(lang, key)` — dot-notation key lookup with deep key type safety
- `localePath(path, lang)` — URL prefix logic for Arabic (no prefix) vs English (`/en/`)
- These are pure functions; unit tests with Vitest would require zero setup

**`src/components/portal/api.ts` — portal API client**
- `request<T>()` — fetch wrapper with error parsing, credential inclusion, JSON handling
- All `portalApi` methods (slots, appointments, auth flows)
- Mocking `fetch` and testing error branches (non-OK responses, JSON parse failures)

**`src/stores/locale.ts` — locale store singleton**
- `init()` — reads from `localStorage`, applies locale
- `setLocale()` — persists to `localStorage`, mutates DOM `dir` attribute
- Requires jsdom environment

**`src/stores/ui.ts` — UI store singleton**
- `toggleMenu()`, `closeMenu()` — straightforward reactive state mutations

**`src/composables/useRTL.ts` — RTL detection**
- Reactive response to `document.documentElement.dir` changes via MutationObserver
- Requires jsdom environment

**`src/content.config.ts` — Zod schemas**
- Validate that schema shapes match actual content frontmatter
- Regression protection if schemas are tightened

**Portal Vue components (form flows)**
- `src/components/portal/PortalSignIn.vue` — OTP request/verify flow
- `src/components/portal/PortalSignUp.vue` — registration flow
- `src/components/portal/PortalBook.vue` — slot search + booking flow
- `src/components/portal/PortalAppointments.vue` — appointment listing/cancel/reschedule

## Recommended Setup (If Tests Are Added)

**Recommended framework:** Vitest (already in Astro's ecosystem, zero-config for most patterns)

**Install:**
```bash
pnpm add -D vitest @vue/test-utils jsdom
```

**Minimal `vitest.config.ts`:**
```ts
import { defineConfig } from 'vitest/config';
import vue from '@vitejs/plugin-vue';

export default defineConfig({
  plugins: [vue()],
  test: {
    environment: 'jsdom',
  },
});
```

**Test file placement convention (recommended):**
- Co-locate unit tests: `src/i18n/index.test.ts`, `src/stores/locale.test.ts`
- Component tests: `src/components/portal/PortalSignIn.test.ts`

**Suggested first test (high value, zero deps):**
```ts
// src/i18n/index.test.ts
import { describe, it, expect } from 'vitest';
import { t, localePath } from './index';

describe('t()', () => {
  it('returns English string for known key', () => {
    expect(t('en', 'nav.home')).toBe('Home');
  });
  it('returns empty string for missing key', () => {
    expect(t('en', 'nav.nonexistent' as any)).toBe('');
  });
});

describe('localePath()', () => {
  it('returns bare path for Arabic (default locale)', () => {
    expect(localePath('/departments', 'ar')).toBe('/departments');
  });
  it('prepends /en for English', () => {
    expect(localePath('/departments', 'en')).toBe('/en/departments');
  });
  it('handles root path for English', () => {
    expect(localePath('/', 'en')).toBe('/en/');
  });
});
```

---

*Testing analysis: 2026-05-01*
