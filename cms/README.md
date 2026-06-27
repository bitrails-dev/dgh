# Hospital CMS (Payload)

Payload CMS that authors the site content and **exports markdown into `../src/content`**,
which the Astro site reads at build. The CMS is the editor; git markdown stays the build
source. The public site never talks to the CMS at runtime — so a CMS outage can't break a deploy.

```
Editor → Payload admin → local libSQL → `npm run export` → ../src/content/*.md → git push → Astro rebuild
```

## Stack

- Payload 3 (runs inside Next.js) — admin UI, auth, roles, drafts, bilingual (ar/en) editing
- DB: local libSQL (no cloud) — embedded `file:./cms.db`, or a local `turso dev` server
- Localization: `ar` (default) + `en`, one field per concept (no duplicated `*Ar` columns)

## Setup

```bash
cd cms
npm install
cp .env.example .env          # set PAYLOAD_SECRET; DATABASE_URI=file:./cms.db for local
npm run generate:importmap    # populates src/app/(payload)/admin/importMap.js
npm run dev                   # admin at http://localhost:3001/admin (first visit creates the admin user)
```

> Runs on port 3001 to stay clear of Astro's 4321. Set it via `next dev -p 3001` or `PORT`.

### Seed from existing markdown (one time)

```bash
npm run import     # reads ../src/content/*.md → creates Payload docs (AR default + EN locale)
```

## Daily flow

1. Edit content in the admin.
2. `npm run export` — writes `../src/content/*.md`.
3. From the repo root: `git add src/content && git commit && git push` → Astro rebuilds.

## Local libSQL (no cloud)

The DB stays on your machine. Two ways:

- **Embedded file (default)** — `DATABASE_URI=file:./cms.db`. Nothing to run; Payload opens the
  file directly. `cms.db` is gitignored.
- **Local libSQL server** — if you want the libSQL server protocol (e.g. to share the DB between
  processes), run `turso dev --db-file cms.db` and set `DATABASE_URI=http://127.0.0.1:8080`.
  No auth token, no Turso account, nothing leaves the machine.

The CMS itself runs locally too — it doesn't need to reach the Astro deploy. Publishing is just
`npm run export` then committing `src/content`.

## Notes / deliberate simplifications

- Image fields are URL strings, not uploads — current content uses external image URLs. Add a
  `Media` collection + S3/R2 storage adapter when editors need to upload files.
- Post bodies are markdown `textarea` fields, not the Lexical rich-text editor — trivial,
  lossless round-trip to markdown. Swap to `richText` + a lexical→markdown converter for WYSIWYG.
- `doctors.department` is a slug string, not a relationship. Make it a `relationship` to
  `departments` if you want the admin to enforce the link.
- The Payload↔markdown field mapping lives in `scripts/specs.ts` — the one file to edit if a
  collection's frontmatter changes. Keep it in sync with `../src/content.config.ts`.
