<script setup lang="ts">
// Account page (Wave E3). Sign-in / register tabs; on a valid session shows the customer profile,
// a live order-history summary (shopApi.orders), and sign-out. Links to full order history and to
// the password-reset flow.
import { ref, reactive, computed, onMounted, onUnmounted } from "vue";
import { shopApi } from "./api";
import { formatMoney } from "../../lib/store/money";
import { localePath } from "../../i18n";

const props = defineProps<{ lang: "ar" | "en"; strings: any }>();
const s = computed(() => props.strings.shop.account);
const sk = computed(() => props.strings.shop);

const mode = ref<"login" | "register">("login");
const customer = ref<any>(null);
const orders = ref<any[]>([]);
const loading = ref(true);
const busy = ref(false);
const error = ref("");
const form = reactive({ email: "", password: "", name: "", phone: "" });
let onPageLoad: (() => void) | null = null;

const ordersHref = computed(() => localePath("/account/orders", props.lang));
const forgotHref = computed(() => localePath("/account/forgot-password", props.lang));

async function load() {
  loading.value = true;
  try {
    const me = await shopApi.auth.me();
    customer.value = me.customer;
    if (customer.value) {
      try {
        orders.value = (await shopApi.orders()).items ?? [];
      } catch {
        orders.value = [];
      }
    }
  } catch {
    customer.value = null;
    orders.value = [];
  } finally {
    loading.value = false;
  }
}

async function login() {
  busy.value = true;
  error.value = "";
  try {
    const r = await shopApi.auth.login({ email: form.email, password: form.password });
    customer.value = r.customer;
    orders.value = (await shopApi.orders().catch(() => ({ items: [] }))).items;
  } catch (e: any) {
    error.value = e?.status === 401 ? s.value.invalidCredentials : s.value.error;
  } finally {
    busy.value = false;
  }
}

async function register() {
  busy.value = true;
  error.value = "";
  try {
    const r = await shopApi.auth.register({ email: form.email, password: form.password, name: form.name, phone: form.phone });
    customer.value = r.customer;
  } catch (e: any) {
    error.value = e?.status === 409 ? s.value.emailInUse : s.value.error;
  } finally {
    busy.value = false;
  }
}

async function logout() {
  try {
    await shopApi.auth.logout();
  } catch {
    /* ignore */
  }
  customer.value = null;
  orders.value = [];
  form.email = "";
  form.password = "";
}

onMounted(() => {
  load();
  onPageLoad = () => load();
  document.addEventListener("astro:page-load", onPageLoad);
});
onUnmounted(() => {
  if (onPageLoad) document.removeEventListener("astro:page-load", onPageLoad);
});
</script>

<template>
  <h1 class="font-display-ar text-3xl font-bold text-navy-900 mb-6">{{ s.title }}</h1>

  <div v-if="loading" class="text-ink-400">{{ s.loading }}</div>

  <div v-else-if="customer" class="space-y-6">
    <div class="card p-6 max-w-lg">
      <p class="text-lg">{{ s.welcome }}, <span class="font-bold">{{ customer.name || customer.email }}</span></p>
      <p class="text-ink-500 text-sm mt-1">{{ customer.email }}</p>
      <button @click="logout" class="btn btn-ghost mt-6">{{ s.signOut }}</button>
    </div>

    <section>
      <div class="flex items-center justify-between mb-3">
        <h2 class="font-display-ar text-lg font-bold text-navy-900">{{ sk.value.orders.title }}</h2>
        <a :href="ordersHref" class="text-teal-700 text-sm hover:underline">{{ sk.value.orders.title }}</a>
      </div>
      <p v-if="orders.length === 0" class="text-ink-400 text-sm">{{ sk.value.orders.empty }}</p>
      <ul v-else class="divide-y divide-ink-100">
        <li v-for="o in orders.slice(0, 5)" :key="o.orderNumber || o.id" class="py-3 flex items-center justify-between gap-4">
          <div>
            <p class="font-semibold text-ink-900 font-mono">{{ o.orderNumber }}</p>
            <p class="text-xs text-ink-400">{{ o.createdAt || o.date }}</p>
          </div>
          <div class="text-end">
            <p class="font-bold text-teal-700">{{ formatMoney(o.grandTotal ?? o.total, o.currency) }}</p>
            <a :href="localePath(`/account/orders/${o.orderNumber}`, lang)" class="text-xs text-teal-700 hover:underline">{{ sk.value.orders.viewDetail }}</a>
          </div>
        </li>
      </ul>
    </section>
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
      <p v-if="error" class="text-coral text-sm" role="alert">{{ error }}</p>
    </form>

    <div v-if="mode === 'login'" class="mt-4 flex items-center justify-between text-sm">
      <button @click="mode = mode === 'login' ? 'register' : 'login'" class="text-teal-700 hover:underline">
        {{ mode === "login" ? s.noAccount : s.haveAccount }}
      </button>
      <a :href="forgotHref" class="text-teal-700 hover:underline">{{ sk.value.reset.forgotTitle }}</a>
    </div>
  </div>
</template>
