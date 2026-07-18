// Storefront API client for Vue islands. Same-origin /api/store/*; credentials:include carries the
// Secure HttpOnly cartToken + session cookies automatically. The CSRF token is read from the readable
// store_csrf cookie and echoed as X-CSRF-Token on every mutating call. Prices/totals are never sent
// from the client — only item intent (sku + quantity); the server re-prices on every call.
export type StoreItem = { sku: string; quantity: number };

function csrfToken(): string {
  if (typeof document === "undefined") return "";
  const m = document.cookie.match(/(?:^|;\s*)store_csrf=([^;]+)/);
  return m ? decodeURIComponent(m[1]) : "";
}

async function req<T>(path: string, init: RequestInit = {}): Promise<T> {
  const method = (init.method ?? "GET").toUpperCase();
  const headers: Record<string, string> = {
    "content-type": "application/json",
    ...((init.headers as Record<string, string>) ?? {}),
  };
  if (method !== "GET") headers["x-csrf-token"] = csrfToken();
  const res = await fetch(`/api/store${path}`, { credentials: "include", ...init, headers });
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const err: any = new Error(body?.error || `HTTP ${res.status}`);
    err.status = res.status;
    err.body = body;
    throw err;
  }
  return body as T;
}

export const storeApi = {
  products: (q?: string) => req<{ products: any[]; total: number }>(`/products${q ? `?q=${encodeURIComponent(q)}` : ""}`),
  product: (id: string) => req<{ product: any } | any>(`/products/${encodeURIComponent(id)}`),
  cart: () => req<{ cartToken?: string; items: StoreItem[]; quote: any | null; quoteError?: any }>(`/cart`),
  updateCart: (items: StoreItem[]) =>
    req<{ items: StoreItem[]; quote: any | null; quoteError?: any }>(`/cart`, { method: "POST", body: JSON.stringify({ items }) }),
  quote: (items: StoreItem[]) => req<any>(`/quote`, { method: "POST", body: JSON.stringify({ items }) }),
  checkout: (payload: {
    items: StoreItem[];
    customerEmail: string;
    customerPhone?: string;
    paymentMethod: "cod" | "bank" | "paymob" | "kashier";
    shippingAddress?: unknown;
    billingAddress?: unknown;
    returnUrl?: string;
    locationId?: string;
    idempotencyKey?: string;
  }) =>
    req<any>(`/checkout`, {
      method: "POST",
      body: JSON.stringify(payload),
      headers: payload.idempotencyKey ? { "idempotency-key": payload.idempotencyKey } : undefined,
    }),
  register: (payload: { email: string; password: string; name?: string; phone?: string }) =>
    req<{ customer: any; expiresIn?: number }>(`/auth/register`, { method: "POST", body: JSON.stringify(payload) }),
  login: (payload: { email: string; password: string }) =>
    req<{ customer: any; expiresIn?: number }>(`/auth/login`, { method: "POST", body: JSON.stringify(payload) }),
  logout: () => req<{ ok: boolean }>(`/auth/logout`, { method: "POST", body: "{}" }),
  me: () => req<{ customer: any }>(`/auth/me`),
};
