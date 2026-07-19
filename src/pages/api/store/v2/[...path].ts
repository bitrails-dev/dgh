// Wave E3 storefront gateway proxy. Same-origin /api/store/v2/* → CMS signed store endpoints.
//
// The browser (src/components/shop/api.ts) calls these routes with credentials:"include". The proxy:
//   1. resolves the tenant from Astro.locals.tenant (host-based) → 404 when missing/featureless;
//   2. maps the v2 sub-path to the CMS store sub-path (catalog↔products; reset/{request,confirm}↔
//      {forgot-password,reset-password});
//   3. signs the OUTBOUND request (X-Commerce-Gateway-* over the CMS path+method+query+body) and
//      forwards to ${CMS_URL}/api/commerce/store/:tenantSlug/*;
//   4. on auth responses, moves session/verification tokens into HttpOnly cookies and strips them
//      from the browser body (the never-done "B4 gateway pass"); reshapes catalog {products}→{items}.
//
// Pricing is authoritative at the CMS — the browser never sends totals (§3.7/§4.1).
//
// NOTE (Wave E3 continuation): the cart area is wired (Lane B) — the proxy injects the
// store_cart_v2 cookie's cartId into cart requests and plants/clears the cookie from the response
// cartId. The orders area still returns 501 `not_wired` until Lane C lands its signed orders
// endpoint + x-session-token customer bridge.

import type { APIRoute } from "astro";
import { Buffer } from "node:buffer";
import {
  storeTenantSlug,
  json,
  signedCmsFetch,
  getSessionTokenV2,
  setSessionTokenV2,
  clearSessionTokenV2,
  getCartIdV2,
  setCartIdV2,
  clearCartIdV2,
} from "../../../../lib/store/server";

type Area = "catalog-list" | "catalog-detail" | "cart" | "quote" | "checkout" | "auth" | "orders";

function mapRoute(segments: string[]): { cmsPath: string; area: Area } | null {
  const [top, a, b] = segments;
  if (top === "catalog") {
    if (!a) return { cmsPath: "/products", area: "catalog-list" };
    return { cmsPath: `/products/${encodeURIComponent(a)}`, area: "catalog-detail" };
  }
  if (top === "cart") {
    if (!a) return { cmsPath: "/cart", area: "cart" };
    if (a === "items" && !b) return { cmsPath: "/cart/items", area: "cart" };
    if (a === "items" && b) return { cmsPath: `/cart/items/${encodeURIComponent(b)}`, area: "cart" };
    return null;
  }
  if (top === "quote") return { cmsPath: "/quote", area: "quote" };
  if (top === "checkout") return { cmsPath: "/checkout", area: "checkout" };
  if (top === "auth") {
    if (a === "register" || a === "login" || a === "logout" || a === "me") return { cmsPath: `/auth/${a}`, area: "auth" };
    if (a === "reset" && b === "request") return { cmsPath: "/auth/forgot-password", area: "auth" };
    if (a === "reset" && b === "confirm") return { cmsPath: "/auth/reset-password", area: "auth" };
    return null;
  }
  if (top === "orders") {
    if (!a) return { cmsPath: "/orders", area: "orders" };
    return { cmsPath: `/orders/${encodeURIComponent(a)}`, area: "orders" };
  }
  return null;
}

async function readBodyBytes(request: Request): Promise<Buffer> {
  const ab = await request.arrayBuffer().catch(() => null);
  return ab ? Buffer.from(ab) : Buffer.alloc(0);
}

