// Browser storefront client for the plugin-first commerce gateway (Wave E3).
//
// The browser talks same-origin to /api/store/v2/*. It NEVER signs requests and NEVER sends
// totals/prices — only item intent (sku + qty), promo/gift-card codes, address, and the checkout
// payload. The Astro server proxy signs every call with the commerce-gateway HMAC
// (X-Commerce-Gateway-{Key-Id,Timestamp,Nonce,Signature}) and forwards to the CMS plugin store
// endpoints at ${CMS_URL}/api/commerce/store/:tenantSlug/*, which re-price authoritatively.
// Cart identity rides the Secure HttpOnly `store_cart_v2` cookie issued by the proxy; this client
// sends credentials:"include" and otherwise stays cookie-agnostic (it never reads the cookie).
//
// Canonical home for this object is src/lib/store/client.ts (integration-owner-owned). This thin
// signing-free browser module lives under src/components/shop/ so the storefront typechecks + ships
// independently of that seam. The integration-owner may canon it into src/lib/store/client.ts and
// delete this file, updating the single import path in each shop component — no behavioural change,
// because the browser side never signs.

export type PaymentMethod = "cod" | "bank" | "paymob" | "kashier";

export interface CatalogParams {
  q?: string;
  category?: string;
  page?: number;
  limit?: number;
  locale?: "ar" | "en";
}

export interface CatalogResult {
  items: any[];
  total: number;
  page: number;
}

/** A cart line. `product` is the resolved sellable (name/images/price) when the proxy joins it. */
export interface CartItem {
  sku: string;
  quantity: number;
  product?: any;
}

/** Server-authoritative cart. `quote` carries the re-priced totals; `quoteError` is set when the
 *  server could not fully price (e.g. an item went out of stock) without failing the whole read. */
export interface Cart {
  cartId: string;
  items: CartItem[];
  quote: any | null;
  quoteError?: any;
}

export interface QuoteInput {
  promotionCodes?: string[];
  giftCardCode?: string;
  shippingMethodId?: string;
  shippingAddress?: unknown;
}

export interface AddressInput {
  fullName?: string;
  phone?: string;
  line1?: string;
  line2?: string;
  city?: string;
  governorate?: string;
  postalCode?: string;
  country?: string;
}

export interface CheckoutInput {
  cartId: string;
  paymentMethod: PaymentMethod;
  shippingAddress: unknown;
  promotionCodes?: string[];
  giftCardCode?: string;
  shippingMethodId?: string;
  idempotencyKey?: string;
  returnUrl?: string;
}

export interface CheckoutResult {
  orderNumber: string;
  amountDue: number;
  currency: string;
  paymentMethod: string;
  paymentState: string;
  checkoutUrl?: string;
  providerSessionId?: string;
  quote?: any;
}

export interface AuthRegisterInput {
  email: string;
  password: string;
  name?: string;
  phone?: string;
}
export interface AuthLoginInput {
  email: string;
  password: string;
}
export interface CustomerResult {
  customer: any;
}

/**
 * The storefront contract. The integration-owner's `src/lib/store/client.ts` `shopApi` must satisfy
 * this shape; the focused contract test (see __tests__/shopApi.contract.test.ts) pins the exact
 * same-origin request shapes (method + path + body) that the Astro proxy must serve.
 */
export interface ShopApi {
  catalog(params?: CatalogParams): Promise<CatalogResult>;
  product(slug: string, locale?: "ar" | "en"): Promise<any>;
  cart(): Promise<Cart>;
  addItem(sku: string, quantity: number): Promise<Cart>;
  /** quantity 0 removes the line. */
  updateItem(sku: string, quantity: number): Promise<Cart>;
  removeItem(sku: string): Promise<Cart>;
  clearCart(): Promise<Cart>;
  quote(input?: QuoteInput): Promise<any>;
  checkout(input: CheckoutInput): Promise<CheckoutResult>;
  auth: {
    register(p: AuthRegisterInput): Promise<CustomerResult>;
    login(p: AuthLoginInput): Promise<CustomerResult>;
    logout(): Promise<{ ok: boolean }>;
    me(): Promise<CustomerResult>;
    requestPasswordReset(email: string): Promise<{ ok: boolean }>;
    resetPassword(p: { token: string; password: string }): Promise<{ ok: boolean }>;
  };
  orders(): Promise<{ items: any[] }>;
  order(orderNumber: string): Promise<any>;
}

