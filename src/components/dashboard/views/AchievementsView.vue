<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useApi } from '../composables/useApi';
import DataTable, { type Column } from '../ui/DataTable.vue';
import FormModal from '../ui/FormModal.vue';
import { Plus } from 'lucide-vue-next';

const { get, post, put, del, loading } = useApi();
const achievements = ref<Record<string, unknown>[]>([]);
const modalOpen = ref(false);
const editingId = ref<string | null>(null);
const form = ref({ year: new Date().getFullYear(), title: '', title_ar: '', description: '', description_ar: '', icon: '' });

const columns: Column[] = [
  { key: 'title_ar', label: 'العنوان', width: '35%' },
  { key: 'year', label: 'السنة' },
  { key: 'icon', label: 'الأيقونة' },
];

async function load() { const res = await get<{ data: Record<string, unknown>[] }>('/api/achievements'); achievements.value = res.data; }
onMounted(load);

function openCreate() { editingId.value = null; form.value = { year: new Date().getFullYear(), title: '', title_ar: '', description: '', description_ar: '', icon: '' }; modalOpen.value = true; }
function openEdit(row: Record<string, unknown>) { editingId.value = row.id as string; form.value = { ...row } as typeof form.value; modalOpen.value = true; }

async function save() {
  if (editingId.value) { await put(`/api/achievements/${editingId.value}`, form.value); } else { await post('/api/achievements', form.value); }
  modalOpen.value = false; await load();
}

async function remove(row: Record<string, unknown>) { if (!confirm('هل أنت متأكد من الحذف؟')) return; await del(`/api/achievements/${row.id}`); await load(); }
</script>

<template>
  <div class="space-y-4">
    <div class="flex items-center justify-end"><button @click="openCreate" class="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700"><Plus class="w-4 h-4" /> إضافة إنجاز</button></div>
    <DataTable :columns="columns" :rows="achievements" :loading="loading" @edit="openEdit" @delete="remove" />
    <FormModal :open="modalOpen" :title="editingId ? 'تعديل الإنجاز' : 'إضافة إنجاز'" @close="modalOpen = false" @submit="save">
      <div class="grid grid-cols-2 gap-4">
        <div><label class="block text-sm font-medium text-gray-700 mb-1">العنوان (عربي)</label><input v-model="form.title_ar" class="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" /></div>
        <div><label class="block text-sm font-medium text-gray-700 mb-1">Title (English)</label><input v-model="form.title" class="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" /></div>
        <div><label class="block text-sm font-medium text-gray-700 mb-1">السنة</label><input v-model.number="form.year" type="number" class="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" /></div>
        <div><label class="block text-sm font-medium text-gray-700 mb-1">الأيقونة</label><input v-model="form.icon" class="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" /></div>
        <div class="col-span-2"><label class="block text-sm font-medium text-gray-700 mb-1">الوصف (عربي)</label><textarea v-model="form.description_ar" rows="3" class="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" /></div>
        <div class="col-span-2"><label class="block text-sm font-medium text-gray-700 mb-1">Description (English)</label><textarea v-model="form.description" rows="3" class="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" /></div>
      </div>
    </FormModal>
  </div>
</template>
