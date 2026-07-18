# Payload commerce authentication and BFF architecture research

**Date:** 2026-07-18  
**Scope:** Payload CMS 3.85.1, the existing Astro storefront/Payload deployment boundary, customer authentication, tenant isolation, browser cookies, CSRF/CORS, rate limiting, and the official ecommerce plugin.

## Executive decision

Do **not** delete the Astro BFF merely because Payload has built-in authentication. Delete it only after the deployment supplies a same-origin reverse-proxy path from every storefront host to Payload and all security gates below pass.

The chosen target architecture is:

1. Keep the existing custom commerce domain modules. Do not migrate the implementation to `@payloadcms/plugin-ecommerce`.
2. Convert `customers` to a Payload auth collection and delete the custom password hashing, session signing, verification-token, reset-token, and timing-defense implementations.
3. Preserve tenant-local duplicate email addresses by disabling email login and using Payload's globally unique `username` as an internal composite login key:
   `immutableTenantNumericId + ":" + normalize(email)`.
   The browser never constructs or receives this username; a tenant-aware CMS auth adapter resolves the trusted tenant slug to its immutable ID before calling Payload Local Auth.
4. Keep Payload database-backed sessions enabled. Do not replace them with stateless JWT-only auth.
5. Expose Payload's native customer auth and custom commerce endpoints through a same-origin ingress/reverse proxy on each storefront host. Keep the Payload admin on a different hostname.
6. Move generic route/IP rate limiting to the ingress/CDN. Payload's account lockout is additional protection, not a substitute.
7. Delete the Astro BFF only after the ingress, cookie, CSRF, tenant-binding, rate-limit, and end-to-end tests are proven in a production-equivalent environment.
8. If arbitrary tenant domains cannot receive a same-origin Payload API route, keep a **thin** same-origin proxy. It may relay traffic and own the anonymous cart cookie, but it must not reimplement customer credentials, sessions, JWTs, password reset, or email verification.

This is a conditional BFF removal, not an unconditional deletion. The repository contains no production ingress configuration proving that the required topology currently exists.

## Evidence from the repository

### Installed versions

The installed packages are all exactly `3.85.1`:

- `payload`
- `@payloadcms/next`
- `@payloadcms/db-sqlite`
- `@payloadcms/plugin-multi-tenant`
- `@payloadcms/plugin-ecommerce`

The root storefront uses Astro 7 with the Node standalone adapter. See:

- `cms/package.json`
- `package.json`
- `astro.config.mjs`

Version-specific decisions in this note are based on the installed `3.85.1` source, not Payload `main` or v4 beta.

### Current application boundary

The storefront is a server-rendered Astro Node application. Its browser client calls same-origin `/api/store/*` routes. Those Astro routes:

- derive the tenant from `Astro.locals.tenant`;
- set `store_cart`, `store_session`, and `store_csrf` cookies;
- implement a double-submit CSRF check;
- implement process-local in-memory rate limiting; and
- proxy requests to Payload using `CMS_URL`.

See:

- `src/lib/store/client.ts`
- `src/lib/store/server.ts`
- `src/pages/api/store/**`
- `src/middleware.ts`

Payload is a separate Next application with custom commerce endpoints under `/api/commerce/store/:tenantSlug/*`. See:

- `cms/src/payload.config.ts`
- `cms/src/commerce/store/endpoints.ts`

The Payload config currently has no explicit `serverURL`, `cors`, `csrf`, or auth-cookie topology. The available deployment files show local composition and legacy Cloudflare OAuth infrastructure, but no production reverse proxy that maps each tenant storefront origin to Payload. Therefore direct browser-to-Payload feasibility is **not yet proven**.

### Current customer authentication

`cms/src/collections/commerce/Customers.ts` intentionally is not auth-enabled. It stores:

- custom password hash/salt;
- custom verification and reset token hashes;
- a custom `verified` flag; and
- a tenant-local `(tenant, normalizedEmail)` identity.

`cms/src/commerce/store/auth.ts` and `cms/src/commerce/crypto.ts` implement custom registration, login, stateless signed sessions, and session parsing. This duplicates capabilities that Payload can own, but the tenant-local identity requirement prevents a naive `auth: true` conversion.

