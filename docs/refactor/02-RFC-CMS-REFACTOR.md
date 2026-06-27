# RFC — CMS & Deployment Stack Refactor

> **Status:** Draft v0.1 — decision document. Read alongside `01-PRD.md`.
> **Date:** 2026-06-18
> **Question:** Which CMS + deployment stack should this project standardize on, given the current half-built D1 implementation and the PRD requirements?
> **Format:** current state → decision criteria → candidate options → comparison → recommendation → open questions.

---

## 1. Decision to make

The project is **mid-migration** from Decap CMS (v1, `codex/`) to a custom **Vue dashboard + Cloudflare D1 + git-tracked SQLite** architecture (the D1 plan in `docs/superpowers/plans/2026-05-04-vue-dashboard-d1.md`, now partially implemented in `codex-v2/`). Before investing further in the D1 direction, we should consciously choose rather than drift.

The refactor should settle:
1. **Content store** — where content lives and is edited.
2. **Build source** — what Astro reads at build time.
3. **Dashboard** — how editors manage content.
4. **Deployment** — where the static site + any API run.
5. **Sync/publish** — how edits reach the live site.

---

## 2. Current state (as-is)

> Verified against `codex-v2/` live code (worker, wrangler.toml, GitHub Actions, package.json).

| Layer | What exists | Status |
|---|---|---|
| **Public site** | Astro 6 static + Vue 3 islands, Tailwind 3, astro-i18next (ar/en) | Working |
| **Content store (live)** | Cloudflare **D1** (SQLite) via Worker; FTS5 search on articles/doctors/news | Scaffolded — handlers present in `worker/src/handlers/` |
| **Content store (build)** | Git-tracked `data/hospital.db` SQLite file, read by `src/lib/db-loader.ts` at build | Scaffolded |
| **Dashboard** | Vue island at `/admin` calling the Worker API; Pinia store | Scaffolded (untracked files: `src/components/dashboard/`, `src/stores/dashboard.ts`, `src/app.ts`) |
| **API** | Cloudflare Worker (`worker/`): router + token auth + CRUD for all collections + sync export/import | Scaffolded |
| **Sync** | `scripts/sync-db.ts` (push/pull) + GitHub Actions `sync-db.yml` (D1 → git commit on dispatch) | Scaffolded |
| **Deployment** | Cloudflare Pages (static) + Cloudflare Workers (API) | Configured |
| **Auth** | Bearer-token (`ADMIN_TOKEN`) on all mutating endpoints | Weak — token in client bundle |
| **Tests** | None configured | Gap |

**Net:** the D1 plan is roughly 60–70% scaffolded in codex-v2. The architecture is coherent but unfinished, and the auth model is a known risk.

---

## 3. Decision criteria

Weighted against the PRD (§7 functional scope, §8 NFRs, §10 acceptance):

| Criterion | Weight | Why it matters |
|---|---|---|
| **Editor experience** (non-technical staff can publish AR/EN) | High | Editors are hospital staff, not engineers |
| **Bilingual content modeling** (AR/EN parity, not afterthought) | High | Core to the product |
| **Build reliability & speed** (<60s, deterministic) | High | Static-site workflow depends on it |
| **Operational simplicity** (few moving parts, easy to recover) | High | Small team, public institution |
| **Auth/security** (no client-side admin tokens) | High | `CONCERNS.md` flags this |
| **Cost** (free/cheap tier sufficient) | Medium | Public hospital budget |
| **Search quality** (Arabic FTS) | Medium | Articles/news/doctors need it |
| **Migration effort** (how much existing work is reusable) | Medium | Don't throw away 60% of a build lightly |
| **Portal readiness** (can the stack also serve booking/auth later) | Medium | Portal v1 is on the roadmap (§7.3) |
| **Multi-tenant optionality** (future, not now) | Low | Explicitly out of scope (PRD §9) |

---

## 4. Candidate options

### Option A — Continue D1 + Workers + Vue dashboard (finish what's started)

**Stack:** Astro static + Cloudflare D1 (live) + git-tracked SQLite (build) + Vue `/admin` dashboard + Cloudflare Worker API + GitHub Actions sync.

**Flow:** Editor → Vue dashboard → Worker → D1 → "Publish" → GH Actions exports D1 → commits `hospital.db` → Cloudflare Pages rebuilds from SQLite.

**Pros:**
- ~60–70% already built; lowest *incremental* effort.
- Git-tracked SQLite = diffable, reviewable content; small commits.
- FTS5 already wired for Arabic-capable search.
- Entirely on Cloudflare free tier.
- Worker can later serve the patient portal (auth, booking) on the same runtime.

