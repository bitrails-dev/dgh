<script setup lang="ts">
import { X } from 'lucide-vue-next';

defineProps<{ open: boolean; title: string }>();
const emit = defineEmits<{ close: []; submit: [] }>();
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="fixed inset-0 z-50 flex items-center justify-center">
      <div class="absolute inset-0 bg-black/50" @click="emit('close')" />
      <div class="relative bg-white rounded-xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto mx-4">
        <div class="flex items-center justify-between p-4 border-b border-gray-200">
          <h3 class="text-lg font-semibold">{{ title }}</h3>
          <button @click="emit('close')" class="p-1 text-gray-500 hover:text-gray-700"><X class="w-5 h-5" /></button>
        </div>
        <form @submit.prevent="emit('submit')" class="p-4 space-y-4">
          <slot />
          <div class="flex items-center justify-end gap-3 pt-4 border-t border-gray-200">
            <button type="button" @click="emit('close')" class="px-4 py-2 text-sm text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200">إلغاء</button>
            <button type="submit" class="px-4 py-2 text-sm text-white bg-blue-600 rounded-lg hover:bg-blue-700">حفظ</button>
          </div>
        </form>
      </div>
    </div>
  </Teleport>
</template>
