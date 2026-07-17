# Documentation Status

**Authoritative and current:**
- `../CLAUDE.md` — repo overview.
- `CMS-ARCHITECTURE.md` — architecture.
- `DEPLOYMENT.md` — deployment + operations.
- `superpowers/plans/2026-07-16-reviewer-summary.md` — implementation status + open gates.
- `superpowers/plans/2026-07-16-social-publishing-setup.md` — provider setup runbook.
- `superpowers/plans/2026-07-16-remediation-review-round-2.md` — the round-2 remediation scope.

The Cloudflare Pages / Workers / export-to-markdown / `HospitalSettings`-global architecture described
in older revisions is **retired**. The system is a multi-tenant Payload CMS read live by an Astro SSR
site; settings are tenant-scoped on the `Tenants` collection.
