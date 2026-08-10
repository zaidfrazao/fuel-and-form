import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  // Resolves the "@/*" alias from tsconfig.json. Native since Vite 7 — this
  // replaces the vite-tsconfig-paths plugin.
  resolve: { tsconfigPaths: true },
  test: {
    environment: "jsdom",
    include: ["src/**/*.{test,spec}.{ts,tsx}", "tests/unit/**/*.{test,spec}.{ts,tsx}"],
    // tests/e2e and tests/visual are Playwright's (see docs/TESTING_STRATEGY.md § 2.1)
    // and must not be picked up by Vitest.
    exclude: ["node_modules/**", ".next/**", "tests/e2e/**", "tests/visual/**"],
  },
});
