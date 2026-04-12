import { reactive } from "vue";

export type Locale = "ar" | "en";

// Module-level singleton — shared across all islands in the same page
const state = reactive({ current: "ar" as Locale });

function applyLocale(locale: Locale) {
  if (typeof document === "undefined") return;
  const html = document.documentElement;
  html.lang = locale;
  html.dir = locale === "ar" ? "rtl" : "ltr";
  html.classList.toggle("font-cairo", locale === "ar");
  html.classList.toggle("font-sans", locale === "en");
}

// Drop-in replacement for the old Pinia store — same property/method names
export function useLocaleStore() {
  return {
    get current() { return state.current; },
    init() {
      if (typeof window === "undefined") return;
      const stored = window.localStorage.getItem("locale") as Locale | null;
      state.current = stored ?? "ar";
      applyLocale(state.current);
    },
    setLocale(locale: Locale) {
      state.current = locale;
      if (typeof window !== "undefined") {
        window.localStorage.setItem("locale", locale);
      }
      applyLocale(locale);
    },
  };
}
