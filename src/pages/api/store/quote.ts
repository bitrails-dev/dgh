import type { APIRoute } from "astro";
import { storeTenantSlug, checkCsrf, cmsFetch, json } from "../../../lib/store/server";

// POST /api/store/quote { items: [{sku, quantity}] } — server-authoritative price preview (e.g. for
// a cart drawer). The body is forwarded verbatim; the CMS resolves all prices/tax/totals.
export const POST: APIRoute = async ({ locals, cookies, request }) => {
  const slug = storeTenantSlug(locals);
  if (!slug) return json({ error: "not_found" }, 404);
  if (!checkCsrf(request, cookies)) return json({ error: "bad_csrf" }, 403);
  const body = await request.text();
  return cmsFetch(slug, `/quote`, { method: "POST", body });
};
