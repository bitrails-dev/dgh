<script setup lang="ts">
// Cart page body: loads the cookie-scoped cart + fresh server quote, supports per-line qty updates
// and removal, shows server-authoritative totals, and links to checkout. Re-loads on soft navigations.
import { ref, computed, onMounted, onUnmounted } from "vue";
import { storeApi } from "../../lib/store/client";
import { formatMoney } from "../../lib/store/money";

const props = defineProps<{ lang: "ar" | "en"; strings: any }>();
const s = props.strings.shop;

const items = ref<any[]>([]);
const quote = ref<any>(null);
const quoteError = ref<any>(null);
const currency = ref("EGP");
const loading = ref(true);
const busy = ref(false);
let onPageLoad: (() => void) | null = null;

const shopHref = computed(() => (props.lang === "en" ? "/en/shop" : "/shop"));
const checkoutHref = computed(() => (props.lang === "en" ? "/en/checkout" : "/checkout"));

async function load() {
  loading.value = true;
  try {
    const c = await storeApi.cart();
    items.value = c.items ?? [];
    quote.value = c.quote ?? null;
    quoteError.value = c.quoteError ?? null;
    currency.value = c.quote?.currency || "EGP";
  } catch {
    /* empty */
  } finally {
    loading.value = false;
  }
}

async function setQty(sku: string, qty: number) {
  if (qty <= 0) return remove(sku);
  busy.value = true;
  const next = items.value.map((i) => (i.sku === sku ? { ...i, quantity: qty } : i));
  try {
    const c = await storeApi.updateCart(next);
    items.value = c.items ?? [];
    quote.value = c.quote ?? null;
    quoteError.value = c.quoteError ?? null;
  } finally {
    busy.value = false;
  }
}

async function remove(sku: string) {
  busy.value = true;
  const next = items.value.filter((i) => i.sku !== sku);
  try {
    const c = await storeApi.updateCart(next);
    items.value = c.items ?? [];
    quote.value = c.quote ?? null;
    quoteError.value = c.quoteError ?? null;
  } finally {
    busy.value = false;
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
  <h1 class="font-display-ar text-3xl font-bold text-navy-900 mb-6">{{ s.cart.title }}</h1>

  <div v-if="loading" class="text-ink-400">{{ props.strings.shop.account.loading }}</div>

  <div v-else-if="items.length === 0" class="text-center py-16">
    <p class="text-ink-500 mb-4">{{ s.cart.empty }}</p>
    <a :href="shopHref" class="btn btn-teal">{{ s.cart.continueShopping }}</a>
  </div>

  <div v-else class="grid lg:grid-cols-3 gap-8">
    <ul class="lg:col-span-2 divide-y divide-ink-100">
      <li v-for="i in items" :key="i.sku" class="py-4 flex items-center gap-4">
        <div class="flex-1">
          <p class="font-semibold text-ink-900">{{ i.name || i.sku }}</p>
          <p class="text-xs text-ink-400">{{ i.sku }}</p>
        </div>
        <input
          type="number" min="0" :value="i.quantity" @change="setQty(i.sku, Number(($event.target as HTMLInputElement).value))"
          class="w-20 border border-ink-200 rounded-lg px-2 py-1 bg-white text-center" :disabled="busy"
        />
        <button @click="remove(i.sku)" :disabled="busy" class="text-coral text-sm hover:underline">{{ s.cart.remove }}</button>
      </li>
    </ul>

    <aside class="card p-5 h-fit">
      <p v-if="quoteError" class="text-coral text-sm mb-3">{{ s.cart.quoteError }}</p>
      <dl class="space-y-2 text-sm" v-if="quote">
        <div class="flex justify-between"><dt class="text-ink-500">{{ s.cart.subtotal }}</dt><dd>{{ formatMoney(quote.merchandiseSubtotal, currency) }}</dd></div>
        <div class="flex justify-between"><dt class="text-ink-500">{{ s.cart.tax }}</dt><dd>{{ formatMoney(quote.totalTax, currency) }}</dd></div>
        <div class="flex justify-between border-t border-ink-100 pt-2 font-bold"><dt>{{ s.cart.total }}</dt><dd>{{ formatMoney(quote.grandTotal, currency) }}</dd></div>
      </dl>
      <a :href="checkoutHref" class="btn btn-primary w-full mt-5 text-center">{{ s.cart.checkout }}</a>
      <a :href="shopHref" class="block text-center text-teal-700 text-sm mt-3 hover:underline">{{ s.cart.continueShopping }}</a>
    </aside>
  </div>
</template>
