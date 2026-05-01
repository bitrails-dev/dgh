<template>
  <div class="mx-auto max-w-md">
    <div class="rounded-2xl border border-ink-200 bg-white p-6 shadow-sm">
      <h1 class="text-xl font-extrabold text-ink-900">{{ strings.portal.signUp.title }}</h1>
      <p class="mt-2 text-sm text-ink-500">{{ strings.portal.signUp.description }}</p>

      <form class="mt-6 space-y-4" @submit.prevent="onSubmit">
        <label class="block">
          <span class="text-xs font-semibold text-ink-900">{{ strings.portal.fields.nid }}</span>
          <input v-model.trim="nid" class="mt-1 w-full rounded-xl border border-gray-300 px-3 py-2 text-sm" :placeholder="strings.portal.placeholders.nid" />
        </label>

        <label class="block">
          <span class="text-xs font-semibold text-ink-900">{{ strings.portal.fields.fullNameAr }}</span>
          <input v-model.trim="fullNameAr" class="mt-1 w-full rounded-xl border border-gray-300 px-3 py-2 text-sm" :placeholder="strings.portal.placeholders.fullNameAr" />
        </label>

        <div class="grid grid-cols-2 gap-3">
          <label class="block">
            <span class="text-xs font-semibold text-ink-900">{{ strings.portal.fields.dob }}</span>
            <input v-model.trim="dob" type="date" class="mt-1 w-full rounded-xl border border-gray-300 px-3 py-2 text-sm" />
          </label>

          <label class="block">
            <span class="text-xs font-semibold text-ink-900">{{ strings.portal.fields.gender }}</span>
            <select v-model="gender" class="mt-1 w-full rounded-xl border border-gray-300 px-3 py-2 text-sm">
              <option value="male">{{ strings.portal.gender.male }}</option>
              <option value="female">{{ strings.portal.gender.female }}</option>
            </select>
          </label>
        </div>

        <label class="block">
          <span class="text-xs font-semibold text-ink-900">{{ strings.portal.fields.mobile }}</span>
          <input v-model.trim="mobile" class="mt-1 w-full rounded-xl border border-gray-300 px-3 py-2 text-sm" :placeholder="strings.portal.placeholders.mobile" />
        </label>

        <button
          class="w-full rounded-xl bg-navy-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
          :disabled="busy || !canSubmit"
          type="submit"
        >
          {{ strings.portal.signUp.submit }}
        </button>

        <div v-if="step === 'otp'" class="space-y-3">
          <div class="rounded-xl border border-ink-200 bg-gray-50 p-3 text-xs text-ink-500">
            {{ strings.portal.signUp.otpSent }}
          </div>

          <label class="block">
            <span class="text-xs font-semibold text-ink-900">{{ strings.portal.fields.otp }}</span>
            <input v-model.trim="code" inputmode="numeric" class="mt-1 w-full rounded-xl border border-gray-300 px-3 py-2 text-sm" :placeholder="strings.portal.placeholders.otp" />
          </label>

          <button
            class="w-full rounded-xl bg-navy-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
            :disabled="busy || code.length < 4"
            type="button"
            @click="verify"
          >
            {{ strings.portal.signUp.verify }}
          </button>
        </div>

        <p v-if="error" class="text-sm text-coral">{{ error }}</p>

        <p class="text-xs text-ink-500">
          {{ strings.portal.signUp.haveAccount }}
          <a :href="lp('/portal/sign-in/')" class="font-semibold text-navy-900 hover:underline">{{ strings.portal.nav.signIn }}</a>
        </p>
      </form>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { portalApi } from "./api";

const props = defineProps<{ lang: "ar" | "en"; strings: any }>();

const lp = (path: string) => props.lang === "ar" ? path : `/en${path}`;

const nid = ref("");
const fullNameAr = ref("");
const dob = ref("");
const gender = ref<"male" | "female">("male");
const mobile = ref("");

const code = ref("");
const step = ref<"form" | "otp">("form");
const busy = ref(false);
const error = ref<string | null>(null);

const canSubmit = computed(() => nid.value && fullNameAr.value && dob.value && mobile.value);

async function onSubmit() {
  busy.value = true;
  error.value = null;
  try {
    await portalApi.signup({
      nid: nid.value,
      full_name_ar: fullNameAr.value,
      dob: dob.value,
      gender: gender.value,
      mobile: mobile.value,
    });
    step.value = "otp";
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
    window.location.href = lp('/portal/');
  } catch (e: any) {
    error.value = e?.message || "Error";
  } finally {
    busy.value = false;
  }
}
</script>
