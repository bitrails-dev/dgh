<template>
  <div class="mx-auto max-w-md">
    <div class="rounded-2xl border border-ink-200 bg-white p-6 shadow-sm">
      <h1 class="text-xl font-extrabold text-ink-900">{{ strings.portal.signIn.title }}</h1>
      <p class="mt-2 text-sm text-ink-500">{{ strings.portal.signIn.description }}</p>

      <div class="mt-6 space-y-4">
        <label class="block">
          <span class="text-xs font-semibold text-ink-900">{{ strings.portal.fields.mobile }}</span>
          <input v-model.trim="mobile" class="mt-1 w-full rounded-xl border border-gray-300 px-3 py-2 text-sm" :placeholder="strings.portal.placeholders.mobile" />
        </label>

        <button
          class="w-full rounded-xl bg-navy-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
          :disabled="busy || !mobile"
          @click="requestOtp"
        >
          {{ strings.portal.signIn.requestOtp }}
        </button>

        <div v-if="otpRequested" class="space-y-3">
          <label class="block">
            <span class="text-xs font-semibold text-ink-900">{{ strings.portal.fields.otp }}</span>
            <input v-model.trim="code" inputmode="numeric" class="mt-1 w-full rounded-xl border border-gray-300 px-3 py-2 text-sm" :placeholder="strings.portal.placeholders.otp" />
          </label>

          <button
            class="w-full rounded-xl bg-navy-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
            :disabled="busy || code.length < 4"
            @click="verify"
          >
            {{ strings.portal.signIn.verifyOtp }}
          </button>
        </div>

        <p v-if="error" class="text-sm text-coral">{{ error }}</p>

        <p class="text-xs text-ink-500">
          {{ strings.portal.signIn.noAccount }}
          <a :href="`/${lang}/portal/sign-up/`" class="font-semibold text-navy-900 hover:underline">{{ strings.portal.nav.signUp }}</a>
        </p>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from "vue";
import { portalApi } from "./api";

const props = defineProps<{ lang: "ar" | "en"; strings: any }>();

const mobile = ref("");
const code = ref("");
const otpRequested = ref(false);
const busy = ref(false);
const error = ref<string | null>(null);

async function requestOtp() {
  busy.value = true;
  error.value = null;
  try {
    await portalApi.requestOtp({ mobile: mobile.value, purpose: "login" });
    otpRequested.value = true;
  } catch (e: any) {
    error.value = e?.message || "Error";
  } finally {
    busy.value = false;
  }
}

async function verify() {
  busy.value = true;
  error.value = null;
  try {
    await portalApi.verifyOtp({ mobile: mobile.value, code: code.value });
    window.location.href = `/${props.lang}/portal/`;
  } catch (e: any) {
    error.value = e?.message || "Error";
  } finally {
    busy.value = false;
  }
}
</script>
