// Focused test (Wave E3) for the pure order-status helpers that drive confirmation/failure messaging.
// Zero-dependency. Run with:
//   cms/node_modules/.bin/tsx src/components/shop/__tests__/order-status.test.ts
import { orderStatusKey, orderOutcome, orderGrandTotal } from "../order-status";

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

check("orderStatusKey normalizes variants to known keys", () => {
  assert(orderStatusKey("paid") === "paid", "paid");
  assert(orderStatusKey("PARTIALLY-PAID") === "partially_paid", "dash → underscore + lower");
  assert(orderStatusKey("Captured") === "fulfilled", "captured alias → fulfilled");
  assert(orderStatusKey("declined") === "failed", "declined → failed");
  assert(orderStatusKey("") === "pending", "empty → pending");
  assert(orderStatusKey(undefined) === "pending", "undefined → pending");
  assert(orderStatusKey("something-weird") === "pending", "unknown → pending");
});

check("orderOutcome maps payment/order state to success / pending / failed", () => {
  assert(orderOutcome("paid", undefined) === "success", "paid → success");
  assert(orderOutcome("partially_paid", undefined) === "success", "partially_paid → success");
  assert(orderOutcome(undefined, "fulfilled") === "success", "fulfilled order → success");
  assert(orderOutcome("failed", undefined) === "failed", "failed → failed");
  assert(orderOutcome(undefined, "cancelled") === "failed", "cancelled order → failed");
  assert(orderOutcome("refunded", undefined) === "failed", "refunded → failed");
  assert(orderOutcome("pending", undefined) === "pending", "pending → pending");
  assert(orderOutcome("processing", undefined) === "pending", "processing → pending");
  assert(orderOutcome(undefined, undefined) === "pending", "nothing → pending");
});

check("orderGrandTotal is defensive across field-name variants", () => {
  assert(orderGrandTotal({ grandTotal: 1250 }) === 1250, "grandTotal");
  assert(orderGrandTotal({ total: 1250 }) === 1250, "total fallback");
  assert(orderGrandTotal({ amountDue: 1250 }) === 1250, "amountDue fallback");
  assert(orderGrandTotal(null) === 0, "null → 0");
  assert(orderGrandTotal({}) === 0, "missing → 0");
});

const failed = results.filter((r) => !r.ok);
for (const r of results) {
  console.log(`[${r.ok ? "PASS" : "FAIL"}] ${r.name}${r.ok ? "" : " — " + r.detail}`);
}
console.log(`\n${results.length - failed.length}/${results.length} order-status assertions passed.`);
if (failed.length) throw new Error(`${failed.length} order-status assertion(s) failed`);
