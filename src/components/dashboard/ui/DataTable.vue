<script setup lang="ts">
import { Pencil, Trash2 } from 'lucide-vue-next';

export interface Column {
  key: string;
  label: string;
  width?: string;
}

const props = defineProps<{
  columns: Column[];
  rows: Record<string, unknown>[];
  loading?: boolean;
}>();

const emit = defineEmits<{
  edit: [row: Record<string, unknown>];
  delete: [row: Record<string, unknown>];
}>();
</script>

<template>
  <div class="overflow-x-auto bg-white rounded-lg border border-gray-200">
    <table class="w-full text-sm">
      <thead class="bg-gray-50 border-b border-gray-200">
        <tr>
          <th
            v-for="col in columns"
            :key="col.key"
            class="px-4 py-3 text-right font-medium text-gray-700"
            :style="col.width ? { width: col.width } : {}"
          >{{ col.label }}</th>
          <th class="px-4 py-3 w-24 text-right font-medium text-gray-700">إجراءات</th>
        </tr>
      </thead>
      <tbody>
        <tr v-if="loading" class="border-b border-gray-100">
          <td :colspan="columns.length + 1" class="px-4 py-8 text-center text-gray-500">جاري التحميل...</td>
        </tr>
        <tr v-else-if="!rows.length" class="border-b border-gray-100">
          <td :colspan="columns.length + 1" class="px-4 py-8 text-center text-gray-500">لا توجد بيانات</td>
        </tr>
        <tr v-for="row in rows" :key="String(row.id)" class="border-b border-gray-100 hover:bg-gray-50 transition-colors">
          <td v-for="col in columns" :key="col.key" class="px-4 py-3">{{ row[col.key] }}</td>
          <td class="px-4 py-3">
            <div class="flex items-center gap-2">
              <button @click="emit('edit', row)" class="p-1 text-blue-600 hover:text-blue-800"><Pencil class="w-4 h-4" /></button>
              <button @click="emit('delete', row)" class="p-1 text-red-600 hover:text-red-800"><Trash2 class="w-4 h-4" /></button>
            </div>
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
