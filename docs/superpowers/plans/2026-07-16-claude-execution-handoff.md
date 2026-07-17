# Execution Handoff — Tenant Types, Feature Templates, Aggregate Lists, Inline Dismissal, Social Links & Auto-Publish Settings

Date: 2026-07-16
Branch: `feat/multi-tenant` (uncommitted working tree, ready for review)
Reviewer target: main AI / Codex
Predecessor plans:
- `docs/superpowers/plans/2026-07-15-tenant-types-features-social-publishing.md`
- `docs/superpowers/plans/2026-07-15-opencode-sequential-handoff.md`

> Final line per the handoff contract: **Changes are uncommitted and ready for Codex review.**

---

## 0. Executive summary

The interrupted partial Task A was audited, corrected, and extended. Tasks **A, B, C are complete and
tested (TDD, green)**. Tasks **D and E (actual social publishing: OAuth, job queue, provider adapters)
are intentionally NOT implemented** — they require per-tenant encrypted credentials, a durable job
queue, and live provider app review/approval that cannot be truthfully represented without operator
secrets (see §9). Task C lays the full settings foundation (entitlement group + toggles) that D/E
consume; 5 real provider adapters from a sibling branch are identified as salvageable.

User's six requested features → status:

| Requested feature | Maps to | Status |
|---|---|---|
| extend-tenant-types | Task A | ✅ Done (extensible `tenant-types` collection) |
| features-template | Task A | ✅ Done (type template copied on create; reset endpoint) |
| filter-by-tenant | Task B | ✅ Done (tenant column + filter on all scoped collections) |
| Inline-type-or-category-dismissal | Task B | ✅ Done (global provider, public hooks, no node_modules patch) |
| social-links | Task C | ✅ Done (8 platforms + WhatsApp) |
| auto-publish | Task C (settings) + D/E (execution) | ⚠️ Settings/toggles/entitlement done; **publishing execution not built** (needs OAuth+jobs+apps) |

---

## 1. Task-by-task status

### Task A — Tenant Types & feature templates: ✅ COMPLETE (audited + corrected)
The interrupted run was ~90% done but had **one real defect**: its integration test
(`tenant-types.integration.test.ts`) created tenants without the required `hero` stat values, so 9 of
30 tests failed with a localized `ValidationError`. Root cause was test-data omission, not a
production bug. Fixed by adding a `HERO_STATS` fixture to all 9 tenant creates (mirrors the valid
pattern in `tenant-settings.integration.test.ts`). Production code (`TenantTypes.ts`, the create-default
hook, reset endpoint, migration) was correct and retained.

