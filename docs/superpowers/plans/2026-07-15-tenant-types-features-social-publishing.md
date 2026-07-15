# Extensible Tenant Types, Feature Templates, Tenant-Aware Admin, and Social Publishing

Date: 2026-07-15
Baseline commit: `7196283` (`feat(cms): add tenant entitlements and migrate article blocks`)
Implementation model: `zai-coding-plan/glm-5.2` through `.agents/skills/opencode-delegate`

## 1. Objective and scope

Implement the following as one coherent, migration-safe CMS capability:

1. Replace the fixed `hospital | clinic` tenant type select with an extensible `tenant-types`
   collection that super-admins can create, edit, and safely delete.
2. Give each tenant type a default feature template. New tenants copy that template when their
   `features` value is omitted. Existing tenants keep their explicit feature set. A super-admin can
   explicitly reset one tenant's features to its current type template.
3. Make tenant ownership visible and filterable in aggregate super-admin lists for every
   tenant-scoped content collection, including Articles.
4. Close successful inline relationship-create drawers after the new record is assigned, for all
   relationship fields (Category, Tenant Type, and future relationships). Preserve Payload's already
   correct upload/media behavior.
5. Expand per-tenant social profile settings to Facebook, Instagram, X, Threads, Snapchat, YouTube,
   LinkedIn, TikTok, plus the existing canonical WhatsApp number.
6. Add tenant-controlled social auto-publishing, per-platform inclusion, secure OAuth connections,
   deterministic publication records, retryable background jobs, and Article-level defaulting.

Out of scope:

- Making the feature catalogue itself database-extensible. Feature keys remain code-defined because
  they gate routes, collections, and access policy. Tenant *types* and their feature combinations are
  extensible without a deployment.
- Downloading and re-uploading third-party YouTube videos. A YouTube embed is a link, not an owned
  video binary.
- Pretending unsupported provider actions succeeded. Unsupported or unconfigured targets must be
  recorded as `skipped` with a reason, never reported as published.
- Unrelated visual restyling or repository cleanup.

## 2. Confirmed current issues

### 2.1 Fixed tenant types

`cms/src/collections/Tenants.ts` stores `type` as a fixed select with two values. Adding a type
therefore requires a code change and deployment, and no reusable type-level feature defaults exist.

### 2.2 Tenant column and filter hidden

Payload's installed multi-tenant plugin (`3.85.1`) injects the `tenant` relationship with both
`admin.disableListColumn: true` and `admin.disableListFilter: true`. Super-admin access correctly
returns aggregated documents, but the list UI hides the ownership column and filter. This is a UI
configuration defect, not a missing data/access constraint.

### 2.3 Inline relationship drawer remains open

Payload's installed generic `AddNewRelation` handler adds the created record to the relationship
field but does not close its `DocumentDrawer`. The Upload field's corresponding handler already calls
`closeCreateDocDrawer()`. The fix must target successful generic relationship creation globally,
rather than special-casing Categories.

### 2.4 Social publishing does not exist

Tenants currently store only Facebook, X, and YouTube profile URLs plus a WhatsApp number. There is no
OAuth connection model, token protection, platform selection, Article opt-in, job queue, idempotency
record, provider adapter, or provider result visibility.

## 3. Behavioral decisions

### 3.1 Tenant type and feature-template behavior

- Add a platform-wide `tenant-types` collection with localized `name`, unique stable `slug`, and
  `defaultFeatures` using the existing `TENANT_FEATURES` options.
- `tenants.type` becomes a required relationship to `tenant-types`.
- On Tenant create, when `features` is `undefined`, copy `type.defaultFeatures` into the Tenant.
- An explicitly submitted empty `features: []` is intentional and must not be replaced.
- Changing a Tenant's type does not silently replace its customized features.
- A super-admin-only reset endpoint copies the current type's current template into that Tenant.
- A Tenant Type that is referenced by any Tenant cannot be deleted; return a clear 400 response.
- Tenant admins may read the related type label but may not create, update, delete, or assign types.
- Super-admins can create Tenant Types inline from the Tenant form; the global drawer-close behavior
  dismisses that flow after successful creation.

