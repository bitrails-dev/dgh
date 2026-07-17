# Multi-tenant migration runbook (cms/)

One-time steps to move the single-hospital DB to the multi-tenant schema. Run from `cms/`.
Invoke the Payload CLI directly (the `.bin` shim may not link on this machine):
`node node_modules/payload/bin.js <cmd>` — set `PAYLOAD_CONFIG_PATH=src/payload.config.ts` and load `.env` first.

## 0. Install (you handle this)

`pnpm install` — adds `@payloadcms/plugin-multi-tenant@3.85.1` (already in package.json).

## 1. Regenerate the import map (REQUIRED)

`node node_modules/payload/bin.js generate:importmap`

The multi-tenant plugin ships **client components** (tenant selector in the admin nav, the injected
`tenant` field, the `isGlobal` redirect view). Payload resolves these through a generated import map;
adding the plugin makes the existing map stale → at runtime you get
`getFromImportMap: PayloadComponent not found in importMap null`. Regenerating fixes it. **Run this
after every install / after editing `payload.config.ts`**, before `dev` or `migrate`.

## 2. Regenerate types (optional but recommended)

`node node_modules/payload/bin.js generate:types` — refreshes `payload-types.ts` (adds `tenants`, drops `hospital-settings`).

## 3. Create the schema migration

`node node_modules/payload/bin.js migrate:create multi_tenant`

This adds: the `tenants` table, a `tenant_id` FK on every scoped collection
(`media, categories, doctors, departments, articles, events, awards, achievements, testimonials`),
a `users_tenants` array sub-table, and a `users_roles` sub-table. The `hospital_settings` global table is dropped.

### Known gotcha (see memory `cms-migration-workflow`)

db-sqlite's `migrate:create` emits a **broken `INSERT … SELECT`** when a table is rebuilt to add a
NOT NULL FK: it SELECTs the brand-new `tenant_id` from the OLD table → `SQLITE_ERROR: no such column: tenant_id`.
For each affected scoped table, **hand-fix** the generated migration: remove `tenant_id` from both the
INSERT column list and the SELECT (it should start NULL; step 5 backfills it).

**Always copy-test first** (migrations run in a transaction, so a failure rolls back safely):

```
cp cms.db cms.test.db
DATABASE_URI=file:./cms.test.db node node_modules/payload/bin.js migrate   # answer "y" to the data-loss prompt
```

Iterate on the hand-fix against the copy until it applies cleanly.

## 4. Apply the migration

`node node_modules/payload/bin.js migrate` (answer `y` to the data-loss prompt if shown)

## 4. Seed the Damietta General Hospital tenant + backfill tenant_id

## 5. Seed the Dumyat tenant + backfill tenant_id

`npx tsx scripts/seed-tenants.ts`

Creates the **Damietta General Hospital** tenant (type=hospital, all features, branding/hero/contact baked from the
pre-tenant values), sets `tenant_id` on every existing scoped row, attaches users while preserving
assigned roles (legacy users without a role become super-admins),
and **asserts** no scoped row is left tenantless. Idempotent — safe to re-run.

<<<<<<< HEAD

## 5. Verify

- `GET http://localhost:3001/api/tenants` → one doc `damietta-general-hospital` with `features` populated.
- `GET http://localhost:3001/api/doctors?where[tenant][equals]=<id>` → only Damietta General Hospital's doctors.

## 6. Verify

- `GET http://localhost:3001/api/tenants` → one doc `dumyat` with `features` populated.
- `GET http://localhost:3001/api/doctors?where[tenant][equals]=<id>` → only Dumyat's doctors.
- `GET http://localhost:3001/api/doctors` (no filter) → still returns all (public reads aren't
  auto-filtered — the Astro site passes the `where[tenant]` filter itself).

## Adding a clinic later

Create a new Tenant in the admin: set `type=clinic`, a `slug`, its `domains`, and only the
`features` it should expose (e.g. omit `team`). Its content is authored under that tenant (use the
"Filter by Tenant" selector in the admin). The public site resolves it by domain and gates its
nav/sections/routes to the chosen features automatically.
