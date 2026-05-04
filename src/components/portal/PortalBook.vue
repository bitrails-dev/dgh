<template>
  <div class="mx-auto max-w-4xl">
    <div class="rounded-2xl border border-ink-200 bg-white p-6 shadow-sm">
      <h1 class="text-xl font-extrabold text-ink-900">{{ strings.portal.book.title }}</h1>
      <p class="mt-1 text-sm text-ink-500">{{ strings.portal.book.description }}</p>

      <div v-if="state === 'loading'" class="mt-6 text-sm text-ink-500">{{ strings.portal.loading }}</div>

      <div v-else class="mt-6 grid gap-6 lg:grid-cols-[360px_1fr]">
        <div class="space-y-4">
          <div v-if="notVerified" class="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
            {{ strings.portal.banner.pendingVerification }}
          </div>

          <div class="rounded-2xl border border-ink-200 p-4">
            <p class="text-xs font-bold text-ink-900">{{ strings.portal.book.mode.label }}</p>
            <div class="mt-2 flex gap-2">
              <button
                class="flex-1 rounded-xl border px-3 py-2 text-xs font-semibold"
                :class="mode === 'clinic' ? 'border-primary text-navy-900 bg-navy-900/5' : 'border-ink-200 text-ink-900'"
                @click="mode='clinic'"
              >
                {{ strings.portal.book.mode.byClinic }}
              </button>
              <button
                class="flex-1 rounded-xl border px-3 py-2 text-xs font-semibold"
                :class="mode === 'doctor' ? 'border-primary text-navy-900 bg-navy-900/5' : 'border-ink-200 text-ink-900'"
                @click="mode='doctor'"
              >
                {{ strings.portal.book.mode.byDoctor }}
              </button>
            </div>
          </div>

          <label class="block">
            <span class="text-xs font-semibold text-ink-900">{{ strings.portal.fields.clinic }}</span>
            <select v-model="clinicId" class="mt-1 w-full rounded-xl border border-gray-300 px-3 py-2 text-sm">
              <option value="">{{ strings.portal.placeholders.select }}</option>
              <option v-for="c in clinics" :key="c.clinic_id" :value="c.clinic_id">
                {{ lang === 'ar' ? c.name_ar : c.name_en }}
              </option>
            </select>
          </label>

          <label v-if="mode === 'doctor'" class="block">
            <span class="text-xs font-semibold text-ink-900">{{ strings.portal.fields.doctor }}</span>
            <select v-model="providerId" class="mt-1 w-full rounded-xl border border-gray-300 px-3 py-2 text-sm" :disabled="!clinicId">
              <option value="">{{ strings.portal.placeholders.select }}</option>
              <option v-for="p in providers" :key="p.provider_id" :value="p.provider_id">
                {{ lang === 'ar' ? p.name_ar : p.name_en }}
              </option>
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

          <div class="grid grid-cols-2 gap-3">
            <label class="block">
              <span class="text-xs font-semibold text-ink-900">{{ strings.portal.fields.dateFrom }}</span>
              <input v-model="dateFrom" type="date" class="mt-1 w-full rounded-xl border border-gray-300 px-3 py-2 text-sm" />
            </label>
            <label class="block">
              <span class="text-xs font-semibold text-ink-900">{{ strings.portal.fields.dateTo }}</span>
              <input v-model="dateTo" type="date" class="mt-1 w-full rounded-xl border border-gray-300 px-3 py-2 text-sm" />
            </label>
          </div>

          <button
            class="w-full rounded-xl bg-navy-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
            :disabled="busy || notVerified || !canSearch"
            @click="searchSlots"
          >
            {{ strings.portal.book.search }}
          </button>

          <p v-if="error" class="text-sm text-coral">{{ error }}</p>
        </div>

        <div class="rounded-2xl border border-ink-200 p-4">
          <p class="text-sm font-bold text-ink-900">{{ strings.portal.book.availableSlots }}</p>
          <div v-if="slots.length === 0" class="mt-3 rounded-xl border border-ink-200 bg-gray-50 p-4 text-sm text-ink-500">
            {{ strings.portal.book.noSlots }}
          </div>

          <div v-else class="mt-3 space-y-2">
            <button
              v-for="s in slots"
              :key="s.slot_id"
              class="w-full rounded-xl border border-ink-200 p-3 text-start hover:border-primary/40"
              :disabled="busy"
              @click="book(s)"
            >
              <div class="flex items-center justify-between gap-2">
                <span class="text-sm font-semibold text-ink-900">{{ s.start_at }}</span>
                <span class="text-xs text-ink-500">{{ s.duration_minutes }} {{ strings.portal.minutes }}</span>
              </div>
              <div class="mt-1 text-xs text-ink-500">{{ strings.portal.book.remaining }}: {{ s.remaining_capacity }}</div>
            </button>
          </div>

          <div v-if="successRef" class="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
            {{ strings.portal.book.success }}: <span class="font-bold">{{ successRef }}</span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { portalApi } from "./api";

