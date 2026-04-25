import plugin from "tailwindcss/plugin";

const rtl = plugin(({ addVariant }) => {
  addVariant("rtl", ["&[dir=\"rtl\"] &", "[dir=\"rtl\"] &"]);
});

/** @type {import('tailwindcss').Config} */
export default {
  content: ["./src/**/*.{astro,html,js,jsx,ts,tsx,vue,md,mdx}"],
  theme: {
    screens: {
      sm: '640px',
      md: '768px',
      lg: '1024px',
      xl: '1280px',
      '2xl': '1440px',
    },
    container: {
      center: true,
      padding: {
        DEFAULT: "1.25rem",
        lg: "2rem",
        xl: "2rem",
      },
    },
    extend: {
      colors: {
        // Teal scale (primary)
        'teal': {
          50: '#eef6f4',
          100: '#dcedeb',
          200: '#b8dedb',
          400: '#6ec1ba',
          500: '#3aa79e',
          600: '#2a8f87',
          700: '#1d6a66',
          800: '#15504f',
          900: '#0f3b3d',
        },
        // Navy scale
        'navy': {
          200: '#b5c2d6',
          500: '#375a8a',
          700: '#1a3a66',
          800: '#112a4d',
          900: '#0a1f3a',
        },
        // Ivory scale (warm ground)
        'ivory': {
          50: '#fbf8f2',
          100: '#f5efe3',
          200: '#ece3cf',
          300: '#d9cdb2',
        },
        // Ink scale (text)
        'ink': {
          50: '#f7f8fa',
          100: '#eef1f5',
          200: '#d9dfe6',
          300: '#b8c2cd',
          400: '#8897a8',
          500: '#5a6b7d',
          700: '#324152',
          900: '#0c1824',
        },
        // Accents
        'coral': '#c85248',
        'gold': '#b88b3a',
        'sage': '#7a9a6e',
      },
      fontFamily: {
        'display-ar': ["'Reem Kufi'", "'Noto Kufi Arabic'", "serif"],
        'body-ar': ["'IBM Plex Sans Arabic'", "'Segoe UI'", "sans-serif"],
        'display-en': ["'Fraunces'", "'Georgia'", "serif"],
        'body-en': ["'Inter'", "-apple-system", "sans-serif"],
        'mono': ["'JetBrains Mono'", "ui-monospace", "monospace"],
        'sans': ["'IBM Plex Sans Arabic'", "'Segoe UI'", "sans-serif"],
        'display': ["'Reem Kufi'", "'Fraunces'", "serif"],
      },
      fontSize: {
        'display': ["clamp(44px, 5.2vw, 82px)", { lineHeight: "1.04" }],
        'section': ["clamp(36px, 4vw, 56px)", { lineHeight: "1.1" }],
        'body-lg': ["19px", { lineHeight: "1.7" }],
        'body': ["16px", { lineHeight: "1.65" }],
        'label': ["13px", { lineHeight: "1.2", letterSpacing: "0.14em" }],
      },
      borderRadius: {
        'sm': '4px',
        'DEFAULT': '8px',
        'lg': '14px',
        'xl': '24px',
      },
      boxShadow: {
        'soft': '0 1px 2px rgba(15, 59, 61, 0.04), 0 1px 3px rgba(15, 59, 61, 0.06)',
        'DEFAULT': '0 4px 12px rgba(15, 59, 61, 0.06), 0 1px 3px rgba(15, 59, 61, 0.04)',
        'layered': '0 6px 20px rgba(15, 59, 61, 0.06), 0 2px 6px rgba(15, 59, 61, 0.04)',
        'deep': '0 20px 48px rgba(15, 59, 61, 0.10), 0 4px 12px rgba(15, 59, 61, 0.06)',
      },
      backgroundImage: {
        "diagonal-stripes":
          "repeating-linear-gradient(135deg, rgba(255,255,255,0.05) 0, rgba(255,255,255,0.05) 2px, transparent 2px, transparent 14px)",
      },
      spacing: {
        's-0': '4px',
        's-1': '8px',
        's-2': '12px',
        's-3': '16px',
        's-4': '24px',
        's-5': '32px',
        's-6': '48px',
        's-7': '64px',
        's-8': '96px',
        's-9': '128px',
      },
    },
  },
  plugins: [rtl],
};
