# Docs Inventory — Prior Plans & Source Material

> Purpose: a single map of every document that carries intent for this project, so the CMS/deployment refactor is grounded in the full prior record — not just what's in `codex-v2/`.
> Scope: `hospital/` parent tree (siblings + research + codex-v2 itself).
> Compiled: 2026-06-18

All paths below are **relative to `hospital/`** unless prefixed `codex-v2/`.

---

## How to use this map

- **Refactoring the CMS/deployment stack?** Start with **Section 3** (the active plan + current docs), then **Section 4** (sibling implementations as comparison).
- **Writing/refining the PRD?** Section 1 (product vision) + Section 2 (research corpus).
- **Want the quick big picture?** Read the one-liners; skip the "use for" tags until you need depth.

---

## Legend

`[STABLE]` — reusable as-is across any stack decision.
`[SCOPE]` — defines *what* to build (requirements), not *how* (stack).
`[AS-IS]` — describes the current/in-progress implementation.
`[STALE]` — describes an older architecture; superseded but useful for history.
`[REF]` — reference/inspiration only.

---

## 1. Product Vision & Brand (STABLE)

| Path | What it is | Use for |
|---|---|---|
| `codex-v2/PRODUCT.md` | Register (brand), users, purpose, brand personality (Trustworthy · Warm · Dignified), design principles, anti-references, accessibility targets | **PRD §product, §brand, §principles** |
| `codex/.impeccable.md` | Earlier design-context doc (near-duplicate of PRODUCT.md) **plus** aesthetic direction: navy authority + warm gold, light-mode-only, anti-references | **PRD §aesthetics** — has detail PRODUCT.md lacks |

---

## 2. Design Research Corpus (SCOPE + REF)

The evidence base behind every design/feature decision. Commissioned April 2026; 142+ hospital websites benchmarked across 25+ sources.

### 2a. Synthesis & design system

| Path | What it is | Use for |
|---|---|---|
| `research/GLM/00_INTENT.md` | Why the research exists; seed prompt (Kanopi "22 sites"); how to use the corpus | **Context** — read first |
| `research/GLM/00_INDEX.md` | Navigation + key findings (section taxonomy, functionality matrix, 6 archetypes, color dominance, trends) | **PRD §features, §design-system** |
| `research/GLM/01_MASTER_WEBSITE_LIST.md` | Full 142+ site catalog | REF |
| `research/GLM/02_SITE_ANALYSIS.md` | 20+ deep per-site analyses | REF — page-type design |
| `research/GLM/03_CROSS_SITE_SYNTHESIS.md` | Patterns, benchmarks, trends, layout library | **PRD §features, §benchmarks** |
| `research/GLM/04_DESIGN_REFERENCE.md` | Actionable specs: nav structure, 22 page templates, colors, typography, components, accessibility, performance | **PRD §IA, §design-system, §NFRs** |
| `research/GLM/05_SUPPLEMENTARY_DATA.md` | Raw award/site inventories | REF |
| `research/GLM/06_DESIGN_SYSTEM.md` | Design system tokens | **PRD §design-system** |
| `Hosptial-Website-Design-Research.md` *(sic)* | **Top-level consolidated research (69KB, 83 sites, 81 sources).** Site inventory + per-site teardowns + functionality deep-dive (booking/portal/AI/maps/billing) + full color/typography/photography/iconography/motion design system + awards/benchmarks + mobile + 25-row section frequency table + functionality matrix + 8 style archetypes + 9 layout patterns + nav patterns + 42 UX best practices + anti-patterns + design recommendations | **PRD §features, §design-system, §NFRs, §benchmarks** — single richest source |

### 2b. Actionable specs (codex research set)

| Path | What it is | Use for |
|---|---|---|
| `research/codex/blueprint.md` | Recommended nav (7 items), homepage layout (10 blocks), MVP features, 5 key page templates | **PRD §IA, §homepage, §MVP** |
| `research/codex/next.ia.md` | Full sitemap (Find Care / Doctors / Locations / Patients & Visitors / Appointments / Billing / About) + IA governance rules | **PRD §IA** |
| `research/codex/next.page-templates.md` | 10 page templates (A–J) with required modules + ordering | **PRD §page-templates** |
| `research/codex/taxonomy.sections.md` | 30 homepage section types, ranked by frequency | **PRD §homepage** |
| `research/codex/taxonomy.functionality.md` | 33 features classified Standard/Emerging/Rare with implementation notes | **PRD §features, §roadmap** |
| `research/codex/themes-archetypes.md` | 12 design "character" archetypes with example sites | **PRD §design-direction** |
| `research/codex/patterns.best-vs-anti.md` | Best patterns + anti-patterns (copy / avoid) | **PRD §principles** |
| `research/codex/next.qa-and-actions.md` | UX acceptance criteria, mobile/accessibility/perf baselines, next actions | **PRD §NFRs, §acceptance** |

