<script setup lang="ts">
// Product detail (Wave E3). Client-hydrated island that fetches a single sellable by slug via
// shopApi.product and renders gallery + meta + the ProductBuy widget. Falls back to a not-found
// state + link back to the catalog when the slug is missing/unavailable.
import { ref, computed, onMounted, onUnmounted } from "vue";
import { shopApi } from "./api";
import { formatMoney } from "../../lib/store/money";
import { localePath } from "../../i18n";
import ProductBuy from "./ProductBuy.vue";

const props = defineProps<{ lang: "ar" | "en"; strings: any; slug: string }>();
const s = computed(() => props.strings.shop);

const product = ref<any>(null);
const loading = ref(true);
const error = ref("");
let onPageLoad: (() => void) | null = null;

const activeImage = ref(0);
const images = computed<any[]>(() => Array.isArray(product.value?.images) ? product.value.images : []);
const displayPrice = computed(() => {
  const p = product.value;
  if (!p) return { value: 0 };
  if (typeof p.price === "number") return { value: p.price };
  if (Array.isArray(p.variants) && p.variants.length) {
    const first = p.variants.find((v: any) => typeof v?.price === "number");
    if (first) return { value: first.price, from: p.variants.length > 1 };
  }
  return { value: 0 };
});
const shopHref = computed(() => localePath("/shop", props.lang));

async function load() {
  loading.value = true;
  error.value = "";
  product.value = null;
  activeImage.value = 0;
  try {
    product.value = await shopApi.product(props.slug);
  } catch (e: any) {
    error.value = e?.body?.error || s.value.errors.generic;
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
  <p v-if="loading" class="text-ink-400">{{ s.account.loading }}</p>
  <p v-else-if="error" class="text-coral" role="alert">{{ error }}</p>

  <div v-else-if="product" class="grid md:grid-cols-2 gap-8">
    <div>
      <img
        v-if="images[activeImage]?.url"
        :src="images[activeImage].url"
        :alt="product.name"
        class="w-full rounded-2xl bg-ivory-100 object-cover"
      />
      <div v-else class="w-full aspect-square rounded-2xl bg-ivory-100"></div>
      <div v-if="images.length > 1" class="flex gap-2 mt-3">
        <button
          v-for="(img, i) in images"
          :key="i"
          type="button"
          @click="activeImage = i"
          :aria-label="`${s.product.viewProduct} ${i + 1}`"
          :class="['w-16 h-16 rounded-lg overflow-hidden border-2', i === activeImage ? 'border-teal-600' : 'border-transparent']"
        >
          <img v-if="img?.url" :src="img.url" :alt="''" class="w-full h-full object-cover" />
        </button>
      </div>
    </div>

    <div>
      <h1 class="font-display-ar text-3xl font-bold text-navy-900">{{ product.name }}</h1>
      <p class="text-2xl text-teal-700 font-bold mt-2">
        <span v-if="displayPrice.from">{{ s.catalog.priceFrom }} </span>{{ formatMoney(displayPrice.value, product.currency) }}
      </p>
      <p v-if="product.description" class="text-ink-600 mt-4 leading-relaxed">{{ product.description }}</p>
      <p v-if="product.sku" class="text-xs text-ink-400 mt-3">{{ product.sku }}</p>
      <ProductBuy :lang="lang" :strings="strings" :product="product" />
    </div>
  </div>

  <div v-else class="text-center py-16">
    <p class="text-ink-500 mb-4">{{ s.product.notFound }}</p>
    <a :href="shopHref" class="btn btn-teal">{{ s.cart.continueShopping }}</a>
  </div>
</template>
