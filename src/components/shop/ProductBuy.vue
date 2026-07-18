<script setup lang="ts">
// Variant picker + quantity + add-to-cart for a product detail page. Merges the chosen line into the
// existing cookie-scoped cart (the cart POST replaces items, so we read-merge-write) and re-quotes.
import { ref, computed } from "vue";
import { storeApi } from "../../lib/store/client";

const props = defineProps<{ lang: "ar" | "en"; strings: any; product: any }>();
const s = props.strings.shop;

const variants = computed(() => (Array.isArray(props.product.variants) ? props.product.variants : []));
const hasVariants = computed(() => variants.value.length > 0);
const selectedSku = ref(hasVariants.value ? variants.value[0]?.sku : props.product.sku);
const qty = ref(1);
const busy = ref(false);
const done = ref(false);
const error = ref("");

async function addToCart() {
  busy.value = true;
  done.value = false;
  error.value = "";
  try {
    const cart = await storeApi.cart();
    const items = ((cart.items ?? []) as { sku: string; quantity: number }[]).map((i) => ({ ...i }));
    const sku = String(selectedSku.value);
    const existing = items.find((i) => i.sku === sku);
    if (existing) existing.quantity += qty.value;
    else items.push({ sku, quantity: qty.value });
    await storeApi.updateCart(items);
    done.value = true;
    setTimeout(() => (done.value = false), 1500);
  } catch (e: any) {
    error.value = e?.body?.error || s.errors.generic;
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div class="mt-6">
    <div v-if="hasVariants" class="mb-4">
      <label class="block text-sm font-medium text-ink-700 mb-1">{{ s.product.variants }}</label>
      <select
        v-model="selectedSku"
        class="w-full md:w-72 border border-ink-200 rounded-lg px-3 py-2 bg-white"
      >
        <option v-for="v in variants" :key="v.sku" :value="v.sku">{{ v.name || v.sku }}</option>
      </select>
    </div>
    <div class="flex items-center gap-3 mb-5">
      <label class="text-sm font-medium text-ink-700">{{ s.product.quantity }}</label>
      <input
        type="number" min="1" v-model.number="qty"
        class="w-20 border border-ink-200 rounded-lg px-3 py-2 bg-white"
      />
    </div>
    <button
      @click="addToCart" :disabled="busy || qty < 1"
      class="btn btn-primary disabled:opacity-60"
    >
      {{ done ? s.product.added : s.product.addToCart }}
    </button>
    <p v-if="error" class="text-coral text-sm mt-2">{{ error }}</p>
  </div>
</template>
