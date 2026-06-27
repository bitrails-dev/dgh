<script setup lang="ts">
import { ref, onMounted, watch } from 'vue';
import { useApi } from '../composables/useApi';
import DataTable, { type Column } from '../ui/DataTable.vue';
import SearchBar from '../ui/SearchBar.vue';
import FormModal from '../ui/FormModal.vue';
import { Plus } from 'lucide-vue-next';

const { get, post, put, del, loading } = useApi();
const doctors = ref<Record<string, unknown>[]>([]);
const search = ref('');
const modalOpen = ref(false);
const editingId = ref<string | null>(null);

const form = ref({ name: '', name_ar: '', specialty: '', specialty_ar: '', photo: '', bio: '', bio_ar: '', certified: false, featured: false, role: '', role_ar: '', sort_order: 0 });

const columns: Column[] = [
  { key: 'name_ar', label: 'الاسم', width: '25%' },
  { key: 'specialty_ar', label: 'التخصص' },
  { key: 'role_ar', label: 'المنصب' },
  { key: 'featured', label: 'مميز' },
];

async function load() {
  const params = search.value ? `?q=${encodeURIComponent(search.value)}` : '';
  const res = await get<{ data: Record<string, unknown>[] }>(`/api/doctors${params}`);
  doctors.value = res.data;
}

onMounted(load);
watch(search, load);

function openCreate() {
  editingId.value = null;
  form.value = { name: '', name_ar: '', specialty: '', specialty_ar: '', photo: '', bio: '', bio_ar: '', certified: false, featured: false, role: '', role_ar: '', sort_order: 0 };
  modalOpen.value = true;
}

function openEdit(row: Record<string, unknown>) {
  editingId.value = row.id as string;
  form.value = { ...row } as typeof form.value;
  modalOpen.value = true;
}

async function save() {
  if (editingId.value) { await put(`/api/doctors/${editingId.value}`, form.value); }
  else { await post('/api/doctors', form.value); }
  modalOpen.value = false;
  await load();
}

async function remove(row: Record<string, unknown>) {
  if (!confirm('هل أنت متأكد من الحذف؟')) return;
  await del(`/api/doctors/${row.id}`);
  await load();
}
</script>

<template>
  <div class="space-y-4">
    <div class="flex items-center justify-between gap-4">
      <SearchBar v-model="search" placeholder="بحث في الأطباء..." class="flex-1 max-w-md" />
      <button @click="openCreate" class="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700"><Plus class="w-4 h-4" /> إضافة طبيب</button>
    </div>
    <DataTable :columns="columns" :rows="doctors" :loading="loading" @edit="openEdit" @delete="remove" />
    <FormModal :open="modalOpen" :title="editingId ? 'تعديل بيانات الطبيب' : 'إضافة طبيب'" @close="modalOpen = false" @submit="save">
      <div class="grid grid-cols-2 gap-4">
        <div><label class="block text-sm font-medium text-gray-700 mb-1">الاسم (عربي)</label><input v-model="form.name_ar" class="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" /></div>
        <div><label class="block text-sm font-medium text-gray-700 mb-1">Name (English)</label><input v-model="form.name" class="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" /></div>
        <div><label class="block text-sm font-medium text-gray-700 mb-1">التخصص (عربي)</label><input v-model="form.specialty_ar" class="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" /></div>
        <div><label class="block text-sm font-medium text-gray-700 mb-1">Specialty (English)</label><input v-model="form.specialty" class="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" /></div>
        <div><label class="block text-sm font-medium text-gray-700 mb-1">الصورة</label><input v-model="form.photo" class="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" placeholder="URL" /></div>
        <div><label class="block text-sm font-medium text-gray-700 mb-1">الترتيب</label><input v-model.number="form.sort_order" type="number" class="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" /></div>
        <div><label class="block text-sm font-medium text-gray-700 mb-1">المنصب (عربي)</label><input v-model="form.role_ar" class="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" /></div>
        <div><label class="block text-sm font-medium text-gray-700 mb-1">Role (English)</label><input v-model="form.role" class="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" /></div>
        <div class="col-span-2"><label class="block text-sm font-medium text-gray-700 mb-1">السيرة (عربي)</label><textarea v-model="form.bio_ar" rows="3" class="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" /></div>
        <div class="col-span-2"><label class="block text-sm font-medium text-gray-700 mb-1">Bio (English)</label><textarea v-model="form.bio" rows="3" class="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" /></div>
        <div class="col-span-2 flex gap-4">
          <label class="flex items-center gap-2 text-sm"><input v-model="form.certified" type="checkbox" class="rounded" /> معتمد</label>
          <label class="flex items-center gap-2 text-sm"><input v-model="form.featured" type="checkbox" class="rounded" /> مميز</label>
        </div>
      </div>
    </FormModal>
  </div>
</template>
