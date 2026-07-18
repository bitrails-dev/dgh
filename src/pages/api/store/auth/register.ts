import type { APIRoute } from "astro";
import { storeTenantSlug, checkCsrf, rateLimit, cmsFetch, attachSession, json } from "../../../../lib/store/server";

// POST /api/store/auth/register { email, password, name?, phone? } — creates a customer, moves the
// CMS-issued session token into the HttpOnly cookie, returns the customer (never the token).
export const POST: APIRoute = async ({ locals, cookies, request, clientAddress }) => {
  const slug = storeTenantSlug(locals);
  if (!slug) return json({ error: "not_found" }, 404);
  if (!checkCsrf(request, cookies)) return json({ error: "bad_csrf" }, 403);
  if (!rateLimit(`auth:${clientAddress ?? "anon"}`, 10, 60_000)) return json({ error: "rate_limited" }, 429);
  const res = await cmsFetch(slug, `/auth/register`, { method: "POST", body: await request.text() });
  return attachSession(res, cookies);
};
