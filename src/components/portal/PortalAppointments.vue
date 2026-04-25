<template>
  <div class="mx-auto max-w-3xl">
    <div class="rounded-2xl border border-ink-200 bg-white p-6 shadow-sm">
      <div class="flex items-start justify-between gap-4">
        <div>
          <h1 class="text-xl font-extrabold text-ink-900">{{ strings.portal.appointments.title }}</h1>
          <p class="mt-1 text-sm text-ink-500">{{ strings.portal.appointments.description }}</p>
        </div>
        <a :href="`/${lang}/portal/book/`" class="rounded-xl bg-navy-900 px-4 py-2 text-sm font-semibold text-white">
          {{ strings.portal.nav.book }}
        </a>
      </div>

      <div v-if="state === 'loading'" class="mt-6 text-sm text-ink-500">{{ strings.portal.loading }}</div>

      <div v-else class="mt-6 space-y-3">
        <div v-if="items.length === 0" class="rounded-xl border border-ink-200 bg-gray-50 p-4 text-sm text-ink-500">
          {{ strings.portal.appointments.empty }}
        </div>

        <div v-for="a in items" :key="a.appointment_id" class="rounded-2xl border border-ink-200 p-4">
          <div class="flex flex-wrap items-center justify-between gap-2">
            <p class="text-sm font-bold text-ink-900">{{ a.reference_number }}</p>
            <span class="rounded-full bg-gray-100 px-3 py-1 text-xs font-semibold text-ink-900">{{ a.status }}</span>
          </div>
          <p class="mt-2 text-sm text-ink-900">{{ a.clinic?.name_ar || a.clinic?.name_en }}</p>
          <p class="mt-1 text-xs text-ink-500">{{ a.start_at }}</p>

          <div class="mt-4 flex flex-wrap gap-2">
            <button
              v-if="a.status !== 'cancelled'"
              class="rounded-xl border border-red-200 px-4 py-2 text-xs font-semibold text-coral disabled:opacity-60"
              :disabled="busy"
              @click="cancel(a.appointment_id)"
            >
              {{ strings.portal.appointments.cancel }}</button>
            <button
              v-if="a.status !== 'cancelled'"
              class="rounded-xl border border-primary px-4 py-2 text-xs font-semibold text-navy-900 disabled:opacity-60"
              :disabled="busy"
              @click="openReschedule(a)"
            >
              {{ strings.portal.appointments.reschedule }}
            </button>
          </div>

          <div v-if="rescheduleTarget?.appointment_id === a.appointment_id" class="mt-4 rounded-2xl border border-ink-200 bg-gray-50 p-4">
            <div class="flex items-center justify-between gap-2">
              <h3 class="text-sm font-bold text-ink-900">{{ strings.portal.appointments.chooseSlot }}</h3>
              <button class="text-xs font-semibold text-navy-900" @click="closeReschedule">
                {{ strings.portal.appointments.close }}
              </button>
            </div>

            <div class="mt-4 grid gap-3 lg:grid-cols-3">
              <label class="block">
                <span class="text-xs font-semibold text-ink-900">{{ strings.portal.fields.dateFrom }}</span>
                <input v-model="rescheduleFrom" type="date" class="mt-1 w-full rounded-xl border border-gray-300 px-3 py-2 text-sm" />
              </label>
              <label class="block">
                <span class="text-xs font-semibold text-ink-900">{{ strings.portal.fields.dateTo }}</span>
                <input v-model="rescheduleTo" type="date" class="mt-1 w-full rounded-xl border border-gray-300 px-3 py-2 text-sm" />
              </label>
              <button
                class="self-end rounded-xl border border-primary px-4 py-2 text-sm font-semibold text-navy-900 disabled:opacity-60"
                :disabled="rescheduleLoading || !rescheduleFrom || !rescheduleTo"
                @click="loadRescheduleSlots"
              >
                {{ strings.portal.appointments.loadSlots }}
              </button>
            </div>

            <div v-if="rescheduleLoading" class="mt-4 text-sm text-ink-500">{{ strings.portal.loading }}</div>
            <div v-else class="mt-4 space-y-2">
              <div v-if="rescheduleSlots.length === 0" class="rounded-xl border border-dashed border-gray-300 bg-white p-4 text-sm text-ink-500">
                {{ strings.portal.appointments.noRescheduleSlots }}
              </div>

              <button
                v-for="slot in rescheduleSlots"
                :key="slot.slot_id"
                class="flex w-full items-center justify-between gap-4 rounded-xl border px-4 py-3 text-left text-sm"
                :class="selectedSlotId === slot.slot_id ? 'border-primary bg-navy-900/5' : 'border-ink-200 bg-white'"
                @click="selectedSlotId = slot.slot_id"
              >
                <div>
                  <p class="font-semibold text-ink-900">{{ slot.start_at }}</p>
                  <p class="mt-1 text-xs text-ink-500">{{ labelFor(providers, slot.provider_id) }}</p>
                </div>
                <span class="text-xs font-semibold text-ink-500">{{ slot.remaining_capacity }} {{ strings.portal.remaining }}</span>
              </button>
            </div>

            <p v-if="rescheduleError" class="mt-4 text-sm text-coral">{{ rescheduleError }}</p>

            <div class="mt-4 flex justify-end">
              <button
                class="rounded-xl bg-navy-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
                :disabled="busy || !selectedSlotId"
                @click="confirmReschedule"
              >
                {{ strings.portal.appointments.confirmReschedule }}
              </button>
            </div>
          </div>
        </div>

        <p v-if="error" class="text-sm text-coral">{{ error }}</p>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from "vue";