const BASE = "/api/store/v2";

class HttpError extends Error {
  status: number;
  body: any;
  constructor(message: string, status: number, body: any) {
    super(message);
    this.name = "ShopApiHttpError";
    this.status = status;
    this.body = body;
  }
}

async function req<T>(path: string, init: RequestInit & { idempotencyKey?: string } = {}): Promise<T> {
  const method = (init.method ?? "GET").toUpperCase();
  const headers: Record<string, string> = {
    "content-type": "application/json",
    ...((init.headers as Record<string, string> | undefined) ?? {}),
  };
  // One idempotency key per in-flight checkout attempt, echoed as a header so a retried submission
  // cannot create a duplicate order. The key is minted by the caller (CheckoutForm) and reused
  // across network retries; the proxy/CMS dedups on it.
  if (init.idempotencyKey) headers["idempotency-key"] = init.idempotencyKey;

  const res = await fetch(`${BASE}${path}`, { credentials: "include", method, headers, body: init.body });
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const message =
      (body && typeof body === "object" && "error" in body && typeof (body as any).error === "string"
        ? (body as any).error
        : `HTTP ${res.status}`) || `HTTP ${res.status}`;
    throw new HttpError(message, res.status, body);
  }
  return body as T;
}

function postBody(data: unknown): string {
  return JSON.stringify(data ?? {});
}

export const shopApi: ShopApi = {
  catalog: (params) => {
    const q = new URLSearchParams();
    if (params?.q) q.set("q", params.q);
    if (params?.category) q.set("category", params.category);
    if (typeof params?.page === "number") q.set("page", String(params.page));
    if (typeof params?.limit === "number") q.set("limit", String(params.limit));
    if (params?.locale) q.set("locale", params.locale);
    const qs = q.toString();
    return req<CatalogResult>(`/catalog${qs ? `?${qs}` : ""}`);
  },
  product: (slug, locale) => {
    const query = locale ? `?locale=${encodeURIComponent(locale)}` : "";
    return req<any>(`/catalog/${encodeURIComponent(slug)}${query}`);
  },

  cart: () => req<Cart>("/cart"),
  addItem: (sku, quantity) =>
    req<Cart>("/cart/items", { method: "POST", body: postBody({ sku, quantity }) }),
  updateItem: (sku, quantity) =>
    req<Cart>(`/cart/items/${encodeURIComponent(sku)}`, { method: "PATCH", body: postBody({ quantity }) }),
  removeItem: (sku) => req<Cart>(`/cart/items/${encodeURIComponent(sku)}`, { method: "DELETE" }),
  clearCart: () => req<Cart>("/cart", { method: "DELETE" }),

  quote: (input) => req<any>("/quote", { method: "POST", body: postBody(input ?? {}) }),

  checkout: (input) =>
    req<CheckoutResult>("/checkout", {
      method: "POST",
      body: postBody(input),
      idempotencyKey: input.idempotencyKey,
    }),

  auth: {
    register: (p) => req<CustomerResult>("/auth/register", { method: "POST", body: postBody(p) }),
    login: (p) => req<CustomerResult>("/auth/login", { method: "POST", body: postBody(p) }),
    logout: () => req<{ ok: boolean }>("/auth/logout", { method: "POST", body: "{}" }),
    me: () => req<CustomerResult>("/auth/me"),
    requestPasswordReset: (email) =>
      req<{ ok: boolean }>("/auth/reset/request", { method: "POST", body: postBody({ email }) }),
    resetPassword: (p) => req<{ ok: boolean }>("/auth/reset/confirm", { method: "POST", body: postBody(p) }),
  },

  orders: () => req<{ items: any[] }>("/orders"),
  order: (orderNumber) => req<any>(`/orders/${encodeURIComponent(orderNumber)}`),
};

export { HttpError as ShopApiHttpError };
