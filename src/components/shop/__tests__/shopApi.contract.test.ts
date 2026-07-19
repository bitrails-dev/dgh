// Focused contract test (Wave E3). Zero-dependency (no vitest / node:test / @types/node required):
// it stubs globalThis.fetch, invokes each shopApi method, and asserts the EXACT same-origin request
// shape (method + path + body + idempotency header) that the Astro gateway proxy must serve.
//
// Run with any TS runner, e.g.:
//   cms/node_modules/.bin/tsx src/components/shop/__tests__/shopApi.contract.test.ts
// It also typechecks as part of the project (tsc --noEmit), which constrains the integration-owner's
// shopApi impl to the same wire shapes.
import { shopApi } from "../api";

interface Captured {
  url: string;
  method: string;
  body: string | null;
  headers: Record<string, string>;
}
let calls: Captured[] = [];
function installFetch(): void {
  calls = [];
  (globalThis as unknown as { fetch: unknown }).fetch = (url: string, init: RequestInit = {}) => {
    const rawHeaders = (init.headers as Record<string, string> | undefined) ?? {};
    const headers: Record<string, string> = {};
    for (const k of Object.keys(rawHeaders)) headers[k.toLowerCase()] = String(rawHeaders[k]);
    calls.push({
      url: String(url),
      method: String(init.method ?? "GET").toUpperCase(),
      body: typeof init.body === "string" ? init.body : null,
      headers,
    });
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ ok: true }) } as Response);
  };
}
const last = (): Captured => calls[calls.length - 1];
const bodyOf = (c: Captured): any => (c.body ? JSON.parse(c.body) : {});

const results: { name: string; ok: boolean; detail?: string }[] = [];
function check(name: string, fn: () => void): void {
  try {
    fn();
    results.push({ name, ok: true });
  } catch (e: any) {
    results.push({ name, ok: false, detail: e?.message ?? String(e) });
  }
}
function assert(cond: any, msg: string): void {
  if (!cond) throw new Error(msg);
}

