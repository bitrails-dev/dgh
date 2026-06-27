<script setup lang="ts">
import { ref, watch } from 'vue';
import { Search } from 'lucide-vue-next';

const props = defineProps<{ modelValue: string; placeholder?: string }>();
const emit = defineEmits<{ 'update:modelValue': [value: string] }>();

const input = ref(props.modelValue);
let timeout: ReturnType<typeof setTimeout>;

watch(input, (val) => {
  clearTimeout(timeout);
  timeout = setTimeout(() => emit('update:modelValue', val), 300);
});
</script>

<template>
  <div class="relative">
    <Search class="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
    <input
      v-model="input"
      type="search"
      :placeholder="placeholder || 'بحث...'"
      class="w-full pr-10 pl-4 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
    />
  </div>
</template>
