<template>
  <header
    class="fixed top-0 z-50 w-full transition-all duration-300"
    :class="scrolled ? 'bg-white/95 backdrop-blur-md shadow-md' : 'bg-transparent'"
  >
    <nav class="container mx-auto flex items-center justify-between py-4">

      <!-- Logo -->
      <a :href="`/${lang}/`" class="flex items-center gap-3 group">
        <div class="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full overflow-hidden transition-colors"
             :class="scrolled ? 'bg-primary' : 'bg-white/20 backdrop-blur-sm'">
          <img src="/icon.png" :alt="strings.site.name" class="h-full w-full object-cover" />
        </div>
        <div>
          <p class="text-sm font-bold leading-tight transition-colors"
             :class="scrolled ? 'text-primary' : 'text-white'">
            {{ strings.site.name }}
          </p>
          <p class="text-xs transition-colors hidden sm:block"
             :class="scrolled ? 'text-muted' : 'text-white/70'">
            {{ strings.site.tagline }}
          </p>
        </div>
      </a>

      <!-- Desktop nav -->
      <div class="hidden items-center gap-6 lg:flex">
        <a
          v-for="item in navItems"
          :key="item.id"
          :href="resolveLink(item.id)"
          class="text-sm font-semibold transition-colors"
          :class="scrolled ? 'text-text hover:text-secondary' : 'text-white/80 hover:text-white'"
        >
          {{ item.label }}
        </a>
      </div>

      <!-- Desktop actions -->
      <div class="hidden items-center gap-3 lg:flex">
        <!-- Emergency badge -->
        <div
          class="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold"
          :class="scrolled ? 'bg-red-600/10 text-red-700' : 'bg-white/15 text-white'"
        >
          <Phone class="h-3.5 w-3.5" aria-hidden="true" />
          <span>{{ strings.nav.emergency }} {{ strings.contact.details.emergencyNumber }}</span>
        </div>

        <!-- Language toggle -->
        <button
          class="rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors"
          :class="scrolled ? 'border-primary text-primary hover:bg-primary hover:text-white' : 'border-white/50 text-white hover:bg-white/20'"
          @click="toggleLocale"
          :aria-label="`Switch to ${localeStore.current === 'ar' ? 'English' : 'Arabic'}`"
        >
          {{ localeStore.current === 'ar' ? strings.nav.toggleToEn : strings.nav.toggleToAr }}
        </button>

      </div>

      <!-- Mobile hamburger -->
      <button
        class="rounded-lg p-2 lg:hidden transition-colors"
        :class="scrolled ? 'text-primary' : 'text-white'"
        :aria-label="uiStore.mobileMenuOpen ? 'Close menu' : 'Open menu'"
        :aria-expanded="uiStore.mobileMenuOpen"
        @click="uiStore.toggleMenu"
      >
        <Menu v-if="!uiStore.mobileMenuOpen" class="h-6 w-6" aria-hidden="true" />
        <X v-else class="h-6 w-6" aria-hidden="true" />
      </button>
    </nav>

    <!-- Mobile menu -->
    <Transition name="slide">
      <div
        v-if="uiStore.mobileMenuOpen"
        class="lg:hidden bg-white/98 backdrop-blur-md border-t border-gray-100 shadow-deep"
      >
        <div class="container mx-auto flex flex-col gap-1 py-4">
          <a
            v-for="item in navItems"
            :key="item.id"
            :href="resolveLink(item.id)"
            class="rounded-lg px-4 py-2.5 text-sm font-semibold text-text hover:bg-primary/5 hover:text-primary transition-colors"
            @click="uiStore.closeMenu"
          >
            {{ item.label }}
          </a>

          <div class="my-2 border-t border-gray-100" />

          <div class="flex items-center gap-2 rounded-full bg-red-600/10 px-4 py-2 text-xs font-semibold text-red-700 w-fit">
            <Phone class="h-3.5 w-3.5" aria-hidden="true" />
            <span>{{ strings.nav.emergency }}: {{ strings.contact.details.emergencyNumber }}</span>
          </div>

          <div class="flex items-center gap-3 pt-2">
            <button
              class="rounded-full border border-primary px-4 py-2 text-xs font-semibold text-primary hover:bg-primary hover:text-white transition-colors"
              @click="toggleLocale"
            >
              {{ localeStore.current === 'ar' ? strings.nav.toggleToEn : strings.nav.toggleToAr }}
            </button>
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
  { id: "about",        label: props.strings.nav.about },
  { id: "departments",  label: props.strings.nav.departments },
  { id: "achievements", label: props.strings.nav.achievements },
  { id: "team",         label: props.strings.nav.team },
  { id: "news",         label: props.strings.nav.news },
  { id: "contact",      label: props.strings.nav.contact },
]);

const resolveLink = (sectionId: string) => {
  const isHome = props.isHome ?? pathSegments.value.length === 1;
  return isHome ? `#${sectionId}` : `/${props.lang}/#${sectionId}`;
};

const onScroll = () => { scrolled.value = window.scrollY > 60; };

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
    window.addEventListener("scroll", onScroll, { passive: true });
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
  transition: all 0.25s ease;
}
.slide-enter-from,
.slide-leave-to {
  opacity: 0;
  transform: translateY(-6px);
}
</style>
