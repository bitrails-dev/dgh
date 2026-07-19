// Pure builder for the v2 checkout payload (Wave E3). Extracted from the Vue component so the
// exact shopApi.checkout input shape is unit-testable without a Vue test runner.
//
// The browser sends the plugin cart id, payment method, shipping address, optional promo / gift-card
// codes, the chosen shipping method, an idempotency key, and the return URL. It NEVER sends line
// items, totals, or prices — the server re-prices from the cart. See plan §3.2 / §3.7 / §4.1.
import type { CheckoutInput, PaymentMethod, AddressInput } from "./api";

export interface CheckoutFormState {
  cartId: string;
  email: string;
  phone?: string;
  paymentMethod: PaymentMethod;
  address: AddressInput;
  promotionCodes?: string[];
  giftCardCode?: string;
  shippingMethodId?: string;
  idempotencyKey?: string;
  returnUrl?: string;
}

/** Normalize a free-form code list: trim, drop empties, collapse duplicates, cap at 10 (plan §3.7). */
export function normalizePromotionCodes(input: string[] | undefined): string[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of input) {
    const code = String(raw ?? "").trim();
    if (!code || seen.has(code.toLowerCase())) continue;
    seen.add(code.toLowerCase());
    out.push(code);
    if (out.length >= 10) break;
  }
  return out;
}

/** Build a v2 ProcessCheckoutInput for shopApi.checkout from form state. */
export function buildCheckoutInput(form: CheckoutFormState): CheckoutInput {
  if (!form.cartId) throw new Error("buildCheckoutInput: missing cartId");

  // The shipping address is the full address block the server persists on the order. Email/phone
  // ride on it so the CMS does not need a second customer-contact field for guest checkout.
  const shippingAddress = {
    fullName: form.address.fullName ?? "",
    phone: form.phone || form.address.phone || "",
    email: form.email,
    line1: form.address.line1 ?? "",
    line2: form.address.line2 ?? "",
    city: form.address.city ?? "",
    governorate: form.address.governorate ?? "",
    postalCode: form.address.postalCode ?? "",
    country: form.address.country ?? "EG",
  };

  const promotionCodes = normalizePromotionCodes(form.promotionCodes);

  const input: CheckoutInput = {
    cartId: form.cartId,
    paymentMethod: form.paymentMethod,
    shippingAddress,
  };
  if (promotionCodes.length) input.promotionCodes = promotionCodes;
  if (form.giftCardCode && form.giftCardCode.trim()) input.giftCardCode = form.giftCardCode.trim();
  if (form.shippingMethodId) input.shippingMethodId = form.shippingMethodId;
  if (form.idempotencyKey) input.idempotencyKey = form.idempotencyKey;
  if (form.returnUrl) input.returnUrl = form.returnUrl;
  return input;
}

/** The browser return URL the payment provider redirects back to after a hosted checkout. */
export function checkoutReturnUrl(lang: "ar" | "en"): string {
  const base = typeof window !== "undefined" ? window.location.origin : "";
  const prefix = lang === "en" ? "/en" : "";
  return `${base}${prefix}/checkout/confirmation`;
}
