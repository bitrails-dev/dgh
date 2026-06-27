<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useApi } from '../composables/useApi';
import { FileText, Users, Building2, Newspaper, Trophy, Award } from 'lucide-vue-next';

const { get } = useApi();
const loading = ref(true);

const stats = ref([
  { id: 'articles',      label: 'المقالات',   count: 0, icon: FileText,  bg: 'bg-blue-50',   fg: 'text-blue-600'   },
  { id: 'doctors',       label: 'الأطباء',    count: 0, icon: Users,     bg: 'bg-emerald-50', fg: 'text-emerald-600' },
  { id: 'departments',   label: 'الأقسام',    count: 0, icon: Building2, bg: 'bg-violet-50', fg: 'text-violet-600'  },
  { id: 'achievements',  label: 'الإنجازات',  count: 0, icon: Trophy,    bg: 'bg-amber-50',  fg: 'text-amber-600'   },
  { id: 'awards',        label: 'الجوائز',    count: 0, icon: Award,     bg: 'bg-rose-50',   fg: 'text-rose-600'    },
  { id: 'news',          label: 'الأخبار',    count: 0, icon: Newspaper, bg: 'bg-sky-50',    fg: 'text-sky-600'     },
]);

onMounted(async () => {
  try {
    const [articles, doctors, departments, achievements, awards, news] = await Promise.all([
      get<{ data: unknown[] }>('/api/articles?limit=200'),
      get<{ data: unknown[] }>('/api/doctors?limit=200'),
      get<{ data: unknown[] }>('/api/departments?limit=200'),
      get<{ data: unknown[] }>('/api/achievements?limit=200'),
      get<{ data: unknown[] }>('/api/awards?limit=200'),
      get<{ data: unknown[] }>('/api/news?limit=200'),
    ]);
    stats.value[0].count = articles.data.length;
    stats.value[1].count = doctors.data.length;
    stats.value[2].count = departments.data.length;
    stats.value[3].count = achievements.data.length;
    stats.value[4].count = awards.data.length;
    stats.value[5].count = news.data.length;
  } catch {
    // counts stay at 0 if worker is unreachable
  } finally {
    loading.value = false;
  }
});
</script>

<template>
  <div class="space-y-6">
    <p class="text-sm text-gray-500">ملخص محتوى الموقع</p>

    <div class="grid grid-cols-2 lg:grid-cols-3 gap-4">
      <div
        v-for="stat in stats"
        :key="stat.id"
        class="bg-white rounded-xl border border-gray-200 p-5 flex items-center gap-4"
      >
        <!-- Icon -->
        <div class="w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0" :class="stat.bg">
          <component :is="stat.icon" class="w-6 h-6" :class="stat.fg" />
        </div>
        <!-- Text -->
        <div class="min-w-0">
          <p class="text-2xl font-bold text-gray-900 leading-none">
            <span v-if="loading" class="inline-block w-8 h-6 bg-gray-100 rounded animate-pulse" />
            <span v-else>{{ stat.count }}</span>
          </p>
          <p class="text-sm text-gray-500 mt-1">{{ stat.label }}</p>
        </div>
      </div>
    </div>
  </div>
</template>
