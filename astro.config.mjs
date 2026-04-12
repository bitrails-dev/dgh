import { defineConfig } from "astro/config";
import vue from "@astrojs/vue";
import tailwind from "@astrojs/tailwind";
import astroI18next from "astro-i18next";
import sitemap from "@astrojs/sitemap";

export default defineConfig({
  site: "https://dumyat-public-hospital.eg",
  output: "static",
  integrations: [
    sitemap({
      i18n: {
        defaultLocale: "ar",
        locales: {
          ar: "ar-EG",
          en: "en-US",
        },
      },
    }),
    vue(),   // no appEntrypoint — avoids virtual:astro:vue-app resolution issue
    tailwind({ applyBaseStyles: false }),
    astroI18next(),
  ],
});