### 3.2 Migration behavior for existing types

- Preserve every distinct, nonblank legacy `tenants.type` value, not only `hospital` and `clinic`.
- Seed `hospital` and `clinic` with their current Arabic/English labels.
- For any unexpected legacy value, create a Tenant Type using a normalized unique slug and the legacy
  value as its display name, then backfill the relationship.
- Seed each migrated Tenant Type's default feature template conservatively from the union of features
  currently used by tenants of that type. Existing Tenant feature arrays remain unchanged.
- Abort before dropping the legacy text column if any Tenant cannot be mapped.
- Down migration restores the text type slug from the relationship and removes only the new type
  schema. Round-trip must preserve Tenant feature rows.

### 3.3 Feature-template reset behavior

- Endpoint: `POST /api/tenants/:id/reset-features-to-type-defaults`.
- Authorization: authenticated super-admin only; direct tenant-admin and forged requests return 403.
- Resolve the Tenant and its current Tenant Type inside the request transaction/context.
- Replace `features` with a cloned type template, including an intentionally empty template.
- Return the updated feature array and type identity.
- Add a Tenant edit-form UI button visible only to super-admins and existing documents.
- Require confirmation, show success/error feedback, then refresh the form so stored state is visible.

### 3.4 Aggregate tenant list behavior

- Override the injected tenant field so list columns and list filters are enabled.
- Add `tenant` to default columns for every tenant-scoped collection: Media, Categories, Doctors,
  Departments, Articles, Events, Awards, Achievements, and Testimonials.
- Super-admins continue to bypass tenant access constraints and can filter any aggregate list by the
  Tenant relationship.
- Non-super users remain constrained by the plugin/access layer; making the filter visible must never
  broaden readable tenants.
- Verify Articles specifically, then assert the same configuration for every scoped collection.

### 3.5 Inline create dismissal

- Add a client admin provider that observes Payload document-create events.
- When a successful `create` event includes the originating `drawerSlug`, close exactly that modal.
- Do not close edit/update drawers, failed submissions, unrelated modals, or the parent Article form.
- Register the provider globally in `admin.components.providers`.
- Do not patch `node_modules`, add `patch-package`, or create category-specific behavior.
- Add a focused component/unit test where practical and a Playwright/manual browser gate for the real
  nested Article -> Category and Tenant -> Tenant Type workflows.

### 3.6 Social profile settings

- Keep `contact.whatsapp` as the canonical WhatsApp number to preserve existing data and frontend
  behavior.
- Expand `contact.social` with:
  `facebookUrl`, `instagramUrl`, `xUrl`, `threadsUrl`, `snapchatUrl`, `youtubeUrl`, `linkedinUrl`,
  and `tiktokUrl`.
- Update generated types, tenant normalization, import/export scripts, fixtures, and public footer
  consumption so the data is not admin-only dead state.
- Validate optional URL fields as HTTP(S) URLs and WhatsApp as a normalized phone-like string without
  erasing existing values during migration.

### 3.7 Auto-publish settings

- Add a distinct tenant setting entitlement group named `socialPublishing`.
- Backfill that entitlement for existing tenants that currently have the previous full entitlement
  set, preserving intentionally restricted tenants. New tenants default to all setting groups.
- Add Tenant settings:
  - `socialPublishing.enabled`: master allow/deny switch.
  - `socialPublishing.defaultAutoPublish`: default for newly created Articles.
  - Per-platform `include` toggles for Facebook, Instagram, X, Threads, Snapchat, YouTube, LinkedIn,
    and TikTok.
- The include control and its Connect/Disconnect status must be displayed together per platform.
- WhatsApp is a contact channel, not a public-feed publishing target, and therefore has no publish
  toggle.
- Tenant-setting entitlement enforcement must protect the new group server-side, just like Branding,
  Hero, and Contact.

