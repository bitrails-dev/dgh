<script setup lang="ts">
import { ref } from 'vue';
import { useApi } from '../composables/useApi';
import { Upload, Check, Loader2 } from 'lucide-vue-next';

const { post } = useApi();
const publishing = ref(false);
const published = ref(false);

async function publish() {
  publishing.value = true;
  published.value = false;
  try {
    await post('/api/sync/publish', {});
    published.value = true;
    setTimeout(() => { published.value = false; }, 3000);
  } finally { publishing.value = false; }
}
</script>

<template>
  <button @click="publish" :disabled="publishing" class="flex items-center gap-2 px-4 py-2 text-sm rounded-lg transition-colors" :class="published ? 'bg-green-600 text-white' : 'bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50'">
    <Check v-if="published" class="w-4 h-4" />
    <Loader2 v-else-if="publishing" class="w-4 h-4 animate-spin" />
    <Upload v-else class="w-4 h-4" />
    {{ published ? 'تم النشر' : 'نشر التغييرات' }}
  </button>
</template>
