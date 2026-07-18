import type { APIRoute } from "astro";
import { storeTenantSlug, clearSessionToken, checkCsrf, json } from "../../../../lib/store/server";

// POST /api/store/auth/logout — stateless sessions have no server row to revoke; clear the cookie.
// (A revocation list is deferred; a short TTL bounds exposure.)
export const POST: APIRoute = async ({ locals, cookies, request }) => {
  const slug = storeTenantSlug(locals);
  if (!slug) return json({ error: "not_found" }, 404);
  if (!checkCsrf(request, cookies)) return json({ error: "bad_csrf" }, 403);
  clearSessionToken(cookies);
  return json({ ok: true });
};
