import { onMounted, ref } from "vue";
import gsap from "gsap";

export const useCounter = (target: number, duration = 2) => {
  const value = ref(0);

  onMounted(() => {
    gsap.to(value, {
      value: target,
      duration,
      ease: "power2.out",
      roundProps: "value",
    });
  });

  return value;
};
