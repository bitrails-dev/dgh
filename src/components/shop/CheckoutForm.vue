<script setup lang="ts">
// Checkout form: collects contact + address + payment method, then places the order via the BFF. COD/
// bank complete inline with the order number; Paymob/Kashier redirect to the hosted checkout URL.
import { ref, reactive, onMounted } from "vue";
import { storeApi } from "../../lib/store/client";
import { formatMoney } from "../../lib/store/money";

const props = defineProps<{ lang: "ar" | "en"; strings: any }>();
const s = props.strings.shop;

const items = ref<{ sku: string; quantity: number }[]>([]);
const amountDue = ref(0);
const currency = ref("EGP");
const loading = ref(true);
const placing = ref(false);
const placed = ref<{ orderNumber: string; method: string } | null>(null);
const redirecting = ref(false);
const error = ref("");

const form = reactive({
  email: "",
  phone: "",
  address: "",
  city: "",
  paymentMethod: "cod" as "cod" | "bank" | "paymob" | "kashier",
});

async function load() {
  loading.value = true;
  try {
    const c = await storeApi.cart();
    items.value = c.items ?? [];
    amountDue.value = c.quote?.amountDue ?? 0;
    currency.value = c.quote?.currency ?? "EGP";
  } catch {
    /* empty */
  } finally {
    loading.value = false;
  }
}

async function submit() {
  placing.value = true;
  error.value = "";
  placed.value = null;
  try {
    const returnUrl = `${window.location.origin}${props.lang === "en" ? "/en" : ""}/checkout`;
    const r = await storeApi.checkout({
      items: items.value,
      customerEmail: form.email,
      customerPhone: form.phone || undefined,
      shippingAddress: { address: form.address, city: form.city },
      paymentMethod: form.paymentMethod,
      returnUrl,
    });
    if (r.checkoutUrl) {
      redirecting.value = true;
      window.location.href = r.checkoutUrl;
      return;
    }
    placed.value = { orderNumber: r.orderNumber, method: form.paymentMethod };
  } catch (e: any) {
    error.value = e?.body?.error === "insufficient_stock" ? s.checkout.insufficientStock : e?.body?.error || s.checkout.error;
  } finally {
    placing.value = false;
  }
}

onMounted(load);
</script>

<template>
  <h1 class="font-display-ar text-3xl font-bold text-navy-900 mb-6">{{ s.checkout.title }}</h1>

  <div v-if="loading" class="text-ink-400">{{ s.account.loading }}</div>

  <div v-else-if="items.length === 0" class="text-ink-500">{{ s.cart.empty }}</div>

  <div v-else-if="placed" class="card p-8 text-center">
    <h2 class="text-2xl font-bold text-teal-700 mb-2">{{ s.checkout.orderPlaced }}</h2>
    <p class="text-ink-600">{{ s.checkout.orderNumber }}: <span class="font-mono font-bold">{{ placed.orderNumber }}</span></p>
    <p v-if="placed.method === 'cod' || placed.method === 'bank'" class="text-ink-500 text-sm mt-2">{{ s.checkout.manualConfirm }}</p>
  </div>

  <form v-else @submit.prevent="submit" class="grid lg:grid-cols-2 gap-8">
    <div class="space-y-5">
      <h2 class="font-display-ar text-xl font-bold text-navy-900">{{ s.checkout.contact }}</h2>
      <label class="block">
        <span class="text-sm font-medium text-ink-700">{{ s.checkout.email }}</span>
        <input type="email" required v-model="form.email" class="w-full mt-1 border border-ink-200 rounded-lg px-3 py-2 bg-white" />
      </label>
      <label class="block">
        <span class="text-sm font-medium text-ink-700">{{ s.checkout.phone }}</span>
        <input type="tel" v-model="form.phone" class="w-full mt-1 border border-ink-200 rounded-lg px-3 py-2 bg-white" />
      </label>
      <label class="block">
        <span class="text-sm font-medium text-ink-700">{{ s.checkout.address }}</span>
        <input type="text" required v-model="form.address" class="w-full mt-1 border border-ink-200 rounded-lg px-3 py-2 bg-white" />
      </label>
      <label class="block">
        <span class="text-sm font-medium text-ink-700">{{ s.checkout.city }}</span>
        <input type="text" required v-model="form.city" class="w-full mt-1 border border-ink-200 rounded-lg px-3 py-2 bg-white" />
      </label>
    </div>

    <div class="space-y-5">
      <h2 class="font-display-ar text-xl font-bold text-navy-900">{{ s.checkout.paymentMethod }}</h2>
      <div class="space-y-2">
        <label class="flex items-center gap-2"><input type="radio" value="cod" v-model="form.paymentMethod" /> {{ s.checkout.cod }}</label>
        <label class="flex items-center gap-2"><input type="radio" value="bank" v-model="form.paymentMethod" /> {{ s.checkout.bank }}</label>
        <label class="flex items-center gap-2"><input type="radio" value="paymob" v-model="form.paymentMethod" /> {{ s.checkout.paymob }}</label>
      </div>
      <div class="card p-4 flex justify-between items-center">
        <span class="font-bold">{{ s.cart.total }}</span>
        <span class="font-bold text-teal-700">{{ formatMoney(amountDue, currency) }}</span>
      </div>
      <button type="submit" :disabled="placing || redirecting" class="btn btn-primary w-full disabled:opacity-60">
        {{ redirecting ? s.checkout.redirecting : placing ? s.checkout.placing : s.checkout.placeOrder }}
      </button>
      <p v-if="error" class="text-coral text-sm">{{ error }}</p>
    </div>
  </form>
</template>
