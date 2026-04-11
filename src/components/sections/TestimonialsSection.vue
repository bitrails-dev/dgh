<template>
  <section id="testimonials" class="relative bg-[#F5F0E9] py-20">
    <div class="absolute inset-0 opacity-10">
      <svg viewBox="0 0 400 200" class="h-full w-full" aria-hidden="true">
        <path
          d="M40 120c30-40 60-60 120-60 40 0 70 15 90 40 10 15 30 30 60 40"
          fill="none"
          stroke="#1B3F6E"
          stroke-width="8"
          stroke-linecap="round"
        />
      </svg>
    </div>
    <div ref="root" class="container mx-auto relative">
      <h2 class="section-title">{{ strings.testimonials.title }}</h2>
      <p class="mt-4 max-w-2xl text-sm text-muted">{{ strings.testimonials.subtitle }}</p>

      <div
        v-if="items.length"
        class="mt-10 overflow-hidden"
        @mouseenter="pause"
        @mouseleave="resume"
        ref="swipeEl"
      >
        <Transition name="fade" mode="out-in">
          <div :key="activeIndex" class="rounded-2xl bg-white p-8 shadow-soft">
            <div class="flex flex-col gap-4 md:flex-row md:items-center">
              <img :src="items[activeIndex].avatar" class="h-20 w-20 rounded-full object-cover" />
              <div>
                <p class="text-lg italic text-text">“{{ items[activeIndex].quote }}”</p>
                <p class="mt-3 text-sm font-semibold text-primary">{{ items[activeIndex].name }}</p>
                <p class="text-xs text-muted">{{ items[activeIndex].caseType }}</p>
              </div>
            </div>
          </div>
        </Transition>
      </div>

      <div v-if="items.length" class="mt-6 flex items-center gap-2">
        <button
          v-for="(dot, index) in items"
          :key="index"
          class="h-2.5 w-2.5 rounded-full"
          :class="index === activeIndex ? 'bg-accent' : 'bg-accent/30'"
          @click="setIndex(index)"
        ></button>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted, ref, withDefaults } from "vue";
import { useMotion } from "@vueuse/motion";
import { useSwipe } from "@vueuse/core";

const props = withDefaults(
  defineProps<{ strings: any; items: { quote: string; name: string; caseType: string; avatar: string }[] }>(),
  { items: () => [] }
);

const activeIndex = ref(0);
const timer = ref<number | null>(null);
const root = ref<HTMLElement | null>(null);
const swipeEl = ref<HTMLElement | null>(null);

const setIndex = (index: number) => {
  activeIndex.value = index;
};

const next = () => {
  activeIndex.value = (activeIndex.value + 1) % props.items.length;
};

const pause = () => {
  if (timer.value) window.clearInterval(timer.value);
  timer.value = null;
};

const resume = () => {
  if (!timer.value) {
    timer.value = window.setInterval(next, 6000);
  }
};

useSwipe(swipeEl, {
  onSwipeEnd: (_, direction) => {
    if (direction === "left") next();
    if (direction === "right") {
      activeIndex.value = (activeIndex.value - 1 + props.items.length) % props.items.length;
    }
  },
});

onMounted(() => {
  if (root.value) {
    useMotion(root, {
      initial: { opacity: 0, y: 40 },
      enter: { opacity: 1, y: 0, transition: { duration: 0.7, ease: "easeOut" } },
    });
  }
  resume();
});

onUnmounted(() => {
  pause();
});
</script>

<style scoped>
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.35s ease;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
