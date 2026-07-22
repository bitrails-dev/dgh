// Storefront BFF helpers (Astro server side). The browser talks same-origin to /api/store/*; these
// routes resolve the tenant from Astro.locals.tenant (host-based, set in middleware), own the
// cartToken + session cookies (Secure HttpOnly SameSite=Lax), enforce CSRF + rate-limit, and proxy
// to the CMS shopper endpoints at ${CMS_URL}/api/commerce/store/:tenantSlug/*. The CMS is stateless
// w.r.t. cookies — it verifies the session token we relay via X-Session-Token.
import { randomUUID } from "node:crypto";
import { Buffer } from "node:buffer";
import { hasFeature } from "../tenant";
import { sign } from "./gateway-sign";

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

// --- Wave E3: signed gateway proxy (plugin-first store-carts, cookie `store_cart_v2`) -----------
// The browser (src/components/shop/api.ts) talks same-origin /api/store/v2/* with credentials:"include".
// These helpers back the proxy routes (src/pages/api/store/v2/*): the cart id (store-carts doc id)
// lives in the Secure HttpOnly `store_cart_v2` cookie; the session token lives in `store_session_v2`.
// Browser code never sees either cookie directly.

const CART_COOKIE_V2 = "store_cart_v2";
const SESSION_COOKIE_V2 = "store_session_v2";

export function getCartIdV2(cookies: Cookies): string | undefined {
  return cookies.get(CART_COOKIE_V2)?.value;
}
export function setCartIdV2(cookies: Cookies, cartId: string): void {
  cookies.set(CART_COOKIE_V2, cartId, { httpOnly: true, sameSite: "lax", secure: SECURE, path: "/" });
}
export function clearCartIdV2(cookies: Cookies): void {
  cookies.delete(CART_COOKIE_V2, { path: "/" });
}
export function getSessionTokenV2(cookies: Cookies): string | undefined {
  return cookies.get(SESSION_COOKIE_V2)?.value;
}
export function setSessionTokenV2(cookies: Cookies, token: string): void {
  cookies.set(SESSION_COOKIE_V2, token, { httpOnly: true, sameSite: "lax", secure: SECURE, path: "/", maxAge: SESSION_TTL });
}
export function clearSessionTokenV2(cookies: Cookies): void {
  cookies.delete(SESSION_COOKIE_V2, { path: "/" });
}

// Resolve the CURRENT gateway key from Astro server env. These are server-only (not PUBLIC_), so the
// secret never reaches the browser. Throws when unconfigured → proxy returns 502 gateway_unavailable.
function gatewayKey(): { keyId: string; secret: Uint8Array } {
  const keyId = import.meta.env.COMMERCE_GATEWAY_KEY_ID;
  const secretB64 = import.meta.env.COMMERCE_GATEWAY_SECRET;
  if (!keyId || !secretB64) throw new Error("COMMERCE_GATEWAY_KEY_ID/SECRET not configured");
  // NM16: mirror the CMS-side minimum (commerce/gateway/keys.ts). Buffer.from(..., 'base64') never
  // throws — it just decodes what it can — so an undersized / garbage secret must be rejected here.
  const buf = Buffer.from(secretB64, "base64");
  if (buf.length < 32) throw new Error("COMMERCE_GATEWAY_SECRET must decode to >= 32 bytes");
  return { keyId, secret: new Uint8Array(buf) };
}

// Sign + forward a request to the CMS signed store endpoint, returning the raw CMS Response. The
// signature is over the CMS path+method+query+body (the exact bytes the verifier hashes). `slug` is
// the resolved tenant slug (lowercased for the canonical tenant field).
export async function signedCmsFetch(
  slug: string,
  cmsSubPathAndQuery: string,
  init: { method?: string; body?: Uint8Array | Buffer; headers?: Record<string, string> } = {},
): Promise<Response> {
  const method = (init.method ?? "GET").toUpperCase();
  const fullPath = `/api/commerce/store/${encodeURIComponent(slug)}${cmsSubPathAndQuery}`;
  const [purePath, query] = splitPath(fullPath);
  const bodyBytes = init.body && (init.body as Uint8Array).byteLength > 0 ? Buffer.from(init.body as Uint8Array) : Buffer.alloc(0);
  const { keyId, secret } = gatewayKey();
  const signed = sign({
    method,
    path: purePath,
    query: query ?? null,
    tenantSlug: slug,
    body: bodyBytes,
    now: Date.now(),
    keyId,
    secret,
  });
  return fetch(`${CMS}${fullPath}`, {
    method,
    headers: { "content-type": "application/json", ...(init.headers ?? {}), ...signed.headers },
    body: method === "GET" || method === "HEAD" ? undefined : bodyBytes,
  });
}

function splitPath(p: string): [string, string | undefined] {
  const i = p.indexOf("?");
  return i === -1 ? [p, undefined] : [p.slice(0, i), p.slice(i + 1)];
}
