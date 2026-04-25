<template>
  <div class="achievements-grid border-t border-ink-200">
    <div
      v-for="(item, index) in items"
      :key="item.year"
      class="bg-ivory-50 p-7 border-b border-ink-200 achievement-cell transition-colors duration-200 hover:bg-white"
    >
      <span class="inline-flex items-center rounded-full bg-gold/15 px-3 py-1 text-xs font-semibold text-gold">
        {{ item.year }}
      </span>
      <h3 class="mt-3 font-display-ar text-lg font-medium text-navy-900">{{ lang === 'ar' ? item.titleAr : item.title }}</h3>
      <p class="mt-2 text-sm text-ink-500 leading-relaxed">{{ lang === 'ar' ? item.descriptionAr : item.description }}</p>
    </div>
    <div
      v-for="n in fillerCount"
      :key="`filler-${n}`"
      class="bg-ivory-50 border-b border-ink-200 achievement-cell"
      aria-hidden="true"
    />
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';

const props = defineProps<{
  items: { year: number; title: string; titleAr: string; description: string; descriptionAr: string; icon?: string }[];
  lang: string;
  strings: any;
}>();

const fillerCount = computed(() => {
  const cols = 3;
  const remainder = props.items.length % cols;
  return remainder === 0 ? 0 : cols - remainder;
});
</script>

<style scoped>
.achievements-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  border-inline-start: 1px solid #d9dfe6;
}
.achievement-cell {
  border-inline-end: 1px solid #d9dfe6;
}
@media (max-width: 900px) {
  .achievements-grid {
    grid-template-columns: repeat(2, 1fr);
  }
}
@media (max-width: 600px) {
  .achievements-grid {
    grid-template-columns: 1fr;
  }
}
</style>
