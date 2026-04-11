import { onMounted, onUnmounted, ref } from "vue";

export const useRTL = () => {
  const isRTL = ref(false);
  let observer: MutationObserver | null = null;

  const update = () => {
    if (typeof document === "undefined") return;
    isRTL.value = document.documentElement.dir === "rtl";
  };

  onMounted(() => {
    update();
    observer = new MutationObserver(update);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["dir"] });
  });

  onUnmounted(() => {
    observer?.disconnect();
  });

  return { isRTL };
};
