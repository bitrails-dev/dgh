<script setup lang="ts">
// Catalog list (Wave E3). Client-hydrated island that reads the signed store catalog via shopApi.
// Supports text search, page-based pagination, and inline add-to-cart. Loading / empty / no-results /
// error states are all rendered; the grid is keyboard-reachable (real <a>/<button> elements).
import { ref, computed, onMounted, onUnmounted } from "vue";
import { shopApi } from "./api";
import { formatMoney } from "../../lib/store/money";
import { localePath } from "../../i18n";

const props = defineProps<{ lang: "ar" | "en"; strings: any }>();
const s = computed(() => props.strings.shop);

const items = ref<any[]>([]);
const total = ref(0);
const page = ref(1);
const limit = 24;
const q = ref("");
const loading = ref(true);
const error = ref("");
const addedSku = ref<string | null>(null);
const busySku = ref<string | null>(null);
let onPageLoad: (() => void) | null = null;

const totalPages = computed(() => Math.max(1, Math.ceil(total.value / limit)));
const resultText = computed(() => {
  const c = s.value.catalog;
  if (total.value === 1) return c.resultsOne;
  return c.resultsMany.replace("{n}", String(total.value));
});
function link(p: any): string {
  return localePath(`/shop/${p.slug || p.id}`, props.lang);
}
// NL10: only allow http(s) image URLs through to :src. Blocks data:/javascript:/blob: URLs that a
// compromised CMS media field could otherwise inject into the gallery <img>.
function safeImg(url?: string): string {
  if (!url) return "";
  try {
    const u = new URL(url);
    return u.protocol === "https:" || u.protocol === "http:" ? url : "";
  } catch {
    return "";
  }
}
function price(p: any): { value: number; from?: boolean } {
  if (typeof p?.price === "number") return { value: p.price };
  if (typeof p?.priceRange?.min === "number") return { value: p.priceRange.min, from: true };
  if (Array.isArray(p?.variants) && p.variants.length) {
    const first = p.variants.find((v: any) => typeof v?.price === "number");
    if (first) return { value: first.price, from: p.variants.length > 1 };
  }
  return { value: 0 };
}

async function load() {
  loading.value = true;
  error.value = "";
  try {
    const r = await shopApi.catalog({
      q: q.value || undefined,
      page: page.value,
      limit,
      locale: props.lang,
    });
    items.value = r.items ?? [];
    total.value = r.total ?? items.value.length;
    if (page.value > totalPages.value) page.value = totalPages.value;
  } catch (e: any) {
    error.value = e?.body?.error || s.value.errors.generic;
    items.value = [];
    total.value = 0;
  } finally {
    loading.value = false;
  }
}

function submitSearch() {
  page.value = 1;
  load();
}
function go(n: number) {
  page.value = Math.min(Math.max(1, n), totalPages.value);
  load();
  if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
}

async function add(p: any) {
  const sku = String(p.sku || p.id || "");
  if (!sku) return;
  busySku.value = sku;
  addedSku.value = null;
  try {
    await shopApi.addItem(sku, 1);
    addedSku.value = sku;
    setTimeout(() => {
      if (addedSku.value === sku) addedSku.value = null;
    }, 1500);
  } catch (e: any) {
    error.value = e?.body?.error || s.value.errors.generic;
  } finally {
    busySku.value = null;
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
  <h1 class="font-display-ar text-3xl font-bold text-navy-900 mb-6">{{ s.title }}</h1>

  <form @submit.prevent="submitSearch" class="mb-6 flex gap-2" role="search">
    <label class="sr-only" for="shop-q">{{ s.catalog.searchPlaceholder }}</label>
    <input
      id="shop-q"
      type="search"
      v-model="q"
      :placeholder="s.catalog.searchPlaceholder"
      class="flex-1 border border-ink-200 rounded-lg px-4 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-teal-500"
    />
    <button type="submit" class="btn btn-teal">{{ s.catalog.searchPlaceholder }}</button>
  </form>

  <p v-if="!loading && !error && items.length" class="text-sm text-ink-500 mb-4">{{ resultText }}</p>

  <p v-if="loading" class="text-ink-400">{{ s.catalog.loading }}</p>
  <p v-else-if="error" class="text-coral" role="alert">{{ error }}</p>
  <p v-else-if="q && items.length === 0" class="text-ink-500">{{ s.catalog.noResults }}</p>
  <p v-else-if="items.length === 0" class="text-ink-500">{{ s.catalog.empty }}</p>

  <div v-if="!loading && items.length" class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-5">
    <div v-for="p in items" :key="p.sku || p.id" class="card overflow-hidden flex flex-col">
      <a :href="link(p)" class="block hover:shadow-md transition-shadow">
        <img v-if="safeImg(p.images?.[0]?.url)" :src="safeImg(p.images?.[0]?.url)" :alt="p.name" class="w-full aspect-square object-cover bg-ivory-100" />
        <div v-else class="w-full aspect-square bg-ivory-100"></div>
      </a>
      <div class="p-4 flex flex-col flex-1">
        <a :href="link(p)" class="font-semibold text-ink-900 line-clamp-2 hover:text-teal-700">
          {{ p.name }}
        </a>
        <p class="text-teal-700 font-bold mt-1">
          <span v-if="price(p).from">{{ s.catalog.priceFrom }} </span>{{ formatMoney(price(p).value, p.currency) }}
        </p>
        <button
          v-if="p.sku || p.id"
          type="button"
          @click="add(p)"
          :disabled="busySku === (p.sku || p.id)"
          class="btn btn-primary mt-3 disabled:opacity-60"
        >
          {{ addedSku === (p.sku || p.id) ? s.product.added : s.product.addToCart }}
        </button>
      </div>
    </div>
  </div>

  <div v-if="!loading && totalPages > 1" class="flex items-center justify-center gap-4 mt-8">
    <button class="btn btn-ghost" :disabled="page <= 1" @click="go(page - 1)">{{ s.catalog.previous }}</button>
    <span class="text-sm text-ink-500">{{ s.catalog.page }} {{ page }} {{ s.catalog.of }} {{ totalPages }}</span>
    <button class="btn btn-ghost" :disabled="page >= totalPages" @click="go(page + 1)">{{ s.catalog.next }}</button>
  </div>
</template>
