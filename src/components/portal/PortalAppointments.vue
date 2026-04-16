<template>
  <div class="mx-auto max-w-3xl">
    <div class="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
      <div class="flex items-start justify-between gap-4">
        <div>
          <h1 class="text-xl font-extrabold text-text">{{ strings.portal.appointments.title }}</h1>
          <p class="mt-1 text-sm text-muted">{{ strings.portal.appointments.description }}</p>
        </div>
        <a :href="`/${lang}/portal/book/`" class="rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-white">
          {{ strings.portal.nav.book }}
        </a>
      </div>

      <div v-if="state === 'loading'" class="mt-6 text-sm text-muted">{{ strings.portal.loading }}</div>

      <div v-else class="mt-6 space-y-3">
        <div v-if="items.length === 0" class="rounded-xl border border-gray-200 bg-gray-50 p-4 text-sm text-muted">
          {{ strings.portal.appointments.empty }}
        </div>

        <div v-for="a in items" :key="a.appointment_id" class="rounded-2xl border border-gray-200 p-4">
          <div class="flex flex-wrap items-center justify-between gap-2">
            <p class="text-sm font-bold text-text">{{ a.reference_number }}</p>
            <span class="rounded-full bg-gray-100 px-3 py-1 text-xs font-semibold text-text">{{ a.status }}</span>
          </div>
          <p class="mt-2 text-sm text-text">
            {{ a.clinic?.name_ar || a.clinic?.name_en }}
          </p>
          <p class="mt-1 text-xs text-muted">{{ a.start_at }}</p>
        </div>

        <p v-if="error" class="text-sm text-red-700">{{ error }}</p>
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
const items = ref<any[]>([]);
const error = ref<string | null>(null);

onMounted(async () => {
  try {
    const res = await portalApi.appointments();
    items.value = res.appointments || [];
  } catch (e: any) {
    if (e?.status === 401) {
      window.location.href = `/${props.lang}/portal/sign-in/`;
      return;
    }
    error.value = e?.message || "Error";
  } finally {
    state.value = "ready";
  }
});
</script>
