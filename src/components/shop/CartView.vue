<script setup lang="ts">
// Cart page body (Wave E3). Loads the cookie-scoped plugin cart + its authoritative server quote,
// supports per-line qty updates, removal, and clearing the whole cart. Totals are always the
// server's (re-priced on every mutation); the browser never computes or sends totals.
import { ref, computed, onMounted, onUnmounted } from "vue";
import { shopApi } from "./api";
import { formatMoney } from "../../lib/store/money";
import { localePath } from "../../i18n";

const props = defineProps<{ lang: "ar" | "en"; strings: any }>();
const s = computed(() => props.strings.shop);

const items = ref<any[]>([]);
const quote = ref<any>(null);
const quoteError = ref<any>(null);
const currency = ref("EGP");
const loading = ref(true);
const busy = ref(false);
const error = ref("");
let onPageLoad: (() => void) | null = null;

const shopHref = computed(() => localePath("/shop", props.lang));
const checkoutHref = computed(() => localePath("/checkout", props.lang));
const isEmpty = computed(() => items.value.length === 0);
const grandTotal = computed(() => quote.value?.grandTotal ?? quote.value?.amountDue ?? 0);

function applyCart(c: { items: any[]; quote: any; quoteError?: any }) {
  items.value = c.items ?? [];
  quote.value = c.quote ?? null;
  quoteError.value = c.quoteError ?? null;
  currency.value = c.quote?.currency || "EGP";
}

async function load() {
  loading.value = true;
  error.value = "";
  try {
    applyCart(await shopApi.cart());
  } catch (e: any) {
    error.value = e?.body?.error || s.value.errors.generic;
  } finally {
    loading.value = false;
  }
}

async function setQty(sku: string, qty: number) {
  if (qty <= 0) return remove(sku);
  if (busy.value) return;
  busy.value = true;
  try {
    applyCart(await shopApi.updateItem(sku, qty));
  } catch (e: any) {
    error.value = e?.body?.error || s.value.errors.generic;
  } finally {
    busy.value = false;
  }
}

async function remove(sku: string) {
  if (busy.value) return;
  busy.value = true;
  try {
    applyCart(await shopApi.removeItem(sku));
  } catch (e: any) {
    error.value = e?.body?.error || s.value.errors.generic;
  } finally {
    busy.value = false;
  }
}

async function clear() {
  if (busy.value || isEmpty.value) return;
  busy.value = true;
  try {
    applyCart(await shopApi.clearCart());
  } catch (e: any) {
    error.value = e?.body?.error || s.value.errors.generic;
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

  <p v-if="loading" class="text-ink-400">{{ s.account.loading }}</p>
  <p v-else-if="error" class="text-coral" role="alert">{{ error }}</p>

  <div v-else-if="isEmpty" class="text-center py-16">
    <p class="text-ink-500 mb-4">{{ s.cart.empty }}</p>
    <a :href="shopHref" class="btn btn-teal">{{ s.cart.continueShopping }}</a>
  </div>

  <div v-else class="grid lg:grid-cols-3 gap-8">
    <ul class="lg:col-span-2 divide-y divide-ink-100" aria-label="Cart items">
      <li v-for="i in items" :key="i.sku" class="py-4 flex items-center gap-4">
        <div class="flex-1">
          <p class="font-semibold text-ink-900">{{ i.product?.name || i.name || i.sku }}</p>
          <p class="text-xs text-ink-400">{{ i.sku }}</p>
        </div>
        <input
          type="number" min="0" :value="i.quantity"
          :aria-label="s.cart.quantity"
          @change="setQty(i.sku, Number(($event.target as HTMLInputElement).value))"
          class="w-20 border border-ink-200 rounded-lg px-2 py-1 bg-white text-center"
          :disabled="busy"
        />
        <button @click="remove(i.sku)" :disabled="busy" class="text-coral text-sm hover:underline">{{ s.cart.remove }}</button>
      </li>
    </ul>

    <aside class="card p-5 h-fit">
      <p v-if="quoteError" class="text-coral text-sm mb-3" role="alert">{{ s.cart.quoteError }}</p>
      <dl class="space-y-2 text-sm" v-if="quote">
        <div class="flex justify-between"><dt class="text-ink-500">{{ s.cart.subtotal }}</dt><dd>{{ formatMoney(quote.merchandiseSubtotal ?? quote.subtotal, currency) }}</dd></div>
        <div v-if="typeof quote.discountTotal === 'number' && quote.discountTotal" class="flex justify-between"><dt class="text-ink-500">{{ s.quote.discount }}</dt><dd>-{{ formatMoney(quote.discountTotal, currency) }}</dd></div>
        <div v-if="typeof quote.shippingTotal === 'number'" class="flex justify-between"><dt class="text-ink-500">{{ s.quote.shipping }}</dt><dd>{{ formatMoney(quote.shippingTotal, currency) }}</dd></div>
        <div class="flex justify-between"><dt class="text-ink-500">{{ s.cart.tax }}</dt><dd>{{ formatMoney(quote.totalTax ?? quote.tax, currency) }}</dd></div>
        <div class="flex justify-between border-t border-ink-100 pt-2 font-bold"><dt>{{ s.quote.grandTotal }}</dt><dd>{{ formatMoney(grandTotal, currency) }}</dd></div>
      </dl>
      <a :href="checkoutHref" class="btn btn-primary w-full mt-5 text-center">{{ s.cart.checkout }}</a>
      <button @click="clear" :disabled="busy" class="block w-full text-center text-coral text-sm mt-3 hover:underline">{{ s.cart.clear }}</button>
      <a :href="shopHref" class="block text-center text-teal-700 text-sm mt-3 hover:underline">{{ s.cart.continueShopping }}</a>
    </aside>
  </div>
</template>