### Task B — Aggregate tenant lists + inline dismissal: ✅ COMPLETE (new)
- **B1 (filter-by-tenant):** `tenantFeatureAccessPlugin` now flips the multi-tenant plugin's injected
  `disableListColumn:true`/`disableListFilter:true` back off and adds `tenant` to default columns for
  every scoped collection. UI visibility does not broaden access (non-super users stay constrained by
  the access layer + the field's `filterOptions`). Confirmed against the installed plugin source.
- **B2 (inline dismissal):** New global provider `InlineCreateDismissalProvider` (registered in
  `admin.components.providers`) uses the **public** `useDocumentEvents()` hook + `@faceless-ui`
  `useModal()` to close exactly the drawer of a successful relationship `create` (the Relationship
  field already assigns the new doc via `mostRecentUpdate.drawerSlug` but left its drawer open).
  Decision logic extracted to a pure, unit-tested `drawerSlugToDismiss`. Never closes update/edit
  drawers, failed creates, the parent form, or unrelated modals. No node_modules patching.

### Task C — Social links + auto-publish settings: ✅ COMPLETE (new)
- Expanded `contact.social` from 3 → 8 platforms (Facebook, Instagram, X, Threads, Snapchat, YouTube,
  LinkedIn, TikTok) with http(s) validation; WhatsApp stays the canonical contact number and is NOT a
  publish target.
- New `socialPublishing` group on Tenants: `enabled` (master), `defaultAutoPublish`, and
  `includedPlatforms` (multi-select over the 8). Gated by a new `socialPublishing` setting
  entitlement, enforced server-side by `enforceTenantSettingsEntitlement` (same boundary as
  Branding/Hero/Contact).
- Frontend (`src/lib/tenant.ts`, `TheFooter.astro`, `src/i18n/{ar,en}.json`) normalizes + renders all 8.
- Reversible migration with a **conditional** entitlement backfill: only tenants that had the complete
  prior 4-group set receive `socialPublishing`; intentionally restricted tenants are preserved.

### Task D — Publication core (jobs, OG, crypto): ⛔ NOT STARTED
### Task E — OAuth UI + provider adapters: ⛔ NOT STARTED
See §9 for the honest rationale + what is salvageable.

---

## 2. What changed and why (grouped)

**Task A (corrected/retained):** `cms/src/collections/TenantTypes.ts`, `cms/src/collections/Tenants.ts`
(create-default hook re-typed `CollectionBeforeChangeHook`; reset endpoint), `cms/src/admin/ResetTenantFeatures.tsx`,
`cms/src/collections/tenantFeatures.ts`, migration `20260715_190731_tenant_types.{ts,json}`, tests.

**Task B:** `cms/src/plugins/tenantFeatureAccess.ts` (column/filter/default-columns override),
`cms/src/admin/InlineCreateDismissalProvider.tsx` + `cms/src/admin/inlineDrawerDismissal.ts`,
`cms/src/payload.config.ts` (provider registration), regenerated `importMap.js`.

**Task C:** `cms/src/access/tenantSettings.ts` (new group), `cms/src/collections/Tenants.ts`
(`SOCIAL_PLATFORMS` catalogue, 8 URL fields, `socialPublishing` group), migration
`20260715_200619_social_publishing.{ts,json}`, `cms/scripts/export-to-content.ts` (8 social fields;
legacy global → first tenant), `cms/scripts/import-from-content.ts` (global → first tenant),
`cms/scripts/seed-and-backfill.ts` (cast), frontend `src/lib/tenant.ts`, `src/components/layout/TheFooter.astro`,
`src/i18n/ar.json`, `src/i18n/en.json`.

---

## 3. Touched-file list

Production code (cms):
- `src/collections/Tenants.ts`, `TenantTypes.ts`, `tenantFeatures.ts`
- `src/access/tenantSettings.ts`
- `src/plugins/tenantFeatureAccess.ts`
- `src/admin/InlineCreateDismissalProvider.tsx`, `inlineDrawerDismissal.ts`, `ResetTenantFeatures.tsx`
- `src/payload.config.ts`
- `src/app/(payload)/admin/importMap.js` (generated)

Migrations: `20260715_190731_tenant_types.{ts,json}`, `20260715_200619_social_publishing.{ts,json}`,
`src/migrations/index.ts`.

Scripts: `scripts/export-to-content.ts`, `import-from-content.ts`, `seed-and-backfill.ts`,
`seed-tenants.ts` (pre-existing Task A).

Tests (new): `tests/tenant-types.test.ts`, `tenant-types.integration.test.ts`,
`tenant-types-migration.test.ts`, `tenant-list-columns.test.ts`, `inline-drawer-dismissal.test.ts`,
`tenant-social.test.ts`, `tenant-social-migration.test.ts`.
Tests (updated): `tenant-settings.test.ts`, `tenant-settings.integration.test.ts`, `tenant-access.test.ts`.

Frontend (Astro): `src/lib/tenant.ts`, `src/components/layout/TheFooter.astro`, `src/i18n/ar.json`,
`src/i18n/en.json`.

> Note: a formatter/linter auto-applied a few clean fixes during the session (the `as never` cast on
> the two migration-test runners, the `Endpoint` cast on the Task A integration test, and
> `features as Tenant['features']` to resolve a Payload overload error in `Tenants.ts`). All are
> correct and were kept.

---

## 4. Review findings corrected

1. **Task A integration test omitted required `hero` stats** → 9/30 failed. Added `HERO_STATS` fixture. (Root cause: test-data, not production.)
2. **`copyTypeDefaultFeatures` hook mis-typed** (`NonNullable<...>['beforeChange'][number]` → TS2537 + implicit any). Re-typed as `CollectionBeforeChangeHook`. Removed 4 tsc errors.
3. **Stale test assertions** after additive changes: `tenant-access.test.ts` (3→8 social fields), `tenant-settings.test.ts` (4→5 setting groups), `tenant-types-migration.test.ts` ("last entry" no longer true). Updated.
4. **Legacy scripts referenced the retired `hospital-settings` global** (broken since baseline `7196283`, which retired HospitalSettings). `export-to-content.ts` and `import-from-content.ts` now read/write the first tenant; `seed-and-backfill.ts` color cast added. These unblocked the build and are in Task C scope ("update import/export scripts").
5. My new test files initially had fixable type errors (plugin `Config | Promise<Config>` seam, migration-runner casts, type predicates) — all cleaned to **0 errors**.

---

## 5. Migration evidence (scratch DBs only — `cms.db` never touched)

- **`20260715_190731_tenant_types`** — round-trip test (`tenant-types-migration.test.ts`): up→down→up on
  throwaway SQLite preserves every distinct legacy type (incl. unexpected values), known ar/en labels,
  conservative feature-template union, existing feature rows byte-equivalent, backfill guard aborts on
  unmappable blank type. ✅
- **`20260715_200619_social_publishing`** — round-trip test (`tenant-social-migration.test.ts`):
  up→down→up adds/drops the 5 new social URL columns + `social_publishing_enabled`/`_default_auto_publish`
  + `tenants_social_publishing_included_platforms` table; backfills `socialPublishing` entitlement ONLY
  for the fully-entitled tenant (restricted tenant preserved); down removes only the backfilled group;
  idempotent re-up. ✅
- Both migrations also replayed cleanly as part of every integration test's `payload.db.migrate()` on
  fresh temp DBs (DB bootstrap from scratch verified).

---

## 6. Gate outcomes (exact)

```powershell
cd C:\Users\mrt\Desktop\dgh\cms
node --import tsx --test tests/*.test.ts        # fail 0 (per-file: fail 0 each; see harness note below)
npm run generate:types                          # OK → src/payload-types.ts (gitignored) has all new fields
npm run generate:importmap                      # OK → provider + reset component registered
npx tsc --noEmit --pretty false                 # 4 errors — ALL pre-existing, NONE in Task A/B/C code
```

The 4 remaining tsc errors (all pre-existing version drift, unmodified by this work):
- `src/app/(payload)/api/graphql/route.ts` — `GRAPHQL_OPTIONS` removed in `@payloadcms/next` 3.85.1 (generated scaffold).
- `src/collections/Doctors.ts` — `defaultSort` not in `CollectionAdminOptions` (3.85.1 types).
- `src/collections/Icons.ts`, `Media.ts` — `staticURL` not in `UploadConfig` (3.85.1 types).

**`npm run build` (cms):** progresses through compilation and past all script/global issues fixed in §4;
it is now blocked ONLY by the pre-existing `graphql/route.ts` `GRAPHQL_OPTIONS` drift above (a generated
file, not app logic). Recommend regenerating the Payload scaffold or removing the `OPTIONS` handler as a
separate, unrelated fix.

**Root `npm run build` (Astro):** requires a running, migrated CMS (`localhost:3001`); in this environment
the loader could not reach it (`fetch failed`) — environmental, not a code defect. The 4 frontend files
changed are type-clean (`tsc --noEmit`: 0 errors in those files).

**Test-harness note:** running `node --test tests/*.test.ts` in one process yields a slightly variable
total (99–105) because multiple Payload-integration files set `process.env.DATABASE_URI` at module top
and share one cached `payload.config` import. Every file reports `fail 0` when run individually. This is
pre-existing harness fragility (Task A introduced the first such files); Task C added one more. For stable
counts, run integration tests per-file.

---

## 7. Provider capability matrix (Tasks D/E — for planning; not implemented)

Salvageable from sibling branch **`origin/feat/social-auto-publish`** (NOT on `origin/feat/multi-tenant`,
which is behind local by 4 commits). That branch predates the tenant work and is **single-tenant by
construction** (global env-var credentials, no OAuth/encryption/queue). Reusable as-is (pure, real REST
adapters, tenant-agnostic):

| Platform | Adapter on remote | Real API call | Maturity | Plan needs |
|---|---|---|---|---|
| YouTube | `adapters/youtube.ts` | OAuth refresh → resumable upload | High | Per-tenant creds |
| Facebook | `adapters/facebook.ts` | Graph video/feed post | High | Page token |
| Instagram | `adapters/instagram.ts` | REELS container→poll→publish | High | IG Business acct |
| LinkedIn | `adapters/linkedin.ts` | ugcPosts link share | High | Per-tenant creds |
| TikTok | `adapters/tiktok.ts` | init only (no status poll) | Partial | Finish polling + audit |
| X | — | — | — | **Build** |
| Threads | — | — | — | **Build** |
| Snapchat | — | — | — | **Build** |

Also salvageable: `social/types.ts`, `social/dispatch.ts` (allSettled fan-out + `mergeResults`
idempotency), `social/content.ts` (article→publish payload). **Nothing** reusable for credentials/OAuth
encryption/queue/publication-records — D/E must build: AES-256-GCM token store (key from
`PAYLOAD_SECRET`), HMAC-signed one-time OAuth state, hidden connection/state collections, Payload job
task with Article+platform idempotency + bounded retry, and a normalized `publications` collection.

---

## 8. Required environment / provider setup (no secrets here)

- `PAYLOAD_SECRET` — already required; D/E will derive the AES key + HMAC key from it.
- New (D/E, documented in `cms/.env.example` on the remote branch as a reference): per-platform client
  IDs/secrets + redirect base URL behind documented env vars; provider-console app + scope + (for
  TikTok/Snapchat) app-review/audit. Do not put secret example values in source.

---

## 9. Open decisions / blockers for the reviewer

1. **Tasks D/E are unbuilt.** Building them truthfully requires operator-supplied provider apps,
   approval status, and per-tenant credential entry. Faking success or storing plaintext tokens is
   explicitly forbidden by the plan's stop conditions. **Recommendation:** implement D/E as a follow-up
   that (a) salvages the 5 adapters + dispatch/content core above, (b) refactors credentials to
   per-tenant encrypted storage, (c) adds the durable queue + `publications` collection. This is a
   multi-day effort, not a tail of Task C.
2. **Pre-existing build blocker** (`graphql/route.ts` `GRAPHQL_OPTIONS`) — unrelated generated-file
   drift; decide whether to regenerate the Payload scaffold.
3. **Per-platform include UI + Connect buttons** (user's "buttons to give permission… toggle near each
   platform") — the data model (`includedPlatforms`, `socialPublishing` group) is ready; the Connect/
   Disconnect UI + OAuth endpoints are Task E.
4. **Article `autoPublish` defaulting + create-only queue** (Task D gate) — not yet wired to Articles.

---

## 10. Exact manual verification steps (browser/sandbox)

1. Log in as super-admin.
2. Create a Tenant Type inline from a new Tenant → drawer closes, relationship assigned, omitted
   features copy the template.
3. Customize a Tenant's features, change its type → custom features remain. Press **Reset to type
   defaults** (confirm) → type template copied.
4. Open **Articles** list → `tenant` column + filter visible. Repeat one other scoped collection
   (e.g. Media). Log in as tenant admin → cross-tenant rows still inaccessible by URL/API.
5. In an Article, create a Category inline → child drawer closes on success, category assigned;
   validation failure keeps it open.
6. Save all 8 social URLs + WhatsApp on a Tenant → render in the footer (frontend).
7. Toggle `socialPublishing.enabled` / `defaultAutoPublish` / `includedPlatforms`; confirm a tenant
   admin WITHOUT the `socialPublishing` entitlement gets 403 editing it.

---

## 11. Migration & safe-deployment runbook

Two new versioned migrations ship in this work, both **additive and reversible**, both verified on
scratch SQLite (see §5). The CMS uses `db.push: false`, so migrations must be applied explicitly.
**Never run these against `cms.db` without a backup.**

### Pre-flight (do once, on a copy)
```powershell
cd C:\Users\mrt\Desktop\dgh
# 1. Snapshot the live DB (file-based SQLite).
Copy-Item cms\cms.db cms\cms.db.bak-2026-07-16
# 2. Verify the backup is readable.
sqlite3 cms\cms.db.bak-2026-07-16 ".tables"   # optional sanity check
```

### Rehearse on a scratch copy (proves the migrations on YOUR data, not a synthetic seed)
```powershell
# Apply the full migration set (incl. the two new ones) to a throwaway COPY.
$env:DATABASE_URI = "file:./cms/rehearse.db"
Copy-Item cms\cms.db.bak-2026-07-16 cms\rehearse.db -Force
cd cms
npx payload migrate                          # runs up; idempotent on already-applied rows
# Inspect:
sqlite3 rehearse.db "SELECT slug FROM tenant_types;"
sqlite3 rehearse.db "SELECT count(*) FROM tenants_social_publishing_included_platforms;"
sqlite3 rehearse.db "SELECT parent_id, value FROM tenants_settings_entitlement WHERE value='socialPublishing';"
# Verify down/up reversibility on the same scratch DB:
npx payload migrate:down                     # optional: rolls back the last migration only
npx payload migrate                          # re-apply
Remove-Item rehearse.db, rehearse.db-* -Force
Remove-Item Env:DATABASE_URI
```
Expected: `tenant_types` seeded from existing legacy types; `socialPublishing` backfilled only for
tenants that had all four prior groups.

### Deploy (production order)
1. **Take the backup** (pre-flight above). Confirm `PAYLOAD_SECRET` is set (existing).
2. **Stop** the CMS + Astro processes.
3. **Apply migrations** against the real DB:
   ```powershell
   cd cms
   npx payload migrate                        # applies tenant_types, then social_publishing
   ```
   Both migrations guard data: tenant_types aborts before dropping the legacy `type` column if any
   tenant can't be mapped; social_publishing only adds columns + conditionally backfills.
4. **Regenerate artifacts** (only if the deploy image doesn't build them):
   ```powershell
   npm run generate:types
   npm run generate:importmap
   ```
5. **Build** (note the pre-existing `GRAPHQL_OPTIONS` blocker in §6 — resolve separately or rebuild
   the Payload scaffold before this will go green):
   ```powershell
   npm run build
   cd .. ; npm run build     # Astro — requires the CMS to be running for the content loader
   ```
6. **Start services:** CMS first (`pnpm dev` / your process manager), then Astro.
7. **Smoke test** the manual gates in §10 (esp. 4 = tenant column/filter, 7 = entitlement 403).

### Rollback (if a migration misbehaves)
```powershell
cd cms
npx payload migrate:down        # rolls back social_publishing FIRST (it is the later migration)
npx payload migrate:down        # rolls back tenant_types (restores legacy text `type` column)
```
Both `down` paths were verified round-trip on scratch SQLite (feature rows + social URLs preserved;
`socialPublishing` rows removed without touching other entitlements). If rollback is not needed but
data looks wrong, restore from `cms.db.bak-2026-07-16`.

### Notes
- `tenants.type` becomes a **required** relationship. Any code/admin flow creating a Tenant without a
  type will now fail validation by design (the create-default hook copies the type's template only when
  `features` is omitted).
- The `socialPublishing` group defaults ON for new tenants and for existing fully-entitled tenants;
  restricted tenants are unchanged. A super-admin can withhold it per tenant.
- The Astro frontend reads the 8 social fields live from `/api/tenants?depth=1`; no content rebuild is
  needed for social-link changes, only a page reload (the tenant cache TTL is 60s).

