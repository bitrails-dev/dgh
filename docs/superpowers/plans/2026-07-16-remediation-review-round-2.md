# Remediation Review Round 2 — Executor Handoff

This plan addresses the remaining findings after the first remediation pass. Read these documents first:

- `docs/superpowers/plans/2026-07-15-tenant-types-features-social-publishing.md`
- `docs/superpowers/plans/2026-07-15-opencode-sequential-handoff.md`
- `docs/superpowers/plans/2026-07-16-review-findings-remediation.md`

Keep correct existing work. Do not reset, commit, patch `node_modules`, upgrade dependencies, mutate `cms/cms.db`, expose credentials, or make live public posts.

## Objective

Close every outstanding Spec and Standards finding. Passing the existing 194 tests is not completion: add checks that fail on the currently identified defects and exercise the production paths.

## Task 1: Make account selection atomic and use safe HTTP semantics

Current defects:

- `cms/src/social/oauth/endpoints.ts` stores the connection before marking the selection session consumed.
- Failure to update `consumedAt` is swallowed.
- Concurrent requests can consume the same supposedly one-time session.
- Selection mutates credentials through GET, which may be prefetched or cached.

Required implementation:

1. Replace the state-changing selection GET with an authenticated POST endpoint. Keep GET read-only if it is needed to render candidates.
2. Protect the POST using the repository/Payload CSRF mechanism and tenant-scoped authorization.
3. Never send encrypted or plaintext candidate credentials to the browser. The client submits only session ID and selected stable target ID.
4. Consume the session atomically before storing the connection:
   - use the installed database/Payload transaction support and a compare-and-set condition equivalent to `consumedAt IS NULL`;
   - require exactly one row to transition;
   - reject zero transitioned rows as expired/replayed/invalid;
   - store the connection in the same transaction where supported, so consumption and connection creation commit or roll back together.
5. Do not swallow consumption or transaction errors.
6. Preserve expiry, tenant, platform, authenticated-user, target-membership, redirect-safety, and tamper checks.

Acceptance tests:

- GET cannot select or connect an account.
- Valid POST selects one target and consumes the session.
- Two concurrent POSTs produce exactly one success and one replay rejection, with one stored connection.
- A failure while storing the connection leaves no partially consumed or partially connected state.
- Expired, replayed, cross-tenant, unauthorized, invalid-target, and tampered requests fail closed.
- Responses and logs never contain tokens or encrypted candidate blobs.

## Task 2: Complete provider adapters and capability behavior

Current defects:

- X, Threads, Snapchat, and TikTok are unconditional placeholder adapters.
- Facebook ignores eligible images.
- LinkedIn implements ARTICLE/link sharing but not the required image path.

Before editing, verify behavior against current official provider documentation. Record API version, required scopes, target discovery, media workflow, revocation support, approval constraints, and source URL in the provider setup documentation. Do not rely on memory or stale comments.

### Facebook

- Preserve text/link Page publishing.
- When an eligible owned image exists, use the documented Page photo/image publishing workflow and include localized copy/link as supported.
- Store the real remote post ID and URL.
- Add mocked request-shape tests for image and text/link paths.

### LinkedIn

- Preserve ARTICLE/link sharing.
- Implement the documented image upload/register/upload/publish sequence where the configured account and scopes allow it.
- Store the real remote share ID and URL.
- Add mocked tests for each request in the image workflow and failure classification.

### X

- Implement OAuth, target resolution, text/link publishing, and image upload when configured API access permits it.
- Missing paid/API access returns a precise `not_configured` or `approval_required` result, not `not_implemented`.

### Threads

- Implement OAuth, account discovery, text/link publishing, and image publishing using the current supported API.
- Missing app configuration or approval returns a precise non-success result.

### Snapchat and TikTok

- Implement the executable adapter/OAuth/request-shape path exposed by current official APIs.
- If execution requires approval, audit, domain verification, or unavailable credentials, retain the implemented adapter contract and return `approval_required`/`not_configured` before making a request.
- Do not report fake success and do not reduce these platforms to generic missing adapters.

