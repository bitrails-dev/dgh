<template>
  <div
    ref="container"
    class="grid grid-cols-2 sm:grid-cols-4 gap-0 rounded-2xl overflow-hidden"
    :class="dark
      ? 'border border-white/20 bg-white/10 backdrop-blur-md'
      : 'border border-primary/20 bg-primary/[0.07] backdrop-blur-sm'"
  >
    <div
      v-for="(stat, i) in enriched"
      :key="stat.label"
      class="flex flex-col items-center justify-center gap-3 px-10 py-9 text-center relative"
    >
      <!-- Number + suffix inline -->
      <div class="flex items-baseline gap-0.5 leading-none">
        <span
          class="stat-counter text-4xl font-black text-accent"
          :data-target="stat.target"
          :data-decimals="stat.decimals"
        >0</span>
        <span class="text-3xl font-black text-accent">{{ stat.suffix }}</span>
      </div>

      <!-- Label -->
      <p
        class="text-xs font-semibold leading-tight"
        :class="dark ? 'text-white/55' : 'text-primary/60'"
      >
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
  dark?: boolean;
}>();

function abbreviate(value: number) {
  if (value >= 1_000_000) {
    const v = value / 1_000_000;
    return { target: v, suffix: "M+", decimals: v % 1 === 0 ? 0 : 1 };
  }
  if (value >= 10_000) {
    const v = value / 1_000;
    return { target: v, suffix: "K+", decimals: 0 };
  }
  return { target: value, suffix: "+", decimals: 0 };
}

const enriched = computed(() =>
  props.stats.map((s) => ({ ...s, ...abbreviate(s.value) }))
);

const container = ref<HTMLElement | null>(null);
let observer: IntersectionObserver | null = null;

onMounted(() => {
  if (!container.value) return;

  observer = new IntersectionObserver(
    (entries) => {
      if (!entries[0].isIntersecting) return;
      observer?.disconnect();

      const counters = container.value!.querySelectorAll<HTMLElement>(".stat-counter");
      counters.forEach((el, i) => {
        const target   = parseFloat(el.dataset.target   ?? "0");
        const decimals = parseInt(el.dataset.decimals   ?? "0", 10);
        const obj = { v: 0 };

        gsap.to(obj, {
          v: target,
          duration: 2.5,
          ease: "expo.out",
          delay: i * 0.1,
          onUpdate() {
            el.textContent = decimals > 0
              ? obj.v.toFixed(decimals)
              : String(Math.floor(obj.v));
          },
          onComplete() {
            el.textContent = decimals > 0
              ? target.toFixed(decimals)
              : String(target);
          },
        });
      });
    },
    { threshold: 0.1 }
  );

  observer.observe(container.value);
});

onUnmounted(() => observer?.disconnect());
</script>
