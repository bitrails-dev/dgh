import type { APIRoute } from "astro";
import { storeTenantSlug, getSessionToken, cmsFetch, json } from "../../../../lib/store/server";

// GET /api/store/auth/me — relay the session token to the CMS for verification; 401 if absent/invalid.
export const GET: APIRoute = async ({ locals, cookies }) => {
  const slug = storeTenantSlug(locals);
  if (!slug) return json({ error: "not_found" }, 404);
  const session = getSessionToken(cookies);
  if (!session) return json({ error: "no_session" }, 401);
  return cmsFetch(slug, `/auth/me`, { headers: { "x-session-token": session } });
};
