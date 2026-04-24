<template>
  <!-- Mobile + tablet backdrop -->
  <Transition name="fade">
    <div
      v-if="uiStore.mobileMenuOpen"
      class="fixed inset-0 z-40 bg-black/40 xl:hidden"
      @click="uiStore.closeMenu"
    />
  </Transition>

  <aside
    ref="sidebarEl"
    class="sidebar-root"
    :class="sidebarClasses"
  >
    <!-- Logo + close/collapse button -->
    <div
      class="flex items-center border-b border-gray-100 py-4"
      :class="isDesktop && desktopCollapsed ? 'justify-center gap-2 px-1' : 'gap-3 px-4'"
    >
      <a :href="`/${lang}/`" class="flex items-center gap-3 group min-w-0">
        <img
          src="/icon.png"
          :alt="strings.site?.name"
          class="h-9 w-9 flex-shrink-0 rounded-full object-cover"
        />
        <span
          v-show="showLabels"
          class="truncate text-sm font-bold text-primary leading-tight"
        >
          {{ strings.site?.name }}
        </span>
      </a>

      <!-- Mobile/tablet close -->
      <button
        v-if="isMobile || isTablet"
        class="ms-auto rounded-lg p-1.5 text-muted hover:text-primary"
        :aria-label="strings.sidebar?.collapse ?? 'Close'"
        @click="uiStore.closeMenu"
      >
        <X class="h-5 w-5" />
      </button>

      <!-- Desktop collapse toggle -->
      <button
        v-if="isDesktop"
        class="rounded-lg p-1.5 text-muted hover:text-primary transition-colors"
        :class="desktopCollapsed ? '' : 'ms-auto'"
        :aria-label="desktopCollapsed ? (strings.sidebar?.expand ?? 'Expand') : (strings.sidebar?.collapse ?? 'Collapse')"
        @click="toggleDesktop"
      >
        <ChevronLeft
          class="h-5 w-5 transition-transform duration-300"
          :class="desktopCollapsed ? 'rtl:rotate-0 rotate-180' : 'rtl:rotate-180'"
        />
      </button>
    </div>

    <!-- Nav items -->
    <nav class="flex-1 overflow-y-auto px-2 py-2" aria-label="Main navigation">
      <ul class="space-y-0.5">
        <li v-for="item in navItems" :key="item.id">
          <a
            :href="item.href"
            :title="!showLabels ? item.label : undefined"
            class="nav-link flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors"
            :class="isActive(item.href)
              ? 'active-link bg-[rgba(212,168,67,0.08)] text-primary border-inline-start-3 border-accent'
              : 'text-text hover:bg-background'"
            @click="onNavClick"
          >
            <component :is="item.icon" class="h-5 w-5 flex-shrink-0" aria-hidden="true" />
            <span v-show="showLabels" class="truncate">{{ item.label }}</span>
          </a>
        </li>
      </ul>
    </nav>

    <!-- Emergency section -->
    <div class="mt-auto border-t border-gray-100 px-3 py-4">
      <a
        href="tel:12345"
        :title="!showLabels ? (strings.sidebar?.emergency ?? strings.nav?.emergency) : undefined"
        class="flex items-center gap-2 rounded-full bg-primary px-3 py-2 text-xs font-semibold text-white"
        :class="showLabels ? '' : 'justify-center'"
      >
        <Phone class="h-4 w-4 flex-shrink-0" aria-hidden="true" />
        <span v-show="showLabels">
          {{ strings.sidebar?.emergency ?? strings.nav?.emergency }}
          {{ strings.contact?.details?.emergencyNumber ?? '12345' }}
        </span>
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
  MessageSquareQuote,
  FileText,
  CalendarDays,
  Phone,
  X,
  ChevronLeft,
} from 'lucide-vue-next';
import { useLocaleStore } from '../../stores/locale';
import { useUiStore } from '../../stores/ui';

const props = defineProps<{
  lang: string;
  currentPath: string;
  strings: any;
}>();

const localeStore = useLocaleStore();
const uiStore = useUiStore();
const sidebarEl = ref<HTMLElement | null>(null);
const windowWidth = ref(0); // 0 = mobile-first SSR (sidebar is fixed/off-screen before hydration)
const desktopCollapsed = ref(false);
const isHydrated = ref(false);
// Tracks the current page path — updated via astro:page-load so the persisted
// component highlights the correct nav item after View Transition navigations.
const livePath = ref(props.currentPath);

