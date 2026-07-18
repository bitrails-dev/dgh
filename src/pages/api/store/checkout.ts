import type { APIRoute } from "astro";
import { storeTenantSlug, ensureCartToken, getCartToken, getSessionToken, checkCsrf, rateLimit, cmsFetch, json } from "../../../lib/store/server";

// POST /api/store/checkout { items, customerEmail, paymentMethod, ... } — place the order. cartToken
// is taken from the cookie (keys the reservation); the session token (if any) is relayed so the order
// can be associated with the signed-in customer. Rate-limited per IP.
export const POST: APIRoute = async ({ locals, cookies, request, clientAddress }) => {
  const slug = storeTenantSlug(locals);
  if (!slug) return json({ error: "not_found" }, 404);
  if (!checkCsrf(request, cookies)) return json({ error: "bad_csrf" }, 403);
  if (!rateLimit(`checkout:${clientAddress ?? "anon"}`, 20, 60_000)) return json({ error: "rate_limited" }, 429);
  ensureCartToken(cookies);
  const cartToken = getCartToken(cookies)!;
  const body = await request.json().catch(() => null);
  if (!body) return json({ error: "invalid_body" }, 400);
  const headers: Record<string, string> = {};
  const session = getSessionToken(cookies);
  if (session) headers["x-session-token"] = session;
  return cmsFetch(slug, `/checkout`, { method: "POST", headers, body: JSON.stringify({ ...body, cartToken }) });
};
