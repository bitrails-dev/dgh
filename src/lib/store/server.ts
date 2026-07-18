// Storefront BFF helpers (Astro server side). The browser talks same-origin to /api/store/*; these
// routes resolve the tenant from Astro.locals.tenant (host-based, set in middleware), own the
// cartToken + session cookies (Secure HttpOnly SameSite=Lax), enforce CSRF + rate-limit, and proxy
// to the CMS shopper endpoints at ${CMS_URL}/api/commerce/store/:tenantSlug/*. The CMS is stateless
// w.r.t. cookies — it verifies the session token we relay via X-Session-Token.
import { randomUUID } from "node:crypto";
import { hasFeature } from "../tenant";

const CMS = import.meta.env.CMS_URL ?? "http://localhost:3000";
const SECURE = import.meta.env.PROD;

const CART_COOKIE = "store_cart";
const SESSION_COOKIE = "store_session";
const CSRF_COOKIE = "store_csrf";
const SESSION_TTL = 7 * 24 * 3600; // 7 days, seconds

type Cookies = {
  get: (name: string) => { value: string | undefined } | undefined;
  set: (name: string, value: string, opts?: Record<string, unknown>) => void;
  delete: (name: string, opts?: Record<string, unknown>) => void;
};

// The resolved tenant slug for a storefront request, or null (→ 404) when no tenant resolved or it
// lacks the `commerce` feature.
export function storeTenantSlug(locals: App.Locals): string | null {
  const t = locals.tenant;
  if (!t || !hasFeature(t, "commerce")) return null;
  return t.slug;
}

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

// Forward a request to the CMS shopper endpoint and stream its JSON response back (status preserved).
export async function cmsFetch(slug: string, pathAndQuery: string, init: RequestInit = {}): Promise<Response> {
  const res = await fetch(`${CMS}/api/commerce/store/${encodeURIComponent(slug)}${pathAndQuery}`, {
    method: init.method ?? "GET",
    headers: { "content-type": "application/json", ...(init.headers as Record<string, string> | undefined) },
    body: init.body,
  });
  const text = await res.text();
  return new Response(text, { status: res.status, headers: { "content-type": "application/json" } });
}

// --- cartToken cookie (the stable anonymous id that also keys inventory reservations) ---
export function getCartToken(cookies: Cookies): string | undefined {
  return cookies.get(CART_COOKIE)?.value;
}
export function ensureCartToken(cookies: Cookies): string {
  let token = cookies.get(CART_COOKIE)?.value;
  if (!token) {
    token = randomUUID();
    cookies.set(CART_COOKIE, token, { httpOnly: true, sameSite: "lax", secure: SECURE, path: "/" });
  }
  return token;
}

// --- session cookie (the CMS-issued, HMAC-signed session token; never exposed to JS) ---
export function getSessionToken(cookies: Cookies): string | undefined {
  return cookies.get(SESSION_COOKIE)?.value;
}
export function setSessionToken(cookies: Cookies, token: string): void {
  cookies.set(SESSION_COOKIE, token, { httpOnly: true, sameSite: "lax", secure: SECURE, path: "/", maxAge: SESSION_TTL });
}
export function clearSessionToken(cookies: Cookies): void {
  cookies.delete(SESSION_COOKIE, { path: "/" });
}
// On a successful CMS auth response, move the sessionToken into the HttpOnly cookie and strip it from
// the body returned to the browser.
export async function attachSession(res: Response, cookies: Cookies): Promise<Response> {
  const text = await res.text();
  if (res.status === 200) {
    try {
      const data = JSON.parse(text);
      if (data && typeof data.sessionToken === "string") {
        setSessionToken(cookies, data.sessionToken);
        const { sessionToken: _omit, ...rest } = data;
        return json(rest, 200);
      }
    } catch {
      /* not JSON; pass through */
    }
  }
  return new Response(text, { status: res.status, headers: { "content-type": "application/json" } });
}

// --- CSRF double-submit (defense-in-depth on top of SameSite=Lax) ---
export function ensureCsrf(cookies: Cookies): string {
  let v = cookies.get(CSRF_COOKIE)?.value;
  if (!v) {
    v = randomUUID();
    // Readable (not HttpOnly) so the Vue island can echo it back as X-CSRF-Token.
    cookies.set(CSRF_COOKIE, v, { httpOnly: false, sameSite: "lax", secure: SECURE, path: "/" });
  }
  return v;
}
export function checkCsrf(request: Request, cookies: Cookies): boolean {
  const cookie = cookies.get(CSRF_COOKIE)?.value;
  const header = request.headers.get("x-csrf-token");
  return !!cookie && !!header && cookie === header;
}

// --- rate limit ---
// ponytail: in-memory token-bucket keyed by IP; correct only for the single Node standalone instance.
// If the app is ever scaled horizontally, replace `buckets` with a shared store (Redis).
const buckets = new Map<string, { count: number; reset: number }>();
export function rateLimit(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  const b = buckets.get(key);
  if (!b || now > b.reset) {
    buckets.set(key, { count: 1, reset: now + windowMs });
    return true;
  }
  if (b.count >= limit) return false;
  b.count += 1;
  return true;
}
