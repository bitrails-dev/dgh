// Pure order-status helpers (Wave E3). Shared by OrderHistory / OrderDetail / OrderStatus and
// unit-tested without a UI runner. Statuses are normalized to the statusLabel i18n keys; the
// payment outcome decides which confirmation/failure messaging to show on the return page.

export type OrderOutcome = "success" | "pending" | "failed";

const STATUS_KEYS = [
  "pending",
  "processing",
  "paid",
  "partially_paid",
  "fulfilled",
  "cancelled",
  "refunded",
  "failed",
] as const;
export type OrderStatusKey = (typeof STATUS_KEYS)[number];

/** Normalize a raw status string to a known statusLabel key (defensive against server variants). */
export function orderStatusKey(raw: string | undefined | null): OrderStatusKey {
  const k = String(raw ?? "").trim().toLowerCase().replace(/[-\s]/g, "_");
  if ((STATUS_KEYS as readonly string[]).includes(k)) return k as OrderStatusKey;
  if (!k) return "pending";
  // Lenient aliases seen across plugin/legacy states.
  if (k === "open" || k === "draft" || k === "awaiting_payment") return "pending";
  if (k === "authorized" || k === "captured" || k === "completed" || k === "delivered" || k === "shipped") return "fulfilled";
  if (k === "declined" || k === "voided" || k === "expired" || k === "error") return "failed";
  if (k === "refunded_partially") return "partially_paid";
  return "pending";
}

/**
 * Decide the confirmation outcome from the order's paymentState + fulfillment status.
 * - success: paid / partially_paid / fulfilled
 * - failed: failed / cancelled / refunded
 * - pending: everything else (pending, processing, unknown)
 */
export function orderOutcome(paymentState?: string | null, orderStatus?: string | null): OrderOutcome {
  const p = orderStatusKey(paymentState);
  const o = orderStatusKey(orderStatus);
  if (p === "paid" || p === "partially_paid" || p === "fulfilled" || o === "fulfilled") return "success";
  if (p === "failed" || p === "cancelled" || p === "refunded" || o === "cancelled" || o === "failed") return "failed";
  return "pending";
}

/** Pull an order's grand total defensively across plugin/legacy field name variants. */
export function orderGrandTotal(order: any): number {
  if (!order) return 0;
  return Number(order.grandTotal ?? order.total ?? order.amountDue ?? 0);
}