### 2c. Portal & scheduling scope (MAJOR — often overlooked)

| Path | What it is | Use for |
|---|---|---|
| `research/codex/next.portal-scheduling.mvp.md` | **Patient portal + self-scheduling v1 spec**: NID accounts, in-person verification, booking by clinic/doctor, slot model, visit types, dual calendar (Gregorian+Hijri), admin console, data model | **PRD §portal-scope** — biggest unimplemented feature |
| `research/codex/next.portal-scheduling.open-questions.md` | Open questions on portal | **PRD §portal-open-questions** |
| `research/codex/next.i18n-rtl.ar-first.md` | Arabic-first / RTL strategy | **PRD §i18n** |
| `research/codex/next.ia.gov-single-ar.md` | Government-single-hospital Arabic IA profile | **PRD §IA-profile** |
| `research/codex/next.profile.gov-single-ar.md` | Profile assumptions for a single government hospital | **PRD §target-profile** |
| `research/codex/next.component-inventory.md` | Component inventory | **PRD §components** |
| `research/codex/kanopi-22.notes.md` | Notes on the Kanopi seed list | REF |

### 2d. Teardowns & external reference (REF)

| Path | What it is |
|---|---|
| `research/minimax/` (~40 files) | Site teardowns (Cleveland Clinic, Mayo, Stanford, Johns Hopkins, international: Bumrungrad, Charité, NHS, etc.) + `synthesis/` reports + `TOOLS/` (content-strategy-guide, design-brief-generator, dev-estimation-guide, performance-seo-benchmarks) |
| `research/codex/sites.csv` / `sites.md` | Machine + human-readable reference site list |
| `research/codex/sources.md` | Discovery sources |

---

## 3. CMS/Deployment Architecture (AS-IS + the refactor target)

This is the heart of the refactor. Two records matter: the **active implementation plan**, and the **current-state docs** describing what got built.

### 3a. The active plan (the refactor's starting point)

| Path | What it is | Use for |
|---|---|---|
| `docs/superpowers/plans/2026-05-04-vue-dashboard-d1.md` | **THE key document.** 15-task, 2672-line plan to replace Decap CMS with **Vue dashboard + Cloudflare D1 + git-tracked SQLite**. Full D1 schema (FTS5), Worker router/auth/CRUD, build-time `db-loader.ts`, sync scripts, Vue dashboard components, GitHub Actions sync workflow, design decisions | **RFC §current-state, §candidate-stack** — this *is* the current direction, partially implemented |

### 3b. Current-state docs in codex-v2 (AS-IS)

| Path | What it is | Use for |
|---|---|---|
| `codex-v2/docs/CMS-ARCHITECTURE.md` | Why SQLite-not-hybrid, DB schema, content flow | **RFC §current-state** |
| `codex-v2/docs/TECH-STACK.md` | Full stack audit (deps, DB tables, performance targets, scalability, future upgrades) | **RFC §current-state, §NFRs** |
| `codex-v2/docs/DEPLOYMENT.md` | Cloudflare Pages + Workers deploy steps, env vars, security, rollback | **RFC §current-deployment** |
| `codex-v2/docs/ADMIN-PANEL-GUIDE.md` | Admin panel usage guide | REF |
| `codex-v2/docs/DOCUMENTATION-STATUS.md` | Doc currency status | REF |
| `codex-v2/README.md` | Setup, architecture diagram, API endpoints, content export workflow | **RFC §current-state** |
| `codex-v2/astro.config.mjs` | Live Astro config (static output, ar/en i18n, integrations) | **RFC §current-state** |
| `codex-v2/package.json` | Live dependencies | **RFC §current-state** |

### 3c. AI-generated codebase map (STALE — describes older Decap/portal arch)

