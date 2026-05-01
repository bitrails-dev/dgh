<template>
  <!-- Mobile/tablet backdrop -->
  <Transition name="fade">
    <div
      v-if="uiStore.mobileMenuOpen"
      class="fixed inset-0 z-40 bg-black/40 xl:hidden"
      @click="uiStore.closeMenu"
    />
  </Transition>

  <aside
    ref="sidebarEl"
    :class="sidebarClasses"
  >
    <!-- Brand header + close button -->
    <div class="flex items-center gap-3 px-5 py-4 border-b border-ink-100">
      <a :href="lp('/')" class="flex items-center gap-3 min-w-0 group">
        <img src="/logo/logo-hex.svg" class="h-8 w-8 flex-shrink-0" alt="" aria-hidden="true" />
        <div class="min-w-0">
          <div class="font-display-ar font-semibold text-sm text-navy-900 leading-tight truncate">
            {{ strings.site?.name }}
          </div>
          <div class="mt-0.5 text-[10px] tracking-widest text-teal-700 uppercase font-medium leading-none">
            {{ strings.site?.established }}
          </div>
        </div>
      </a>

      <!-- Close button -->
      <button
        class="ms-auto rounded-lg p-1.5 text-ink-400 hover:text-teal-800 transition-colors"
        :aria-label="strings.sidebar?.collapse ?? 'Close'"
        @click="uiStore.closeMenu"
      >
        <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </button>
    </div>

    <!-- Language toggle row -->
    <div class="px-5 py-3 border-b border-ink-100">
      <a
        :href="langSwitchUrl"
        class="inline-flex items-center gap-1.5 px-3 py-1.5 border border-ink-200 rounded-full text-sm font-medium text-ink-700 hover:border-teal-600 hover:text-teal-800 transition-colors"
      >
        <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <circle cx="12" cy="12" r="10" />
          <line x1="2" y1="12" x2="22" y2="12" />
          <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
        </svg>
        {{ lang === 'ar' ? strings.nav?.toggleToEn : strings.nav?.toggleToAr }}
      </a>
    </div>

    <!-- Nav items -->
    <nav class="flex-1 overflow-y-auto px-2 py-3" aria-label="Main navigation">
      <ul class="space-y-0.5">
        <li v-for="item in navItems" :key="item.id">
          <a
            :href="item.href"
            class="flex items-center gap-3 px-3 py-2.5 text-sm font-medium transition-colors"
            :class="isActive(item.href)
              ? 'bg-teal-50 text-teal-800 border-l-2 border-teal-600'
              : 'text-ink-700 hover:bg-ivory-100'"
            @click="onNavClick"
          >
            <component :is="item.icon" class="h-5 w-5 flex-shrink-0" aria-hidden="true" />
            <span class="truncate">{{ item.label }}</span>
          </a>
        </li>
      </ul>
    </nav>

    <!-- Emergency section -->
    <div class="mt-auto border-t border-ink-100 px-3 py-4">
      <a
        :href="`tel:${emergencyNumber}`"
        class="emergency-pill w-full justify-center"
      >
        <span class="dot" />
        <span class="lnum">{{ strings.sidebar?.emergency ?? strings.nav?.emergency }} {{ emergencyNumber }}</span>
      </a>
    </div>
  </aside>
</template>

<script setup lang="ts">
import { computed, ref, onMounted, onUnmounted } from 'vue';
import {
  Home,
  Info,
  Building2,
  Users,
  Trophy,
  Award,
  FileText,
  CalendarDays,
  Phone,
} from 'lucide-vue-next';
import { useUiStore } from '../../stores/ui';

const props = defineProps<{
  lang: string;
  currentPath: string;
  strings: any;
}>();

const uiStore = useUiStore();
const sidebarEl = ref<HTMLElement | null>(null);
const isHydrated = ref(false);

// Tracks the current page path -- updated via astro:page-load so the persisted
// component highlights the correct nav item after View Transition navigations.
const livePath = ref(props.currentPath);

const emergencyNumber = computed(() => props.strings.contact?.details?.emergencyNumber ?? '12345');

// Prefix helper: empty for Arabic (default, no prefix), /en for English
const lp = (path: string) => props.lang === 'ar' ? path : `/en${path}`;

// Language switch URL (safe for SSR)
const langSwitchUrl = computed(() => {
  const path = livePath.value;
  if (props.lang === 'ar') {
    return path === '/' ? '/en/' : `/en${path}`;
  } else {
    return path.replace(/^\/en/, '') || '/';
  }
});

const navItems = computed(() => [
  { id: 'home',          href: lp('/'),              label: props.strings.nav?.home,          icon: Home },
  { id: 'about',         href: lp('/about'),         label: props.strings.nav?.about,         icon: Info },
  { id: 'departments',   href: lp('/departments'),   label: props.strings.nav?.departments,   icon: Building2 },
  { id: 'team',          href: lp('/team'),          label: props.strings.nav?.team,          icon: Users },
  { id: 'achievements',  href: lp('/achievements'),  label: props.strings.nav?.achievements,  icon: Trophy },
  { id: 'awards',        href: lp('/awards'),        label: props.strings.nav?.awards,        icon: Award },
  { id: 'articles',      href: lp('/articles'),      label: props.strings.nav?.articles,      icon: FileText },
  { id: 'events',        href: lp('/events'),        label: props.strings.nav?.events,        icon: CalendarDays },
  { id: 'contact',       href: lp('/contact'),       label: props.strings.nav?.contact,       icon: Phone },
]);

function isActive(href: string): boolean {
  const path = livePath.value.replace(/\/$/, '') || '/';
  const target = href.replace(/\/$/, '') || '/';
  const homeTarget = lp('/').replace(/\/$/, '') || '/';
  if (target === homeTarget) return path === target;
  return path === target || path.startsWith(target + '/');
}

function onNavClick() {
  uiStore.closeMenu();
}

function onPageLoad() {
  livePath.value = window.location.pathname;
  // Close mobile drawer on navigation
  uiStore.closeMenu();
}

function onToggleSidebar() {
  uiStore.toggleMenu();
}

onMounted(() => {
  if (typeof window !== 'undefined') {
    window.addEventListener('toggle-sidebar', onToggleSidebar);
    document.addEventListener('astro:page-load', onPageLoad);
    requestAnimationFrame(() => { isHydrated.value = true; });
  }
});

onUnmounted(() => {
  if (typeof window !== 'undefined') {
    window.removeEventListener('toggle-sidebar', onToggleSidebar);
    document.removeEventListener('astro:page-load', onPageLoad);
  }
});

const isRtl = computed(() => props.lang === 'ar');

const sidebarClasses = computed(() => [
  'fixed top-0 h-screen z-50 flex w-[280px] flex-col bg-white shadow-deep xl:hidden',
  isRtl.value ? 'right-0' : 'left-0',
  isHydrated.value ? 'transition-transform duration-300' : '',
  uiStore.mobileMenuOpen
    ? 'translate-x-0'
    : isRtl.value ? 'translate-x-full' : '-translate-x-full',
]);
</script>

<style scoped>
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.25s ease;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
