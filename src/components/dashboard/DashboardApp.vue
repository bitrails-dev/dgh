<script setup lang="ts">
import { computed } from 'vue';
import { useDashboardStore } from '../../stores/dashboard';
import DashboardLayout from './DashboardLayout.vue';
import OverviewView from './views/OverviewView.vue';
import ArticlesView from './views/ArticlesView.vue';
import DoctorsView from './views/DoctorsView.vue';
import DepartmentsView from './views/DepartmentsView.vue';
import AchievementsView from './views/AchievementsView.vue';
import AwardsView from './views/AwardsView.vue';
import NewsView from './views/NewsView.vue';

const store = useDashboardStore();

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const views: Record<string, any> = {
  overview:     OverviewView,
  articles:     ArticlesView,
  doctors:      DoctorsView,
  departments:  DepartmentsView,
  achievements: AchievementsView,
  awards:       AwardsView,
  news:         NewsView,
};

const currentView = computed(() => views[store.currentView] ?? OverviewView);
</script>

<template>
  <DashboardLayout>
    <component :is="currentView" />
  </DashboardLayout>
</template>