### 3.8 Article trigger semantics

The current Article collection has no draft/version lifecycle; every created Article is immediately
live. Therefore:

- Add `autoPublish` to Articles.
- On create, if the caller omits `autoPublish`, default it from the selected Tenant's
  `socialPublishing.defaultAutoPublish`.
- Queue social publication only for the first successful Article create when all are true:
  Tenant social publishing is enabled, Article auto-publish is true, and at least one platform is
  included.
- Article updates never create duplicate social posts automatically.
- Add a super-admin/tenant-authorized explicit retry action for failed platform publication records;
  retries reuse the same idempotency record.
- No external API failure may roll back or corrupt the Article save.

### 3.9 Publish payload and media selection

- Construct a canonical public URL from a required deployment base URL plus Tenant/domain and
  localized Article route. Reject/skip publishing when a safe public URL cannot be formed.
- Ensure the Article page passes its thumbnail to `BaseLayout` as the OG image. Continue emitting
  canonical URL, OG title, description, and image tags.
- Build localized post copy from Article title plus canonical URL, respecting provider length limits.
- Detect Article video blocks separately from images. A YouTube block is a video link, not an upload.
- If no video block exists and a thumbnail or Article image block exists, choose the first suitable
  public image for image-capable providers.
- Link-preview providers receive text plus canonical URL; their crawler consumes the OG metadata.
- Media-first providers receive the public image plus caption/link when their API permits it.
- If a platform requires media and no eligible media exists, record `skipped: no_eligible_media`.
- Never scrape/download a YouTube URL for cross-posting.

### 3.10 Provider capability rules

Implement adapters behind one typed registry. Each adapter must declare `text`, `link`, `image`, and
`video` capabilities and return a normalized result.

- Facebook Pages: text/link and image Page post when an authorized Page is selected.
- Instagram professional accounts: image publishing; skip without eligible public image or eligible
  owned video.
- X: text/link post, with image upload when available and the app tier permits it.
- Threads: text/link and image post.
- LinkedIn: organization/member post according to the authorized target, including article/image.
- TikTok: photo direct-post only when the app is approved, the domain is verified, creator info allows
  the requested privacy, and the user consent requirements are met; otherwise skip with a precise
  configuration/approval reason.
- Snapchat: Public Profile content publishing only when the app/account has approved Content
  Management access; otherwise expose Connect/configuration status and skip honestly.
- YouTube: publish only an owned uploaded video binary. With the current Article model (YouTube links,
  not owned uploads), record `skipped: no_owned_video`; never make an image-only YouTube upload.

Provider adapters must not contain fake success fallbacks. Every success stores the remote ID/URL.

### 3.11 OAuth and secret handling

- Add hidden platform collections for OAuth connections and one-time OAuth state/nonces.
- A connection is unique by Tenant + platform + remote account.
- Collections are not directly readable/writable through ordinary REST/GraphQL/admin access.
- Connect endpoint requires an authenticated user who may manage that Tenant's
  `socialPublishing` settings; Disconnect follows the same rule.
- OAuth state includes Tenant, platform, nonce, return path, and expiry; sign it with an HMAC derived
  from `PAYLOAD_SECRET`, store a hashed one-time nonce, enforce expiry, and mark it consumed.
- Encrypt access/refresh tokens with AES-256-GCM using a versioned key derived from `PAYLOAD_SECRET`.
  Store IV/auth tag/ciphertext and never return them to the browser or logs.
- Support token refresh where the provider supplies it. A refresh failure marks the connection as
  requiring reconnection and records a sanitized error.
- Callback handlers validate state before exchanging codes and redirect only to a validated internal
  admin return path.
- App client IDs/secrets, redirect base URL, and provider API versions live in documented environment
  variables; no secrets enter source control.

### 3.12 Reliable jobs, idempotency, and observability

- Use Payload's job queue with a `publishArticleToSocial` task and a dedicated `social-publishing`
  queue.
