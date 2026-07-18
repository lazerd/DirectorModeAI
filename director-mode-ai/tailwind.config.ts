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
        // Core shadcn/ui semantic tokens — wired to the CSS variables defined
        // in globals.css. Without these mappings, utilities like bg-popover,
        // text-popover-foreground, bg-card, text-muted-foreground, border-input,
        // and *-foreground never generated (they silently no-op'd), which is why
        // overlays/menus and colored surfaces rendered with unreadable text.
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        // NOTE: `card`/`card-foreground` are intentionally NOT mapped. The
        // shadcn <Card> is used on half-migrated pages that mix explicit
        // bg-white cards with the dark theme; leaving bg-card/text-card-foreground
        // as no-ops preserves each Card's current (working) rendering and avoids
        // flipping white cards' text to near-white. The reported overlay bug is
        // fixed via the popover/accent/secondary tokens below, not via card.
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        // Unified color system - Tennis court inspired
        primary: {
          DEFAULT: "hsl(210, 100%, 45%)",
          light: "hsl(210, 100%, 95%)",
          dark: "hsl(210, 100%, 35%)",
          foreground: "hsl(var(--primary-foreground))",
        },
        accent: {
          DEFAULT: "hsl(75, 80%, 55%)",
          light: "hsl(75, 80%, 90%)",
          dark: "hsl(75, 80%, 40%)",
          foreground: "hsl(var(--accent-foreground))",
        },
        success: {
          DEFAULT: "hsl(142, 76%, 45%)",
          light: "hsl(142, 76%, 95%)",
          foreground: "hsl(var(--success-foreground))",
        },
        warning: {
          DEFAULT: "hsl(38, 92%, 50%)",
          light: "hsl(38, 92%, 95%)",
          foreground: "hsl(var(--warning-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(0, 84%, 60%)",
          light: "hsl(0, 84%, 95%)",
          foreground: "hsl(var(--destructive-foreground))",
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
        courtconnect: {
          DEFAULT: "hsl(152, 76%, 42%)",
          light: "hsl(152, 76%, 95%)",
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
