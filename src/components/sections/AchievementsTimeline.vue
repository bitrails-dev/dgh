<template>
  <div ref="root" class="relative">
    <div class="flex gap-6 overflow-x-auto pb-6 snap-x snap-mandatory">
      <div
        v-for="(item, index) in items"
        :key="item.year"
        class="min-w-[260px] snap-start rounded-2xl bg-white p-5 shadow-soft"
        :ref="setCardRef"
      >
        <span class="inline-flex items-center rounded-full bg-accent/15 px-3 py-1 text-xs font-semibold text-accent">
          {{ item.year }}
        </span>
        <h3 class="mt-3 text-lg font-semibold text-text">{{ item.title }}</h3>
        <p class="mt-2 text-sm text-muted">{{ item.description }}</p>
        <svg class="mt-4 h-6 w-full" viewBox="0 0 200 24" aria-hidden="true">
          <path
            :ref="setPathRef"
            d="M2 12 H198"
            stroke="#D4A843"
            stroke-width="2"
            fill="none"
            stroke-linecap="round"
          />
        </svg>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted, ref } from "vue";
import { useMotion } from "@vueuse/motion";
import gsap from "gsap";
import ScrollTrigger from "gsap/ScrollTrigger";

const props = defineProps<{
  items: { year: number; title: string; description: string }[];
}>();

const root = ref<HTMLElement | null>(null);
const cardRefs = ref<HTMLElement[]>([]);
const pathRefs = ref<SVGPathElement[]>([]);
const cleanup: Array<() => void> = [];

const setCardRef = (el: HTMLElement | null) => {
  if (el && !cardRefs.value.includes(el)) cardRefs.value.push(el);
};

const setPathRef = (el: SVGPathElement | null) => {
  if (el && !pathRefs.value.includes(el)) pathRefs.value.push(el);
};

onMounted(() => {
  if (root.value) {
    useMotion(root, {
      initial: { opacity: 0, y: 40 },
      enter: { opacity: 1, y: 0, transition: { duration: 0.7, ease: "easeOut" } },
    });
  }

  gsap.registerPlugin(ScrollTrigger);

  pathRefs.value.forEach((path) => {
    const length = path.getTotalLength();
    gsap.set(path, { strokeDasharray: length, strokeDashoffset: length });
    gsap.to(path, {
      strokeDashoffset: 0,
      duration: 1.6,
      ease: "power2.out",
      scrollTrigger: {
        trigger: path,
        start: "top 85%",
        once: true,
      },
    });
  });

  cardRefs.value.forEach((card) => {
    const onEnter = () => {
      gsap.to(card, { boxShadow: "0 0 20px rgba(212, 168, 67, 0.45)", duration: 0.3 });
    };
    const onLeave = () => {
      gsap.to(card, { boxShadow: "0 10px 30px rgba(27, 63, 110, 0.12)", duration: 0.3 });
    };
    card.addEventListener("mouseenter", onEnter);
    card.addEventListener("mouseleave", onLeave);
    cleanup.push(() => {
      card.removeEventListener("mouseenter", onEnter);
      card.removeEventListener("mouseleave", onLeave);
    });
  });
});

onUnmounted(() => {
  cleanup.forEach((fn) => fn());
});
</script>
