import ar from "./ar.json";
import en from "./en.json";

export type Locale = "ar" | "en";

const strings = { ar, en } as const;

type DeepKey<T> = T extends object
  ? {
      [K in keyof T]: K extends string
        ? T[K] extends object
          ? `${K}` | `${K}.${DeepKey<T[K]>}`
          : `${K}`
        : never;
    }[keyof T]
  : never;

export const getStrings = (lang: Locale) => strings[lang];

export const localePath = (path: string, lang: Locale): string => {
  if (lang === "ar") return path;
  return `/${lang}${path === "/" ? "/" : path}`;
};

export const t = (lang: Locale, key: DeepKey<typeof strings.en>): string => {
  const parts = key.split(".");
  let current: any = strings[lang];
  for (const part of parts) {
    current = current?.[part];
  }
  return typeof current === "string" ? current : "";
};
