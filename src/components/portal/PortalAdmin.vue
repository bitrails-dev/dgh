<template>
  <div class="mx-auto max-w-6xl">
    <div class="rounded-2xl border border-ink-200 bg-white p-6 shadow-sm">
      <div class="flex items-start justify-between gap-4">
        <div>
          <h1 class="text-2xl font-extrabold text-ink-900">{{ strings.portal.admin.title }}</h1>
          <p class="mt-2 text-sm text-ink-500">{{ strings.portal.admin.description }}</p>
        </div>
        <a :href="`/${lang}/portal/`" class="rounded-xl border border-primary px-4 py-2 text-sm font-semibold text-navy-900">
          {{ strings.portal.nav.home }}
        </a>
      </div>

      <div class="mt-6 grid gap-6 xl:grid-cols-2">
        <section class="rounded-2xl border border-ink-200 p-4">
          <h2 class="text-sm font-bold text-ink-900">{{ strings.portal.admin.bootstrapTitle }}</h2>
          <p class="mt-1 text-xs text-ink-500">{{ strings.portal.admin.bootstrapBody }}</p>

          <label class="mt-4 block">
            <span class="text-xs font-semibold text-ink-900">{{ strings.portal.admin.adminKey }}</span>
            <input v-model.trim="adminKey" class="mt-1 w-full rounded-xl border border-gray-300 px-3 py-2 text-sm" />
          </label>

          <div class="mt-4 flex gap-2">
            <button
              class="flex-1 rounded-xl bg-navy-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
              :disabled="busy || !adminKey"
              @click="bootstrap"
            >
              {{ strings.portal.admin.bootstrapAction }}
            </button>
            <button
              class="flex-1 rounded-xl border border-primary px-4 py-2 text-sm font-semibold text-navy-900 disabled:opacity-60"
              :disabled="busy || !adminKey || !clinicId"
              @click="loadSlots"
            >
              {{ strings.portal.admin.refreshSlots }}
            </button>
          </div>
        </section>

        <section class="rounded-2xl border border-ink-200 p-4">
          <h2 class="text-sm font-bold text-ink-900">{{ strings.portal.admin.verifyTitle }}</h2>
          <p class="mt-1 text-xs text-ink-500">{{ strings.portal.admin.verifyBody }}</p>

          <label class="mt-4 block">
            <span class="text-xs font-semibold text-ink-900">{{ strings.portal.fields.nid }}</span>
            <input v-model.trim="nid" class="mt-1 w-full rounded-xl border border-gray-300 px-3 py-2 text-sm" :placeholder="strings.portal.placeholders.nid" />
          </label>

          <button
            class="mt-4 w-full rounded-xl border border-primary px-4 py-2 text-sm font-semibold text-navy-900 disabled:opacity-60"
            :disabled="busy || !adminKey || !nid"
            @click="verify"
          >
            {{ strings.portal.admin.verifyAction }}
          </button>
        </section>
      </div>

      <div class="mt-6 rounded-2xl border border-ink-200 p-4">
        <div class="flex items-start justify-between gap-4">
          <div>
            <h2 class="text-sm font-bold text-ink-900">{{ strings.portal.admin.scheduleTitle }}</h2>
            <p class="mt-1 text-xs text-ink-500">{{ strings.portal.admin.scheduleBody }}</p>
          </div>
          <span class="text-xs font-semibold text-ink-500">{{ slots.length }} {{ strings.portal.admin.slotCountSuffix }}</span>
        </div>

        <div class="mt-4 grid gap-4 lg:grid-cols-3">
          <label class="block">
            <span class="text-xs font-semibold text-ink-900">{{ strings.portal.fields.clinic }}</span>
            <select v-model="clinicId" class="mt-1 w-full rounded-xl border border-gray-300 px-3 py-2 text-sm">
              <option value="">{{ strings.portal.placeholders.select }}</option>
              <option v-for="c in clinics" :key="c.clinic_id" :value="c.clinic_id">
                {{ lang === 'ar' ? c.name_ar : c.name_en }}
              </option>
            </select>
          </label>

          <label class="block">
            <span class="text-xs font-semibold text-ink-900">{{ strings.portal.fields.dateFrom }}</span>
            <input v-model="dateFrom" type="date" class="mt-1 w-full rounded-xl border border-gray-300 px-3 py-2 text-sm" />
          </label>

          <label class="block">
            <span class="text-xs font-semibold text-ink-900">{{ strings.portal.fields.dateTo }}</span>
            <input v-model="dateTo" type="date" class="mt-1 w-full rounded-xl border border-gray-300 px-3 py-2 text-sm" />
          </label>
        </div>

        <div class="mt-4 grid gap-4 lg:grid-cols-4">
          <label class="block">
            <span class="text-xs font-semibold text-ink-900">{{ strings.portal.admin.slotDate }}</span>
            <input v-model="slotDate" type="date" class="mt-1 w-full rounded-xl border border-gray-300 px-3 py-2 text-sm" />
          </label>

          <label class="block">
            <span class="text-xs font-semibold text-ink-900">{{ strings.portal.admin.slotTime }}</span>
            <input v-model="slotTime" type="time" class="mt-1 w-full rounded-xl border border-gray-300 px-3 py-2 text-sm" />
          </label>

          <label class="block">
            <span class="text-xs font-semibold text-ink-900">{{ strings.portal.admin.durationMinutes }}</span>
            <input v-model.number="durationMinutes" type="number" min="5" step="5" class="mt-1 w-full rounded-xl border border-gray-300 px-3 py-2 text-sm" />
          </label>

          <label class="block">
            <span class="text-xs font-semibold text-ink-900">{{ strings.portal.admin.capacity }}</span>
            <input v-model.number="capacity" type="number" min="1" step="1" class="mt-1 w-full rounded-xl border border-gray-300 px-3 py-2 text-sm" />
          </label>
        </div>

        <div class="mt-4 grid gap-4 lg:grid-cols-3">
          <label class="block">
            <span class="text-xs font-semibold text-ink-900">{{ strings.portal.fields.doctor }}</span>
            <select v-model="providerId" class="mt-1 w-full rounded-xl border border-gray-300 px-3 py-2 text-sm" :disabled="!clinicId">
              <option value="">{{ strings.portal.admin.anyDoctor }}</option>
              <option v-for="p in providers" :key="p.provider_id" :value="p.provider_id">
                {{ lang === 'ar' ? p.name_ar : p.name_en }}</option>
            </select>
          </label>

          <label class="block">
            <span class="text-xs font-semibold text-ink-900">{{ strings.portal.fields.visitType }}</span>
            <select v-model="visitTypeId" class="mt-1 w-full rounded-xl border border-gray-300 px-3 py-2 text-sm">
              <option value="">{{ strings.portal.placeholders.select }}</option>
              <option v-for="v in visitTypes" :key="v.visit_type_id" :value="v.visit_type_id">
                {{ lang === 'ar' ? v.name_ar : v.name_en }}
              </option>
            </select>
          </label>

          <div class="flex items-end gap-2">
            <button
              class="flex-1 rounded-xl bg-navy-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
              :disabled="busy || !adminKey || !clinicId || !visitTypeId || !slotDate || !slotTime"
              @click="createSlot"
            >
              {{ strings.portal.admin.createSlot }}
            </button>
            <button
              class="rounded-xl border border-primary px-4 py-2 text-sm font-semibold text-navy-900 disabled:opacity-60"
              :disabled="busy || !adminKey || !clinicId"
              @click="loadSlots"
            >
              {{ strings.portal.admin.loadSlots }}
            </button>
          </div>
        </div>

        <div v-if="message" class="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
          {{ message }}
        </div>
        <div v-if="error" class="mt-4 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-900">
          {{ error }}
        </div>

        <div class="mt-6 overflow-x-auto rounded-2xl border border-ink-200">
          <table class="min-w-full divide-y divide-gray-200 text-sm">
            <thead class="bg-gray-50 text-left text-xs uppercase tracking-wide text-ink-500">
              <tr>
                <th class="px-4 py-3">{{ strings.portal.admin.slotTable.startAt }}</th>
                <th class="px-4 py-3">{{ strings.portal.fields.visitType }}</th>
                <th class="px-4 py-3">{{ strings.portal.fields.doctor }}</th>
                <th class="px-4 py-3">{{ strings.portal.admin.slotTable.capacity }}</th>
                <th class="px-4 py-3">{{ strings.portal.admin.slotTable.reference }}</th>
                <th class="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody class="divide-y divide-gray-100 bg-white">
              <tr v-for="slot in slots" :key="slot.slot_id">
                <td class="px-4 py-3 font-medium text-ink-900">{{ slot.start_at }}</td>
                <td class="px-4 py-3 text-ink-500">{{ labelFor(visitTypes, slot.visit_type_id) }}</td>
                <td class="px-4 py-3 text-ink-500">{{ labelFor(providers, slot.provider_id) }}</td>
                <td class="px-4 py-3 text-ink-500">{{ slot.remaining_capacity }}/{{ slot.capacity }}</td>
                <td class="px-4 py-3 text-ink-500">{{ slot.reference_number || '-' }}</td>
                <td class="px-4 py-3 text-right">
                  <button
                    class="rounded-lg border border-red-200 px-3 py-1.5 text-xs font-semibold text-coral disabled:opacity-60"
                    :disabled="busy || slot.appointment_id"
                    @click="deleteSlot(slot.slot_id)"
                  >
                    {{ strings.portal.admin.deleteSlot }}
                  </button>
                </td>
              </tr>
              <tr v-if="slots.length === 0">
                <td colspan="6" class="px-4 py-8 text-center text-sm text-ink-500">{{ strings.portal.admin.noSlots }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref, watch } from "vue";
