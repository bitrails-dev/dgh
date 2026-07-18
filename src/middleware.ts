import { defineMiddleware } from "astro:middleware";
import { resolveTenant, routeGated, type TenantFeature } from "./lib/tenant";

// Route → capability. A tenant that lacks the capability 404s the whole route subtree.
// Matches both the Arabic default (no prefix) and the English (/en) routes.
const FEATURE_ROUTES: Array<[RegExp, TenantFeature]> = [
  [/^\/(en\/)?departments(\/|$)/, "departments"],
  [/^\/(en\/)?team(\/|$)/, "team"],
  [/^\/(en\/)?doctors(\/|$)/, "team"],
  [/^\/(en\/)?articles(\/|$)/, "articles"],
  [/^\/(en\/)?events(\/|$)/, "events"],
  [/^\/(en\/)?awards(\/|$)/, "awards"],
  [/^\/(en\/)?achievements(\/|$)/, "achievements"],
  [/^\/(en\/)?testimonials(\/|$)/, "testimonials"],
  [/^\/(en\/)?portal(\/|$)/, "portal"],
  // Commerce storefront (shop, cart, checkout, account) + its same-origin BFF. Pages gate on the
  // `commerce` feature; the /api/store/* routes check storeTenantSlug() themselves (not matched here).
  [/^\/(en\/)?(shop|cart|checkout|account)(\/|$)/, "commerce"],
];

// Resolve the tenant once per request from the host (or TENANT_SLUG), expose it on
// Astro.locals.tenant, and gate feature routes. Pages/components read locals.tenant to filter
// content and hide nav/sections.
export const onRequest = defineMiddleware(async (context, next) => {
  const tenant = await resolveTenant(context.url.hostname);
  context.locals.tenant = tenant;

  const path = context.url.pathname;
  const rule = FEATURE_ROUTES.find(([re]) => re.test(path));
  if (rule && routeGated(tenant, rule[1])) {
    return context.rewrite("/404");
  }

  return next();
});
