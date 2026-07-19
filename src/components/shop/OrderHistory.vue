<script setup lang="ts">
// Order history (Wave E3). Lists the signed-in customer's orders from shopApi.orders with a status
// badge, total, and a link to the detail page. Loading / empty / error states. Requires a session —
// if the customer is signed out, shows a sign-in prompt.
import { ref, computed, onMounted, onUnmounted } from "vue";
import { shopApi } from "./api";
import { orderStatusKey, orderGrandTotal } from "./order-status";
import { formatMoney } from "../../lib/store/money";
import { localePath } from "../../i18n";

const props = defineProps<{ lang: "ar" | "en"; strings: any }>();
const s = computed(() => props.strings.shop.orders);
const sk = computed(() => props.strings.shop);

const orders = ref<any[]>([]);
const loading = ref(true);
const error = ref("");
const signedOut = ref(false);
let onPageLoad: (() => void) | null = null;

async function load() {
  loading.value = true;
  error.value = "";
  signedOut.value = false;
  try {
    orders.value = (await shopApi.orders()).items ?? [];
  } catch (e: any) {
    if (e?.status === 401 || e?.status === 403) signedOut.value = true;
    else error.value = e?.body?.error || sk.value.errors.generic;
    orders.value = [];
  } finally {
    loading.value = false;
  }
}

function statusLabel(o: any): string {
  const k = orderStatusKey(o.paymentState ?? o.status);
  return s.value.statusLabel[k] ?? k;
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
  <h1 class="font-display-ar text-3xl font-bold text-navy-900 mb-6">{{ s.title }}</h1>

  <div v-if="signedOut" class="card p-6 max-w-md">
    <p class="text-ink-600">{{ sk.value.account.signIn }}</p>
    <a :href="localePath('/account', lang)" class="btn btn-primary mt-4">{{ sk.value.account.signInAction }}</a>
  </div>

  <p v-else-if="loading" class="text-ink-400">{{ s.loading }}</p>
  <p v-else-if="error" class="text-coral" role="alert">{{ error }}</p>
  <p v-else-if="orders.length === 0" class="text-ink-500">{{ s.empty }}</p>

  <ul v-else class="divide-y divide-ink-100">
    <li v-for="o in orders" :key="o.orderNumber || o.id" class="py-4 flex items-center justify-between gap-4">
      <div>
        <a :href="localePath(`/account/orders/${o.orderNumber}`, lang)" class="font-semibold text-ink-900 hover:text-teal-700 font-mono">
          {{ o.orderNumber }}
        </a>
        <p class="text-xs text-ink-400 mt-0.5">{{ o.createdAt || o.date }}</p>
        <p class="text-xs text-ink-400">{{ o.items?.length ?? 0 }} {{ s.items }}</p>
      </div>
      <div class="text-end">
        <p class="font-bold text-teal-700">{{ formatMoney(orderGrandTotal(o), o.currency) }}</p>
        <span class="inline-block mt-1 text-xs px-2 py-0.5 rounded-full bg-ivory-100 text-ink-600">{{ statusLabel(o) }}</span>
      </div>
    </li>
  </ul>
</template>
