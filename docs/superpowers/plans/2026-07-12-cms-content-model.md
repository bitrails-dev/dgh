# CMS content-model changes — plan (2026-07-12)

Four changes to the Payload CMS (`cms/`) + the Astro reader. Payload **3.85.1**, SQLite,
versioned migrations (`push: false`). **Hard constraint from the user: no migration may
lose data or fail.** The whole plan is shaped around that — see the safety protocol first.

Decisions locked in review:
- **Icons** → dedicated `Icons` upload collection (managed SVG library), department references one.
- **Category delete** → full reassign-on-delete dialog (clear / move-to-another / delete anyway).
- **Article blocks** → Rich text, Image, YouTube, Heading, **Testimonial** (image + text + caption).

---

## 0. Migration safety protocol (applies to every step below)

This is the backbone. Every schema change follows **additive → backfill → switch → cleanup**,
never a destructive rewrite.

1. **Back up first.** Copy `cms/cms.db` (and `-wal`/`-shm`) to a timestamped file before any
   `payload migrate`. One-line restore path if anything looks wrong.
2. **Additive-first.** A feature's first migration only *adds* — new tables, new **nullable** FK
   columns. It never drops or narrows an existing column.
3. **Backfill separately, defensively.** Populate the new column from the old one in the same
   migration's `up()` (after the DDL) or a follow-up `tsx` script using the Payload local API.
   Rows that don't map are logged and skipped, never thrown on. Must be a **no-op on an empty
   DB** (fresh installs run every migration).
4. **Never drop a populated column in the migration that introduces its replacement.** The old
   column stays as a fallback for one release.
5. **Cleanup is a separate, later migration** — runs only after the app reads the new field in
   prod and row counts are verified. It drops the legacy column / enforces `NOT NULL`.
6. **Every migration has a real `down()`.** DDL reverses exactly; data-restoring `down()` is
   best-effort and commented as such.
7. **Generate, then audit.** Use `payload migrate:create <name>` to diff the config into SQL, then
   **read the generated SQL by hand** — reject any unexpected `DROP`/`ALTER … DROP COLUMN` and move
   it to a cleanup migration. Run with `payload migrate`.
8. **Test on a copy before the real DB.** `cp cms.db cms.test.db` → migrate the copy → assert:
   `articles`, `doctors`, `departments` row counts unchanged; new FKs populated; zero NULLs where
   a value was expected. Only then migrate the real DB.
9. **One feature per migration batch**, verified before the next. The four items are independent.

Reader-side (`src/lib/cms.ts` + `src/content.config.ts`) changes ship **after** the matching CMS
migration+backfill, and each keeps a fallback (`?? oldField`) so a half-migrated DB still renders.

---

## 1. Articles composed of parts (blocks)

**Native answer: Payload `blocks` field.** No custom system.

**CMS — `cms/src/collections/Articles.ts`:** add a localized `content` blocks field. Keep `title`
top-level. **Keep the existing `body` textarea untouched** (rename label to "Legacy body",
`admin.readOnly`) — zero risk to existing article text; no markdown→Lexical conversion needed.

Block types:
- `richText` — Lexical (`editor: lexicalEditor()`), the prose block.
- `image` — `upload` → media, + `alt`, optional `caption` (localized).
- `youtube` — `url` text (+ optional `caption`). Renders via the **existing** `YouTubeEmbed.astro`.
- `heading` — `text` + `level` select (h2/h3).
- `testimonial` — `image` upload + `text` (localized) + `caption` (localized).

**DB:** purely additive — Payload creates `articles_blocks_*` (+ `_locales`) tables. `body` column
is never touched. `migrate:create` → audit (expect only CREATE TABLE) → migrate. Nothing to backfill.

**Reader:**
- `src/lib/cms.ts` + `src/content.config.ts` articles: map `doc.content` (ordered `blockType` array;
  normalize image/testimonial upload URLs with `imgUrl`, keep `{en,ar}` for localized fields).