export const ALL: APIRoute = async (ctx) => {
  const { locals, cookies, request, url } = ctx;
  const slug = storeTenantSlug(locals);
  if (!slug) return json({ error: "not_found" }, 404);

  const segments = url.pathname.replace(/^\/api\/store\/v2\//, "").split("/").filter(Boolean);
  const mapped = mapRoute(segments);
  if (!mapped) return json({ error: "not_found" }, 404);

  // Wave E3 continuation — see file header. The orders CMS endpoint is still pending (Lane C).
  if (mapped.area === "orders") {
    return json({ error: "not_wired", detail: "CMS orders endpoint pending (Wave E3 continuation)" }, 501);
  }

  const method = request.method.toUpperCase();
  const hasBody = method !== "GET" && method !== "HEAD";
  const bodyBytes = hasBody ? await readBodyBytes(request) : Buffer.alloc(0);

  const headers: Record<string, string> = {};
  const session = getSessionTokenV2(cookies);
  if (session) headers["x-session-token"] = session;
  const idem = request.headers.get("idempotency-key");
  if (idem) headers["idempotency-key"] = idem;

  let cmsSub = mapped.cmsPath + (url.search || "");
  let forwardBody: Buffer = bodyBytes;

  // Cart: inject the store_cart_v2 cookie's cartId into the forwarded request (query for GET, body
  // for writes) so the signed CMS cart handler owns cart identity. The signature covers the modified
  // bytes. The response cartId plants/clears the cookie (handled below).
  if (mapped.area === "cart") {
    const cookieCartId = getCartIdV2(cookies);
    if (method === "GET") {
      if (cookieCartId) cmsSub += `${cmsSub.includes("?") ? "&" : "?"}cartId=${encodeURIComponent(cookieCartId)}`;
    } else {
      try {
        const parsed = bodyBytes.length ? JSON.parse(bodyBytes.toString("utf8")) : {};
        const merged = { ...(parsed && typeof parsed === "object" ? parsed : {}), ...(cookieCartId ? { cartId: cookieCartId } : {}) };
        forwardBody = Buffer.from(JSON.stringify(merged), "utf8");
      } catch {
        /* malformed body — forward as-is; the CMS returns 400 */
      }
    }
  }

  let res: Response;
  try {
    res = await signedCmsFetch(slug, cmsSub, {
      method,
      body: forwardBody.length ? forwardBody : undefined,
      headers,
    });
  } catch {
    return json({ error: "gateway_unavailable" }, 502);
  }

  const text = await res.text();
  const status = res.status;
  const ok = status >= 200 && status < 300;

  // Auth: move session/verification tokens into HttpOnly cookies; strip them from the browser body.
  if (mapped.area === "auth" && ok) {
    if (mapped.cmsPath === "/auth/logout") {
      clearSessionTokenV2(cookies);
    } else {
      try {
        const o = JSON.parse(text) as Record<string, unknown>;
        const tok = (o.sessionToken ?? o.token) as string | undefined;
        if (typeof tok === "string" && tok && (mapped.cmsPath === "/auth/login" || mapped.cmsPath === "/auth/register")) {
          setSessionTokenV2(cookies, tok);
          const { sessionToken: _a, token: _b, ...rest } = o;
          return json(rest, status);
        }
      } catch {
        /* non-JSON auth response — pass through */
      }
    }
  }

  // Catalog list: map {products,total} → shopApi {items,total,page}.
  if (mapped.area === "catalog-list" && ok) {
    try {
      const o = JSON.parse(text) as { products?: unknown[]; total?: number };
      return json({ items: o.products ?? [], total: o.total ?? 0, page: 1 }, status);
    } catch {
      /* fall through to pass-through */
    }
  }

  // Cart: plant/clear the store_cart_v2 cookie from the response cartId (only on success — a failed
  // write must not wipe an existing cart cookie).
  if (mapped.area === "cart" && ok) {
    try {
      const o = JSON.parse(text) as { cartId?: unknown };
      const cid = typeof o.cartId === "string" ? o.cartId : "";
      if (cid) setCartIdV2(cookies, cid);
      else clearCartIdV2(cookies);
    } catch {
      /* non-JSON cart response — pass through without touching the cookie */
    }
  }

  return new Response(text, { status, headers: { "content-type": "application/json" } });
};