async function main(): Promise<void> {
  installFetch();
  await shopApi.catalog();
  check("catalog() → GET /api/store/v2/catalog", () => {
    assert(last().method === "GET", "method");
    assert(last().url === "/api/store/v2/catalog", `url was ${last().url}`);
  });

  installFetch();
  await shopApi.catalog({ q: "mask", category: "med", page: 2, limit: 5 });
  check("catalog(params) → GET with query string", () => {
    const u = last().url;
    assert(u.startsWith("/api/store/v2/catalog?"), `url was ${u}`);
    assert(u.includes("q=mask"), "q");
    assert(u.includes("category=med"), "category");
    assert(u.includes("page=2"), "page");
    assert(u.includes("limit=5"), "limit");
  });

  installFetch();
  await shopApi.product("a b");
  check("product(slug) → GET /catalog/:slug (encoded)", () => {
    assert(last().method === "GET", "method");
    assert(last().url === "/api/store/v2/catalog/a%20b", `url was ${last().url}`);
  });

  installFetch();
  await shopApi.cart();
  check("cart() → GET /cart", () => {
    assert(last().method === "GET" && last().url === "/api/store/v2/cart", `url ${last().url}`);
  });

  installFetch();
  await shopApi.addItem("SKU-1", 2);
  check("addItem(sku,qty) → POST /cart/items {sku,quantity}", () => {
    const c = last();
    assert(c.method === "POST" && c.url === "/api/store/v2/cart/items", `url ${c.url}`);
    const b = bodyOf(c);
    assert(b.sku === "SKU-1" && b.quantity === 2, `body ${JSON.stringify(b)}`);
  });

  installFetch();
  await shopApi.updateItem("SKU-1", 3);
  check("updateItem(sku,qty) → PATCH /cart/items/:sku {quantity}", () => {
    const c = last();
    assert(c.method === "PATCH" && c.url === "/api/store/v2/cart/items/SKU-1", `url ${c.url}`);
    assert(bodyOf(c).quantity === 3, "qty 3");
  });

  installFetch();
  await shopApi.updateItem("SKU-1", 0);
  check("updateItem zero quantity PATCHes through (server removes)", () => {
    assert(bodyOf(last()).quantity === 0, "qty 0 passed through");
  });

  installFetch();
  await shopApi.removeItem("SKU-1");
  check("removeItem(sku) → DELETE /cart/items/:sku", () => {
    const c = last();
    assert(c.method === "DELETE" && c.url === "/api/store/v2/cart/items/SKU-1", `url ${c.url}`);
  });

  installFetch();
  await shopApi.clearCart();
  check("clearCart() → DELETE /cart", () => {
    const c = last();
    assert(c.method === "DELETE" && c.url === "/api/store/v2/cart", `url ${c.url}`);
  });

  installFetch();
  await shopApi.quote({ promotionCodes: ["P10"], giftCardCode: "GC", shippingMethodId: "sm", shippingAddress: { city: "Cairo" } });
  check("quote(input) → POST /quote with codes/address", () => {
    const c = last();
    assert(c.method === "POST" && c.url === "/api/store/v2/quote", `url ${c.url}`);
    const b = bodyOf(c);
    assert(JSON.stringify(b.promotionCodes) === '["P10"]', "promo");
    assert(b.giftCardCode === "GC" && b.shippingMethodId === "sm", "gc/sm");
  });

  installFetch();
  await shopApi.checkout({
    cartId: "cart-123",
    paymentMethod: "paymob",
    shippingAddress: { city: "Cairo", country: "EG" },
    idempotencyKey: "idem-1",
    returnUrl: "https://example/en/checkout/confirmation",
  });
  check("checkout(input) → POST /checkout with idempotency-key header; no items/totals sent", () => {
    const c = last();
    assert(c.method === "POST" && c.url === "/api/store/v2/checkout", `url ${c.url}`);
    assert(c.headers["idempotency-key"] === "idem-1", `header ${JSON.stringify(c.headers)}`);
    const b = bodyOf(c);
    assert(b.cartId === "cart-123" && b.paymentMethod === "paymob", "cartId/paymentMethod");
    assert(b.shippingAddress.city === "Cairo", "shippingAddress");
    assert(b.returnUrl === "https://example/en/checkout/confirmation", "returnUrl");
    assert(!("items" in b), "must not send items");
    assert(!("amountDue" in b) && !("total" in b), "must not send totals");
  });

  installFetch();
  await shopApi.checkout({ cartId: "c", paymentMethod: "cod", shippingAddress: {} });
  check("checkout without idempotencyKey omits the header", () => {
    assert(!("idempotency-key" in last().headers), "no idempotency header");
  });

  installFetch();
  await shopApi.auth.register({ email: "a@b.com", password: "password", name: "N", phone: "010" });
  check("auth.register → POST /auth/register", () => {
    const c = last();
    assert(c.method === "POST" && c.url === "/api/store/v2/auth/register", `url ${c.url}`);
    const b = bodyOf(c);
    assert(b.email === "a@b.com" && b.password === "password" && b.name === "N" && b.phone === "010", "body");
  });

  installFetch();
  await shopApi.auth.login({ email: "a@b.com", password: "password" });
  check("auth.login → POST /auth/login", () => {
    assert(last().url === "/api/store/v2/auth/login", `url ${last().url}`);
  });

  installFetch();
  await shopApi.auth.logout();
  check("auth.logout → POST /auth/logout", () => {
    assert(last().method === "POST" && last().url === "/api/store/v2/auth/logout", `url ${last().url}`);
  });

  installFetch();
  await shopApi.auth.me();
  check("auth.me → GET /auth/me", () => {
    assert(last().method === "GET" && last().url === "/api/store/v2/auth/me", `url ${last().url}`);
  });

  installFetch();
  await shopApi.auth.requestPasswordReset("a@b.com");
  check("auth.requestPasswordReset → POST /auth/reset/request {email}", () => {
    const c = last();
    assert(c.url === "/api/store/v2/auth/reset/request", `url ${c.url}`);
    assert(bodyOf(c).email === "a@b.com", "email body");
  });

  installFetch();
  await shopApi.auth.resetPassword({ token: "tok", password: "newpass" });
  check("auth.resetPassword → POST /auth/reset/confirm {token,password}", () => {
    const c = last();
    assert(c.url === "/api/store/v2/auth/reset/confirm", `url ${c.url}`);
    const b = bodyOf(c);
    assert(b.token === "tok" && b.password === "newpass", "body");
  });

  installFetch();
  await shopApi.orders();
  check("orders() → GET /orders", () => {
    assert(last().method === "GET" && last().url === "/api/store/v2/orders", `url ${last().url}`);
  });

  installFetch();
  await shopApi.order("ORD-1");
  check("order(number) → GET /orders/:number", () => {
    assert(last().method === "GET" && last().url === "/api/store/v2/orders/ORD-1", `url ${last().url}`);
  });

  const failed = results.filter((r) => !r.ok);
  for (const r of results) {
    console.log(`[${r.ok ? "PASS" : "FAIL"}] ${r.name}${r.ok ? "" : " — " + r.detail}`);
  }
  console.log(`\n${results.length - failed.length}/${results.length} shopApi contract assertions passed.`);
  if (failed.length) throw new Error(`${failed.length} shopApi contract assertion(s) failed`);
}

await main();
