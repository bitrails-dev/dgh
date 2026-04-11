<template>
  <div ref="root" class="rounded-2xl bg-secondary text-white shadow-layered">
    <div class="grid gap-6 p-8 sm:grid-cols-2 lg:grid-cols-5">
      <div v-for="(item, index) in stats" :key="item.label" class="text-center">
        <p ref="setCountRef" class="text-3xl font-bold text-accent">0</p>
        <p class="mt-2 text-xs uppercase tracking-[0.08em] text-white/70">{{ item.label }}</p>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from "vue";
import { useMotion } from "@vueuse/motion";
import gsap from "gsap";
import ScrollTrigger from "gsap/ScrollTrigger";

const props = defineProps<{ stats: { label: string; value: number }[] }>();
const root = ref<HTMLElement | null>(null);
const countRefs = ref<HTMLElement[]>([]);

const setCountRef = (el: HTMLElement | null) => {
  if (el && !countRefs.value.includes(el)) countRefs.value.push(el);
};

onMounted(() => {
  if (root.value) {
    useMotion(root, {
      initial: { opacity: 0, y: 40 },
      enter: { opacity: 1, y: 0, transition: { duration: 0.7, ease: "easeOut" } },
    });
  }

  gsap.registerPlugin(ScrollTrigger);
  countRefs.value.forEach((el, index) => {
    const target = { value: 0 };
    const endValue = props.stats[index]?.value ?? 0;
    gsap.to(target, {
      value: endValue,
      duration: 2.2,
      ease: "power2.out",
      scrollTrigger: {
        trigger: el,
        start: "top 85%",
        once: true,
      },
      onUpdate: () => {
        el.textContent = Math.floor(target.value).toLocaleString();
      },
    });
  });
});
</script>
