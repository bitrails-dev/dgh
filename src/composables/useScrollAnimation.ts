import { reactive } from "vue";

export const useScrollAnimation = () => {
  const variants = reactive({
    initial: { opacity: 0, y: 40 },
    enter: { opacity: 1, y: 0, transition: { duration: 0.7, ease: "easeOut" } },
  });

  return variants;
};