import { portalApi } from "./api";

const props = defineProps<{ lang: "ar" | "en"; strings: any }>();

const adminKey = ref("");
const nid = ref("");
const busy = ref(false);
const message = ref<string | null>(null);
const error = ref<string | null>(null);

const clinics = ref<any[]>([]);
const providers = ref<any[]>([]);
const visitTypes = ref<any[]>([]);
const slots = ref<any[]>([]);

const clinicId = ref("");
const providerId = ref("");
const visitTypeId = ref("");
const dateFrom = ref(today());
const dateTo = ref(addDays(7));

const slotDate = ref(today());
const slotTime = ref("09:00");
const durationMinutes = ref(15);
const capacity = ref(1);

onMounted(async () => {
  adminKey.value = window.localStorage.getItem("portal_admin_key") || "";
  await loadStaticData();
});

watch(clinicId, async () => {
  providerId.value = "";
  if (!clinicId.value) {
    providers.value = [];
    slots.value = [];
    return;
  }

  try {
    const res = await portalApi.providers(clinicId.value);
    providers.value = res.providers || [];
  } catch {
    providers.value = [];
  }

  await loadSlots();
});

async function loadStaticData() {
  try {
    const [clinicRes, visitTypeRes] = await Promise.all([portalApi.clinics(), portalApi.visitTypes()]);
    clinics.value = clinicRes.clinics || [];
    visitTypes.value = visitTypeRes.visit_types || [];
  } catch (e: any) {
    error.value = e?.message || "Error";
  }
}