import { portalApi } from "./api";

const props = defineProps<{ lang: "ar" | "en"; strings: any }>();

type State = "loading" | "ready";
const state = ref<State>("loading");
const busy = ref(false);
const items = ref<any[]>([]);
const providers = ref<any[]>([]);
const error = ref<string | null>(null);

const rescheduleTarget = ref<any | null>(null);
const rescheduleFrom = ref(today());
const rescheduleTo = ref(addDays(30));
const rescheduleSlots = ref<any[]>([]);
const rescheduleLoading = ref(false);
const rescheduleError = ref<string | null>(null);
const selectedSlotId = ref("");

onMounted(async () => {
  try {
    await refresh();
  } catch (e: any) {
    if (e?.status === 401) {
      window.location.href = `/${props.lang}/portal/sign-in/`;
    }
  } finally {
    state.value = "ready";
  }
});

async function refresh() {
  const res = await portalApi.appointments();
  items.value = res.appointments || [];
}

async function cancel(appointmentId: string) {
  busy.value = true;
  error.value = null;
  try {
    await portalApi.cancelAppointment({ appointment_id: appointmentId });
    await refresh();
    if (rescheduleTarget.value?.appointment_id === appointmentId) {
      closeReschedule();
    }
  } catch (e: any) {
    error.value = e?.message || "Error";
  } finally {
    busy.value = false;
  }
}

async function openReschedule(appointment: any) {
  rescheduleTarget.value = appointment;
  rescheduleError.value = null;
  selectedSlotId.value = "";
  rescheduleFrom.value = dateOnly(appointment.start_at) || today();
  rescheduleTo.value = addDaysFrom(rescheduleFrom.value, 30);
  await loadProviders(appointment.clinic_id);
  await loadRescheduleSlots();
}

function closeReschedule() {
  rescheduleTarget.value = null;
  rescheduleError.value = null;
  selectedSlotId.value = "";
  rescheduleSlots.value = [];
}

async function loadProviders(clinicId: string) {
  try {
    const res = await portalApi.providers(clinicId);
    providers.value = res.providers || [];
  } catch {
    providers.value = [];
  }
}

async function loadRescheduleSlots() {
  if (!rescheduleTarget.value) return;
  rescheduleLoading.value = true;
  rescheduleError.value = null;
  try {
    const res = await portalApi.slots({
      clinic_id: rescheduleTarget.value.clinic_id,
      visit_type_id: rescheduleTarget.value.visit_type_id,
      date_from: rescheduleFrom.value,
      date_to: rescheduleTo.value,
    });
    rescheduleSlots.value = (res.slots || []).filter((slot: any) => slot.slot_id !== rescheduleTarget.value?.slot_id);
  } catch (e: any) {
    rescheduleError.value = e?.message || "Error";
  } finally {
    rescheduleLoading.value = false;
  }
}

async function confirmReschedule() {
  if (!rescheduleTarget.value || !selectedSlotId.value) return;
  busy.value = true;
  error.value = null;
  rescheduleError.value = null;
  try {
    await portalApi.rescheduleAppointment({ appointment_id: rescheduleTarget.value.appointment_id, slot_id: selectedSlotId.value });
    await refresh();
    closeReschedule();
  } catch (e: any) {
    rescheduleError.value = e?.message || "Error";
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

function addDaysFrom(dateString: string, days: number) {
  const d = new Date(`${dateString}T00:00:00`);
  if (Number.isNaN(d.getTime())) return addDays(days);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function dateOnly(value: string) {
  if (!value) return "";
  return value.slice(0, 10);
}
</script>