For all eight platforms:

- Register an explicit adapter.
- Every real success records remote ID and URL.
- Provider 401/403 marks the connection reconnect-required.
- Transient and permanent failures use the shared classifier.
- Secrets remain encrypted at rest and absent from responses/logs.
- Contract tests use mocked HTTP only and prove exact request shapes, scopes, success normalization, media rules, and honest unavailable states.

Remove `not_implemented` as a normal outcome for planned platforms. It may remain only as a defensive invariant for an unknown/unregistered platform.

## Task 3: Add authorized explicit publication retry

Current defect: failed publications have automatic job retries but no operator-triggered retry action.

Required implementation:

1. Add a POST retry endpoint/action for one failed publication record.
2. Allow only super-admins or users authorized for that publication's tenant.
3. Accept only retryable terminal records; reject published, pending/running, skipped, cross-tenant, and unauthorized records.
4. Reuse the existing Article+platform publication record and idempotency key; never create a duplicate row.
5. Reset only the fields necessary for a retry, preserve attempt/audit history, and enqueue through the durable `social-publishing` job queue.
6. Ensure two concurrent retry requests enqueue at most one effective retry.
7. Expose a minimal admin action with clear success/failure feedback if the current admin status panel displays failed publications.

Acceptance tests cover authorization, invalid statuses, concurrent retry, idempotent record reuse, enqueue failure, and successful state transition.

## Task 4: Use a dedicated queue and deterministic event targets

Current defects:

- Social jobs use the `default` queue rather than the required `social-publishing` queue.
- Task input contains only tenant/article IDs and derives targets from mutable settings/connections at run time.
- The worker hard-codes `articleAutoPublish: true` rather than loading the Article state.

Required implementation:

1. Queue and run social work on `social-publishing`; update `autoRun`, dedicated worker command, tests, and docs consistently.
2. At Article creation, compute the deterministic target platform list from the accepted create event and enqueue stable IDs plus that target list.
3. Validate the target list against the shared platform catalogue at the task boundary.
4. The worker reloads the Article and Tenant for content/security data, but must not silently add targets because tenant settings or connections changed after enqueue.
5. Define cancellation semantics explicitly:
   - if the Article was deleted or is unavailable, record a sanitized permanent/cancelled outcome;
   - if the Article no longer belongs to the queued Tenant, fail closed;
   - do not assume `autoPublish: true` without loading or preserving the create-event decision.
6. Preserve per-Article concurrency and Article+platform database idempotency.
7. Keep bounded retries only for transient failures.

Acceptance tests prove queue name, stable target input, no added targets after settings changes, behavior when connections change, deleted/mismatched Article handling, no update-triggered duplicate, and real Payload runner execution.

## Task 5: Populate and enforce publication payload hashes

Current defect: `SocialPublications.payloadHash` exists but no production path writes it.

Required implementation:

1. Build the normalized provider-independent publish payload first.
2. Compute a deterministic SHA-256 hash using Node's standard `crypto` module over a canonical serialization of fields that affect the outgoing post.
3. Store the hash on every attempted publication record before the provider call.
4. Use one canonical serializer; do not hash secrets, tokens, volatile timestamps, or object insertion order.
5. Decide and document how retries behave if Article content changes after the first attempt. Preserve the original event payload/hash unless the explicit retry contract intentionally creates a new audited attempt.

Acceptance tests prove identical semantic payloads hash identically, relevant content/media changes change the hash, key ordering does not, secrets are excluded, and production publication rows receive the hash.

## Task 6: Finish platform metadata consolidation

Current defect: `SocialConnectionsPanel.tsx` duplicates labels and widens platform values to `string`.

- Derive admin-visible labels/status metadata from `cms/src/social/platforms.ts`, preferably through the server response so client admin code does not import server-only configuration.
- Type platform fields/actions with the shared `Platform` union rather than `string`.
- Remove redundant label maps and “keep in sync” comments.
- Retain the frontend boundary parity test for Astro mappings.
- Add a test proving every catalogue platform is represented exactly once in the admin status response.

