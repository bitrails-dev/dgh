# Technology Stack

| Layer | Technology |
|---|---|
| Public site | Astro (Node SSR, standalone adapter) + Vue 3 islands, Pinia, Tailwind 3, GSAP |
| CMS | Payload 3.85.1 on Next.js ~15.4 (`cms/`) |
| CMS database | libSQL / SQLite (`@payloadcms/db-sqlite`); versioned migrations (`push: false`) |
| i18n | Astro i18n (ar default / en) + Payload localization (ar/en, fallback on) |
| Editor auth | Payload `users` — roles: super-admin / admin / editor |
| Content flow | Astro reads the CMS **live over REST** (`CMS_URL`); `src/content/**` is legacy seed only |
| Social publishing | durable Payload jobs on the `social-publishing` queue → OAuth adapters |

The site is server-rendered on Node — there is **no** Cloudflare Pages/Workers deployment and no
`sync:push` / export-to-markdown step. See `CMS-ARCHITECTURE.md` and `DEPLOYMENT.md`.
