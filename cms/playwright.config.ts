// Playwright config for the storefront AR/EN checkout operator gate (runbook §8).
//
// Scope: the specs under tests/playwright/ drive a real browser against the running Astro
// storefront (4321) + CMS (3001). It does NOT auto-start either server — the operator must
// bring both up + provision a commerce-enabled tenant first (see the RUN PREREQUISITES block
// at the top of each spec). Keeping this config minimal on purpose (ponytail): baseURL,
// testDir, a single project, and a 60s per-test ceiling for the hosted-checkout redirect path.
//
// Run:   npx playwright test --config cms/playwright.config.ts
//        (cwd = repo root)  —  or from cms/:  npx playwright test
import { defineConfig, devices } from '@playwright/test';

const ASTRO_BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:4321';
const CMS_URL = process.env.CMS_URL ?? 'http://localhost:3001';

export default defineConfig({
  testDir: './tests/playwright',
  testMatch: /.*\.spec\.ts$/,
  fullyParallel: false, // shared pilot tenant + cookie-scoped carts — run locales sequentially
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
  timeout: 60_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: ASTRO_BASE_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    // shopApi sends credentials:"include" — the Secure HttpOnly `store_cart_v2` cookie must
    // ride every same-origin mutation. Accept the default context so the cookie persists
    // across the single-test browse → cart → checkout flow.
    storageState: { cookies: [], origins: [] },
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
  },
  projects: [
    {
      name: 'chromium-storefront',
      use: { ...devices['Desktop Chrome'] },
      metadata: { cmsUrl: CMS_URL },
    },
  ],
});
