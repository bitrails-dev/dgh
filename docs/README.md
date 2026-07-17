# Documentation Index

The project is a **multi-tenant Payload CMS** (Next.js, SQLite) whose content a bilingual **Astro SSR**
public site reads **live over REST**. Arabic-default, RTL-first, with a patient portal.

## Start here
- `../CLAUDE.md` — repo overview, stack, commands, conventions (the canonical quick reference).
- `CMS-ARCHITECTURE.md` — CMS ↔ Astro data flow, multi-tenancy, collections, social publishing.
- `DEPLOYMENT.md` — hosting, migrations, the social-publishing worker, rollback.
- `superpowers/plans/2026-07-16-reviewer-summary.md` — current implementation status + open gates.

## Agent / process docs
- `agents/issue-tracker.md`, `agents/triage-labels.md`, `agents/domain.md` — issue + triage workflow.
- `superpowers/plans/` — design plans + execution handoffs (tenant types, features, social publishing).

> A prior version built a static Astro site on Cloudflare Pages from exported markdown with a
> Cloudflare Worker API. That flow is **retired** — the live source of truth is the Payload CMS.
