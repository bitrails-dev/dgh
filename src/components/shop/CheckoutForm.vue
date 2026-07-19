<script setup lang="ts">
// Checkout form (Wave E3). Collects contact + shipping address + payment method (+ optional promo /
// gift-card / shipping-method), then places the order via shopApi.checkout with the plugin-first
// v2 input (cartId, paymentMethod, shippingAddress, …). COD/bank complete inline with the order
// number; Paymob/Kashier redirect to the hosted checkout URL. One idempotency key per in-flight
// attempt (reused across retries so a lost response cannot create a duplicate order).
import { ref, reactive, computed, onMounted, onUnmounted } from "vue";
import { shopApi, type AddressInput, type PaymentMethod } from "./api";
import { buildCheckoutInput, checkoutReturnUrl, normalizePromotionCodes } from "./checkout-input";
import { formatMoney } from "../../lib/store/money";
import { localePath } from "../../i18n";

const props = defineProps<{ lang: "ar" | "en"; strings: any }>();
const s = computed(() => props.strings.shop);

const cartId = ref("");
const items = ref<any[]>([]);
const amountDue = ref(0);
const currency = ref("EGP");
const shippingMethods = ref<any[]>([]);
const customer = ref<any>(null);

const loading = ref(true);
const placing = ref(false);
const redirecting = ref(false);
const placed = ref<{ orderNumber: string; method: PaymentMethod } | null>(null);
const error = ref("");

// Reused across retries on a network failure; cleared on a terminal (business) response so a
// genuine new submission mints a fresh key. Not template-reactive → plain let.
let idempotencyKey: string | null = null;

const form = reactive({
  email: "",
  phone: "",
  paymentMethod: "cod" as PaymentMethod,
  fullName: "",
  line1: "",
  line2: "",
  city: "",
  governorate: "",
  postalCode: "",
  country: "EG",
  promoInput: "",
  giftCardCode: "",
  shippingMethodId: "",
  selectedAddressId: "",
});

const shopHref = computed(() => localePath("/shop", props.lang));
const savedAddresses = computed<any[]>(() =>
  Array.isArray(customer.value?.addresses) ? customer.value.addresses : []
);