const props = defineProps<{ lang: "ar" | "en"; strings: any }>();
const lp = (path: string) => props.lang === "ar" ? path : `/en${path}`;

type State = "loading" | "ready";
const state = ref<State>("loading");
const busy = ref(false);
const error = ref<string | null>(null);

const mode = ref<"clinic" | "doctor">("clinic");

const notVerified = ref(false);

const clinics = ref<any[]>([]);
const providers = ref<any[]>([]);
const visitTypes = ref<any[]>([]);
const slots = ref<any[]>([]);

const clinicId = ref("");
const providerId = ref("");
const visitTypeId = ref("");
const dateFrom = ref(today());
const dateTo = ref(addDays(7));

const successRef = ref<string | null>(null);

const canSearch = computed(() => {
  if (!clinicId.value || !visitTypeId.value || !dateFrom.value || !dateTo.value) return false;
  if (mode.value === "doctor" && !providerId.value) return false;
  return true;
});

onMounted(async () => {
  try {
    const me = await portalApi.me();
    notVerified.value = me.patient.verification_status !== "verified";
  } catch (e: any) {
    window.location.href = lp('/portal/sign-in/');
    return;
  }

  try {
    const [c, v] = await Promise.all([portalApi.clinics(), portalApi.visitTypes()]);
    clinics.value = c.clinics || [];
    visitTypes.value = v.visit_types || [];
  } catch (e: any) {
    error.value = e?.message || "Error";
  } finally {
    state.value = "ready";
  }
});

watch(clinicId, async () => {
  providerId.value = "";
  providers.value = [];
  if (!clinicId.value) return;
  try {
    const res = await portalApi.providers(clinicId.value);
    providers.value = res.providers || [];
  } catch {
    providers.value = [];
  }
});

async function searchSlots() {
  busy.value = true;
  error.value = null;
  successRef.value = null;
  slots.value = [];
  try {
    const params: Record<string, string> = {
      clinic_id: clinicId.value,
      visit_type_id: visitTypeId.value,
      date_from: dateFrom.value,
      date_to: dateTo.value,
    };
    if (mode.value === "doctor") params.provider_id = providerId.value;
    const res = await portalApi.slots(params);
    slots.value = res.slots || [];
  } catch (e: any) {
    error.value = e?.message || "Error";
  } finally {
    busy.value = false;
  }
}

async function book(slot: any) {
  busy.value = true;
  error.value = null;
  successRef.value = null;
  try {
    const payload: any = {
      slot_id: slot.slot_id,
      clinic_id: clinicId.value,
      visit_type_id: visitTypeId.value,
    };
    if (mode.value === "doctor") payload.provider_id = providerId.value;

    const res = await portalApi.createAppointment(payload);
    successRef.value = res.appointment?.reference_number || null;
    await searchSlots();
  } catch (e: any) {
    error.value = e?.message || "Error";
  } finally {
    busy.value = false;
  }
}

function today() {
  const d = new Date();
  return d.toISOString().slice(0, 10);
}

function addDays(days: number) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}
</script>
