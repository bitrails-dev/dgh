<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useApi } from '../composables/useApi';
import DataTable, { type Column } from '../ui/DataTable.vue';
import FormModal from '../ui/FormModal.vue';
import { Plus } from 'lucide-vue-next';

const { get, post, put, del, loading } = useApi();
const awards = ref<Record<string, unknown>[]>([]);
const modalOpen = ref(false);
const editingId = ref<string | null>(null);
const form = ref({ name: '', name_ar: '', body: '', body_ar: '', year: new Date().getFullYear(), badge_image: '' });

const columns: Column[] = [
  { key: 'name_ar', label: 'الاسم', width: '35%' },
  { key: 'body', label: 'الجهة المانحة' },
  { key: 'year', label: 'السنة' },
];

async function load() { const res = await get<{ data: Record<string, unknown>[] }>('/api/awards'); awards.value = res.data; }
onMounted(load);

function openCreate() { editingId.value = null; form.value = { name: '', name_ar: '', body: '', body_ar: '', year: new Date().getFullYear(), badge_image: '' }; modalOpen.value = true; }
function openEdit(row: Record<string, unknown>) { editingId.value = row.id as string; form.value = { ...row } as typeof form.value; modalOpen.value = true; }

async function save() {
  if (editingId.value) { await put(`/api/awards/${editingId.value}`, form.value); } else { await post('/api/awards', form.value); }
  modalOpen.value = false; await load();
}

async function remove(row: Record<string, unknown>) { if (!confirm('هل أنت متأكد من الحذف؟')) return; await del(`/api/awards/${row.id}`); await load(); }
</script>

<template>
  <div class="space-y-4">
    <div class="flex items-center justify-end"><button @click="openCreate" class="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700"><Plus class="w-4 h-4" /> إضافة جائزة</button></div>
    <DataTable :columns="columns" :rows="awards" :loading="loading" @edit="openEdit" @delete="remove" />
    <FormModal :open="modalOpen" :title="editingId ? 'تعديل الجائزة' : 'إضافة جائزة'" @close="modalOpen = false" @submit="save">
      <div class="grid grid-cols-2 gap-4">
        <div><label class="block text-sm font-medium text-gray-700 mb-1">الاسم (عربي)</label><input v-model="form.name_ar" class="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" /></div>
        <div><label class="block text-sm font-medium text-gray-700 mb-1">Name (English)</label><input v-model="form.name" class="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" /></div>
        <div><label class="block text-sm font-medium text-gray-700 mb-1">الجهة المانحة (عربي)</label><input v-model="form.body_ar" class="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" /></div>
        <div><label class="block text-sm font-medium text-gray-700 mb-1">Awarding Body (English)</label><input v-model="form.body" class="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" /></div>
        <div><label class="block text-sm font-medium text-gray-700 mb-1">السنة</label><input v-model.number="form.year" type="number" class="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" /></div>
        <div><label class="block text-sm font-medium text-gray-700 mb-1">صورة الشارة</label><input v-model="form.badge_image" class="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" placeholder="URL" /></div>
      </div>
    </FormModal>
  </div>
</template>
