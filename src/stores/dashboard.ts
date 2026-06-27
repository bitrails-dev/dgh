import { defineStore } from 'pinia';
import { ref } from 'vue';

export const useDashboardStore = defineStore('dashboard', () => {
  const currentView = ref<string>('overview');
  const sidebarOpen = ref(true);
  const searchQuery = ref('');

  function navigate(view: string) {
    currentView.value = view;
  }

  return { currentView, sidebarOpen, searchQuery, navigate };
});
