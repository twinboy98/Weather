import type { Config } from "tailwindcss";

export default {
  darkMode: "class",
  content: ["./app/**/*.{js,ts,jsx,tsx}", "./components/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#10263f",
        sky: "#4b96e6",
        rain: "#2563eb",
        mist: "#eef5fb"
      },
      boxShadow: {
        card: "0 14px 36px rgba(24, 58, 94, 0.10)"
      }
    }
  },
  plugins: []
} satisfies Config;

