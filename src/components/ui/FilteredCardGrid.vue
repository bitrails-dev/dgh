<template>
  <div>
    <!-- Category filter -->
    <div class="mb-8 flex flex-wrap gap-2">
      <button
        v-for="cat in filterOptions"
        :key="cat.value"
        class="btn text-sm"
        :class="selectedCategory === cat.value ? 'btn-primary' : 'btn-ghost'"
        @click="selectedCategory = cat.value; currentPage = 1"
      >
        {{ lang === 'ar' ? cat.labelAr : cat.labelEn }}
      </button>
    </div>

    <!-- Cards grid -->
    <div v-if="paginatedItems.length > 0" class="card-grid">
      <template v-for="item in paginatedItems" :key="item.slug">
        <!-- Event card -->
        <article v-if="cardType === 'event'" class="group flex flex-col overflow-hidden border border-ink-100 transition-colors duration-200">
          <div class="relative overflow-hidden h-44 shrink-0 bg-gradient-to-br from-navy-900/80 to-teal-700/80">
            <img
              v-if="item.thumbnail && !item.thumbnail.includes('picsum')"
              :src="item.thumbnail"
              :alt="getTitle(item)"
              class="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
              loading="lazy"
            />
            <div v-else class="flex h-full items-center justify-center">
              <svg xmlns="http://www.w3.org/2000/svg" class="h-12 w-12 text-white/40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <rect x="3" y="4" width="18" height="18"/>
                <line x1="16" y1="2" x2="16" y2="6"/>
                <line x1="8" y1="2" x2="8" y2="6"/>
                <line x1="3" y1="10" x2="21" y2="10"/>
              </svg>
            </div>
          </div>
          <div class="flex flex-1 flex-col p-5 bg-ivory-50 group-hover:bg-white transition-colors duration-200">
            <div class="flex flex-wrap items-center gap-2 mb-2">
              <span class="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold" :class="getCategoryClass(item.category)">
                {{ getCategoryLabel(item.category) }}
              </span>
              <span v-if="item.date" class="text-ink-300" aria-hidden="true">·</span>
              <time v-if="item.date" class="text-xs text-ink-400">{{ formatDate(item.date) }}</time>
            </div>
            <h3 class="text-base font-bold text-ink-900 leading-snug group-hover:text-teal-700 transition-colors">
              {{ getTitle(item) }}
            </h3>
            <p v-if="getSummary(item)" class="mt-2 text-sm text-ink-500 line-clamp-2">{{ getSummary(item) }}</p>
            <div class="mt-auto pt-4">
              <a :href="`${basePath}/${item.slug}`" class="btn-text text-sm">
                {{ lang === 'ar' ? 'اقرأ المزيد ←' : 'Read More →' }}
              </a>
            </div>
          </div>
        </article>

        <!-- Article card -->
        <article v-else class="group flex flex-col overflow-hidden border border-ink-100 transition-colors duration-200">
          <div class="relative overflow-hidden h-44 shrink-0 bg-gradient-to-br from-navy-900/80 to-teal-700/80">
            <img
              v-if="item.thumbnail && !item.thumbnail.includes('picsum')"
              :src="item.thumbnail"
              :alt="getTitle(item)"
              class="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
              loading="lazy"
            />
            <div v-else class="flex h-full items-center justify-center">
              <svg xmlns="http://www.w3.org/2000/svg" class="h-12 w-12 text-white/40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/>
                <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>
              </svg>
            </div>
          </div>
          <div class="flex flex-1 flex-col p-5 bg-ivory-50 group-hover:bg-white transition-colors duration-200">
            <time v-if="item.date" class="text-xs text-ink-400 mb-2">{{ formatDate(item.date) }}</time>
            <h3 class="text-base font-bold text-ink-900 leading-snug group-hover:text-teal-700 transition-colors">
              {{ getTitle(item) }}
            </h3>
            <p v-if="getSummary(item)" class="mt-2 text-sm text-ink-500 line-clamp-2">{{ getSummary(item) }}</p>
            <div class="mt-auto pt-4">
              <a :href="`${basePath}/${item.slug}`" class="btn-text text-sm">
                {{ lang === 'ar' ? 'اقرأ المزيد ←' : 'Read More →' }}
              </a>
            </div>
          </div>
        </article>
      </template>
    </div>

    <!-- Empty state -->
    <div v-else class="text-center py-12">
      <p class="text-ink-500">{{ lang === 'ar' ? 'لا توجد عناصر' : 'No items found' }}</p>
    </div>

    <!-- Pagination -->
    <div v-if="totalPages > 1" class="mt-10 flex items-center justify-center gap-2">
      <button v-if="currentPage > 1" class="btn btn-ghost text-sm" @click="currentPage--">
        {{ lang === 'ar' ? 'السابق' : 'Prev' }}
      </button>
      <div class="flex gap-1">
        <button
          v-for="page in paginationRange"
          :key="page"
          class="btn text-sm"
          :class="currentPage === page ? 'btn-primary' : 'btn-ghost'"
          @click="currentPage = page"
        >
          {{ page }}
        </button>
      </div>
      <button v-if="currentPage < totalPages" class="btn btn-ghost text-sm" @click="currentPage++">
        {{ lang === 'ar' ? 'التالي' : 'Next' }}
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';

