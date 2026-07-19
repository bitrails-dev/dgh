<script setup lang="ts">
// Payment return page body (Wave E3). The hosted-checkout provider redirects back to /checkout/
// confirmation (success) or /checkout/failure. This component reads the order number, fetches its
// authoritative state via shopApi.order, and shows the truthful outcome (a success page still shows
// failure messaging if the server says the payment failed) with a retry link back to checkout.
import { ref, computed, onMounted, onUnmounted } from "vue";
import { shopApi } from "./api";
import { orderOutcome, orderGrandTotal } from "./order-status";
import { formatMoney } from "../../lib/store/money";
import { localePath } from "../../i18n";

const props = defineProps<{ lang: "ar" | "en"; strings: any; variant: "success" | "failure"; orderNumber?: string }>();
const s = computed(() => props.strings.shop.confirmation);
const sk = computed(() => props.strings.shop);

const order = ref<any>(null);
const loading = ref(true);
const error = ref("");
let onPageLoad: (() => void) | null = null;

const resolvedNumber = computed(() => {
  if (props.orderNumber) return props.orderNumber;
  if (typeof window === "undefined") return "";
  const q = new URLSearchParams(window.location.search);
  return q.get("order") || q.get("orderNumber") || q.get("orderId") || "";
});
const outcome = computed(() =>
  orderOutcome(order.value?.paymentState, order.value?.status)
);
// The actual message reflects the AUTHORITATIVE server state, not the URL the provider sent us to.
const isFailure = computed(() => props.variant === "failure" || outcome.value === "failed");
const shopHref = computed(() => localePath("/shop", props.lang));
const ordersHref = computed(() => localePath("/account/orders", props.lang));
const retryHref = computed(() => localePath("/checkout", props.lang));

async function load() {
  loading.value = true;
  error.value = "";
  order.value = null;
  const num = resolvedNumber.value;
  if (!num) {
    loading.value = false;
    return;
  }
  try {
    order.value = await shopApi.order(num);
  } catch (e: any) {
    error.value = e?.body?.error || sk.value.errors.generic;
  } finally {
    loading.value = false;
  }
}

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
  <div class="max-w-xl mx-auto text-center py-10">
    <h1 class="font-display-ar text-3xl font-bold mb-4" :class="isFailure ? 'text-coral' : 'text-teal-700'">
      {{ isFailure ? s.failureTitle : s.title }}
    </h1>

    <p v-if="loading" class="text-ink-400">{{ s.loading }}</p>
    <p v-else-if="error" class="text-coral" role="alert">{{ error }}</p>

    <template v-else-if="order">
      <p class="text-ink-600 mb-2">
        {{ isFailure ? s.failureBody : outcome === "pending" ? s.pending : outcome === "success" ? s.paid : s.success }}
      </p>
      <p class="text-ink-500 text-sm">{{ s.orderNumber }}: <span class="font-mono font-bold">{{ order.orderNumber }}</span></p>
      <p v-if="orderGrandTotal(order)" class="text-ink-500 text-sm">{{ sk.value.orders.total }}: {{ formatMoney(orderGrandTotal(order), order.currency) }}</p>

      <div class="mt-6 flex flex-wrap items-center justify-center gap-3">
        <a v-if="isFailure" :href="retryHref" class="btn btn-primary">{{ s.retry }}</a>
        <a :href="ordersHref" class="btn btn-teal">{{ s.viewOrders }}</a>
        <a :href="shopHref" class="btn btn-ghost">{{ s.continueShopping }}</a>
      </div>
    </template>

    <template v-else>
      <p class="text-ink-600 mb-4">{{ isFailure ? s.failureBody : s.success }}</p>
      <a :href="shopHref" class="btn btn-teal">{{ s.continueShopping }}</a>
    </template>
  </div>
</template>