## Validated Payload 3.85.1 capabilities

### Auth collections

Payload can auth-enable any collection. It then supplies login, logout, current-user, refresh, email verification, forgot-password, reset-password, lockout, auth email hooks, and Admin UI support. Multiple auth collections are supported; only the collection configured as `admin.user` signs into the Admin Panel.

Sources:

- [Payload authentication overview](https://payloadcms.com/docs/authentication/overview)
- [Payload authentication operations](https://payloadcms.com/docs/authentication/operations)
- [Payload Admin overview](https://payloadcms.com/docs/admin/overview)
- [Payload REST API auth routes](https://payloadcms.com/docs/rest-api/overview)

Decision:

- Keep `admin.user = Users.slug`.
- Auth-enable `customers` only for storefront authentication.
- Explicitly deny customers Admin access and keep collection/field access tenant-aware.

### Sessions versus stateless JWTs

In 3.85.1, `useSessions` defaults to `true`. Payload still issues a signed JWT, but the JWT contains a session identifier that is checked against session records stored on the user. This supports revoking one session or all sessions. `useSessions: false` removes that server-side revocation and uses stateless JWT authentication.

Sources:

- [Payload authentication config options](https://payloadcms.com/docs/authentication/overview)
- [Payload logout and session revocation](https://payloadcms.com/docs/authentication/operations)
- [Payload 3.85.1 JWT strategy source](https://github.com/payloadcms/payload/blob/v3.85.1/packages/payload/src/auth/strategies/jwt.ts)
- Installed source: `cms/node_modules/payload/dist/auth/baseFields/sessions.js`

Decision:

- Set `useSessions: true` explicitly.
- Use native `/login`, `/logout`, `/me`, and `/refresh-token`.
- Set `removeTokenFromResponses: true`; the storefront uses only the HTTP-only cookie.
- Do not expose or persist bearer tokens in browser JavaScript.

### Email verification and password reset

`auth.verify` and `auth.forgotPassword` provide the token lifecycle, email hooks, and REST/Local API operations. The generated email destinations are customizable. Verification requires a configured email adapter and a correct public URL.

Sources:

- [Payload authentication emails](https://payloadcms.com/docs/authentication/email)
- [Payload email overview](https://payloadcms.com/docs/email/overview)
- [Payload verification and reset operations](https://payloadcms.com/docs/authentication/operations)

Decision:

- Use Payload's existing Nodemailer adapter dependency.
- Customize verification and reset email HTML so links go to storefront pages, not the Admin Panel.
- Configure an explicit public base URL; do not rely on request inference in background or Local API operations.
- Remove the custom verification/reset token fields only after migration validation confirms that existing accounts are handled.

### Admin customer management

Auth-enabling `customers` adds the auth fields and account controls to its collection UI. Payload's default collection access is only an authenticated-user check, which is too broad for a multi-auth, multi-tenant system.

Sources:

- [Payload authentication overview](https://payloadcms.com/docs/authentication/overview)
- [Payload access control](https://payloadcms.com/docs/access-control/overview)

Decision:

- Keep `Users` as the only Admin auth collection.
- Add explicit access rules for platform admin, tenant admin, and the customer acting on its own record.
- Hide internal `username`, sessions, lockout state, verification tokens, password fields, and tenant ownership from public create/update input.
- Do not rely on Payload's default `Boolean(req.user)` access rule.

## Multi-tenant customer identity constraint

### Why plain Payload email login is unsafe

Payload's injected email field is globally unique by default. More importantly, the 3.85.1 local login operation queries only `email` or `username`; it does not add a tenant predicate before `payload.db.findOne`.

Sources:

- Installed source: `cms/node_modules/payload/dist/auth/baseFields/email.js`
- Installed source: `cms/node_modules/payload/dist/auth/operations/login.js`
- [Payload 3.85.1 login operation source](https://github.com/payloadcms/payload/blob/v3.85.1/packages/payload/src/auth/operations/login.ts)

The multi-tenant plugin adds tenant fields, Admin selection, relationship filtering, and access constraints. It does not rewrite the auth login lookup into `(tenant, email)`.

Source:

- [Payload multi-tenant plugin](https://payloadcms.com/docs/plugins/multi-tenant)

Therefore, this configuration is forbidden:

```ts
auth: true
```

while expecting the same email to log into separate tenants.

Making `email` non-unique without disabling native email login is also forbidden. Payload would perform a single email-only `findOne`, making the selected tenant/customer ambiguous.

### Selected identity model

Payload 3.85.1 supports username login. When `allowEmailLogin` is false, its auth field builder makes the email field non-unique while retaining unique username login.

Sources:

- [Payload username login](https://payloadcms.com/docs/authentication/overview#login-with-username)
- Installed source: `cms/node_modules/payload/dist/auth/getAuthFields.js`

Use:

```ts
auth: {
  loginWithUsername: {
    allowEmailLogin: false,
    requireEmail: true,
    requireUsername: true,
  },
  useSessions: true,
  removeTokenFromResponses: true,
  verify: true,
  maxLoginAttempts: 5,
  lockTime: 15 * 60 * 1000,
}
```

The internal username must be generated as:

```text
<immutable tenant numeric ID>:<normalized email>
```

Do not expose Payload's native username login directly to the browser. Keep a small **Payload custom
auth adapter endpoint** that accepts `{email, password}`, resolves the trusted route tenant slug to
the tenant record, and calls Payload's native login using the stable tenant-ID composite username.
The same server-side normalization and derivation function must be used by registration, login,
forgot-password and account lookup. The adapter may translate tenant identity only; it must not hash
passwords, sign tokens or implement sessions. The username must be unreadable through public APIs,
admin list views, logs and emails. A tenant slug change does not alter customer usernames.

### Registration requirements

Do not expose unrestricted public `POST /api/customers` with caller-controlled `tenant` or `username`.

Use one Payload custom registration endpoint that:

1. resolves the tenant from the trusted route/ingress binding;
2. checks the tenant exists and has commerce enabled;
3. normalizes email;
4. derives the composite username;
5. calls Payload create on the auth-enabled collection with `email`, `username`, `password`, safe profile fields, and the resolved tenant;
6. relies on Payload for hashing and verification token generation;
7. returns a generic response that does not expose internal auth fields; and
8. is protected by ingress rate limiting and bot controls.

Payload custom endpoints receive authenticated `req.user` and `req.payload`, but access checks and response CORS are still the application's responsibility.

Source:

- [Payload custom endpoints](https://payloadcms.com/docs/rest-api/overview#custom-endpoints)

## Cookies and browser topology

### Payload cookie behavior

Payload supports HTTP-only cookies and requires `credentials: "include"` for browser fetches. Cookie options include `secure`, `sameSite`, and `domain`.

Source:

- [Payload cookie strategy](https://payloadcms.com/docs/authentication/cookies)

The installed 3.85.1 implementation names the auth cookie `${cookiePrefix}-token`, uses path `/`, and does not provide a per-auth-collection cookie name.

Sources:

- Installed source: `cms/node_modules/payload/dist/auth/cookies.js`
- [Payload 3.85.1 cookie source](https://github.com/payloadcms/payload/blob/v3.85.1/packages/payload/src/auth/cookies.ts)

Consequence:

- Admin and customer auth cookies overwrite each other if both auth flows use the same hostname.
- The Payload Admin and storefront customer API must use different cookie hosts.

### Selected no-BFF topology

Preferred topology:

```text
Browser on tenant.example.com
  -> https://tenant.example.com/api/customers/*
  -> https://tenant.example.com/api/commerce/*
  -> ingress reverse proxy
  -> Payload Next application

Payload Admin
  -> https://cms.example.com/admin
  -> https://cms.example.com/api/users/*
```

Rules:

- Keep customer cookies host-only; do not set `Domain=.example.com`.
- Keep Admin traffic on `cms.example.com`.
- Do not expose `/admin` or admin-user auth routes on tenant storefront hosts.
- Preserve the original trusted Host and Origin through the ingress.
- Make the Payload service unreachable except through the trusted ingress or authenticated internal network.
- Route only the exact customer auth and commerce endpoint prefixes on storefront hosts.

This lets Payload set a host-only HTTP-only customer cookie through the storefront origin without third-party-cookie dependence. It also removes the need for CORS on normal storefront traffic because browser requests are same-origin.

### When direct cross-origin Payload calls are acceptable

Payload documents same-site subdomains as the preferred cross-origin cookie approach. Unrelated domains require `SameSite=None`, `Secure`, exact CORS origins, exact CSRF origins, and browser acceptance of third-party cookies.

Source:

- [Payload cross-domain cookies](https://payloadcms.com/docs/authentication/cookies#cross-domain-authentication)

Do not base the commerce launch on unrelated-domain cookies. They are less robust and add avoidable browser policy risk.

If tenant custom domains cannot proxy Payload API paths on the same origin, retain a thin Astro proxy for those deployments.

## CSRF and CORS

Payload's cookie CSRF protection is trusted-origin validation configured with `csrf`. It is not the same mechanism as the current Astro double-submit cookie.

Sources:

- [Payload CSRF configuration](https://payloadcms.com/docs/authentication/cookies#csrf-prevention)
- [Payload production abuse guidance](https://payloadcms.com/docs/production/preventing-abuse)

Payload CORS and CSRF are separate settings. Credentialed cross-origin requests require an explicit origin allowlist; wildcard CORS is not valid for the cookie topology.

Sources:

- [Payload configuration: CORS and CSRF](https://payloadcms.com/docs/configuration/overview)
- [Payload cookie strategy](https://payloadcms.com/docs/authentication/cookies)

Custom endpoint responses do not automatically add CORS headers. When an endpoint is reachable cross-origin, use Payload's `headersWithCors`.

Source:

- [Payload custom endpoint CORS](https://payloadcms.com/docs/rest-api/overview#headerswithcors)

Required configuration:

- `serverURL`: the canonical CMS URL;
- `csrf`: exact storefront origins plus the CMS origin;
- `cors.origins`: the exact same approved browser origins if cross-origin access is permitted;
- `cors.headers`: only required custom headers;
- `cookies.secure`: true in production and false only for local HTTP;
- an environment-owned, validated `STOREFRONT_ORIGINS` list.

Tenant onboarding must update the trusted-origin list and restart/redeploy Payload before enabling commerce on that tenant.

Do not use `cors: "*"`, a reflected arbitrary Origin, substring hostname checks, or an ingress that trusts a client-supplied tenant header.

## Tenant binding after BFF removal

CORS and CSRF do not establish tenant identity. Every stateful commerce request must still bind together:

- the storefront host or ingress-injected tenant identity;
- the route tenant;
- the authenticated customer's tenant;
- the cart's tenant; and
- the order's tenant.

The ingress may inject a tenant slug only if it overwrites the client header and Payload cannot be reached around the ingress.

At the application layer:

- public catalog endpoints may resolve tenant by route/host;
- registration must force the resolved tenant;
- authenticated account/order/cart endpoints must reject when `req.user.tenant` differs from the resolved tenant;
- collection access must restrict documents by both tenant and owner where applicable;
- Local API calls must use `overrideAccess: false` when enforcing caller permissions, or must include explicit equivalent constraints when running as a trusted system operation.

## Rate limiting

Payload `maxLoginAttempts`/`lockTime` is account-level failed-login lockout. Payload's official production-abuse documentation does not provide a generic per-IP or arbitrary-endpoint rate limiter.

Sources:

- [Payload production API-abuse guidance](https://payloadcms.com/docs/production/preventing-abuse)
- [Payload auth configuration](https://payloadcms.com/docs/authentication/overview)

Therefore, configure distributed ingress/CDN limits for at least:

- customer registration;
- login;
- forgot password;
- reset password;
- verification resend;
- quote;
- checkout/payment initiation;
- cart mutations; and
- order lookup.

The current Astro `Map`-based limiter is process-local and cannot be considered a production distributed limit. Delete it only after the ingress returns verified `429` responses under the intended policy.

## Official ecommerce plugin assessment

The installed `@payloadcms/plugin-ecommerce` 3.85.1 is configurable and exposes collections/operations for:

- products and variants;
- carts;
- addresses;
- customers;
- orders;
- transactions;
- currencies;
- inventory; and
- payments.

Sources:

- [Payload ecommerce plugin](https://payloadcms.com/docs/ecommerce/plugin)
- [Payload 3.85.1 ecommerce plugin source](https://github.com/payloadcms/payload/tree/v3.85.1/packages/plugin-ecommerce)

However:

- all meaningful access functions must be supplied by the application;
- the official inventory model is explicitly rudimentary: a field decremented when an order is placed, with no external inventory integrations;
- the official payment adapter is Stripe;
- Paymob and Kashier require custom adapters;
- the documented option surface does not supply the project's required multi-location reservation ledger, promotions, gift cards, tenant-specific gateways, tax engine, shipping engine, subscriptions, bookings, or B2B rules.

Sources:

- [Payload ecommerce access configuration](https://payloadcms.com/docs/ecommerce/plugin#access)
- [Payload ecommerce inventory](https://payloadcms.com/docs/ecommerce/plugin#inventory)
- [Payload ecommerce payments](https://payloadcms.com/docs/ecommerce/plugin#payments)

Decision:

- Do not replace the current commerce engine with the plugin.
- Do not run both models in parallel.
- Reuse Payload core auth, access, Admin UI, jobs, REST plumbing, and email infrastructure.
- Keep the project's order, transaction, reservation, inventory, payment-event, pricing, promotion, tax, shipping, and fulfillment domain modules.
- Reconsider the plugin only as a separate migration project if its v4 stable feature set later covers the required domain and a data migration is justified.

## BFF deletion acceptance gates

The Astro BFF may be removed only when every item is proven:

1. A production-equivalent reverse proxy exposes the required Payload routes on each storefront origin.
2. The CMS Admin remains on a separate cookie host.
3. Customer login sets only a Secure, HTTP-only, host-only cookie on the storefront host.
4. Payload sessions can be individually revoked and `logout?allSessions=true` revokes every session.
5. Customer tokens/cookies never authenticate as Admin users and Admin cookies do not overwrite storefront customer cookies.
6. `csrf` contains every enabled storefront origin and rejects an untrusted Origin.
7. CORS is exact or unnecessary because traffic is same-origin; no wildcard credentialed CORS exists.
8. The ingress overwrites tenant routing metadata and the Payload service cannot be reached around it.
9. Cross-tenant replay, tenant slug tampering, and customer ID collisions return `401`/`403` without PII.
10. Public registration cannot choose tenant, username, roles, verified state, sessions, or ownership.
11. The same normalized email can register and log in independently in two tenants.
12. Duplicate email within one tenant is rejected.
13. Email verification, forgot password, reset password, login lockout, refresh, one-session logout, and all-session logout pass end-to-end.
14. Distributed ingress rate limiting returns `429` on the configured sensitive routes.
15. Anonymous cart identity survives BFF removal through a Secure, HTTP-only, host-only cart cookie managed by Payload or the ingress.
16. All storefront catalog/cart/checkout/account/order tests pass through the final public origin, not a direct internal Payload URL.

If any gate fails, retain the thin proxy and delete only the duplicated custom auth/crypto implementation.

## Final architecture boundary

Payload should own:

- password hashing and verification;
- verification/reset token lifecycle;
- auth emails;
- account lockout;
- session records;
- JWT signing/validation;
- auth cookies;
- login/logout/me/refresh;
- Admin account controls;
- collection access enforcement; and
- custom commerce endpoint execution.

The ingress should own:

- TLS;
- host routing;
- same-origin API proxying;
- trusted tenant routing metadata;
- request-size/time limits;
- distributed IP/risk rate limiting; and
- bot/WAF controls.

The custom commerce code should own:

- tenant-aware registration adaptation;
- tenant/owner binding;
- anonymous cart identity;
- catalog/quote/checkout orchestration;
- order-scoped reservations;
- inventory movements;
- payment gateway adapters and webhooks;
- promotion/gift-card/tax/shipping/fulfillment rules; and
- idempotent recovery/reconciliation.

Astro should own presentation and browser API calls. It should not own customer password/session security once Payload auth is adopted.
