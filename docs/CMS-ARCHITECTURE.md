# CMS Architecture: Payload CMS + Astro

## Overview

Content is authored in **Payload CMS** (in `cms/`), exported to **markdown files** in
`src/content/`, committed to git, and **Astro** rebuilds the static site. Payload is the editor;
git markdown is the build source. The public site never queries the CMS at runtime, so a CMS
outage cannot break a deploy.

```
Editor → Payload admin → local libSQL → `npm run export` → src/content/*.md → git push → Astro rebuild (Cloudflare Pages)
```

## Why this shape

- **Astro already builds from markdown** (`src/content.config.ts` glob loaders). Payload writing
  markdown means the public site needs **zero changes** and keeps building statically on the free
  Cloudflare Pages tier.
- **Content stays in git** — diffable, reviewable, small commits, trivial rollback.
- **Build is decoupled from the CMS** — no live API dependency at build time.
- **Payload provides the editor, auth, roles, drafts, and bilingual (ar/en) modeling** out of the
  box — no custom dashboard to maintain, no admin token shipped to the browser.

## Localization

Payload localization is enabled (`ar` default, `en` secondary). Each concept is **one field**
marked `localized: true` instead of duplicated `title` / `titleAr` columns. The export flattens
each localized field `F` back to the frontmatter keys Astro expects: `F` (en) + `FAr` (ar).

## The seam

`cms/scripts/specs.ts` is the single source of the Payload↔markdown mapping. Its frontmatter keys
must match `src/content.config.ts`. Two thin scripts use it:

- `cms/scripts/export-to-content.ts` — Payload → `src/content/*.md` (run after editing).
- `cms/scripts/import-from-content.ts` — `src/content/*.md` → Payload (one-time seed).

## Collections

`doctors`, `departments`, `articles`, `events`, `awards`, `achievements`, `testimonials`, plus
`users` (auth). These mirror the Astro content collections one-to-one. There is intentionally no
`media`/uploads collection or `news` collection — current images are external URLs and the site
has no news collection.

## Globals (site config)

Singletons (hero stats, contact info) live in the `hospital-settings` **Global**, not a collection.
The export writes them to `src/content/settings/hero.json` and `contact.json` — the exact JSON the
site imports directly (`HeroSection`, `ContactSection`, `TheSidebar`). UI translation strings
(`src/i18n/*.json`) stay developer-managed and are intentionally not in the CMS.

## Tech stack

| Component | Technology |
|---|---|
| Public site | Astro 6 static + Vue islands, Tailwind, astro-i18next (ar/en) |
| CMS | Payload 3 (Next.js) in `cms/` |
| CMS database | local libSQL — embedded `file:./cms.db` or a local `turso dev` server |
| Editor auth | Payload `users` collection (sessions, roles) |
| Publish | `npm run export` → git commit → Cloudflare Pages rebuild |
| Hosting | Astro on Cloudflare Pages; Payload runs locally (Node) |

See `cms/README.md` for setup and the daily publish flow.
