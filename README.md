---
marp: false
---

# Al Noor Public Hospital Showcase

A static Astro website for a public hospital in Egypt, with bilingual (ar/en) content authored in
**Payload CMS**. Content is edited in Payload, exported to markdown in `src/content/`, committed to
git, and Astro rebuilds the static site.

## Stack

- **Frontend**: Astro 6 (static output) + Vue 3 islands, Tailwind CSS v3, astro-i18next (ar/en)
- **CMS**: Payload 3 (in `cms/`) — admin UI, auth, roles, drafts, bilingual editing
- **CMS database**: local libSQL (no cloud) — embedded `file:./cms.db` or a local `turso dev` server
- **Hosting**: Astro on Cloudflare Pages (static); Payload runs locally (Node)
- **Content flow**: Payload → `npm run export` → `src/content/*.md` → git → Astro rebuild

The public site reads markdown at build time and never queries the CMS at runtime, so a CMS outage
cannot break a deploy.

```
Editor → Payload admin → local libSQL → export → src/content/*.md → git push → Astro rebuild
```

## Public site

```bash
npm install
npm run dev        # http://localhost:4321
npm run build      # → ./dist
```

Content lives in `src/content/<collection>/*.md` (see `src/content.config.ts` for the schema).
Edit it directly, or author it in the CMS and run the export.

### Deploy

Cloudflare Pages — build command `npm run build`, output `dist`, framework preset Astro.

## CMS

See [`cms/README.md`](./cms/README.md) for setup, seeding existing content, and the publish flow.
Architecture and the Payload↔markdown mapping: [`docs/CMS-ARCHITECTURE.md`](./docs/CMS-ARCHITECTURE.md).

## Troubleshooting

- **Build fails**: clear the cache — `rm -rf .astro && npm run build`.
- **CMS admin route errors after install**: run `npm run generate:importmap` in `cms/`.