- `src/pages/[...lang]/articles/[slug].astro`: render `content` blocks in order (a small
  `switch(blockType)` → block component). **Fallback:** if `content` is empty, render `body` as
  today. Lexical rich text renders to HTML via `@payloadcms/richtext-lexical`'s converter (or the
  serialized HTML) into the existing `.prose` container.

---

## 2. Departments ↔ Doctors

Today: `Doctors.department` is a free **text slug**; `departments/[slug].astro:27` filters
`doctors.filter(d => d.data.department === entry.id)`; `doctors/[id].astro:110` links the slug.
The UI is **one department per doctor**.

**Recommended: single FK owned by the doctor + a `join` on the department.**
- `Doctors.department`: `text` → `relationship` (`relationTo: 'departments'`, hasOne, `required`
  optional). Single FK = referential integrity, matches the one-dept-per-doctor UI.
- `Departments`: add a `join` field `{ name: 'doctors', collectionSlug: 'doctors', on: 'department' }`
  — surfaces & lets you assign the department's doctors from the department edit screen (the stated
  "assign a doctor to it"), with **no duplicate ownership**.

> Alternative if a doctor may belong to *many* departments: make it a `hasMany` `doctors`
> relationship owned on Departments instead. Pick this only if multi-department doctors are wanted;
> it gives up the single-FK integrity. Defaulting to the join approach.

**DB (safety-critical — text→FK):**
1. Additive migration: add nullable `department_id` FK to `doctors`. Keep the old `department` text
   column.
