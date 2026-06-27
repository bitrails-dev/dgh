# PRD — Al Noor Public Hospital Website

> **Status:** Draft v0.1 — synthesized from the prior research + product corpus (see `00-DOCS-INVENTORY.md`).
> **Date:** 2026-06-18
> **Stack-agnostic.** This document defines *what* to build and *why* — not the CMS or deployment technology. The stack decision lives in `02-RFC-CMS-REFACTOR.md`.
> **Sources:** `PRODUCT.md`, `codex/.impeccable.md`, `Hosptial-Website-Design-Research.md`, `research/GLM/*`, `research/codex/*`, `codex-v2/docs/*`.

---

## 1. Vision & Product Purpose

Al Noor Public Hospital's website is the digital front door of a **single government (public) hospital in Egypt**. It exists to bridge world-class medical infrastructure and the community it serves — a seamless, dignified gateway to healthcare for the Egyptian public.

The site is **bilingual (Arabic-first / English), mobile-first, accessibility-driven**, and must convey absolute trust to users who are often anxious, in health distress, or searching for a credible institution — frequently on mobile, frequently under stress.

> *"This is a hospital I can trust with my family's lives."* — the emotional goal for every visitor.

**Profile assumptions** (from `research/codex/next.profile.gov-single-ar.md`): single public hospital, Arabic-primary audience, government institutional tone. This shapes the IA toward the **"Community-First" + "Government Service Catalog" archetypes** rather than the US multi-location health-system patterns that dominate the research corpus.

---

## 2. Users & Jobs to Be Done

### Primary users
- **Egyptian general public** — patients, families, community members seeking healthcare services.

### Secondary users
- Job seekers, researchers, media interested in the hospital's achievements.

### Context of use
- May be anxious, in health distress, or evaluating credibility.
- Often on mobile, often under high cognitive load.
- Low-bandwidth connectivity must be assumed.

### Primary jobs to be done (ranked)
| # | Job | Research basis |
|---|---|---|
| 1 | Evaluate the hospital's credibility / trustworthiness | "Patient stories > institutional messaging" — top performers lead with outcomes |
| 2 | Find the right department or doctor | "Find a Doctor" is the #1 CTA on 100% of benchmarked sites |
| 3 | Access emergency / contact information fast | Mobile-first urgency — emergency ≤2 taps away |
| 4 | Understand services, procedures, and what to expect | Health library / A-Z conditions = 90% section frequency |
| 5 | (Portal) Create an account, verify identity, self-schedule | `next.portal-scheduling.mvp.md` scope |
| 6 | Read news, achievements, awards | Trust signals must be visual, not hidden |

---

## 3. Brand & Voice

| Attribute | Direction |
|---|---|
| **Voice** | Authoritative but warm; formal but approachable — a respected public institution, not a glossy private clinic |
| **Tone** | Calm, trustworthy, professional — competence without coldness |
| **Personality (3 words)** | Trustworthy · Warm · Dignified |
| **Emotional goal** | "This is a hospital I can trust with my family" |

### Anti-references (explicitly avoid)
- **No "startup" fluff** — playful animations, neon gradients, casual copy.
- **No sterile plainness** — the "cold clinic" look; the UI must feel human and inhabited.
- **No trendy minimalism** — excessive whitespace or ultra-thin type that compromises readability for elderly/stressed users.

### Design principles
1. **Dignified Bilingualism** — Arabic and English receive equal visual weight; Arabic typography is never an afterthought.
2. **Warm Authority** — deep navy for competence, gold/teal for humanity.
3. **Clarity over Decoration** — every element serves a functional purpose for a stressed user.
4. **Mobile-First Urgency** — emergency access and contact points are always ≤2 taps away.
5. **Legacy of Excellence** — blend the hospital's founding legacy with 2026 digital-first healthcare.
6. **Trust signals are visual** — awards, credentials, years of service displayed prominently, not buried.

---

## 4. Design System

> Grounded in `Hosptial-Website-Design-Research.md` §7 (full color/typography/photography/iconography/motion analysis of 83 sites) + `research/GLM/06_DESIGN_SYSTEM.md`.

### Color
- **Palette:** Deep **navy** primary + **white** + one warm accent (**gold** or **teal**).
- **Rationale:** Blue dominates 80%+ of hospital sites (trust/stability). Navy + gold signals "academic prestige / respected institution" (Johns Hopkins, Duke, Vanderbilt archetype). Gold/teal adds humanity vs. cold clinical blue.
- **Contrast:** WCAG 2.1 AA minimum — 4.5:1 normal text, 3:1 large text.

