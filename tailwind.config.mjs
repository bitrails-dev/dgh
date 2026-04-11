import plugin from "tailwindcss/plugin";

const rtl = plugin(({ addVariant }) => {
  addVariant("rtl", ["&[dir=\"rtl\"] &", "[dir=\"rtl\"] &"]);
});

/** @type {import('tailwindcss').Config} */
export default {
  content: ["./src/**/*.{astro,html,js,jsx,ts,tsx,vue,md,mdx}"],
  theme: {
    container: {
      center: true,
      padding: {
        DEFAULT: "1.25rem",
        lg: "2rem",
        xl: "3rem",
      },
    },
    extend: {
      colors: {
        primary: "#1B3F6E",
        secondary: "#2A7D5F",
        accent: "#D4A843",
        background: "#F8F9FC",
        surface: "#FFFFFF",
        text: "#1A1A2E",
        muted: "#6B7280",
      },
      fontFamily: {
        sans: ["Inter", "sans-serif"],
        cairo: ["Cairo", "sans-serif"],
        display: ["Cairo", "Inter", "sans-serif"],
      },
      fontSize: {
        display: ["clamp(40px, 6vw, 72px)", { lineHeight: "1.05" }],
        section: ["clamp(28px, 4vw, 44px)", { lineHeight: "1.2" }],
        body: ["clamp(15px, 2vw, 18px)", { lineHeight: "1.75" }],
        label: ["13px", { lineHeight: "1.2", letterSpacing: "0.08em" }],
      },
      boxShadow: {
        soft: "0 10px 30px rgba(27, 63, 110, 0.12)",
        layered: "0 6px 20px rgba(27, 63, 110, 0.12), 0 2px 6px rgba(27, 63, 110, 0.08)",
        deep: "0 18px 40px rgba(27, 63, 110, 0.22)",
      },
      backgroundImage: {
        "diagonal-stripes":
          "repeating-linear-gradient(135deg, rgba(255,255,255,0.06) 0, rgba(255,255,255,0.06) 8px, rgba(255,255,255,0) 8px, rgba(255,255,255,0) 16px)",
      },
    },
  },
  plugins: [rtl],
};
