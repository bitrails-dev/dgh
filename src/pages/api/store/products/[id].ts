import type { APIRoute } from "astro";
import { storeTenantSlug, ensureCsrf, cmsFetch, json } from "../../../../lib/store/server";

// GET /api/store/products/:id — public catalog detail (:id may be an id or slug).
export const GET: APIRoute = async ({ locals, cookies, params }) => {
  const slug = storeTenantSlug(locals);
  if (!slug) return json({ error: "not_found" }, 404);
  const id = params.id;
  if (!id) return json({ error: "missing_id" }, 400);
  ensureCsrf(cookies);
  return cmsFetch(slug, `/products/${encodeURIComponent(id)}`);
};
