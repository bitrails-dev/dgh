<template>
  <!-- Mobile backdrop -->
  <Transition name="fade">
    <div
      v-if="uiStore.mobileMenuOpen"
      class="fixed inset-0 z-40 bg-black/40 md:hidden"
      @click="uiStore.closeMenu"
    />
  </Transition>

  <aside
    ref="sidebarEl"
    class="sidebar-root"
    :class="sidebarClasses"
    @mouseenter="onMouseEnter"
    @mouseleave="onMouseLeave"
  >
    <!-- Logo -->
    <div class="flex items-center gap-3 border-b border-gray-100 px-4 py-4">
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

      <!-- Mobile close -->
      <button
        v-if="isMobile"
        class="ms-auto rounded-lg p-1.5 text-muted hover:text-primary"
        :aria-label="strings.sidebar?.collapse ?? 'Close'"
        @click="uiStore.closeMenu"
      >
        <X class="h-5 w-5" />
      </button>
    </div>

    <!-- Language toggle -->
    <div class="px-3 py-2" v-show="showLabels">
      <button
        class="w-full rounded-lg border border-primary/20 px-3 py-1.5 text-xs font-semibold text-primary hover:bg-primary hover:text-white transition-colors"
        @click="toggleLocale"
      >
        {{ localeStore.current === 'ar' ? strings.nav?.toggleToEn : strings.nav?.toggleToAr }}
      </button>
    </div>

    <!-- Nav items -->
    <nav class="flex-1 overflow-y-auto px-2 py-2" aria-label="Main navigation">
      <ul class="space-y-0.5">
        <li v-for="item in navItems" :key="item.id">
          <a
            :href="item.href"
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
const hovered = ref(false);
const windowWidth = ref(1280);

const isMobile = computed(() => windowWidth.value < 768);
const isCollapsed = computed(() => windowWidth.value >= 768 && windowWidth.value < 1280);
const isExpanded = computed(() => windowWidth.value >= 1280);
const showLabels = computed(() => isExpanded.value || hovered.value || uiStore.mobileMenuOpen);

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
  const path = props.currentPath.replace(/\/$/, '') || '/';
  const target = href.replace(/\/$/, '') || '/';
  return path === target;
}

function onNavClick() {
  if (isMobile.value) {
    uiStore.closeMenu();
  }
}

function onMouseEnter() {
  if (isCollapsed.value) hovered.value = true;
}

function onMouseLeave() {
  if (isCollapsed.value) hovered.value = false;
}

function toggleLocale() {
  const next = localeStore.current === 'ar' ? 'en' : 'ar';
  localeStore.setLocale(next);
  if (typeof window === 'undefined') return;
  const url = new URL(window.location.href);
  const segments = url.pathname.split('/').filter(Boolean);
  if (segments.length && (segments[0] === 'ar' || segments[0] === 'en')) {
    segments[0] = next;
  } else {
    segments.unshift(next);
  }
  url.pathname = `/${segments.join('/')}`;
  window.location.href = url.toString();
}

function onResize() {
  windowWidth.value = window.innerWidth;
}

// Listen for toggle-sidebar custom event from TheTopBar
function onToggleSidebar() {
  uiStore.toggleMenu();
}

onMounted(() => {
  localeStore.init();
  if (typeof window !== 'undefined') {
    windowWidth.value = window.innerWidth;
    window.addEventListener('resize', onResize, { passive: true });
    window.addEventListener('toggle-sidebar', onToggleSidebar);
  }
});

onUnmounted(() => {
  if (typeof window !== 'undefined') {
    window.removeEventListener('resize', onResize);
    window.removeEventListener('toggle-sidebar', onToggleSidebar);
  }
});

const sidebarClasses = computed(() => {
  // Mobile drawer
  if (isMobile.value) {
    return [
      'fixed inset-block-0 z-50 flex w-[240px] flex-col bg-white shadow-deep transition-transform duration-300',
      uiStore.mobileMenuOpen
        ? 'translate-x-0 rtl:translate-x-0'
        : '-translate-x-full rtl:translate-x-full',
      'inset-inline-start-0',
    ];
  }
  // Collapsed rail (md–lg)
  if (isCollapsed.value) {
    return [
      'sticky top-0 z-30 flex h-screen flex-col bg-white border-inline-end border-gray-200 transition-all duration-300 overflow-hidden',
      hovered.value ? 'w-[240px] shadow-layered' : 'w-16',
    ];
  }
  // Full sidebar (xl+)
  return [
    'sticky top-0 z-30 flex h-screen w-[240px] flex-col bg-white border-inline-end border-gray-200',
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