- Queue input contains only stable IDs (Article, Tenant, publication batch); load current documents in
  the task.
- Enable concurrency control and use a key that prevents simultaneous duplicate processing of the
  same Article/platform publication.
- Add `social-publications` records containing Tenant, Article, platform, status
  (`pending|processing|published|failed|skipped`), attempts, last error code/message, remote ID/URL,
  payload hash, and timestamps.
- Enforce uniqueness/idempotency for the initial Article-create event per Article + platform.
- Retry transient 429/5xx/network failures with bounded exponential backoff. Do not retry permanent
  permission, validation, missing-media, or unsupported-capability failures.
- Sanitize provider errors; never store or log tokens or full authorization responses.
- Expose publication status read-only to authorized Tenant users and super-admins.
- Provide a production job-run script/config and document persistent-server `autoRun` versus external
  scheduler behavior. Do not assume serverless background work survives after the request.

## 4. Dependency-ordered OpenCode execution queue

Run sequentially with a clean tree, independent review, gates, and an orchestrator commit after each
task. Do not parallelize because the tasks overlap `Tenants.ts`, Payload config, generated schema,
migration index/snapshots, and tests.

### Task A: Tenant Types and feature templates

Files/areas:

- New `cms/src/collections/TenantTypes.ts`.
- `cms/src/collections/Tenants.ts` relationship, create-default hook, reset endpoint/UI field.
- New admin reset component.
- Payload config registration.
- Versioned reversible migration and snapshot.
- Generated Payload types and focused unit/integration/migration tests.

Task A gates:

1. Existing legacy type strings round-trip without loss on scratch SQLite.
2. Existing Tenant features unchanged after up migration.
3. New Tenant with omitted features copies template; explicit empty stays empty.
4. Type change does not mutate features.
5. Reset copies current template and rejects tenant-admin/unauthenticated calls.
6. Referenced type deletion is rejected.

### Task B: Aggregate tenant lists and inline drawer dismissal

Files/areas:

- Multi-tenant plugin overrides and scoped collection default columns.
- Global admin provider for successful relationship-create drawer dismissal.
- Import map regeneration if required.
- Configuration tests and browser/manual test instructions.

Task B gates:

1. Injected tenant field allows list column and filter.
2. Every scoped collection defaults to a Tenant column.
3. Super-admin aggregate reads remain unconstrained; tenant users remain constrained.
4. Article -> create Category assigns and closes drawer.
5. Tenant -> create Tenant Type assigns and closes drawer.
6. Invalid create keeps the drawer open and shows validation.
7. Media upload creation still assigns and closes.

### Task C: Social profile fields and tenant auto-publish settings

Files/areas:

- Tenant Contact/Social and Social Publishing setting groups.
- Setting entitlement access map and platform-field protection.
- Frontend Tenant types/normalization and footer consumption.
- Import/export scripts.
- Reversible migration/snapshot and tests.

Task C gates:

1. All eight profile URLs and WhatsApp round-trip through Payload and frontend normalization.
2. Existing FB/X/YouTube/WhatsApp data survives migration.
3. Tenant admin can edit the group only when entitled.
4. Forged disabled-group and platform-field changes return 403.
5. Existing fully entitled tenants receive the new group; restricted tenants remain restricted.

### Task D: Social publication core, Article trigger, OG, and jobs

Files/areas:

- Article `autoPublish` defaulting and create-only queue hook.
- Canonical URL/post/media builder.
- Article-specific OG image.
- Hidden OAuth connection/state and publication record collections.
- Encryption/state helpers.
- Payload job task, retry/idempotency logic, and access control.
- Schema migration/snapshot and deterministic tests with fake provider adapters.

Task D gates:

1. Omitted Article autoPublish uses Tenant default; explicit false remains false.
2. Disabled Tenant or no included targets queues nothing.
3. Create queues once; updates and repeated hooks do not duplicate.
4. Provider failures do not fail Article creation.
5. Token ciphertext decrypts only with the configured secret; tampering fails closed.
6. OAuth state is signed, expires, is one-time, and rejects external redirect paths.
7. Jobs transition publication states correctly and classify transient/permanent failures.
8. Image selection follows the no-video + image rule.

