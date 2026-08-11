import type { Config } from "tailwindcss";

export default {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        ink: "#17211d",
        paper: "#f6f3eb",
        moss: "#3f6654",
        coral: "#df6d5f",
      },
      boxShadow: {
        card: "0 20px 60px rgba(23, 33, 29, 0.10)",
      },
    },
  },
  plugins: [],
} satisfies Config;
