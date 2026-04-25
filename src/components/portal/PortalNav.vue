<template>
  <header class="fixed top-0 z-50 w-full bg-white/95 backdrop-blur-md shadow-sm">
    <div class="container mx-auto flex items-center justify-between px-4 py-3">
      <a :href="`/${lang}/`" class="flex items-center gap-3">
        <div class="h-10 w-10 rounded-full bg-navy-900 overflow-hidden">
          <img src="/icon.png" :alt="strings.site.name" class="h-full w-full object-cover" />
        </div>
        <div>
          <p class="text-sm font-bold text-navy-900 leading-tight">{{ strings.site.name }}</p>
          <p class="text-xs text-ink-500">{{ strings.portal.title }}</p>
        </div>
      </a>

      <nav class="hidden md:flex items-center gap-4 text-sm font-semibold">
        <a :href="`/${lang}/portal/`" class="hover:text-navy-900">{{ strings.portal.nav.home }}</a>
        <a :href="`/${lang}/portal/book/`" class="hover:text-navy-900">{{ strings.portal.nav.book }}</a>
        <a :href="`/${lang}/portal/appointments/`" class="hover:text-navy-900">{{ strings.portal.nav.appointments }}</a>
        <a :href="`/${lang}/portal/admin/`" class="hover:text-navy-900">{{ strings.portal.nav.admin }}</a>
      </nav>

      <div class="flex items-center gap-2">
        <a
          class="rounded-full border border-primary px-3 py-1.5 text-xs font-semibold text-navy-900 hover:bg-navy-900 hover:text-white transition-colors"
          :href="switchHref"
        >
          {{ lang === 'ar' ? strings.nav.toggleToEn : strings.nav.toggleToAr }}
        </a>

        <a
          v-if="status === 'signed_out'"
          class="rounded-full bg-navy-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-navy-900/90"
          :href="`/${lang}/portal/sign-in/`"
        >
          {{ strings.portal.nav.signIn }}
        </a>

        <button
          v-else
          class="rounded-full border border-gray-300 px-3 py-1.5 text-xs font-semibold text-ink-900 hover:bg-gray-50"
          @click="onLogout"
        >
          {{ strings.portal.nav.signOut }}
        </button>
      </div>
    </div>

    <div v-if="status === 'signed_in_pending'" class="border-t border-amber-200 bg-amber-50">
      <div class="container mx-auto px-4 py-2 text-xs text-amber-900">
        {{ strings.portal.banner.pendingVerification }}
      </div>
    </div>
  </header>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { portalApi } from "./api";

const props = defineProps<{ lang: "ar" | "en"; strings: any }>();

type Status = "loading" | "signed_out" | "signed_in_verified" | "signed_in_pending";
const status = ref<Status>("loading");

const switchHref = computed(() => {
  const next = props.lang === "ar" ? "en" : "ar";
  const path = typeof window === "undefined" ? `/${props.lang}/portal/` : window.location.pathname;
  const parts = path.split("/").filter(Boolean);
  if (parts.length && (parts[0] === "ar" || parts[0] === "en")) parts[0] = next;
  return `/${parts.join("/")}/`;
});

async function refresh() {
  try {
    const me = await portalApi.me();
    status.value = me.patient.verification_status === "verified" ? "signed_in_verified" : "signed_in_pending";
  } catch {
    status.value = "signed_out";
  }
}

async function onLogout() {
  try {
    await portalApi.logout();
  } finally {
    status.value = "signed_out";
    window.location.href = `/${props.lang}/portal/sign-in/`;
  }
}

onMounted(refresh);
</script>
