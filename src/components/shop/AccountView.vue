<script setup lang="ts">
// Account page: sign-in / register tabs; on a valid session shows the customer profile + sign-out.
// Order history is deferred (no per-customer orders endpoint yet) — surfaced as "not available".
import { ref, reactive, onMounted, onUnmounted } from "vue";
import { storeApi } from "../../lib/store/client";

const props = defineProps<{ lang: "ar" | "en"; strings: any }>();
const s = props.strings.shop.account;

const mode = ref<"login" | "register">("login");
const customer = ref<any>(null);
const loading = ref(true);
const busy = ref(false);
const error = ref("");
const form = reactive({ email: "", password: "", name: "", phone: "" });
let onPageLoad: (() => void) | null = null;

async function me() {
  try {
    const r = await storeApi.me();
    customer.value = r.customer;
  } catch {
    customer.value = null;
  } finally {
    loading.value = false;
  }
}
async function login() {
  busy.value = true;
  error.value = "";
  try {
    const r = await storeApi.login({ email: form.email, password: form.password });
    customer.value = r.customer;
  } catch (e: any) {
    error.value = e?.status === 401 ? s.invalidCredentials : s.error;
  } finally {
    busy.value = false;
  }
}
async function register() {
  busy.value = true;
  error.value = "";
  try {
    const r = await storeApi.register({ email: form.email, password: form.password, name: form.name, phone: form.phone });
    customer.value = r.customer;
  } catch (e: any) {
    error.value = e?.status === 409 ? s.emailInUse : s.error;
  } finally {
    busy.value = false;
  }
}
async function logout() {
  try {
    await storeApi.logout();
  } catch {
    /* empty */
  }
  customer.value = null;
  form.email = "";
  form.password = "";
}

onMounted(() => {
  me();
  onPageLoad = () => me();
  document.addEventListener("astro:page-load", onPageLoad);
});
onUnmounted(() => {
  if (onPageLoad) document.removeEventListener("astro:page-load", onPageLoad);
});
</script>

<template>
  <h1 class="font-display-ar text-3xl font-bold text-navy-900 mb-6">{{ s.title }}</h1>

  <div v-if="loading" class="text-ink-400">{{ s.loading }}</div>

  <div v-else-if="customer" class="card p-6 max-w-lg">
    <p class="text-lg">{{ s.welcome }}, <span class="font-bold">{{ customer.name || customer.email }}</span></p>
    <p class="text-ink-500 text-sm mt-1">{{ customer.email }}</p>
    <h2 class="font-display-ar text-lg font-bold text-navy-900 mt-6 mb-1">{{ s.ordersTitle }}</h2>
    <p class="text-ink-400 text-sm">{{ s.noOrders }}</p>
    <button @click="logout" class="btn btn-ghost mt-6">{{ s.signOut }}</button>
  </div>

  <div v-else class="max-w-md">
    <div class="flex gap-2 mb-6">
      <button @click="mode = 'login'" :class="mode === 'login' ? 'btn btn-primary' : 'btn btn-ghost'">{{ s.signIn }}</button>
      <button @click="mode = 'register'" :class="mode === 'register' ? 'btn btn-primary' : 'btn btn-ghost'">{{ s.register }}</button>
    </div>

    <form @submit.prevent="mode === 'login' ? login() : register()" class="space-y-4">
      <label v-if="mode === 'register'" class="block">
        <span class="text-sm font-medium text-ink-700">{{ s.name }}</span>
        <input type="text" v-model="form.name" class="w-full mt-1 border border-ink-200 rounded-lg px-3 py-2 bg-white" />
      </label>
      <label class="block">
        <span class="text-sm font-medium text-ink-700">{{ s.email }}</span>
        <input type="email" required v-model="form.email" class="w-full mt-1 border border-ink-200 rounded-lg px-3 py-2 bg-white" />
      </label>
      <label class="block">
        <span class="text-sm font-medium text-ink-700">{{ s.password }}</span>
        <input type="password" required minlength="8" v-model="form.password" class="w-full mt-1 border border-ink-200 rounded-lg px-3 py-2 bg-white" />
      </label>
      <label v-if="mode === 'register'" class="block">
        <span class="text-sm font-medium text-ink-700">{{ s.phone }}</span>
        <input type="tel" v-model="form.phone" class="w-full mt-1 border border-ink-200 rounded-lg px-3 py-2 bg-white" />
      </label>
      <button type="submit" :disabled="busy" class="btn btn-primary w-full disabled:opacity-60">
        {{ mode === "login" ? s.signInAction : s.registerAction }}
      </button>
      <p v-if="error" class="text-coral text-sm">{{ error }}</p>
    </form>

    <button @click="mode = mode === 'login' ? 'register' : 'login'" class="text-teal-700 text-sm mt-4 hover:underline">
      {{ mode === "login" ? s.noAccount : s.haveAccount }}
    </button>
  </div>
</template>
