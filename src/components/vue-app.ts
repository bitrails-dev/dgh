import type { App } from "vue";
import { createPinia } from "pinia";
import { MotionPlugin } from "@vueuse/motion";

export default (app: App) => {
  app.use(createPinia());
  app.use(MotionPlugin);
};
