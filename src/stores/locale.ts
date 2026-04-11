import { defineStore } from "pinia";

export type Locale = "ar" | "en";

const applyLocale = (locale: Locale) => {
  if (typeof document === "undefined") return;
  const html = document.documentElement;
  html.lang = locale;
  html.dir = locale === "ar" ? "rtl" : "ltr";
  html.classList.toggle("font-cairo", locale === "ar");
  html.classList.toggle("font-sans", locale === "en");
};

export const useLocaleStore = defineStore("locale", {
  state: () => ({
    current: "ar" as Locale,
  }),
  actions: {
    init() {
      if (typeof window === "undefined") return;
      const stored = window.localStorage.getItem("locale") as Locale | null;
      this.current = stored ?? "ar";
      applyLocale(this.current);
    },
    setLocale(locale: Locale) {
      this.current = locale;
      if (typeof window !== "undefined") {
        window.localStorage.setItem("locale", locale);
      }
      applyLocale(locale);
    },
  },
});
