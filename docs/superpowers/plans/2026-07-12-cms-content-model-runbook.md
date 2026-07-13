# CMS content-model — execution runbook (2026-07-12)

Companion to `2026-07-12-cms-content-model.md`. All **code is written**; what remains is generating
+ applying the migration and running the backfill. Everything below is designed so **no step can
lose data** (additive schema, idempotent Payload-API backfill, copy-test before touching the real DB).

## What is already implemented

- **CMS collections** (`cms/src/collections/`): `Articles` (content blocks + `categoryRel`; legacy
  `category` kept read-only), `Doctors` (`departmentRel`; legacy `department` read-only), `Departments`
  (`iconRef` + `doctors` join; legacy `icon` read-only), new `Icons` (SVG upload lib), new `Categories`
  (name + token color, `beforeDelete` guard + `/:id/reassign-delete` endpoint). Registered in
  `cms/src/payload.config.ts`.
- **Admin UI**: `cms/src/admin/CategoryDeletePanel.tsx` — clear / move / delete-anyway. Registered as a
  `ui` field on Categories. Needs `generate:importmap` + an admin build check.
- **Backfill**: `cms/scripts/seed-and-backfill.ts` — idempotent; seeds 4 categories + 12 icons, backfills
  `categoryRel` / `departmentRel` / `iconRef`. Only sets new fields.
- **Reader + frontend** (Astro): `src/lib/cms.ts`, `src/content.config.ts`, `ArticleBlocks.astro`,
  `CardBase`/`CardDepartment`/`DepartmentsSection`, `articles/[slug].astro`, `articles/index.astro` — every
  new field falls back to its legacy value, so a half-migrated DB still renders.

## 0. Unblock the install (Windows)

pnpm install fails on this machine with `ERR_PNPM_EPERM` — Windows Defender/indexer locks files during
pnpm's atomic rename. Fixes, best first:
1. **Add a Defender exclusion** for `D:\WORKSPACE\PROJECTS\hospital` (Settings → Virus & threat
   protection → Exclusions), then `cd cms && pnpm install`.
2. A `cms/.npmrc` with `node-linker=hoisted` is already committed as a workaround (flat node_modules).
3. If still failing, install from a shell with real-time protection paused.

Confirm: `cd cms && node -e "require('payload/package.json')"` prints no error.

## 1. Generate the additive migration

```bash
cd cms
pnpm payload migrate:create item_content_model
```

## 2. AUDIT the generated SQL (critical)

Open `cms/src/migrations/<timestamp>_item_content_model.ts`. It must contain **only**:
- `CREATE TABLE` for: `icons`, `categories`, `categories_locales`, and the article block tables
  `articles_blocks_rich_text`, `_heading`, `_image`, `_youtube`, `_testimonial` (+ their `_locales`).
- `ADD COLUMN` / new FK for `doctors.department_rel_id`, `departments.icon_ref_id`,
  `articles.category_rel_id` (and any `_rels` plumbing).
- Table **recreate** for `articles` and `departments` only to make `category` / `icon` **nullable**
  (safe widening — required because those fields are now read-only, so new rows can't fill them).

**Reject** anything that DROPs a column holding data (`body`, `department`, `icon`, `category`) or drops a
table. If present, move it out — legacy columns stay until the cleanup migration (§6).

## 3. Regenerate import map + types

```bash
pnpm payload generate:importmap    # wires CategoryDeletePanel into the admin
pnpm payload generate:types
```
If the admin fails to build because of `CategoryDeletePanel`, remove the `safeDelete` `ui` field from
`Categories.ts` for now (the `beforeDelete` guard + endpoint still enforce safety) and revisit.

## 4. Back up + dry-run on a COPY

```bash
cp cms.db cms.db.pre-migrate.bak
cp cms.db cms.test.db
DATABASE_URI=file:./cms.test.db pnpm payload migrate
DATABASE_URI=file:./cms.test.db npx tsx scripts/seed-and-backfill.ts
```
Verify on the copy: article/doctor/department counts unchanged; new tables exist; `category_rel_id`,
`department_rel_id`, `icon_ref_id` populated; 4 categories + 12 icons created. Then delete `cms.test.db`.

## 5. Apply for real

```bash
pnpm payload migrate
npx tsx scripts/seed-and-backfill.ts
```
Re-running the backfill is a no-op (idempotent). Load the site — departments show icons, articles show
category name/color, department pages list doctors. All read paths fall back to legacy values if a row
wasn't backfilled, so nothing renders blank.

## 6. Cleanup migration (LATER, only after prod is verified)

Separate migration — the genuinely destructive step, deferred on purpose. After confirming every row is
backfilled and the site is happy for a release: remove the legacy fields (`articles.body` optional,
`articles.category`, `doctors.department`, `departments.icon`) from the collection configs, then
`migrate:create cleanup_legacy_fields`, audit (now DROPs are expected), back up, copy-test, apply.
Optionally rename `categoryRel`/`departmentRel`/`iconRef` → `category`/`department`/`icon`.