### Typography
- **Arabic (default):** `Reem Kufi` (display) + `IBM Plex Sans Arabic` (body).
- **English:** `Fraunces` (display) + `Inter` (body).
- **Rules:** Sans-serif for digital, 16px min body, 1.5× line height, clear H1→H6 scale.
- **Direction:** Arabic = RTL default; English = LTR. Logical CSS properties (`ms-`, `me-`, `ps-`, `pe-`) + `rtl:` variant.

### Photography
- **Authenticity is non-negotiable** — obvious stock is an "instant credibility killer."
- Real patients and providers in authentic care moments; proper consent; diverse representation.

### Iconography
- Consistent stroke-width line set — **Lucide** (already in stack) or Phosphor.

### Motion
- Subtle micro-interactions only (hover, progress, scroll-reveal).
- **No auto-playing video** (accessibility violation + performance hit).
- Must respect `prefers-reduced-motion`.

### Shape & spacing
- 8px corner radius — clinical precision + approachable.
- Generous but not excessive whitespace (avoid anti-reference #3).

### Mode
- **Light mode only** (current decision — appropriate for healthcare readability).

---

## 5. Information Architecture

> Adapted from `research/codex/blueprint.md` + `next.ia.md` + `next.ia.gov-single-ar.md` for a **single government hospital** (not the US multi-location default).

### Primary navigation (≤7 items)
1. **Find Care / Services** (الأقسام والتخصصات)
2. **Doctors** (الأطباء)
3. **Patients & Visitors** (للمرضى والزوار)
4. **Appointments** (المواعيد) — *portal entry*
5. **News & Media** (الأخبار)
6. **About** (عن المستشفى)

### Persistent utilities (header)
- **Patient Portal** login (بوابة المريض)
- **Contact / Emergency phone** (اتصل بنا / طوارئ)
- **Language switcher** (عربي / English)

### Sitemap structure (single hospital)
```
/                        (Arabic home — no prefix)
/en/                     (English home)
├── services/            (departments + service lines)
│   └── [slug]/          (department page)
├── doctors/             (provider directory)
│   └── [slug]/          (provider profile)
├── patients-visitors/   (visit prep, hours, parking, records, forms)
├── portal/              (auth-gated patient portal)
│   ├── sign-in/
│   ├── appointments/    (self-scheduling)
│   └── ...
├── news/                (news + press)
│   └── [slug]/
├── about/               (mission, leadership, achievements, awards)
└── contact/             (phone, address, form, map)
```

### IA governance rules
- Primary nav stays ≤7 items.
- No patient-critical task buried under "About."
- Any care-journey page ends with a "next step" module (Request appointment / Call / Find a doctor).
- Service taxonomy consistent across service pages, provider specialties, and (future) locations.
- Avoid >2 levels of nested navigation for patient-facing pathways.

---

## 6. Page Templates

> From `research/codex/next.page-templates.md` (Templates A–J) + research §13 layout patterns. Each page: H1 matching intent, 1 primary + 1 secondary CTA above fold, Help/Contact entry, keyboard-first, visible focus.

| # | Template | Required modules (summary) |
|---|---|---|
| A | **Homepage** | Alert bar (conditional) → Hero (static, 2 CTAs) → Top-tasks tiles (3–6) → Services entry → Doctor finder entry → Health-library entry → Trust markers → News/community → Footer |
| B | **Find Care landing** | Search w/ suggestions → Care-type tiles → Service-lines grid → Condition-library entry → "Not sure where to start?" + phone |
| C | **Service/department page** | Service hero (CTA) → Conditions treated → Treatments → Care team → Locations → What to expect → Insurance/referral → FAQs → Sticky CTA (mobile) |
| D | **Condition page** | Condition hero (urgency guidance) → Symptoms → Causes → Diagnosis → Treatments → Related services → Care team → Locations → FAQs → disclaimer |
| E | **Provider directory** | Search + typeahead → Filters (specialty, language, availability) → Sort (soonest/distance) → Result cards (photo, name, role, specialty, locations, languages) |
| F | **Provider profile** | Header (name, credentials, specialty) → Appointment options → Locations + map → Insurance → Clinical interests → Education/boards → Publications → Patient resources |
| G | **Location page** | Header (address, hours, phone) → Map + directions → Parking/transit → Services at location → Providers → Patient & visitor info → Accessibility → Policies |
| H | **Appointments hub** | Care-type routing → Request-appointment form → Phone numbers by service → Expectations (response time, required info) |
| I | **Billing & insurance hub** | Pay a bill (guest + portal) → Financial assistance → Insurance accepted → Price transparency → Billing support |
| J | **Patients & visitors hub** | Prepare for visit → Visiting policies → Parking/directions → Medical records → Forms → Amenities |

**Global template requirements:** H1 matching user intent; one primary CTA above fold; Help/Contact entry that doesn't block tasks; "last reviewed" date on logistics pages; keyboard-first; visible focus; proper heading hierarchy.

---

## 7. Functional Scope

### 7.1 Public website — MVP (must-have)

Grounded in `taxonomy.functionality.md` Standard-tier (70%+ sites) + `blueprint.md` MVP:

- [ ] **Find a Doctor / provider directory** with multi-filter search (specialty, language, availability) + plain-language understanding ("ENT" = "ear doctor" = "Otolaryngology")
- [ ] **Appointment request flow** (or self-scheduling where available — see §7.3) with phone fallback
- [ ] **Service/department pages** with structured taxonomy (specialty, conditions, visit types)
- [ ] **News + articles** (bilingual) with full-text search
- [ ] **Awards & achievements** display (trust signals)
- [ ] **Contact / emergency information** prominently, ≤2 taps from any state
- [ ] **Global site search** with type-ahead + result-type tabs
- [ ] **Bilingual AR/EN** with full RTL
- [ ] **Accessibility baseline** — WCAG 2.1 AA
- [ ] **Mobile-first responsive**
- [ ] **Schema.org structured data** (Hospital, MedicalClinic, Physician, Article)
- [ ] **Sitemap** (bilingual)

### 7.2 Public website — differentiators (roadmap)

Emerging-tier (20–70%) features to sequence after MVP:

- [ ] Care-type navigator (Emergency / Urgent / Primary / Specialty) in hero
- [ ] Patient stories with direct family quotes (near-hero)
- [ ] A-Z conditions index (SEO + trust — Mayo Clinic signature)
- [ ] Online second-opinion pathway
- [ ] Real-time appointment availability in booking
- [ ] Health library / condition pages
- [ ] Chatbot / virtual assistant for triage & FAQ routing

### 7.3 Patient Portal + Self-Scheduling (v1)

> **Major scope item** from `research/codex/next.portal-scheduling.mvp.md`. Largely unimplemented in codex-v2 today.

**v1 is scheduling-first:**
- **Account + identity verification** (non-API): user creates account → status `pending_verification` → in-person activation at reception with NID → can then self-schedule.
- **Self-scheduling**: book / reschedule / cancel, by clinic OR by doctor.
- **Appointment reference number + notifications.**
- **Clinic + doctor directories** (scheduling-driven).
- **Admin console**: define clinics, visit types, slots (provider-level + clinic-level pool), closures/holidays, assign providers to unassigned appointments, audit log.

**Confirmed v1 decisions:**
- NID required to book; **no NID verification API in v1** (in-person activation).
- Anyone can create an account.
- Minimum signup: NID, mobile, full Arabic name, DOB, gender.
- Visit types: New patient, Follow-up, Procedure, Lab, Imaging, Vaccination.
- Slot duration: 15 min (default; configurable per clinic).
- Dual calendar display: **Gregorian selection + Hijri display**.
- Numbers: **Western digits** (123).
- Dependents/guardians booking: **not in v1**.
- "Any doctor" booking: doctor assignment happens later (rotating shifts).

**Out of scope (v1):** lab results, imaging, prescriptions, secure messaging, online payments, dependents booking. HIS/EMR integration is **later** — portal is system of record now.

**Data model (minimum):** Patient, Clinic, Provider, VisitType, Slot, Appointment (with `assignment_status: unassigned/assigned`).

### 7.4 Admin / CMS (content management)

Content editors must manage (without engineering involvement):
- Articles, News (bilingual body, excerpt, category, featured, author, thumbnail)
- Doctors (name, specialty, bio, photo, role, department, sort order, featured, certified)
- Departments (name, description, icon, image, center-of-excellence, featured)
- Achievements (year, title, description, icon)
- Awards (name, awarding body, year, badge image)
- Hospital info / global settings (key-value)
- Hero stats (homepage statistics widget)

> **The CMS/deployment technology for this is the subject of the refactor — see `02-RFC-CMS-REFACTOR.md`.**

---

## 8. Non-Functional Requirements

### Performance
| Metric | Target | Basis |
|---|---|---|
| Page load (HTML) | <1s | Static asset |
| Hero weight | Lightweight, image-optimized, no heavy JS for first paint | Research §15 |
| Third-party scripts | Audited, minimal trackers | Research §15 |
| Lighthouse | Core Web Vitals green | Cloudflare monitoring |
| Build time (Astro) | <60s | Static generation |

### Accessibility
- **WCAG 2.1 AA** (minimum), AAA preferred where feasible.
- Keyboard navigation for all interactive components.
- Visible, consistent focus states.
- Skip-to-content links.
- Alt text on all images.
- No autoplay media.
- Contrast 4.5:1 (normal), 3:1 (large).
- Touch targets ≥48×48dp mobile.
- Plain language (NHS benchmark: reading age 9–11).
- VoiceOver/TalkBack compatibility; dynamic type support.

### Internationalization
- Arabic (default, RTL) + English (LTR).
- Equal visual weight; Arabic typography first-class.
- Hijri calendar display alongside Gregorian (portal).
- Western digits.

### Security
- Token/session-based admin auth (never client-only — see `CONCERNS.md`).
- HTTPS everywhere (CDN automatic).
- Parameterized queries (no SQL injection).
- Automatic escaping (XSS prevention).
- Secrets in env vars / secrets manager, never in repo or client bundles.

### SEO
- Schema.org structured data (Hospital, Physician, Article, BreadcrumbList).
- Bilingual sitemap.
- Canonical URLs.
- Portal routes `noindex`.
- Plain-language, condition-led content for search intent.

### Scalability
- Static assets: CDN-served, effectively unlimited.
- Content volume: designed for tens of thousands of articles (SQLite handles up to 281TB).
- Concurrent users: bounded by API token throughput (if portal/booking active).

---

## 9. Out of Scope (v1 / this refactor)

- **Multi-tenant / multi-hospital.** `.planning/notes/` explores a composable multi-tenant platform — that is a **future direction**, not this refactor. This project targets a single hospital.
- **Lab results, imaging, prescriptions, secure messaging, online payments** in the portal (deferred per portal MVP).
- **HIS/EMR integration** (later phase; portal is system of record in v1).
- **Dependents/guardians booking.**
- **Native mobile apps** (PWA is sufficient for v1).
- **EHR/Bahmni** (separate initiative in `hospital/EHR/`).

---

## 10. Acceptance Criteria

### UX task success (from `next.qa-and-actions.md`)
A new patient can complete these in **≤3 clicks from homepage**:
- Find a specialist doctor for a condition
- Find the nearest location offering that service *(single hospital → "the hospital")*
- Start an appointment request (or find the correct phone number)
- Access patient portal login
- Find directions + parking

### Mobile criteria
- Filters work in bottom sheet/drawer; no tiny checkboxes.
- Sticky primary CTA on long pages (service/condition/provider) — recommended.

### Editorial criteria
- A non-technical editor can create, edit, and publish an article in AR + EN without engineering help.
- A "Publish" action propagates content changes to the live site within a defined SLA.

---

## 11. Risks & Open Questions

| # | Risk / Question | Status |
|---|---|---|
| 1 | **Admin panel currently has no route-level auth** (`CONCERNS.md`) — publicly accessible static route | Must fix in refactor |
| 2 | **No NID verification API** — portal relies on in-person activation; is reception workflow realistic? | Open — confirm with hospital ops |
| 3 | **"Any doctor" booking** needs later provider assignment — staffing workflow not designed | Open |
| 4 | **Dual calendar (Gregorian + Hijri)** — library/UX choice undecided | Open |
| 5 | **Content migration** from existing markdown collections → new CMS data store | Must be addressed by refactor plan |
| 6 | **No test framework configured** (`TESTING.md`) | Should be added in refactor |
| 7 | **Stale codebase map** (`.planning/codebase/`) doesn't reflect the D1 migration | Refresh after refactor decision |
| 8 | **Single-hospital assumption** — if scope expands to multi-hospital, IA + data model must change | Acceptable for v1; flag for future |

---

## 12. Traceability — source → requirement

| Requirement | Primary source |
|---|---|
| Brand voice/personality | `PRODUCT.md`, `.impeccable.md` |
| Color/typography/photography system | `Hosptial-Website-Design-Research.md` §7 |
| IA / sitemap | `research/codex/next.ia.md`, `next.ia.gov-single-ar.md` |
| Page templates | `research/codex/next.page-templates.md` |
| Feature tiers (MVP/differentiator) | `taxonomy.functionality.md`, `blueprint.md`, research §11 |
| Portal + scheduling scope | `research/codex/next.portal-scheduling.mvp.md` |
| Accessibility / performance NFRs | `next.qa-and-actions.md`, research §15 |
| Trust-signal patterns | research §10, §15 (Trust Building) |
| Content model | `codex-v2/docs/CMS-ARCHITECTURE.md` (schema), `TECH-STACK.md` (tables) |

---

## Next

→ `02-RFC-CMS-REFACTOR.md` — evaluates current vs. candidate CMS/deployment stacks against this PRD.
