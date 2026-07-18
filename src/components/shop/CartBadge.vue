<script setup lang="ts">
// Live item-count badge for the shop header cart link. Loads the cookie-scoped cart on mount and
// sums line quantities. Fails silently (no badge) if the cart can't be read.
import { ref, onMounted, onUnmounted } from "vue";
import { storeApi } from "../../lib/store/client";

const count = ref(0);
let onPageLoad: (() => void) | null = null;

async function load() {
  try {
    const c = await storeApi.cart();
    count.value = (c.items ?? []).reduce((n: number, i: any) => n + Number(i.quantity || 0), 0);
  } catch {
    count.value = 0;
  }
}

onMounted(() => {
  load();
  // Refresh on View Transitions navigations so the badge stays accurate across soft route changes.
  onPageLoad = () => load();
  document.addEventListener("astro:page-load", onPageLoad);
});
onUnmounted(() => {
  if (onPageLoad) document.removeEventListener("astro:page-load", onPageLoad);
});
</script>

<template>
  <span
    v-if="count > 0"
    class="inline-flex items-center justify-center min-w-[1.25rem] h-5 px-1 rounded-full bg-coral text-ivory-50 text-xs font-semibold"
  >{{ count }}</span>
</template>
