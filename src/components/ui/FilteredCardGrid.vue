<template>
  <div>
    <!-- Category filter -->
    <div class="mb-8 flex flex-wrap gap-2">
      <button
        v-for="cat in filterOptions"
        :key="cat.value"
        class="px-4 py-2 rounded-full text-sm font-semibold transition-all"
        :class="selectedCategory === cat.value
          ? 'bg-primary text-white'
          : 'bg-gray-100 text-text hover:bg-gray-200'"
        @click="selectedCategory = cat.value"
      >
        {{ lang === 'ar' ? cat.labelAr : cat.labelEn }}
      </button>
    </div>

    <!-- Cards grid -->
    <div v-if="paginatedItems.length > 0" :class="`grid gap-6 ${gridColsClass}`">
      <template v-for="item in paginatedItems" :key="item.slug">
        <!-- Event card -->
        <article v-if="cardType === 'event'" class="group flex flex-col overflow-hidden rounded-2xl bg-surface shadow-soft transition-all duration-300 hover:-translate-y-1 hover:shadow-layered">
          <!-- Thumbnail -->
          <div class="relative overflow-hidden bg-gradient-to-br from-primary/80 to-secondary/80 h-44">
            <img
              v-if="item.thumbnail && !item.thumbnail.includes('picsum')"
              :src="item.thumbnail"
              :alt="getTitle(item)"
              class="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
              loading="lazy"
            />
            <div v-else class="flex h-full items-center justify-center">
              <svg xmlns="http://www.w3.org/2000/svg" class="h-12 w-12 text-white/40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>
                <line x1="16" y1="2" x2="16" y2="6"/>
                <line x1="8" y1="2" x2="8" y2="6"/>
                <line x1="3" y1="10" x2="21" y2="10"/>
              </svg>
            </div>
          </div>

          <!-- Content -->
          <div class="flex flex-1 flex-col p-5">
            <div class="flex items-center justify-between gap-2">
              <span class="inline-flex rounded-full px-3 py-1 text-xs font-semibold" :class="getCategoryClass(item.category)">
                {{ getCategoryLabel(item.category) }}
              </span>
              <time v-if="item.date" class="text-xs text-muted/70">{{ formatDate(item.date) }}</time>
            </div>
            <h3 class="mt-3 text-base font-bold text-text leading-snug group-hover:text-primary transition-colors">
              {{ getTitle(item) }}
            </h3>
            <p v-if="getSummary(item)" class="mt-2 text-sm text-muted line-clamp-2">{{ getSummary(item) }}</p>
            <a :href="`${basePath}/${item.slug}`" class="mt-auto pt-4 inline-flex items-center gap-1.5 text-sm font-semibold text-secondary hover:gap-3 transition-all">
              <span>{{ lang === 'ar' ? 'اقرأ المزيد' : 'Read More' }}</span>
              <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 rtl:rotate-180" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="9 18 15 12 9 6"/></svg>
            </a>
          </div>
        </article>

        <!-- Article card -->
        <article v-else class="group flex flex-col overflow-hidden rounded-2xl bg-surface shadow-soft transition-all duration-300 hover:-translate-y-1 hover:shadow-layered">
          <div class="relative overflow-hidden bg-gradient-to-br from-primary/80 to-secondary/80 h-44">
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

          <div class="flex flex-1 flex-col p-5">
            {item.date && <time class="text-xs text-muted/70">{{ formatDate(item.date) }}</time>}
            <h3 class="mt-2 text-base font-bold text-text leading-snug group-hover:text-primary transition-colors">
              {{ getTitle(item) }}
            </h3>
            <p v-if="getSummary(item)" class="mt-2 text-sm text-muted line-clamp-2">{{ getSummary(item) }}</p>
            <a :href="`${basePath}/${item.slug}`" class="mt-auto pt-4 inline-flex items-center gap-1.5 text-sm font-semibold text-secondary hover:gap-3 transition-all">
              <span>{{ lang === 'ar' ? 'اقرأ المزيد' : 'Read More' }}</span>
              <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 rtl:rotate-180" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="9 18 15 12 9 6"/></svg>
            </a>
          </div>
        </article>
      </template>
    </div>

    <!-- Empty state -->
    <div v-else class="text-center py-12">
      <p class="text-muted">{{ lang === 'ar' ? 'لا توجد عناصر' : 'No items found' }}</p>
    </div>

    <!-- Pagination -->
    <div v-if="totalPages > 1" class="mt-10 flex items-center justify-center gap-2">
      <button
        v-if="currentPage > 1"
        class="px-3 py-2 rounded-lg border border-primary text-primary hover:bg-primary hover:text-white transition-colors text-sm"
        @click="currentPage--"
      >
        {{ lang === 'ar' ? 'السابق' : 'Prev' }}
      </button>

      <div class="flex gap-1">
        <button
          v-for="page in paginationRange"
          :key="page"
          class="w-10 h-10 rounded-lg text-sm font-semibold transition-colors"
          :class="currentPage === page
            ? 'bg-primary text-white'
            : 'border border-gray-200 text-text hover:border-primary'"
          @click="currentPage = page"
        >
          {{ page }}
        </button>
      </div>

      <button
        v-if="currentPage < totalPages"
        class="px-3 py-2 rounded-lg border border-primary text-primary hover:bg-primary hover:text-white transition-colors text-sm"
        @click="currentPage++"
      >
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
  if (selectedCategory.value === 'all') {
    return props.items;
  }
  return props.items.filter((item) => item.category === selectedCategory.value);
});

const totalPages = computed(() => Math.ceil(filteredItems.value.length / props.itemsPerPage));

const paginatedItems = computed(() => {
  const start = (currentPage.value - 1) * props.itemsPerPage;
  const end = start + props.itemsPerPage;
  return filteredItems.value.slice(start, end);
});

const paginationRange = computed(() => {
  const range: number[] = [];
  const maxVisible = 5;
  const halfVisible = Math.floor(maxVisible / 2);

  let start = Math.max(1, currentPage.value - halfVisible);
  let end = Math.min(totalPages.value, start + maxVisible - 1);

  if (end - start < maxVisible - 1) {
    start = Math.max(1, end - maxVisible + 1);
  }

  for (let i = start; i <= end; i++) {
    range.push(i);
  }

  return range;
});

const gridColsClass = computed(() => {
  return 'md:grid-cols-2 lg:grid-cols-3';
});

const getTitle = (item: Item) => props.lang === 'ar' ? item.titleAr : item.title;
const getSummary = (item: Item) => props.lang === 'ar' ? item.summaryAr : item.summary;

const formatDate = (dateStr: string) => {
  const date = new Date(dateStr);
  return date.toLocaleDateString(props.lang === 'ar' ? 'ar-EG' : 'en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
};

const getCategoryClass = (category?: string) => {
  const categoryColors: Record<string, string> = {
    procedure: 'bg-secondary/10 text-secondary',
    event: 'bg-primary/10 text-primary',
    announcement: 'bg-accent/15 text-accent',
  };
  return categoryColors[category ?? ''] ?? 'bg-muted/10 text-muted';
};

const getCategoryLabel = (category?: string) => {
  const cat = props.categories.find((c) => c.value === category);
  return cat ? (props.lang === 'ar' ? cat.labelAr : cat.labelEn) : '';
};

import { withDefaults } from 'vue';
</script>
