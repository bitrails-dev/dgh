<script setup lang="ts">
// Variant picker + quantity + add-to-cart for a product detail page (Wave E3). Calls the plugin
// cart server op shopApi.addItem(sku, qty); the server merges the line into the cookie-scoped
// cart by SKU and re-prices. No client-side read-merge-write, no client totals.
import { ref, computed } from "vue";
import { shopApi } from "./api";

const props = defineProps<{ lang: "ar" | "en"; strings: any; product: any }>();
const s = computed(() => props.strings.shop);

const variants = computed(() => (Array.isArray(props.product.variants) ? props.product.variants : []));
const hasVariants = computed(() => variants.value.length > 0);
const selectedSku = ref(hasVariants.value ? variants.value[0]?.sku : props.product.sku);
const qty = ref(1);
const busy = ref(false);
const done = ref(false);
const error = ref("");

async function addToCart() {
  const sku = String(selectedSku.value ?? "");
  if (!sku || qty.value < 1) return;
  busy.value = true;
  done.value = false;
  error.value = "";
  try {
    await shopApi.addItem(sku, qty.value);
    done.value = true;
    setTimeout(() => (done.value = false), 1500);
  } catch (e: any) {
    error.value = e?.body?.error || s.value.errors.generic;
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div class="mt-6">
    <div v-if="hasVariants" class="mb-4">
      <label class="block text-sm font-medium text-ink-700 mb-1" for="pb-variant">{{ s.product.variants }}</label>
      <select
        id="pb-variant"
        v-model="selectedSku"
        class="w-full md:w-72 border border-ink-200 rounded-lg px-3 py-2 bg-white"
      >
        <option v-for="v in variants" :key="v.sku" :value="v.sku">{{ v.name || v.sku }}</option>
      </select>
    </div>
    <div class="flex items-center gap-3 mb-5">
      <label class="text-sm font-medium text-ink-700" for="pb-qty">{{ s.product.quantity }}</label>
      <input
        id="pb-qty"
        type="number" min="1" v-model.number="qty"
        class="w-20 border border-ink-200 rounded-lg px-2 py-2 bg-white text-center"
      />
    </div>
    <button
      @click="addToCart" :disabled="busy || qty < 1"
      class="btn btn-primary disabled:opacity-60"
    >
      {{ done ? s.product.added : s.product.addToCart }}
    </button>
    <p v-if="error" class="text-coral text-sm mt-2" role="alert">{{ error }}</p>
  </div>
</template>
