# CMS Architecture: Payload CMS (multi-tenant) + Astro (SSR)

## Overview

Content is authored in **Payload CMS** (`cms/`), and the public **Astro** site reads it **live over
REST at request/build time** — there is no markdown-export step and no git content. Payload is the
source of truth; the Astro site is its consumer. The CMS is multi-tenant: one deployment serves many
entities (e.g. a hospital, a clinic), each resolved per request.

```
Editor → Payload admin (Next.js, :3001) → SQLite (libSQL)
Astro (Node SSR, :4321) ──REST GET /api/<collection>?locale=all──→ Payload (live)
```

> Previously this project exported Payload content to `src/content/*.md` and built a static site on
> Cloudflare Pages. **That flow is retired.** `src/content/**` is legacy seed data only; the live
> source of truth is the CMS. The `scripts/{export,import}-from-content.ts` tools remain as legacy
> one-time seed helpers (they reference the retired `hospital-settings` global and are not in the
> build/runtime path).

## Multi-tenancy

- A **Tenant** is an entity (hospital, clinic, …). `Tenants` carries its identity (`name`, `slug`,
  `domains`), branding/hero/contact, `features` (gates public-site sections + admin collections),
  and `socialPublishing`.
- `Tenants.type` is a relationship to the extensible **`TenantTypes`** collection; each type carries a
  `defaultFeatures` template copied into a new tenant only when `features` is omitted.
- The `@payloadcms/plugin-multi-tenant` injects a required, indexed `tenant` field on every content
  collection. Super-admins bypass scoping; tenant admins see only their tenant. Capability access
  (`tenantFeatureAccessPlugin`) hides disabled collections from non-super users.
- The public site resolves one tenant per request by host (or `TENANT_SLUG`) in `src/lib/tenant.ts`,
  then filters content by `tenant.id` and gates the surface by `tenant.features`.

## Localization

Payload localization is enabled (`ar` default, `en` secondary, fallback on). Each concept is one
field marked `localized: true`; the Astro content layer reads `?locale=all` and normalizes `{en, ar}`
(`src/lib/tenant.ts`, `src/content.config.ts`).

## Content layer (live from Payload)

`src/content.config.ts` uses Astro's content-layer loaders (v6) — each collection (`articles`,
`doctors`, …) fetches live from `GET {CMS_URL}/api/<slug>?locale=all&depth=1` and validates with
Zod. The Astro build therefore requires the CMS to be reachable.

## Collections

Content: `doctors`, `departments`, `articles`, `events`, `awards`, `achievements`, `testimonials`,
`media`, `categories` — all tenant-scoped. `users` (auth), `tenants`, `tenant-types`, and a shared
`icons` library.

Social publishing (internal — `admin.hidden`, fully access-locked, managed only via Local API + the
OAuth endpoints): `social-connections` (encrypted per-tenant provider tokens), `social-publications`
(idempotent `[article, platform]` result rows), `social-oauth-states` (one-time OAuth state **and**
multi-account selection sessions).

There are **no globals** — `globals: []`. Per-tenant settings live on the `Tenants` collection.

## Social auto-publishing

When an Article with `autoPublish` on is created, the `queueSocialPublish` afterChange hook enqueues
one durable Payload **job** (`social-publish-article`) carrying only stable IDs `{ tenantId,
articleId }`. A worker (`payload jobs:run`, or in-process via `jobs.autoRun`) recomputes the target
platforms at run time and publishes through the adapter registry, writing idempotent
`social-publications` rows. Transient failures (429/5xx/network) retry with bounded exponential
backoff; permanent failures and explicit skips never retry. OAuth connect/callback/disconnect +
multi-account selection live under `/api/social/*`. Details + provider approvals:
`docs/superpowers/plans/2026-07-16-social-publishing-setup.md`.

## Tech stack

| Component | Technology |
|---|---|
| Public site | Astro (Node SSR, standalone adapter) + Vue islands, Tailwind, Pinia |
| CMS | Payload 3.85.1 (Next.js ~15.4) in `cms/` |
| CMS database | local libSQL — embedded `file:./cms.db` or a local `turso dev` server |
| Editor auth | Payload `users` (sessions, roles: super-admin / admin / editor) |
| Schema | versioned migrations (`cms/src/migrations`, `push: false`) |

See `CLAUDE.md` for commands and `docs/DEPLOYMENT.md` for hosting + the social-publishing worker.