2. Backfill: for each doctor, `department_id = (SELECT id FROM departments WHERE slug = doctors.department)`.
   Log unmatched slugs; leave them NULL (don't fail).
3. Switch reader to the relationship.
4. Cleanup migration (later): drop `department` text column.

**Reader:**
- `src/lib/cms.ts` doctors: `department` becomes `str(doc.department?.slug)` (depth=1 returns the
  related dept) — keep it as a **slug string** so `departments/[slug].astro` and `doctors/[id].astro`
  keep working with minimal change.
- `departments/[slug].astro:27`: unchanged if reader still yields a slug; or switch to
  `entry.data.doctors` from the join.

---

## 3. Department icons → managed Icons collection

Today `Departments.icon` is a **text name** mapped to a **hardcoded inline-SVG path** in two files
(`CardDepartment.astro`, `DepartmentsSection.astro`) — there is no real asset.

**CMS:**
- New `cms/src/collections/Icons.ts`: `upload` with `mimeTypes: ['image/svg+xml']`,
  `staticDir`/`staticURL` like Media, fields `label` (text) + optional `sdgNumber`. Register in
  `payload.config.ts`. This is the curated, reusable, no-orphan library you chose.
- `Departments.icon`: `text` → `relationship` (`relationTo: 'icons'`).

**DB + seed (safety-critical — text→FK, and no assets exist yet):**
1. Additive migration: create `icons` table(s); add nullable `icon_id` FK to `departments`. Keep old
   `icon` text column.
2. **Seed script** (`tsx`, Payload local API): generate a `.svg` file for each entry in the current
   `iconPaths` map (wrap the path in `<svg viewBox="0 0 24 24">…</svg>`), upload each into `Icons`
   with `label = name`, plus one default fallback icon. This preserves today's visuals with real
   assets. (You then upload the actual SDG SVGs and re-point departments as desired.)
3. Backfill `departments.icon_id` by matching old `icon` name → seeded icon `label`; unmatched →
   fallback icon (never NULL, since icon is conceptually required).
4. Switch reader; cleanup migration later drops the `icon` text column.

**Reader / rendering:**
- `src/lib/cms.ts` + `content.config.ts` departments: `icon` → the uploaded SVG **URL**
  (`imgUrl(doc.icon?.url)`).
- `CardDepartment.astro` + `DepartmentsSection.astro`: drop the `iconPaths` map; render the asset.
  `CardBase` currently takes an SVG **path string** — extend it to accept an icon **URL** and render
  `<img src>` (simple) — **ponytail: `<img>` first; switch to inline-`set:html` SVG only if you need
  `currentColor` theming.**

---

## 4. Article categories → editable collection + reassign-on-delete

Today `Articles.category` is a hardcoded `select` enum (`hospital-news`, `health-tips`, `research`,
`events`), with labels/colors duplicated across `articles/[slug].astro`, `articles/index.astro`,
`FilteredCardGrid.vue`.

**CMS:**
- New `cms/src/collections/Categories.ts`: `slug` (unique), `name` (localized), `color` (select over
  the design tokens — teal/navy/gold/ink — so colors stop living in the frontend), optional `order`.
- `Articles.category`: `select` → `relationship` (`relationTo: 'categories'`). Make it **optional
  (nullable)** so the "clear category" delete option is possible without a required-field conflict.

**DB + seed (safety-critical — enum→FK):**
1. Additive migration: create `categories` table(s); **seed the 4 existing categories** with their
   current localized labels + colors (idempotent — skip if slug exists); add nullable `category_id`
   FK to `articles`. Keep old `category` text column.
2. Backfill `articles.category_id` by matching old enum value → seeded category slug.
3. Switch reader; cleanup migration later drops the `category` text column.

**Reassign-on-delete (the chosen full dialog):**
- **Enforcement backbone — `beforeDelete` hook on Categories:** count referencing articles; if any
  exist and the request carries no reassignment instruction, **throw** (blocks accidental orphaning
  even outside the UI).
- **UI — custom admin flow:** replace the category delete action with a custom view/modal offering:
  - **Clear** — set `category = null` on the N articles, then delete.
  - **Move to another** — set `category = <target>` on the N articles, then delete.
  - **Delete anyway** — same as Clear (category is nullable), explicit override.
  - Backed by a custom Payload **endpoint** (`POST /categories/:id/delete-with-reassign`) that does
    the reassignment inside a transaction, then deletes. The `beforeDelete` hook stays as the guard.
- This is genuine custom React-admin work (component + endpoint) — the heavier of the four items.

**Reader:**
- `src/lib/cms.ts` + `content.config.ts` articles: `category` → `{ slug, name/nameAr, color }` from
  the relationship (depth=1). Keep `slug` available so `FilteredCardGrid.vue` filtering (matches by
  value) keeps working.
- `articles/index.astro`: replace the hardcoded `categories` array (lines 16-21) with categories
  fetched from the CMS.
- `articles/[slug].astro`: replace `categoryLabels`/`categoryColors` maps (18-37, 65) with the
  category object's `name` + `color`.

---

## Rollout order

Independent features; ship one migration batch at a time, verifying between (protocol §8). Suggested:
**1 (blocks, additive-only, lowest risk) → 3 (icons) → 2 (doctors) → 4 (categories, most involved).**
For each: CMS config → `migrate:create` → audit SQL → backup → migrate copy → verify → migrate real →
backfill → verify → ship reader change (with fallback) → later cleanup migration.

## Files touched (summary)

- **CMS collections:** `Articles.ts` (blocks + category rel), `Doctors.ts` (department rel),
  `Departments.ts` (icon rel + doctors join), new `Icons.ts`, new `Categories.ts`, `payload.config.ts`
  (register 2 collections), custom admin component + endpoint for category delete.
- **CMS migrations:** one additive + one cleanup per feature (2, 3, 4); one additive for feature 1.
  Plus seed scripts for icons + categories.
- **Reader:** `src/lib/cms.ts`, `src/content.config.ts` (articles, doctors, departments mappers/schemas).
- **Astro/Vue:** `articles/[slug].astro`, `articles/index.astro`, `departments/[slug].astro`,
  `doctors/[id].astro`, `CardDepartment.astro`, `DepartmentsSection.astro`, `CardBase.astro`,
  `FilteredCardGrid.vue`; new block components for the article renderer.
