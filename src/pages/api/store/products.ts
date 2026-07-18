import type { APIRoute } from "astro";
import { storeTenantSlug, ensureCsrf, cmsFetch, json } from "../../../lib/store/server";

// GET /api/store/products?q=&limit=&page= — public catalog list. Sets the CSRF cookie on the way out
// so the first island interaction already has it.
export const GET: APIRoute = async ({ locals, cookies, url }) => {
  const slug = storeTenantSlug(locals);
  if (!slug) return json({ error: "not_found" }, 404);
  ensureCsrf(cookies);
  return cmsFetch(slug, `/products?${url.searchParams.toString()}`);
};
