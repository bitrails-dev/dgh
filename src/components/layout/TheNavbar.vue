<template>
  <header class="fixed top-0 z-50 w-full transition-all duration-300" :class="scrolled ? 'backdrop-blur-md bg-white/90 shadow-md' : 'bg-transparent'">
    <nav class="container mx-auto flex items-center justify-between py-4">
      <div class="flex items-center gap-3">
        <div class="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary text-white font-bold">{{ strings.site.initials }}</div>
        <div>
          <p class="text-sm font-semibold text-primary">{{ strings.site.name }}</p>
          <p class="text-xs text-muted">{{ strings.site.tagline }}</p>
        </div>
      </div>

      <div class="hidden items-center gap-6 lg:flex">
        <a v-for="item in navItems" :key="item.id" :href="resolveLink(item.id)" class="text-sm font-semibold text-text hover:text-secondary">
          {{ item.label }}
        </a>
      </div>

      <div class="hidden items-center gap-4 lg:flex">
        <div class="flex items-center gap-2 rounded-full bg-red-600/10 px-3 py-1 text-xs font-semibold text-red-700">
          <Phone class="h-4 w-4" />
          <span>{{ strings.nav.emergency }} {{ strings.contact.details.emergencyNumber }}</span>
        </div>
        <button
          class="rounded-full border border-primary px-3 py-1 text-xs font-semibold text-primary"
          @click="toggleLocale"
        >
          {{ localeStore.current === 'ar' ? strings.nav.toggleToEn : strings.nav.toggleToAr }}
        </button>
        <a :href="resolveLink('contact')" class="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white shadow-soft">
          {{ strings.nav.cta }}
        </a>
      </div>

      <button class="lg:hidden" @click="uiStore.toggleMenu">
        <Menu v-if="!uiStore.mobileMenuOpen" class="h-7 w-7 text-primary" />
        <X v-else class="h-7 w-7 text-primary" />
      </button>
    </nav>

    <Transition name="slide">
      <div v-if="uiStore.mobileMenuOpen" class="lg:hidden bg-white/95 backdrop-blur-md border-t border-gray-200">
        <div class="container mx-auto flex flex-col gap-4 py-4">
          <a v-for="item in navItems" :key="item.id" :href="resolveLink(item.id)" class="text-sm font-semibold text-text" @click="uiStore.closeMenu">
            {{ item.label }}
          </a>
          <div class="flex items-center gap-2 rounded-full bg-red-600/10 px-3 py-1 text-xs font-semibold text-red-700">
            <Phone class="h-4 w-4" />
            <span>{{ strings.nav.emergency }} {{ strings.contact.details.emergencyNumber }}</span>
          </div>
          <div class="flex items-center gap-3">
            <button class="rounded-full border border-primary px-3 py-1 text-xs font-semibold text-primary" @click="toggleLocale">
              {{ localeStore.current === 'ar' ? strings.nav.toggleToEn : strings.nav.toggleToAr }}
            </button>
            <a :href="resolveLink('contact')" class="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white shadow-soft">
              {{ strings.nav.cta }}
            </a>
          </div>
        </div>
      </div>
    </Transition>
  </header>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import { Menu, X, Phone } from "lucide-vue-next";
import { useLocaleStore } from "../../stores/locale";
import { useUiStore } from "../../stores/ui";

const props = defineProps<{ strings: any; lang: "ar" | "en"; isHome?: boolean }>();

const localeStore = useLocaleStore();
const uiStore = useUiStore();
const scrolled = ref(false);
const pathSegments = ref<string[]>([]);

const navItems = computed(() => [
  { id: "about", label: props.strings.nav.about },
  { id: "departments", label: props.strings.nav.departments },
  { id: "achievements", label: props.strings.nav.achievements },
  { id: "team", label: props.strings.nav.team },
  { id: "news", label: props.strings.nav.news },
  { id: "contact", label: props.strings.nav.contact },
]);

const resolveLink = (sectionId: string) => {
  const isHome = props.isHome ?? pathSegments.value.length === 1;
  return isHome ? `#${sectionId}` : `/${props.lang}/#${sectionId}`;
};

const onScroll = () => {
  scrolled.value = window.scrollY > 20;
};

const toggleLocale = () => {
  const next = localeStore.current === "ar" ? "en" : "ar";
  localeStore.setLocale(next);
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  const segments = url.pathname.split("/").filter(Boolean);
  if (segments.length && (segments[0] === "ar" || segments[0] === "en")) {
    segments[0] = next;
  } else {
    segments.unshift(next);
  }
  url.pathname = `/${segments.join("/")}`;
  window.location.href = url.toString();
};

onMounted(() => {
  localeStore.init();
  if (typeof window !== "undefined") {
    pathSegments.value = window.location.pathname.split("/").filter(Boolean);
    window.addEventListener("scroll", onScroll);
    onScroll();
  }
});

onUnmounted(() => {
  if (typeof window !== "undefined") {
    window.removeEventListener("scroll", onScroll);
  }
});
</script>

<style scoped>
.slide-enter-active,
.slide-leave-active {
  transition: all 0.3s ease;
}
.slide-enter-from,
.slide-leave-to {
  opacity: 0;
  transform: translateY(-8px);
}
</style>