### Task E: OAuth UI/endpoints and provider adapters

Files/areas:

- Tenant Social Publishing admin panel with per-platform include + connection controls.
- Connect/callback/disconnect/account-selection endpoints.
- Provider registry and concrete adapters.
- `.env.example` and deployment/admin documentation.
- Contract tests using mocked HTTP servers/fetch; no live provider calls in CI.

Task E gates:

1. Each Connect button maps to the correct platform and Tenant, with no token exposure.
2. Callback rejects bad/expired/replayed state.
3. Disconnect revokes where supported and deletes encrypted local credentials.
4. All adapters generate provider-valid request shapes from the normalized payload.
5. Unsupported/unapproved cases become explicit skipped records, never successes.
6. UI status reflects connected/reconnect-required/not-configured and last publication result.

### Task F: Coherence, migrations, and documentation

Files/areas:

- Full generated types/schema/import map.
- Migration index order and scratch database replay.
- Test/build/typecheck gate output.
- Exact operator migration/deployment/provider setup/manual verification guide.

Task F gates:

1. Clean DB migrate up succeeds.
2. Copy of current DB migrate up succeeds with row-count/data invariants.
3. New migrations down then up succeed on scratch DB.
4. Schema snapshot matches collection config with no unrelated nullability drift.
5. Full CMS test suite passes.
6. CMS typecheck/build and root Astro build are rerun; pre-existing unrelated failures are separated
   from regressions with exact file/error evidence.
7. Repository-wide searches find no stale fixed Tenant type union or incomplete social field mapping.

## 5. Automated verification commands

OpenCode must discover and use installed commands, but the expected minimum is:

```powershell
cd C:\Users\mrt\Desktop\dgh\cms
node --import tsx --test tests/*.test.ts
npm run generate:types
npm run generate:importmap
npx tsc --noEmit --pretty false
npm run build

cd C:\Users\mrt\Desktop\dgh
npm run build
git diff --check
git status --short
```

Migration verification must use temporary copies/databases only until final operator instructions;
do not mutate `cms/cms.db` during delegated implementation/review.

## 6. Manual verification gates

1. Log in as super-admin.
2. Create a Tenant Type inline from a new Tenant. Confirm the drawer closes, the relationship is
   assigned, and omitted Tenant features copy the template.
3. Customize Tenant features, change its type, and confirm custom features remain. Press Reset and
   confirm the new type template is copied only after confirmation.
4. Open Articles list and confirm Tenant column plus Tenant filter. Repeat one other scoped collection.
5. Log in as tenant admin and confirm cross-tenant records remain inaccessible even by URL/API.
6. In an Article, create a Category inline. Confirm success closes the child drawer and assigns it;
   validation failure keeps the drawer open.
7. Confirm all social URL fields and WhatsApp save and render for the correct Tenant.
8. Toggle master publishing/default/per-platform settings; confirm disabled entitlements are enforced.
9. Configure one sandbox provider app, connect it, create an Article with auto-publish enabled, run the
   social job worker, and verify one remote post plus one `published` record.
10. Retry the worker and update the Article; confirm no duplicate remote post.
11. Force a provider 401 and a 429 in sandbox/mock modes; confirm reconnect-required vs retry behavior.

## 7. Stop conditions

OpenCode must stop and report rather than broaden scope if:

- A provider requires a commercial/partner approval unavailable to the repository owner.
- Correct OAuth target selection requires a product decision not represented here.
- Payload 3.85.1 cannot provide a required job/admin hook without dependency patching.
- A migration cannot preserve an unexpected legacy Tenant type or feature row.
- Completing a provider would require fake success, scraping third-party video, or storing plaintext
  credentials.

The orchestrator may issue a delta brief for implementation defects. A plan-level conflict must be
surfaced to the user.
