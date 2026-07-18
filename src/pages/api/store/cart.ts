import type { APIRoute } from "astro";
import { storeTenantSlug, ensureCsrf, ensureCartToken, getCartToken, checkCsrf, cmsFetch, json } from "../../../lib/store/server";

// GET /api/store/cart — read the cookie-scoped cart + a fresh server quote.
export const GET: APIRoute = async ({ locals, cookies }) => {
  const slug = storeTenantSlug(locals);
  if (!slug) return json({ error: "not_found" }, 404);
  ensureCsrf(cookies);
  ensureCartToken(cookies);
  const cartToken = getCartToken(cookies)!;
  return cmsFetch(slug, `/cart?cartToken=${encodeURIComponent(cartToken)}`);
};

// POST /api/store/cart { items: [{sku, quantity}] } — replace the cart's items; cartToken is taken
// from the HttpOnly cookie (never the client), and the server re-prices the lot.
export const POST: APIRoute = async ({ locals, cookies, request }) => {
  const slug = storeTenantSlug(locals);
  if (!slug) return json({ error: "not_found" }, 404);
  if (!checkCsrf(request, cookies)) return json({ error: "bad_csrf" }, 403);
  const cartToken = ensureCartToken(cookies);
  const body = await request.json().catch(() => null);
  if (!body || !Array.isArray(body.items)) return json({ error: "invalid_body" }, 400);
  return cmsFetch(slug, `/cart`, { method: "POST", body: JSON.stringify({ cartToken, items: body.items }) });
};
