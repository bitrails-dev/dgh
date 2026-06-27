<script setup lang="ts">
import { ref, onMounted, watch } from 'vue';
import { useApi } from '../composables/useApi';
import DataTable, { type Column } from '../ui/DataTable.vue';
import SearchBar from '../ui/SearchBar.vue';
import FormModal from '../ui/FormModal.vue';
import { Plus } from 'lucide-vue-next';

const { get, post, put, del, loading } = useApi();
const newsList = ref<Record<string, unknown>[]>([]);
const search = ref('');
const modalOpen = ref(false);
const editingId = ref<string | null>(null);
const form = ref({ title: '', title_ar: '', date: '', category: 'hospital-news', thumbnail: '', excerpt: '', excerpt_ar: '', featured: false, author: '', body: '', body_ar: '' });

const columns: Column[] = [
  { key: 'title_ar', label: 'العنوان', width: '30%' },
  { key: 'category', label: 'التصنيف' },
  { key: 'date', label: 'التاريخ' },
  { key: 'featured', label: 'مميز' },
];

async function load() {
  const params = search.value ? `?q=${encodeURIComponent(search.value)}` : '';
  const res = await get<{ data: Record<string, unknown>[] }>(`/api/news${params}`);
  newsList.value = res.data;
}

onMounted(load);
watch(search, load);

function openCreate() { editingId.value = null; form.value = { title: '', title_ar: '', date: new Date().toISOString().split('T')[0], category: 'hospital-news', thumbnail: '', excerpt: '', excerpt_ar: '', featured: false, author: '', body: '', body_ar: '' }; modalOpen.value = true; }
function openEdit(row: Record<string, unknown>) { editingId.value = row.id as string; form.value = { ...row } as typeof form.value; modalOpen.value = true; }

async function save() {
  if (editingId.value) { await put(`/api/news/${editingId.value}`, form.value); } else { await post('/api/news', form.value); }
  modalOpen.value = false; await load();
}

async function remove(row: Record<string, unknown>) { if (!confirm('هل أنت متأكد من الحذف؟')) return; await del(`/api/news/${row.id}`); await load(); }
</script>

<template>
  <div class="space-y-4">
    <div class="flex items-center justify-between gap-4">
      <SearchBar v-model="search" placeholder="بحث في الأخبار..." class="flex-1 max-w-md" />
      <button @click="openCreate" class="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700"><Plus class="w-4 h-4" /> إضافة خبر</button>
    </div>
    <DataTable :columns="columns" :rows="newsList" :loading="loading" @edit="openEdit" @delete="remove" />
    <FormModal :open="modalOpen" :title="editingId ? 'تعديل الخبر' : 'إضافة خبر'" @close="modalOpen = false" @submit="save">
      <div class="grid grid-cols-2 gap-4">
        <div><label class="block text-sm font-medium text-gray-700 mb-1">العنوان (عربي)</label><input v-model="form.title_ar" class="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" /></div>
        <div><label class="block text-sm font-medium text-gray-700 mb-1">Title (English)</label><input v-model="form.title" class="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" /></div>
        <div><label class="block text-sm font-medium text-gray-700 mb-1">التاريخ</label><input v-model="form.date" type="date" class="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" /></div>
        <div><label class="block text-sm font-medium text-gray-700 mb-1">التصنيف</label>
          <select v-model="form.category" class="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm">
            <option value="hospital-news">أخبار المستشفى</option><option value="health-tips">نصائح صحية</option><option value="research">أبحاث</option><option value="events">فعاليات</option>
          </select>
        </div>
        <div class="col-span-2"><label class="block text-sm font-medium text-gray-700 mb-1">ملخص (عربي)</label><textarea v-model="form.excerpt_ar" rows="2" class="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" /></div>
        <div class="col-span-2"><label class="block text-sm font-medium text-gray-700 mb-1">Excerpt (English)</label><textarea v-model="form.excerpt" rows="2" class="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" /></div>
        <div class="col-span-2"><label class="block text-sm font-medium text-gray-700 mb-1">المحتوى (عربي)</label><textarea v-model="form.body_ar" rows="4" class="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" /></div>
        <div class="col-span-2"><label class="block text-sm font-medium text-gray-700 mb-1">Content (English)</label><textarea v-model="form.body" rows="4" class="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" /></div>
        <div class="col-span-2"><label class="flex items-center gap-2 text-sm"><input v-model="form.featured" type="checkbox" class="rounded" /> خبر مميز</label></div>
      </div>
    </FormModal>
  </div>
</template>
