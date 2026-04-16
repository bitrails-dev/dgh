<template>
  <div v-if="images.length > 0">
    <!-- Gallery grid -->
    <div class="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
      <button
        v-for="(image, index) in images"
        :key="index"
        class="group relative overflow-hidden rounded-lg aspect-square cursor-pointer"
        @click="openLightbox(index)"
        :aria-label="image.alt"
      >
        <img
          :src="image.url"
          :alt="image.alt"
          class="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
          loading="lazy"
        />
        <div class="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors duration-300" />
      </button>
    </div>

    <!-- Lightbox overlay -->
    <Teleport to="body" v-if="isLightboxOpen">
      <div
        class="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm"
        role="dialog"
        aria-modal="true"
        :aria-label="currentImage.alt"
        @click.self="closeLightbox"
        @keydown.escape="closeLightbox"
      >
        <!-- Close button -->
        <button
          ref="closeBtn"
          class="absolute top-4 end-4 z-50 rounded-lg bg-white/10 p-2 text-white hover:bg-white/20 transition-colors"
          :aria-label="`Close ${currentImage.alt}`"
          @click="closeLightbox"
        >
          <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>

        <!-- Main image -->
        <div class="mx-auto w-full max-w-4xl px-4">
          <figure>
            <img
              :src="currentImage.url"
              :alt="currentImage.alt"
              class="h-auto w-full rounded-lg"
            />
            <figcaption v-if="currentCaption" class="mt-3 text-center text-sm text-white/70">
              {{ currentCaption }}
            </figcaption>
          </figure>
        </div>

        <!-- Navigation buttons -->
        <button
          class="absolute start-4 top-1/2 -translate-y-1/2 rounded-lg bg-white/10 p-2 text-white hover:bg-white/20 transition-colors"
          :aria-label="lang === 'ar' ? 'الصورة التالية' : 'Previous image'"
          @click="previousImage"
        >
          <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6 rtl:rotate-180" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>

        <button
          class="absolute end-4 top-1/2 -translate-y-1/2 rounded-lg bg-white/10 p-2 text-white hover:bg-white/20 transition-colors"
          :aria-label="lang === 'ar' ? 'الصورة السابقة' : 'Next image'"
          @click="nextImage"
        >
          <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6 rtl:rotate-180" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </button>

        <!-- Counter -->
        <div class="absolute bottom-4 start-1/2 -translate-x-1/2 rounded-lg bg-black/50 px-3 py-1 text-xs text-white">
          {{ currentIndex + 1 }} / {{ images.length }}
        </div>
      </div>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';

interface Image {
  url: string;
  caption?: string;
  captionAr?: string;
  alt: string;
}

interface Props {
  images: Image[];
  lang: 'ar' | 'en';
}

const props = defineProps<Props>();

const isLightboxOpen = ref(false);
const currentIndex = ref(0);
const closeBtn = ref<HTMLButtonElement | null>(null);

const currentImage = computed(() => props.images[currentIndex.value]);
const currentCaption = computed(() => {
  if (props.lang === 'ar') {
    return currentImage.value?.captionAr ?? currentImage.value?.caption;
  }
  return currentImage.value?.caption;
});

const openLightbox = (index: number) => {
  currentIndex.value = index;
  isLightboxOpen.value = true;
  document.documentElement.style.overflow = 'hidden';
  // Focus trap: focus close button
  setTimeout(() => closeBtn.value?.focus(), 0);
};

const closeLightbox = () => {
  isLightboxOpen.value = false;
  document.documentElement.style.overflow = '';
};

const nextImage = () => {
  currentIndex.value = (currentIndex.value + 1) % props.images.length;
};

const previousImage = () => {
  currentIndex.value = (currentIndex.value - 1 + props.images.length) % props.images.length;
};

// Keyboard navigation
const handleKeydown = (e: KeyboardEvent) => {
  if (!isLightboxOpen.value) return;
  if (e.key === 'ArrowRight') nextImage();
  if (e.key === 'ArrowLeft') previousImage();
};

onMounted(() => {
  window.addEventListener('keydown', handleKeydown);
});

onUnmounted(() => {
  window.removeEventListener('keydown', handleKeydown);
});

import { onMounted, onUnmounted } from 'vue';
</script>
