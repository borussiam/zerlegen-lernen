import type { Config } from "tailwindcss";

export default {
  darkMode: ["class", '[data-theme="dark"]'],
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        ink: "rgb(var(--color-ink) / <alpha-value>)",
        paper: "rgb(var(--color-paper) / <alpha-value>)",
        moss: "rgb(var(--color-moss) / <alpha-value>)",
        coral: "rgb(var(--color-coral) / <alpha-value>)",
      },
      boxShadow: {
        card: "8px 8px 0 rgb(var(--color-ink) / 0.18)",
      },
    },
  },
  plugins: [],
} satisfies Config;
