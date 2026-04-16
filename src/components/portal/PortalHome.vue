<template>
  <div class="mx-auto max-w-3xl">
    <div class="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
      <h1 class="text-2xl font-extrabold text-text">{{ strings.portal.title }}</h1>
      <p class="mt-2 text-sm text-muted">{{ strings.portal.description }}</p>

      <div v-if="state === 'loading'" class="mt-6 text-sm text-muted">{{ strings.portal.loading }}</div>

      <div v-else-if="state === 'signed_out'" class="mt-6">
        <p class="text-sm text-text">{{ strings.portal.signedOut }}</p>
        <div class="mt-4 flex flex-wrap gap-2">
          <a :href="`/${lang}/portal/sign-in/`" class="rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-white">
            {{ strings.portal.nav.signIn }}
          </a>
          <a :href="`/${lang}/portal/sign-up/`" class="rounded-xl border border-primary px-4 py-2 text-sm font-semibold text-primary">
            {{ strings.portal.nav.signUp }}
          </a>
        </div>
      </div>

      <div v-else class="mt-6">
        <div class="rounded-xl border border-gray-200 bg-gray-50 p-4">
          <p class="text-sm font-semibold text-text">{{ strings.portal.welcome }}</p>
          <p class="mt-1 text-sm text-muted">
            <span v-if="verificationStatus === 'verified'">{{ strings.portal.status.verified }}</span>
            <span v-else>{{ strings.portal.status.pending }}</span>
          </p>
        </div>

        <div class="mt-4 grid gap-3 sm:grid-cols-2">
          <a
            :href="`/${lang}/portal/book/`"
            class="rounded-2xl border border-gray-200 bg-white p-4 hover:border-primary/40 hover:shadow-sm"
            :class="verificationStatus !== 'verified' ? 'opacity-60 pointer-events-none' : ''"
          >
            <p class="text-sm font-bold text-text">{{ strings.portal.nav.book }}</p>
            <p class="mt-1 text-xs text-muted">{{ strings.portal.book.description }}</p>
          </a>

          <a
            :href="`/${lang}/portal/appointments/`"
            class="rounded-2xl border border-gray-200 bg-white p-4 hover:border-primary/40 hover:shadow-sm"
          >
            <p class="text-sm font-bold text-text">{{ strings.portal.nav.appointments }}</p>
            <p class="mt-1 text-xs text-muted">{{ strings.portal.appointments.description }}</p>
          </a>
        </div>

        <div v-if="verificationStatus !== 'verified'" class="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          {{ strings.portal.banner.pendingVerification }}
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from "vue";
import { portalApi } from "./api";

const props = defineProps<{ lang: "ar" | "en"; strings: any }>();

type State = "loading" | "signed_out" | "signed_in";
const state = ref<State>("loading");
const verificationStatus = ref<string>("");

onMounted(async () => {
  try {
    const me = await portalApi.me();
    verificationStatus.value = me.patient.verification_status;
    state.value = "signed_in";
  } catch {
    state.value = "signed_out";
  }
});
</script>
