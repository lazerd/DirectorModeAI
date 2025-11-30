import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: ["class"],
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        // Unified color system - Tennis court inspired
        primary: {
          DEFAULT: "hsl(210, 100%, 45%)",
          light: "hsl(210, 100%, 95%)",
          dark: "hsl(210, 100%, 35%)",
        },
        accent: {
          DEFAULT: "hsl(75, 80%, 55%)",
          light: "hsl(75, 80%, 90%)",
          dark: "hsl(75, 80%, 40%)",
        },
        success: {
          DEFAULT: "hsl(142, 76%, 45%)",
          light: "hsl(142, 76%, 95%)",
        },
        warning: {
          DEFAULT: "hsl(38, 92%, 50%)",
          light: "hsl(38, 92%, 95%)",
        },
        destructive: {
          DEFAULT: "hsl(0, 84%, 60%)",
          light: "hsl(0, 84%, 95%)",
        },
        // Tool-specific accent colors
        mixer: {
          DEFAULT: "hsl(25, 95%, 55%)",
          light: "hsl(25, 95%, 95%)",
        },
        lessons: {
          DEFAULT: "hsl(210, 100%, 45%)",
          light: "hsl(210, 100%, 95%)",
        },
        stringing: {
          DEFAULT: "hsl(280, 70%, 50%)",
          light: "hsl(280, 70%, 95%)",
        },
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "sans-serif"],
        display: ["Inter", "system-ui", "sans-serif"],
      },
      borderRadius: {
        DEFAULT: "0.75rem",
      },
    },
  },
  plugins: [],
};

export default config;
