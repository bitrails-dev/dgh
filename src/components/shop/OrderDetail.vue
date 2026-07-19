<script setup lang="ts">
// Order detail (Wave E3). Fetches a single order by number via shopApi.order and renders its lines,
// totals, shipping address, and status. Loading / not-found / error states.
import { ref, computed, onMounted, onUnmounted } from "vue";
import { shopApi } from "./api";
import { orderStatusKey, orderGrandTotal } from "./order-status";
import { formatMoney } from "../../lib/store/money";
import { localePath } from "../../i18n";

const props = defineProps<{ lang: "ar" | "en"; strings: any; orderNumber: string }>();
const s = computed(() => props.strings.shop.orders);
const sk = computed(() => props.strings.shop);

const order = ref<any>(null);
const loading = ref(true);
const error = ref("");
let onPageLoad: (() => void) | null = null;

const currency = computed(() => order.value?.currency ?? "EGP");
const items = computed<any[]>(() => Array.isArray(order.value?.items) ? order.value.items : []);
const address = computed(() => order.value?.shippingAddress ?? order.value?.address ?? null);
const backHref = computed(() => localePath("/account/orders", props.lang));

function statusLabel(): string {
  const k = orderStatusKey(order.value?.paymentState ?? order.value?.status);
  return s.value.statusLabel[k] ?? k;
}

async function load() {
  loading.value = true;
  error.value = "";
  order.value = null;
  try {
    order.value = await shopApi.order(props.orderNumber);
  } catch (e: any) {
    error.value = e?.status === 404 ? s.value.notFound : e?.body?.error || sk.value.errors.generic;
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
  <a :href="backHref" class="text-teal-700 text-sm hover:underline">{{ s.back }}</a>
  <h1 class="font-display-ar text-3xl font-bold text-navy-900 mt-2 mb-6">
    {{ s.orderNumber }} <span class="font-mono">{{ orderNumber }}</span>
  </h1>

  <p v-if="loading" class="text-ink-400">{{ sk.value.account.loading }}</p>
  <div v-else-if="error" class="card p-6 text-center">
    <p class="text-coral" role="alert">{{ error }}</p>
    <a :href="backHref" class="btn btn-ghost mt-4">{{ s.back }}</a>
  </div>

  <div v-else-if="order" class="grid lg:grid-cols-3 gap-8">
    <ul class="lg:col-span-2 divide-y divide-ink-100">
      <li v-for="i in items" :key="i.sku || i.id" class="py-3 flex items-center justify-between gap-4">
        <div>
          <p class="font-semibold text-ink-900">{{ i.product?.name || i.name || i.sku }}</p>
          <p class="text-xs text-ink-400">{{ s.items }}: {{ i.quantity }} · {{ i.sku }}</p>
        </div>
        <p class="font-semibold text-ink-700">{{ formatMoney(i.total ?? i.price ?? 0, currency) }}</p>
      </li>
    </ul>

    <aside class="card p-5 h-fit space-y-3">
      <div class="flex justify-between text-sm">
        <span class="text-ink-500">{{ s.status }}</span>
        <span class="font-medium">{{ statusLabel() }}</span>
      </div>
      <div class="flex justify-between text-sm">
        <span class="text-ink-500">{{ s.paymentMethod }}</span>
        <span class="font-medium">{{ order.paymentMethod ?? "—" }}</span>
      </div>
      <div class="flex justify-between border-t border-ink-100 pt-2 font-bold">
        <span>{{ s.total }}</span>
        <span class="text-teal-700">{{ formatMoney(orderGrandTotal(order), currency) }}</span>
      </div>
      <div v-if="address" class="text-sm text-ink-600 border-t border-ink-100 pt-3">
        <p class="font-medium text-ink-700 mb-1">{{ sk.value.address.line1 }}</p>
        <p>{{ address.fullName }}</p>
        <p>{{ address.line1 }}{{ address.line2 ? `, ${address.line2}` : "" }}</p>
        <p>{{ address.city }}{{ address.governorate ? `, ${address.governorate}` : "" }}</p>
        <p v-if="address.phone" class="mt-1">{{ address.phone }}</p>
      </div>
    </aside>
  </div>
</template>
