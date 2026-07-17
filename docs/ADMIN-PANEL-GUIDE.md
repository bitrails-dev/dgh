# Admin Panel User Guide

Content is authored in **Payload's own admin** at `/admin` (Next.js, served by the CMS on port 3001).
Authentication is Payload `users` with roles: **super-admin** (all tenants), **admin** (tenant-scoped),
**editor**.

## Multi-tenancy
Every content collection is scoped to a tenant via `@payloadcms/plugin-multi-tenant`. Super-admins see
the Tenant column + filter and all tenants; tenant admins see only their tenant. Per-tenant settings
(branding / hero / contact + social publishing) live on the **Tenants** collection — there is no
`HospitalSettings` global.

## Tenant types + features
`tenants.type` is a relationship to the extensible `tenant-types` collection; each type carries a
default feature template copied into a new tenant only when its `features` are omitted. A super-admin
can reset a tenant's features to its current type's template.

## Social auto-publishing
On a Tenant (when the `socialPublishing` setting group is entitled): enable the master switch, set the
default for new articles, pick included platforms, and connect each platform via OAuth. Providers that
return multiple accounts open a one-time selection page. Articles with `autoPublish` on enqueue a
durable job; the connection panel shows the last result; failed publications can be retried.

> The earlier Vue dashboard + Cloudflare Worker + `PUBLIC_ADMIN_TOKEN` admin is retired. See
> `CMS-ARCHITECTURE.md` and `superpowers/plans/2026-07-16-social-publishing-setup.md`.