const isMobile = computed(() => windowWidth.value < 768);
const isTablet = computed(() => windowWidth.value >= 768 && windowWidth.value < 1280);
const isDesktop = computed(() => windowWidth.value >= 1280);
const showLabels = computed(() => {
  if (isMobile.value || isTablet.value) return uiStore.mobileMenuOpen;
  return !desktopCollapsed.value;
});

const navItems = computed(() => [
  { id: 'home',          href: `/${props.lang}/`,              label: props.strings.nav?.home,          icon: Home },
  { id: 'about',         href: `/${props.lang}/about`,         label: props.strings.nav?.about,         icon: Info },
  { id: 'departments',   href: `/${props.lang}/departments`,   label: props.strings.nav?.departments,   icon: Building2 },
  { id: 'team',          href: `/${props.lang}/team`,          label: props.strings.nav?.team,          icon: Users },
  { id: 'achievements',  href: `/${props.lang}/achievements`,  label: props.strings.nav?.achievements,  icon: Trophy },
  { id: 'awards',        href: `/${props.lang}/awards`,        label: props.strings.nav?.awards,        icon: Award },
  { id: 'testimonials',  href: `/${props.lang}/testimonials`,  label: props.strings.nav?.testimonials,  icon: MessageSquareQuote },
  { id: 'articles',      href: `/${props.lang}/articles`,      label: props.strings.nav?.articles,      icon: FileText },
  { id: 'events',        href: `/${props.lang}/events`,        label: props.strings.nav?.events,        icon: CalendarDays },
  { id: 'contact',       href: `/${props.lang}/contact`,       label: props.strings.nav?.contact,       icon: Phone },
]);

function isActive(href: string): boolean {
  const path = livePath.value.replace(/\/$/, '') || '/';
  const target = href.replace(/\/$/, '') || '/';
  return path === target;
}

function onNavClick() {
  if (isMobile.value || isTablet.value) {
    uiStore.closeMenu();
  }
}

function toggleDesktop() {
  desktopCollapsed.value = !desktopCollapsed.value;
  try {
    localStorage.setItem('sidebar-collapsed', String(desktopCollapsed.value));
  } catch {}
}

function onResize() {
  windowWidth.value = window.innerWidth;
}

function onToggleSidebar() {
  if (isDesktop.value) {
    toggleDesktop();
  } else {
    uiStore.toggleMenu();
  }
}

function onPageLoad() {
  livePath.value = window.location.pathname;
  // Close mobile drawer on navigation
  uiStore.closeMenu();
}

onMounted(() => {
  localeStore.init();
  if (typeof window !== 'undefined') {
    windowWidth.value = window.innerWidth;
    try {
      desktopCollapsed.value = localStorage.getItem('sidebar-collapsed') === 'true';
    } catch {}
    window.addEventListener('resize', onResize, { passive: true });
    window.addEventListener('toggle-sidebar', onToggleSidebar);
    document.addEventListener('astro:page-load', onPageLoad);
    // Enable transitions after initial layout settles to avoid the SSR→hydration animation
    requestAnimationFrame(() => { isHydrated.value = true; });
  }
});

onUnmounted(() => {
  if (typeof window !== 'undefined') {
    window.removeEventListener('resize', onResize);
    window.removeEventListener('toggle-sidebar', onToggleSidebar);
    document.removeEventListener('astro:page-load', onPageLoad);
  }
});

const sidebarClasses = computed(() => {
  // Mobile + tablet: hidden drawer, slides in when toggled
  if (isMobile.value || isTablet.value) {
    return [
      'fixed top-0 h-screen z-50 flex w-[240px] flex-col bg-white shadow-deep inset-inline-start-0',
      isHydrated.value ? 'transition-transform duration-300' : '',
      uiStore.mobileMenuOpen
        ? 'translate-x-0 rtl:translate-x-0'
        : '-translate-x-full rtl:translate-x-full',
    ];
  }
  // Desktop: toggleable between full and compact icon rail
  return [
    'sticky top-[var(--sidebar-topbar-height,56px)] z-30 flex h-[calc(100vh-var(--sidebar-topbar-height,56px))] flex-col bg-white border-inline-end border-gray-200 overflow-hidden',
    isHydrated.value ? 'transition-all duration-300' : '',
    desktopCollapsed.value ? 'w-20' : 'w-[240px]',
  ];
});
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

.border-inline-start-3 {
  border-inline-start-width: 3px;
}

.border-inline-end {
  border-inline-end-width: 1px;
}

.inset-inline-start-0 {
  inset-inline-start: 0;
}

.nav-link {
  padding-inline-start: 12px;
}

.active-link {
  padding-inline-start: 9px; /* 12px - 3px border */
}
</style>
