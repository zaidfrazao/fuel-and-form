import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  // Resolves the "@/*" alias from tsconfig.json. Native since Vite 7 — this
  // replaces the vite-tsconfig-paths plugin.
  resolve: { tsconfigPaths: true },
  test: {
    environment: "jsdom",
    setupFiles: ["./vitest.setup.ts"],
    include: ["src/**/*.{test,spec}.{ts,tsx}", "tests/unit/**/*.{test,spec}.{ts,tsx}"],
    // tests/e2e and tests/visual are Playwright's (see docs/TESTING_STRATEGY.md § 2.1)
    // and must not be picked up by Vitest.
    exclude: ["node_modules/**", ".next/**", "tests/e2e/**", "tests/visual/**"],
    // Testing Strategy § 1.4: "Coverage: 100%, enforced." The gate is scoped to
    // the data-access layer rather than applied repo-wide, so it stays a real
    // guarantee about the isolation boundary instead of a number to be gamed
    // elsewhere.
    //
    // It runs HERE, in the hermetic suite, deliberately. The integration suite
    // skips itself without DATABASE_URL_TEST, so a gate that lived there would
    // report success in CI having measured nothing — a false green on exactly
    // the promise the PRD makes to strangers on a public URL. scope.ts imports
    // nothing `server-only` precisely so this is possible.
    coverage: {
      provider: "v8",
      include: ["src/lib/db/scope.ts"],
      thresholds: {
        "src/lib/db/scope.ts": {
          statements: 100,
          branches: 100,
          functions: 100,
          lines: 100,
        },
      },
    },
  },
});
