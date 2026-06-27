<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useApi } from '../composables/useApi';
import DataTable, { type Column } from '../ui/DataTable.vue';
import FormModal from '../ui/FormModal.vue';
import { Plus } from 'lucide-vue-next';

const { get, post, put, del, loading } = useApi();
const departments = ref<Record<string, unknown>[]>([]);
const modalOpen = ref(false);
const editingId = ref<string | null>(null);
const form = ref({ name: '', name_ar: '', description: '', description_ar: '', icon: 'building', center_of_excellence: false, featured: false, image: '' });

const columns: Column[] = [
  { key: 'name_ar', label: 'الاسم', width: '30%' },
  { key: 'icon', label: 'الأيقونة' },
  { key: 'center_of_excellence', label: 'مركز تميز' },
  { key: 'featured', label: 'مميز' },
];

async function load() { const res = await get<{ data: Record<string, unknown>[] }>('/api/departments'); departments.value = res.data; }
onMounted(load);

function openCreate() { editingId.value = null; form.value = { name: '', name_ar: '', description: '', description_ar: '', icon: 'building', center_of_excellence: false, featured: false, image: '' }; modalOpen.value = true; }
function openEdit(row: Record<string, unknown>) { editingId.value = row.id as string; form.value = { ...row } as typeof form.value; modalOpen.value = true; }

async function save() {
  if (editingId.value) { await put(`/api/departments/${editingId.value}`, form.value); } else { await post('/api/departments', form.value); }
  modalOpen.value = false; await load();
}

async function remove(row: Record<string, unknown>) { if (!confirm('هل أنت متأكد من الحذف؟')) return; await del(`/api/departments/${row.id}`); await load(); }
</script>

<template>
  <div class="space-y-4">
    <div class="flex items-center justify-end"><button @click="openCreate" class="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700"><Plus class="w-4 h-4" /> إضافة قسم</button></div>
    <DataTable :columns="columns" :rows="departments" :loading="loading" @edit="openEdit" @delete="remove" />
    <FormModal :open="modalOpen" :title="editingId ? 'تعديل القسم' : 'إضافة قسم'" @close="modalOpen = false" @submit="save">
      <div class="grid grid-cols-2 gap-4">
        <div><label class="block text-sm font-medium text-gray-700 mb-1">الاسم (عربي)</label><input v-model="form.name_ar" class="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" /></div>
        <div><label class="block text-sm font-medium text-gray-700 mb-1">Name (English)</label><input v-model="form.name" class="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" /></div>
        <div class="col-span-2"><label class="block text-sm font-medium text-gray-700 mb-1">الوصف (عربي)</label><textarea v-model="form.description_ar" rows="3" class="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" /></div>
        <div class="col-span-2"><label class="block text-sm font-medium text-gray-700 mb-1">Description (English)</label><textarea v-model="form.description" rows="3" class="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" /></div>
        <div><label class="block text-sm font-medium text-gray-700 mb-1">الأيقونة</label><input v-model="form.icon" class="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" /></div>
        <div><label class="block text-sm font-medium text-gray-700 mb-1">صورة</label><input v-model="form.image" class="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" placeholder="URL" /></div>
        <div class="col-span-2 flex gap-4">
          <label class="flex items-center gap-2 text-sm"><input v-model="form.center_of_excellence" type="checkbox" class="rounded" /> مركز تميز</label>
          <label class="flex items-center gap-2 text-sm"><input v-model="form.featured" type="checkbox" class="rounded" /> مميز</label>
        </div>
      </div>
    </FormModal>
  </div>
</template>
