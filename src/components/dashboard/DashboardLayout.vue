<script setup lang="ts">
import { useDashboardStore } from '../../stores/dashboard';
import PublishButton from './views/PublishButton.vue';
import { Menu, X, Home, FileText, Users, Building2, Trophy, Award, Newspaper } from 'lucide-vue-next';

const store = useDashboardStore();

const navItems = [
  { id: 'overview',      label: 'نظرة عامة',  icon: Home },
  { id: 'articles',      label: 'المقالات',    icon: FileText },
  { id: 'doctors',       label: 'الأطباء',     icon: Users },
  { id: 'departments',   label: 'الأقسام',     icon: Building2 },
  { id: 'achievements',  label: 'الإنجازات',   icon: Trophy },
  { id: 'awards',        label: 'الجوائز',     icon: Award },
  { id: 'news',          label: 'الأخبار',     icon: Newspaper },
];
</script>

<template>
  <!-- Root: fill the full viewport height provided by admin.astro -->
  <div class="flex h-full bg-gray-100 overflow-hidden">

    <!-- ── Sidebar (right in RTL) ─────────────────────────────────── -->
    <aside
      class="flex flex-col flex-shrink-0 w-64 bg-white border-l border-gray-200 transition-transform duration-200"
      :class="store.sidebarOpen ? 'translate-x-0' : 'translate-x-full'"
    >
      <!-- Logo / title -->
      <div class="flex items-center gap-3 px-4 py-5 border-b border-gray-100">
        <div class="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center flex-shrink-0">
          <span class="text-white text-xs font-bold">د</span>
        </div>
        <div class="min-w-0">
          <p class="font-bold text-gray-900 text-sm leading-tight truncate">مستشفى دمياط العام</p>
          <p class="text-xs text-gray-400 leading-tight">لوحة التحكم</p>
        </div>
      </div>

      <!-- Navigation -->
      <nav class="flex flex-col flex-1 overflow-y-auto gap-0.5 p-2">
        <button
          v-for="item in navItems"
          :key="item.id"
          class="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors text-right"
          :class="store.currentView === item.id
            ? 'bg-blue-50 text-blue-700'
            : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'"
          @click="store.navigate(item.id)"
        >
          <component :is="item.icon" class="w-4 h-4 flex-shrink-0" />
          <span>{{ item.label }}</span>
        </button>
      </nav>
    </aside>

    <!-- ── Main content ───────────────────────────────────────────── -->
    <div class="flex flex-col flex-1 min-w-0 overflow-hidden">

      <!-- Top bar -->
      <header class="flex items-center gap-3 px-5 py-3 bg-white border-b border-gray-200 flex-shrink-0">
        <button
          class="p-1.5 rounded-md text-gray-500 hover:text-gray-700 hover:bg-gray-100 transition-colors"
          @click="store.sidebarOpen = !store.sidebarOpen"
        >
          <X v-if="store.sidebarOpen" class="w-5 h-5" />
          <Menu v-else class="w-5 h-5" />
        </button>

        <h1 class="text-base font-semibold text-gray-800 flex-1">
          {{ navItems.find(n => n.id === store.currentView)?.label }}
        </h1>

        <PublishButton />
      </header>

      <!-- Page content -->
      <main class="flex-1 overflow-y-auto p-6">
        <slot />
      </main>
    </div>
  </div>
</template>