| Path | What it is | Use for |
|---|---|---|
| `codex-v2/.planning/codebase/ARCHITECTURE.md` | System overview, layouts, routing, data flow, component groups — **but documents Decap CMS + patient portal, not the new D1 dashboard** | History only — needs refresh |
| `codex-v2/.planning/codebase/STRUCTURE.md` | File map (older) | History |
| `codex-v2/.planning/codebase/STACK.md` | Stack audit (older) | History |
| `codex-v2/.planning/codebase/CONVENTIONS.md` | Code idioms | Partially reusable |
| `codex-v2/.planning/codebase/CONCERNS.md` | Severity-ranked issues (admin auth, OAuth dupes, hardcoded Formspree, missing .env.example) | **RFC §current-state-risks** — many still apply |
| `codex-v2/.planning/codebase/INTEGRATIONS.md` | External integrations | History |
| `codex-v2/.planning/codebase/TESTING.md` | Test strategy (none configured) | **RFC §current-state-risks** |

### 3d. Design prompts & notes

| Path | What it is | Use for |
|---|---|---|
| `codex-v2/.planning/notes/2026-05-01-design-prompt-composable-multitenant.md` | Meta-prompt for AI-driven multi-tenant static-platform design discussion | **RFC §future-direction** (multi-tenant) |
| `codex-v2/.planning/notes/2026-05-01-multi-theme-vue-cloudflare-features.md` | Requirements + recs: multi-theme, Vue dashboard, Cloudflare Workers + SQLite | **RFC §candidate-stack** |

---

## 4. Sibling Implementations (REF — comparison points)

Three parallel builds of the same product exist in `hospital/`. Each is a full Astro+Vue implementation; the D1 plan in §3a explicitly targets `claude/`. Useful as reference when evaluating alternative stacks.

| Path | What it is | Notable |
|---|---|---|
| `codex/` (v1) | Decap CMS + Cloudflare Pages + OAuth worker (`cloudflare/oauth-worker/`) | The architecture being replaced; `CONCERNS.md` flags its OAuth issues |
| `claude/` | Full Astro+Vue impl; **target of the D1 plan** | Likely furthest along on the new direction |
| `gemini/` | Full Astro+Vue impl | Alternate take |
| `ehr_architecture_roadmap.html` | EHR/EMR architecture roadmap (77KB) | **Separate initiative** (out of scope for website refactor, but related) |
| `EHR/`, `bahmni-docker/` | EHR/EMR + Bahmni docker | Separate initiative |
| `Damietta General Hospital-handoff.zip` | Handoff archive | REF |
| `damietta-general-hospital/` | Decompressed handoff | REF |

---

## 5. Tooling / AI workflow config (context only)

| Path | What it is |
|---|---|
| `codex-v2/.claude/` | Claude Code config (launch.json, permissions) — confirms AI-assisted dev |
| `codex-v2/dev.log` | Dev server log snippet |
| `codex-v2/.env.example` | Env var template (worker URL, admin token) |

---

## Coverage check — what the corpus does *not* contain

These gaps should be filled as part of the refactor planning (candidates for the PRD/RFC):

1. **No formal PRD** — `PRODUCT.md` is brand-level only; functional requirements are scattered across the research files. *(→ addressed by `01-PRD.md`)*
2. **No RFC/ADR for the CMS stack choice** — the D1 plan asserts the stack but doesn't compare alternatives. *(→ addressed by `02-RFC-CMS-REFACTOR.md`)*
3. **No roadmap** with milestones/phases — plans exist per-feature but not sequenced across the whole project.
4. **No test strategy in code** — `TESTING.md` notes none is configured.
5. **Stale codebase map** — `.planning/codebase/` predates the D1 migration; doesn't reflect `codex-v2/` today.
6. **Portal scope unimplemented** — `next.portal-scheduling.mvp.md` defines a v1 portal, but codex-v2 has no portal code yet.

---

## Suggested reading order for the refactor

1. This inventory (`00-DOCS-INVENTORY.md`)
2. `01-PRD.md` — product + scope (stack-agnostic)
3. `02-RFC-CMS-REFACTOR.md` — current vs. candidate stacks
4. `docs/superpowers/plans/2026-05-04-vue-dashboard-d1.md` — the existing D1 plan (deep detail)
5. `codex-v2/docs/CMS-ARCHITECTURE.md` + `TECH-STACK.md` — what's built today