function uuidV4(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  const b = (crypto as Crypto).getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

async function load() {
  loading.value = true;
  error.value = "";
  try {
    const [cart, me] = await Promise.all([shopApi.cart(), shopApi.auth.me().catch(() => ({ customer: null }))]);
    cartId.value = cart.cartId;
    items.value = cart.items ?? [];
    amountDue.value = cart.quote?.grandTotal ?? cart.quote?.amountDue ?? 0;
    currency.value = cart.quote?.currency ?? "EGP";
    shippingMethods.value = Array.isArray(cart.quote?.shippingMethods) ? cart.quote.shippingMethods : [];
    customer.value = me.customer;
    if (customer.value?.email) form.email = customer.value.email;
    if (customer.value?.phone) form.phone = customer.value.phone;
    if (shippingMethods.value[0]?.id && !form.shippingMethodId) form.shippingMethodId = shippingMethods.value[0].id;
  } catch (e: any) {
    error.value = e?.body?.error || s.value.errors.generic;
  } finally {
    loading.value = false;
  }
}

function useSavedAddress(id: string) {
  const a = savedAddresses.value.find((x) => String(x.id) === id);
  if (!a) return;
  form.fullName = a.fullName ?? customer.value?.name ?? "";
  form.phone = a.phone ?? form.phone;
  form.line1 = a.line1 ?? "";
  form.line2 = a.line2 ?? "";
  form.city = a.city ?? "";
  form.governorate = a.governorate ?? "";
  form.postalCode = a.postalCode ?? "";
  form.country = a.country ?? "EG";
}

async function submit() {
  if (!cartId.value) {
    error.value = s.value.checkout.error;
    return;
  }
  placing.value = true;
  error.value = "";
  placed.value = null;
  if (!idempotencyKey) idempotencyKey = uuidV4();
  try {
    const address: AddressInput = {
      fullName: form.fullName,
      phone: form.phone,
      line1: form.line1,
      line2: form.line2,
      city: form.city,
      governorate: form.governorate,
      postalCode: form.postalCode,
      country: form.country,
    };
    const input = buildCheckoutInput({
      cartId: cartId.value,
      email: form.email,
      phone: form.phone,
      paymentMethod: form.paymentMethod,
      address,
      promotionCodes: normalizePromotionCodes(form.promoInput.split(/[,\s]+/)),
      giftCardCode: form.giftCardCode,
      shippingMethodId: form.shippingMethodId || undefined,
      idempotencyKey,
      returnUrl: checkoutReturnUrl(props.lang),
    });
    const r = await shopApi.checkout(input);
    // An empty 2xx is indeterminate → treat like a network failure: keep the key to dedup a retry.
    if (!r) throw new Error("empty_checkout_response");
    idempotencyKey = null; // terminal success → next submission mints a fresh key
    if (r.checkoutUrl) {
      redirecting.value = true;
      window.location.href = r.checkoutUrl;
      return;
    }
    placed.value = { orderNumber: r.orderNumber, method: form.paymentMethod };
  } catch (e: any) {
    // A business response (HTTP error carrying a body) is terminal → clear the key. A network
    // failure (no response body) is indeterminate → KEEP the key so a retry dedups any made order.
    if (e?.body) idempotencyKey = null;
    const code = e?.body?.error;
    error.value = code === "insufficient_stock"
      ? s.value.checkout.insufficientStock
      : (typeof code === "string" && code) || s.value.checkout.error;
  } finally {
    placing.value = false;
  }
}

let onPageLoad: (() => void) | null = null;
onMounted(() => {
  load();
  onPageLoad = () => load();
  document.addEventListener("astro:page-load", onPageLoad);
});
onUnmounted(() => {
  if (onPageLoad) document.removeEventListener("astro:page-load", onPageLoad);
});
</script>

<template>
  <h1 class="font-display-ar text-3xl font-bold text-navy-900 mb-6">{{ s.checkout.title }}</h1>

  <p v-if="loading" class="text-ink-400">{{ s.account.loading }}</p>
  <p v-else-if="error && !items.length" class="text-coral" role="alert">{{ error }}</p>
  <p v-else-if="items.length === 0" class="text-ink-500">
    {{ s.cart.empty }}
    <a :href="shopHref" class="text-teal-700 hover:underline">{{ s.cart.continueShopping }}</a>
  </p>

  <div v-else-if="placed" class="card p-8 text-center">
    <h2 class="text-2xl font-bold text-teal-700 mb-2">{{ s.checkout.orderPlaced }}</h2>
    <p class="text-ink-600">{{ s.checkout.orderNumber }}: <span class="font-mono font-bold">{{ placed.orderNumber }}</span></p>
    <p v-if="placed.method === 'cod' || placed.method === 'bank'" class="text-ink-500 text-sm mt-2">{{ s.checkout.manualConfirm }}</p>
    <a :href="localePath(`/account/orders/${placed.orderNumber}`, lang)" class="btn btn-teal mt-5">{{ s.orders.viewDetail }}</a>
  </div>

  <form v-else @submit.prevent="submit" class="grid lg:grid-cols-2 gap-8">
    <div class="space-y-5">
      <h2 class="font-display-ar text-xl font-bold text-navy-900">{{ s.checkout.contact }}</h2>

      <div v-if="savedAddresses.length" class="space-y-2">
        <label class="block">
          <span class="text-sm font-medium text-ink-700">{{ s.address.selectSaved }}</span>
          <select
            v-model="form.selectedAddressId"
            @change="useSavedAddress(form.selectedAddressId)"
            class="w-full mt-1 border border-ink-200 rounded-lg px-3 py-2 bg-white"
          >
            <option value="">{{ s.address.useNew }}</option>
            <option v-for="a in savedAddresses" :key="a.id" :value="a.id">{{ a.fullName || a.city }}{{ a.default ? ` · ${s.address.default}` : "" }}</option>
          </select>
        </label>
      </div>

      <label class="block">
        <span class="text-sm font-medium text-ink-700">{{ s.address.fullName }}</span>
        <input type="text" required v-model="form.fullName" class="w-full mt-1 border border-ink-200 rounded-lg px-3 py-2 bg-white" />
      </label>
      <label class="block">
        <span class="text-sm font-medium text-ink-700">{{ s.checkout.email }}</span>
        <input type="email" required v-model="form.email" class="w-full mt-1 border border-ink-200 rounded-lg px-3 py-2 bg-white" />
      </label>
      <label class="block">
        <span class="text-sm font-medium text-ink-700">{{ s.checkout.phone }}</span>
        <input type="tel" v-model="form.phone" class="w-full mt-1 border border-ink-200 rounded-lg px-2 py-2 bg-white" />
      </label>
      <label class="block">
        <span class="text-sm font-medium text-ink-700">{{ s.address.line1 }}</span>
        <input type="text" required v-model="form.line1" class="w-full mt-1 border border-ink-200 rounded-lg px-3 py-2 bg-white" />
      </label>
      <label class="block">
        <span class="text-sm font-medium text-ink-700">{{ s.address.line2 }}</span>
        <input type="text" v-model="form.line2" class="w-full mt-1 border border-ink-200 rounded-lg px-3 py-2 bg-white" />
      </label>
      <div class="grid grid-cols-2 gap-3">
        <label class="block">
          <span class="text-sm font-medium text-ink-700">{{ s.address.city }}</span>
          <input type="text" required v-model="form.city" class="w-full mt-1 border border-ink-200 rounded-lg px-3 py-2 bg-white" />
        </label>
        <label class="block">
          <span class="text-sm font-medium text-ink-700">{{ s.address.governorate }}</span>
          <input type="text" v-model="form.governorate" class="w-full mt-1 border border-ink-200 rounded-lg px-3 py-2 bg-white" />
        </label>
      </div>
      <div class="grid grid-cols-2 gap-3">
        <label class="block">
          <span class="text-sm font-medium text-ink-700">{{ s.address.postalCode }}</span>
          <input type="text" v-model="form.postalCode" class="w-full mt-1 border border-ink-200 rounded-lg px-3 py-2 bg-white" />
        </label>
        <label class="block">
          <span class="text-sm font-medium text-ink-700">{{ s.address.country }}</span>
          <input type="text" v-model="form.country" class="w-full mt-1 border border-ink-200 rounded-lg px-3 py-2 bg-white" />
        </label>
      </div>
    </div>

    <div class="space-y-5">
      <h2 class="font-display-ar text-xl font-bold text-navy-900">{{ s.checkout.paymentMethod }}</h2>
      <fieldset class="space-y-2">
        <legend class="sr-only">{{ s.checkout.paymentMethod }}</legend>
        <label class="flex items-center gap-2"><input type="radio" name="pm" value="cod" v-model="form.paymentMethod" /> {{ s.checkout.cod }}</label>
        <label class="flex items-center gap-2"><input type="radio" name="pm" value="bank" v-model="form.paymentMethod" /> {{ s.checkout.bank }}</label>
        <label class="flex items-center gap-2"><input type="radio" name="pm" value="paymob" v-model="form.paymentMethod" /> {{ s.checkout.paymob }}</label>
        <label class="flex items-center gap-2"><input type="radio" name="pm" value="kashier" v-model="form.paymentMethod" /> {{ s.checkout.kashier }}</label>
      </fieldset>

      <details class="card p-3">
        <summary class="cursor-pointer text-sm font-medium text-ink-700">{{ s.quote.promoCode }} / {{ s.quote.giftCard }}</summary>
        <div class="mt-3 space-y-2">
          <input type="text" v-model="form.promoInput" :placeholder="s.quote.promoCode" class="w-full border border-ink-200 rounded-lg px-3 py-2 bg-white" />
          <input type="text" v-model="form.giftCardCode" :placeholder="s.quote.giftCard" class="w-full border border-ink-200 rounded-lg px-3 py-2 bg-white" />
        </div>
      </details>

      <fieldset v-if="shippingMethods.length" class="space-y-2">
        <legend class="text-sm font-medium text-ink-700">{{ s.quote.shipping }}</legend>
        <label v-for="m in shippingMethods" :key="m.id" class="flex items-center gap-2">
          <input type="radio" name="ship" :value="m.id" v-model="form.shippingMethodId" />
          {{ m.name }} <span class="text-ink-400 text-sm">· {{ formatMoney(m.price, currency) }}</span>
        </label>
      </fieldset>

      <div class="card p-4 flex justify-between items-center">
        <span class="font-bold">{{ s.cart.total }}</span>
        <span class="font-bold text-teal-700">{{ formatMoney(amountDue, currency) }}</span>
      </div>
      <button type="submit" :disabled="placing || redirecting" class="btn btn-primary w-full disabled:opacity-60">
        {{ redirecting ? s.checkout.redirecting : placing ? s.checkout.placing : s.checkout.placeOrder }}
      </button>
      <p v-if="error" class="text-coral text-sm" role="alert">{{ error }}</p>
    </div>
  </form>
</template>