async function bootstrap() {
  busy.value = true;
  error.value = null;
  message.value = null;
  try {
    window.localStorage.setItem("portal_admin_key", adminKey.value);
    const res = await portalApi.bootstrapDemo(adminKey.value);
    message.value = `${props.strings.portal.admin.bootstrapSuccess} ${res.seeded.clinics}/${res.seeded.providers}/${res.seeded.slots}`;
    await loadStaticData();
    await loadSlots();
  } catch (e: any) {
    error.value = e?.message || "Error";
  } finally {
    busy.value = false;
  }
}

async function verify() {
  busy.value = true;
  error.value = null;
  message.value = null;
  try {
    window.localStorage.setItem("portal_admin_key", adminKey.value);
    await portalApi.verifyReception(adminKey.value, nid.value);
    message.value = props.strings.portal.admin.verifySuccess;
  } catch (e: any) {
    error.value = e?.message || "Error";
  } finally {
    busy.value = false;
  }
}

async function loadSlots() {
  if (!adminKey.value || !clinicId.value) return;
  busy.value = true;
  error.value = null;
  try {
    const res = await portalApi.adminSlots(adminKey.value, {
      clinic_id: clinicId.value,
      date_from: dateFrom.value,
      date_to: dateTo.value,
    });
    slots.value = res.slots || [];
  } catch (e: any) {
    error.value = e?.message || "Error";
  } finally {
    busy.value = false;
  }
}

async function createSlot() {
  busy.value = true;
  error.value = null;
  message.value = null;
  try {
    window.localStorage.setItem("portal_admin_key", adminKey.value);
    const provider = providerId.value || "";
    const startAt = `${slotDate.value}T${slotTime.value}`;
    await portalApi.createAdminSlot(adminKey.value, {
      clinic_id: clinicId.value,
      provider_id: provider,
      visit_type_id: visitTypeId.value,
      start_at: startAt,
      duration_minutes: durationMinutes.value,
      capacity: capacity.value,
    });
    message.value = props.strings.portal.admin.createSuccess;
    await loadSlots();
  } catch (e: any) {
    error.value = e?.message || "Error";
  } finally {
    busy.value = false;
  }
}

async function deleteSlot(slotId: string) {
  busy.value = true;
  error.value = null;
  message.value = null;
  try {
    await portalApi.deleteAdminSlot(adminKey.value, slotId);
    message.value = props.strings.portal.admin.deleteSuccess;
    await loadSlots();
  } catch (e: any) {
    error.value = e?.message || "Error";
  } finally {
    busy.value = false;
  }
}

function labelFor(items: any[], id: string) {
  if (!id) return props.strings.portal.admin.anyDoctor;
  const item = items.find((entry) => entry.provider_id === id || entry.visit_type_id === id || entry.clinic_id === id);
  if (!item) return id;
  return props.lang === "ar" ? item.name_ar || item.name_en : item.name_en || item.name_ar;
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function addDays(days: number) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}
</script>
