<script setup lang="ts">
// Password reset (Wave E3). Two modes:
// - request: email → shopApi.auth.requestPasswordReset → "sent" notice (always shown, to avoid
//   account enumeration).
// - confirm: reads the reset token from the URL query, takes a new password, calls
//   shopApi.auth.resetPassword. On success or an invalid/expired token, surfaces the right message.
import { ref, computed, onMounted } from "vue";
import { shopApi } from "./api";
import { localePath } from "../../i18n";

const props = defineProps<{ lang: "ar" | "en"; strings: any; mode: "request" | "confirm"; token?: string }>();
const s = computed(() => props.strings.shop.reset);
const sk = computed(() => props.strings.shop);

const email = ref("");
const password = ref("");
const busy = ref(false);
const done = ref(false);
const error = ref("");
const resolvedToken = ref("");

const loginHref = computed(() => localePath("/account", props.lang));

onMounted(() => {
  if (props.mode === "confirm") {
    const t = props.token ?? new URLSearchParams(window.location.search).get("token") ?? "";
    resolvedToken.value = t;
  }
});

async function sendRequest() {
  busy.value = true;
  error.value = "";
  try {
    await shopApi.auth.requestPasswordReset(email.value);
    done.value = true;
  } catch (e: any) {
    // Treat provider errors as "sent" to avoid account enumeration, unless it's clearly a rate limit.
    if (e?.status === 429) error.value = sk.value.errors.rateLimited;
    else done.value = true;
  } finally {
    busy.value = false;
  }
}

async function confirmReset() {
  if (!resolvedToken.value) {
    error.value = s.invalidToken;
    return;
  }
  busy.value = true;
  error.value = "";
  try {
    await shopApi.auth.resetPassword({ token: resolvedToken.value, password: password.value });
    done.value = true;
  } catch (e: any) {
    error.value = e?.status === 429 ? sk.value.errors.rateLimited : s.invalidToken;
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <h1 class="font-display-ar text-3xl font-bold text-navy-900 mb-2">
    {{ mode === "request" ? s.forgotTitle : s.resetTitle }}
  </h1>
  <p class="text-ink-500 mb-6">{{ mode === "request" ? s.forgotBody : s.newPassword }}</p>

  <div v-if="done" class="card p-6 max-w-md">
    <p class="text-ink-700">{{ mode === "request" ? s.sent : s.updated }}</p>
    <a :href="loginHref" class="btn btn-primary mt-4">{{ s.backToLogin }}</a>
  </div>

  <form
    v-else-if="mode === 'request'"
    @submit.prevent="sendRequest"
    class="max-w-md space-y-4"
  >
    <label class="block">
      <span class="text-sm font-medium text-ink-700">{{ s.email }}</span>
      <input type="email" required v-model="email" class="w-full mt-1 border border-ink-200 rounded-lg px-3 py-2 bg-white" />
    </label>
    <button type="submit" :disabled="busy" class="btn btn-primary w-full disabled:opacity-60">
      {{ busy ? s.sending : s.send }}
    </button>
    <p v-if="error" class="text-coral text-sm" role="alert">{{ error }}</p>
    <a :href="loginHref" class="block text-teal-700 text-sm hover:underline">{{ s.backToLogin }}</a>
  </form>

  <form v-else @submit.prevent="confirmReset" class="max-w-md space-y-4">
    <div v-if="!resolvedToken" class="card p-4">
      <p class="text-coral text-sm" role="alert">{{ s.invalidToken }}</p>
    </div>
    <label class="block">
      <span class="text-sm font-medium text-ink-700">{{ s.newPassword }}</span>
      <input type="password" required minlength="8" v-model="password" class="w-full mt-1 border border-ink-200 rounded-lg px-3 py-2 bg-white" />
    </label>
    <button type="submit" :disabled="busy || !resolvedToken" class="btn btn-primary w-full disabled:opacity-60">
      {{ busy ? s.submitting : s.submit }}
    </button>
    <p v-if="error" class="text-coral text-sm" role="alert">{{ error }}</p>
  </form>
</template>