**Cons:**
- **Custom dashboard = ongoing maintenance burden** — no community/UX polish, you own every CRUD form.
- **Auth is weak** — `ADMIN_TOKEN` in client bundle; needs Cloudflare Access or session auth bolted on.
- **Dual source of truth** (D1 live + git SQLite build) — sync is an explicit, fail-prone step.
- **D1 is young** — fewer operational tools than mature DBs; `database_id: "placeholder"` shows it's not even provisioned yet.
- **No revision history / drafts / roles** out of the box — would have to build.
- **Editors get a utilitarian table UI**, not a polished editing experience.

**Migration cost:** Low (finish), but ongoing ownership is high.

---

### Option B — Headless CMS (Sanity / Payload / Strapi) + Astro + same deployment

**Stack:** Astro static reads from a hosted headless CMS API (or exported files) at build; CMS provides the editor UI, auth, roles, drafts, i18n; static site on Cloudflare Pages; portal still on Workers.

**Sub-options:**
- **Sanity** — hosted, real-time, excellent i18n, content lake; free dev tier, usage-based prod. Strong AR support via field-level locales.
- **Payload CMS** — self-hosted (or Payload Cloud), TypeScript-native, SQLite/Postgres, local API; can run on a Worker/Node.
- **Strapi** — self-hosted, SQLite/Postgres, established; heavier.

**Pros:**
- **Editor experience is the product** — polished UI, drafts, preview, roles, revision history, scheduled publish — all built.
- **First-class bilingual modeling** (field-level or document-level locales).
- **No custom dashboard to maintain.**
- **Auth/roles solved** by the CMS.
- Astro has clean patterns for fetching from CMS APIs at build.

**Cons:**
- **Throws away the D1 dashboard + Worker CRUD work** (significant sunk cost).
- **Vendor lock-in / cost** (Sanity) or **self-hosting burden** (Payload/Strapi need a server).
- **Build-time fetch dependency** — build needs CMS API reachable; or export-to-git step reintroduced.
- **Content no longer in git by default** — loses diffability unless an export step is added.
- **Portal still needs its own backend** — CMS doesn't solve scheduling/auth.

**Migration cost:** High (rebuild content layer), but low ongoing ownership.

---

### Option C — Decap CMS (git-based) — stay on the v1 model, modernized

**Stack:** Astro static + Decap CMS (git editor UI at `/admin`) + GitHub OAuth worker + content as Markdown/JSON in git. This is what `codex/` (v1) already was.

**Pros:**
- **Content lives in git** — maximal diffability, review, rollback; no DB to operate.
- **Decap gives a free editor UI, auth, drafts, editorial workflow.**
- **Simplest ops** — static site + one OAuth worker.
- **Zero data-store to back up** — git is the backup.
- **Fast, deterministic builds** — read local files.

**Cons:**
- **This is the architecture the project deliberately moved away from** — `CONCERNS.md` documented OAuth dupes/security issues; the D1 plan was commissioned *because* Decap was found wanting.
- **Search is hard** — no FTS over markdown at build; client-side or external index needed.
- **Decap is under-maintained** (community fork territory) — risk.
- **Doesn't serve the portal** — scheduling/auth still needs a separate backend.
- **Markdown + frontmatter** is less ergonomic than structured fields for bilingual content.

**Migration cost:** Medium (revert content to markdown), but it's reversing a deliberate decision.

---

### Option D — Hybrid: Decap/git for marketing content + Workers/D1 for portal only

**Stack:** Astro static + Decap for articles/news/doctors/departments/awards/achievements (git-tracked markdown) **+** Cloudflare Worker + D1 *only* for the patient portal (accounts, scheduling, slots). Two clear domains.

**Pros:**
- **Right tool per domain** — git-content for editorial (diffable, simple) vs. operational DB for bookings (transactional, relational).
- **Eliminates the D1↔git sync dance entirely** for content — no dual source of truth.
- **Portal gets a purpose-built DB** (D1) instead of being shoehorned into the content store.
- **Lower total complexity** than Option A.
- **Keeps Cloudflare stack** for portal API.

**Cons:**
- **Still owns a custom portal backend** (unavoidable — no CMS does scheduling).
- **Two auth systems** — Decap (GitHub OAuth) + portal (NID/session).
- **Search split** — marketing content via client-side/lunr; portal via D1.
- **Reverts the marketing-content layer to markdown** (some re-migration).
- **Decap maintenance risk** (same as Option C).

**Migration cost:** Medium — restructure content to markdown, but portal work is additive (not yet built anyway).

---

## 5. Comparison matrix

Scored 1 (poor) – 5 (excellent) against the §3 criteria.

