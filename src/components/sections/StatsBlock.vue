<template>
  <div
    ref="container"
    class="grid grid-cols-2 gap-px overflow-hidden rounded-2xl bg-accent/20 shadow-deep lg:grid-cols-5"
  >
    <div
      v-for="(stat, i) in enriched"
      :key="stat.label"
      class="group flex flex-col items-center justify-center gap-1 bg-secondary px-4 py-8 text-center transition-colors duration-300 hover:bg-secondary/80"
    >
      <!-- Animated number + suffix -->
      <div class="flex items-end justify-center gap-0.5">
        <span
          :ref="(el) => setRef(el as HTMLElement, i)"
          class="text-4xl font-black leading-none text-accent transition-transform duration-300 group-hover:scale-110"
        >0</span>
        <span class="mb-1 text-xl font-bold text-accent/80">{{ stat.suffix }}</span>
      </div>

      <!-- Icon -->
      <div class="mt-1 flex h-6 w-6 items-center justify-center opacity-50">
        <svg viewBox="0 0 24 24" class="h-5 w-5 text-white" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path :d="stat.icon" />
        </svg>
      </div>

      <!-- Label -->
      <p class="mt-1 text-xs font-semibold uppercase tracking-widest text-white/60">
        {{ stat.label }}
      </p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import gsap from "gsap";

const props = defineProps<{
  stats: { label: string; value: number }[];
}>();

// ── Icon paths (SVG d= strings) per index ─────────────────────────────────
const ICONS = [
  // Calendar / years
  "M8 2v3M16 2v3M3 8h18M5 4h14a2 2 0 012 2v14a2 2 0 01-2 2H5a2 2 0 01-2-2V6a2 2 0 012-2z",
  // Grid / departments
  "M3 3h7v7H3zM14 3h7v7h-7zM14 14h7v7h-7zM3 14h7v7H3z",
  // Users / patients
  "M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2M9 11a4 4 0 100-8 4 4 0 000 8zM23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75",
  // Briefcase / staff
  "M20 7H4a2 2 0 00-2 2v10a2 2 0 002 2h16a2 2 0 002-2V9a2 2 0 00-2-2zM16 7V5a2 2 0 00-2-2h-4a2 2 0 00-2 2v2",
  // Award / awards
  "M12 2l2.9 6.2 6.6.6-5 4.3 1.6 6.4-6.1-3.4-6.1 3.4 1.6-6.4-5-4.3 6.6-.6L12 2z",
];

// ── Smart abbreviation ─────────────────────────────────────────────────────
function abbreviate(value: number): { target: number; suffix: string; decimals: number } {
  if (value >= 1_000_000) {
    const v = value / 1_000_000;
    return { target: v, suffix: "M+", decimals: v % 1 === 0 ? 0 : 1 };
  }
  if (value >= 10_000) {
    const v = value / 1_000;
    return { target: v, suffix: "K+", decimals: v % 1 === 0 ? 0 : 1 };
  }
  return { target: value, suffix: "+", decimals: 0 };
}

const enriched = computed(() =>
  props.stats.map((s, i) => ({
    ...s,
    ...abbreviate(s.value),
    icon: ICONS[i] ?? ICONS[ICONS.length - 1],
  }))
);

// ── Refs ──────────────────────────────────────────────────────────────────
const container  = ref<HTMLElement | null>(null);
const numEls     = ref<(HTMLElement | null)[]>([]);

function setRef(el: HTMLElement | null, index: number) {
  numEls.value[index] = el;
}

// ── Animation ─────────────────────────────────────────────────────────────
let observer: IntersectionObserver | null = null;

onMounted(() => {
  if (!container.value) return;

  observer = new IntersectionObserver(
    (entries) => {
      if (!entries[0].isIntersecting) return;
      observer?.disconnect();

      enriched.value.forEach((stat, i) => {
        const el = numEls.value[i];
        if (!el) return;

        const obj = { v: 0 };
        gsap.to(obj, {
          v: stat.target,
          duration: 2.4,
          ease: "expo.out",
          delay: i * 0.08,
          onUpdate() {
            el.textContent =
              stat.decimals > 0
                ? obj.v.toFixed(stat.decimals)
                : String(Math.floor(obj.v));
          },
          onComplete() {
            // Show exact final value
            el.textContent =
              stat.decimals > 0
                ? stat.target.toFixed(stat.decimals)
                : String(stat.target);
          },
        });
      });
    },
    { threshold: 0.4 }
  );

  observer.observe(container.value);
});

onUnmounted(() => {
  observer?.disconnect();
});
</script>