Do not introduce another registry or abstraction layer.

## Task 7: Replace documentation banners with corrected content

Current defect: warning banners were added, but stale and contradictory instructions remain below them.

Fully update or remove obsolete sections in:

- `docs/README.md`
- `docs/TECH-STACK.md`
- `docs/ADMIN-PANEL-GUIDE.md`
- `docs/DOCUMENTATION-STATUS.md`

Requirements:

- Describe the current Payload/Next CMS, Astro public application, tenant-scoped settings, live content flow, migrations, and social worker accurately.
- Remove obsolete Vue/Cloudflare-admin, export-only, old version, and retired `HospitalSettings` claims.
- Ensure commands and links are executable/current.
- Update `docs/DEPLOYMENT.md`, `docs/CMS-ARCHITECTURE.md`, provider setup docs, and reviewer summary for the dedicated queue, target snapshot semantics, explicit retry, payload hash, account-selection POST, and actual provider capability matrix.
- Do not mark implementation complete while a required adapter or gate remains incomplete.

## Task 8: Repository hygiene and final verification

1. Add `*.tsbuildinfo` to the appropriate `.gitignore` and remove the untracked `cms/tsconfig.tsbuildinfo` artifact without deleting any tracked source.
2. Review every changed test for weakened assertions, skipped cases, or mocks that bypass production handlers.
3. Verify there are no dependency/lockfile changes unless explicitly required and approved.

Run in `cms`:

```powershell
node --import tsx --test tests/*.test.ts
npm run generate:types
npm run generate:importmap
npx tsc --noEmit --pretty false
npm run build
```

Run migration gates only against fresh scratch databases or verified copies:

1. Full migrate-up on a clean database.
2. Current-database-copy migrate-up with row/data invariants.
3. New remediation migrations down then up.
4. Schema snapshot comparison with collection configuration.

Run at repository root while Payload CMS is reachable on port 3001:

```powershell
npm run build
git diff --check
git status --short
```

Repository-wide proof searches must show:

- selection mutation is POST-only and one-time consumption errors are not swallowed;
- every planned provider has an explicit registered adapter and current capability outcome;
- no normal planned-platform path returns generic `not_implemented`;
- an authorized explicit retry path exists;
- every social task uses the `social-publishing` queue;
- task input carries deterministic targets;
- `payloadHash` has a production writer;
- no duplicated admin platform label map remains;
- stale architecture claims are removed rather than bannered;
- no plaintext token/secret logging, `node_modules` patch, or unplanned dependency upgrade exists.

Manual sandbox gates, without public posts:

1. Prove selection of a non-first target and concurrent replay rejection.
2. Prove explicit retry reuses one publication record.
3. Prove a queued event does not gain platforms after tenant configuration changes.
4. Prove transient retry then success and permanent no-retry through the real worker.
5. Exercise available provider sandbox request flows and honest approval/not-configured outcomes.
6. Exercise supported revocation and documented local-only behavior.

## Final report contract

Return:

1. Status of Tasks 1–8: complete, partial, or blocked.
2. Files changed, grouped by production code, migrations/generated files, tests, and docs.
3. Evidence that account selection is atomically one-time under concurrency.
4. Eight-platform capability matrix with implemented request paths, official-doc API versions/scopes, approval requirements, revocation behavior, and tested outcomes.
5. Explicit retry authorization/idempotency behavior.
6. Queue name, task input, target snapshot policy, concurrency, retry, cancellation, and worker command.
7. Payload-hash canonicalization and retry semantics.
8. Exact automated commands, counts, exit codes, migration evidence, root build result, and repository searches.
9. Manual gates executed and remaining external gates.
10. Honest blockers; do not use green unit tests to relabel partial provider work as complete.

Leave changes uncommitted and finish with: `Changes are uncommitted and ready for Codex review.`