| Criterion | A: D1+Vue | B: Headless | C: Decap-only | D: Hybrid |
|---|---|---|---|---|
| Editor experience | 2 (utilitarian tables) | **5** (polished) | 3 (Decap OK) | 3 |
| Bilingual modeling | 3 (manual fields) | **5** (locales) | 2 (frontmatter) | 2/3 |
| Build reliability/speed | 3 (sync dependency) | 4 (API fetch) | **5** (local files) | **5** / 4 |
| Operational simplicity | 2 (DB + sync + worker + dashboard) | 3 (CMS vendor/host) | **5** (git only) | 3 (two systems, clear split) |
| Auth/security | 2 (client token) | **4** (CMS) | 4 (OAuth) | 4 |
| Cost | **5** (free tier) | 3 (vendor/host) | **5** (free) | **5** |
| Arabic search quality | **5** (FTS5) | 3 (varies) | 2 (client-side) | 3 |
| Migration effort (reuse) | **5** (finish) | 1 (rebuild) | 2 (revert) | 3 |
| Portal readiness | **4** (same runtime) | 3 (still need backend) | 2 | **4** |
| **Weighted total** (rough) | **~3.2** | **~3.8** | **~3.3** | **~3.6** |

> The matrix is a discussion aid, not a verdict. Weights in §3 should be adjusted by stakeholders before deciding.

---

## 6. Recommendation (draft, for discussion)

**Primary recommendation: Option D (Hybrid)** — with a strong caveat.

**Reasoning:**
- The single biggest flaw in Option A is the **dual source of truth + custom dashboard + weak auth** — three problems that don't get cheaper to fix later.
- Editorial content (articles, doctors, news, awards) is **inherently git-shaped** — diffable, reviewable, low-write-frequency. A git-based editor fits it better than a relational DB.
- The portal (scheduling, slots, accounts) is **inheritably transactional** — it needs a real DB regardless of the content decision. So D1/Workers isn't wasted; it's *re-scoped* to where it belongs.
- This eliminates the D1↔git sync step entirely for content (a real reliability win) and keeps the portal on a clean relational model.

**However — the Decap caveat is serious.** Decap's maintenance status and the documented OAuth issues that triggered the move away from it are real. Before committing to Option D, evaluate:

- **Decap fork/alternatives:** Static CMS (Decap fork), Sveltia CMS, TinaCMS (git-backed, visual editor, actively maintained, React-based), Keystatic (git-backed, Markwhen). **TinaCMS or Keystatic may deliver Option D's benefits without Decap's risks.**

**Alternative recommendation if editor experience is the top priority: Option B with Sanity** — accept the rebuild and vendor cost in exchange for a best-in-class bilingual editing UX that the hospital staff will actually use daily.

**Recommendation against: Option C (Decap-only)** — reversing a deliberate prior decision without addressing *why* it was made.

---

## 7. Migration considerations (whichever option)

Any refactor must address, from PRD §11:

1. **Content migration script** — existing markdown collections (v1) + D1 data (v2) → chosen store. The `migrate-content.ts` pattern exists.
2. **Auth hardening** — replace client-side admin token with Cloudflare Access (gateway) or session-based auth, regardless of option.
3. **Build determinism** — ensure the build does not depend on a live external service being reachable, or document the failure mode.
4. **Backup/DR** — git (content) + D1 exports (portal) → documented recovery procedure.
5. **Tests** — add a minimal test framework (none today).
6. **Refresh `.planning/codebase/`** — the codebase map is stale.
7. **Portal scope** — Option D/A keep portal viable; Option B/C require a separate portal backend decision.

---

## 8. Open questions for stakeholders

1. **Who are the editors, and how often do they publish?** If daily/multiple, editor UX (→ Option B) dominates. If weekly/rare, git-based (→ Option D) is fine.
2. **Is there budget for a hosted CMS** (Sanity/Payload Cloud), or must it be free-tier only?
3. **Is the patient portal a confirmed v1 deliverable**, or aspirational? If confirmed, portal-backend choice is co-equal with content-CMS choice.
4. **Tolerance for self-hosting** a CMS/DB (Payload/Strapi) vs. vendor-managed (Sanity) vs. git-only (Decap/Tina/Keystatic)?
5. **Arabic search depth required** — is client-side search acceptable for marketing content, or is FTS5 a hard requirement (→ favors keeping D1 for content too = Option A)?
6. **Multi-tenant future** — if likely within 2 years, does that change the calculus toward a CMS with workspace/tenant features (→ Option B)?

---

## 9. Decision & next steps

*(To be filled after stakeholder discussion.)*

- **Chosen option:** ______
- **Date decided:** ______
- **Deciders:** ______
- **Migration plan reference:** ______ (to be written as a `docs/superpowers/plans/` entry, mirroring the existing D1 plan format)
- **Revisit trigger:** ______ (e.g., "if editor adoption <X%", "if portal ships")

---

## References

- `00-DOCS-INVENTORY.md` — full source map
- `01-PRD.md` — product requirements (stack-agnostic)
- `docs/superpowers/plans/2026-05-04-vue-dashboard-d1.md` — the existing D1 plan (Option A in detail)
- `codex-v2/docs/CMS-ARCHITECTURE.md` — current architecture rationale
- `codex-v2/.planning/codebase/CONCERNS.md` — security/architecture risks (many still apply)
- `research/codex/next.portal-scheduling.mvp.md` — portal scope (drives the DB requirement)
