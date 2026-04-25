<template>
  <section id="testimonials" class="bg-ivory-100" style="padding: 96px 0;">
    <div ref="root" class="container mx-auto">

      <!-- Section header: split grid -->
      <div class="section-header" style="display:grid; grid-template-columns: 1fr 1.6fr; gap:32px; margin-bottom:56px;">
        <div>
          <div class="inline-flex items-center gap-2.5 mb-4">
            <div class="w-8 h-px bg-teal-600"></div>
            <p class="h-eyebrow">{{ isAr ? 'آراء المرضى' : 'Patient Voices' }}</p>
          </div>
          <h2 class="font-display-ar font-medium text-navy-900 leading-none tracking-tight" style="font-size: clamp(36px, 4vw, 56px); line-height: 1.1;">
            {{ strings.testimonials.title }}
          </h2>
        </div>
        <div class="flex items-end">
          <p class="text-body-lg text-ink-500 leading-relaxed">{{ strings.testimonials.subtitle }}</p>
        </div>
      </div>

      <!-- Testimonial cards -->
      <div v-if="items.length" class="overflow-hidden" @mouseenter="pause" @mouseleave="resume" ref="swipeEl">
        <Transition name="fade" mode="out-in">
          <div :key="activeIndex" class="testimonial-grid" style="display:grid; grid-template-columns: 1fr 1.8fr; gap:48px; align-items:center;">
            <!-- Photo placeholder -->
            <div class="relative aspect-[4/5] rounded-sm overflow-hidden">
              <div class="absolute inset-0 bg-gradient-to-br from-teal-900 via-teal-700 to-teal-600">
                <div class="absolute inset-0" style="background-image: repeating-linear-gradient(135deg, rgba(255,255,255,0.04) 0, rgba(255,255,255,0.04) 2px, transparent 2px, transparent 14px)"></div>
              </div>
              <div class="absolute bottom-4 start-4 font-mono text-white/40 text-[10px] tracking-wide">[ PATIENT_PHOTO ]</div>
            </div>

            <!-- Quote side -->
            <div>
              <div class="mb-8">
                <svg class="h-12 w-12 text-teal-700/20 mb-4" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                  <path d="M14.017 21v-7.391c0-5.704 3.731-9.57 8.983-10.609l.995 2.151c-2.432.917-3.995 3.638-3.995 5.849h4v10h-9.983zm-14.017 0v-7.391c0-5.704 3.748-9.57 9-10.609l.996 2.151c-2.433.917-3.996 3.638-3.996 5.849h3.983v10h-9.983z"/>
                </svg>
                <p class="font-display-ar text-navy-900 leading-snug" style="font-size: clamp(28px, 3vw, 42px); line-height: 1.25; font-style: italic;">
                  "{{ items[activeIndex].quote }}"
                </p>
              </div>
              <!-- Attribution -->
              <div class="flex items-center gap-4">
                <div>
                  <p class="font-display-ar text-lg font-medium text-navy-900">{{ items[activeIndex].name }}</p>
                  <p class="font-mono text-xs text-ink-400 mt-1">{{ items[activeIndex].caseType }}</p>
                </div>
              </div>
            </div>
          </div>
        </Transition>
      </div>

      <!-- Dots navigation -->
      <div v-if="items.length > 1" class="flex items-center gap-2 mt-8">
        <button
          v-for="(dot, index) in items"
          :key="index"
          class="h-2.5 w-2.5 rounded-full transition-colors duration-200"
          :class="index === activeIndex ? 'bg-teal-700' : 'bg-ink-300'"
          @click="setIndex(index)"
          :aria-label="`Testimonial ${index + 1}`"
        ></button>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted, ref, computed } from "vue";
import { useMotion } from "@vueuse/motion";
import { useSwipe } from "@vueuse/core";

const props = withDefaults(
  defineProps<{ strings: any; items: { quote: string; name: string; caseType: string; avatar: string }[]; lang?: string }>(),
  { items: () => [], lang: "ar" }
);

const isAr = computed(() => props.lang === "ar");
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
@media (max-width: 900px) {
  .testimonial-grid {
    grid-template-columns: 1fr !important;
    gap: 32px !important;
  }
  .testimonial-grid > div:first-child {
    max-height: 280px;
    max-width: 280px;
    margin-inline: auto;
    width: 100%;
  }
  .section-header {
    grid-template-columns: 1fr !important;
    gap: 16px !important;
  }
}
</style>