interface Item {
  id: string;
  slug: string;
  title: string;
  titleAr: string;
  category?: string;
  thumbnail?: string;
  date?: string;
  summary?: string;
  summaryAr?: string;
}

interface Category {
  value: string;
  labelAr: string;
  labelEn: string;
}

interface Props {
  items: Item[];
  categories: Category[];
  lang: 'ar' | 'en';
  basePath: string;
  itemsPerPage?: number;
  cardType: 'article' | 'event';
}

const props = withDefaults(defineProps<Props>(), {
  itemsPerPage: 8,
});

const currentPage = ref(1);
const selectedCategory = ref('all');

const filterOptions = computed(() => [
  { value: 'all', labelEn: 'All', labelAr: 'الكل' },
  ...props.categories,
]);

const filteredItems = computed(() => {
  if (selectedCategory.value === 'all') return props.items;
  return props.items.filter((item) => item.category === selectedCategory.value);
});

const totalPages = computed(() => Math.ceil(filteredItems.value.length / props.itemsPerPage));

const paginatedItems = computed(() => {
  const start = (currentPage.value - 1) * props.itemsPerPage;
  return filteredItems.value.slice(start, start + props.itemsPerPage);
});

const paginationRange = computed(() => {
  const range: number[] = [];
  const maxVisible = 5;
  const halfVisible = Math.floor(maxVisible / 2);
  let start = Math.max(1, currentPage.value - halfVisible);
  let end = Math.min(totalPages.value, start + maxVisible - 1);
  if (end - start < maxVisible - 1) start = Math.max(1, end - maxVisible + 1);
  for (let i = start; i <= end; i++) range.push(i);
  return range;
});

const getTitle = (item: Item) => (props.lang === 'ar' ? item.titleAr : item.title);
const getSummary = (item: Item) => (props.lang === 'ar' ? item.summaryAr : item.summary);

const formatDate = (dateStr: string) =>
  new Date(dateStr).toLocaleDateString(props.lang === 'ar' ? 'ar-EG' : 'en-US', {
    year: 'numeric', month: 'short', day: 'numeric',
  });

const getCategoryClass = (category?: string) => {
  const map: Record<string, string> = {
    procedure: 'bg-teal-700/10 text-teal-700',
    event: 'bg-navy-900/10 text-navy-900',
    announcement: 'bg-gold/15 text-gold',
  };
  return map[category ?? ''] ?? 'bg-ink-500/10 text-ink-500';
};

const getCategoryLabel = (category?: string) => {
  const cat = props.categories.find((c) => c.value === category);
  return cat ? (props.lang === 'ar' ? cat.labelAr : cat.labelEn) : '';
};
</script>

<style scoped>
.card-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 1.25rem;
}
@media (max-width: 900px) {
  .card-grid { grid-template-columns: repeat(2, 1fr); }
}
@media (max-width: 600px) {
  .card-grid { grid-template-columns: 1fr; }
}
</style>
