import { defineConfig } from "vitest/config";

// Integration tests run against a REAL Postgres (the Neon "test" branch) and
// are deliberately separate from `npm run test`:
//   - no jsdom, no React plugin — nothing here renders
//   - the default suite stays hermetic, so CI needs no database secret
//
// Testing Strategy § 1.4 (demo isolation) lands here in FUEL-7.
export default defineConfig({
  resolve: {
    tsconfigPaths: true,
    // src/lib/db imports "server-only", which throws unless resolved under the
    // react-server condition (it maps to an empty module there). Without this,
    // the data-access layer cannot be imported by a test at all.
    conditions: ["react-server"],
  },
  ssr: { resolve: { conditions: ["react-server"] } },
  test: {
    environment: "node",
    setupFiles: ["./tests/integration/setup.ts"],
    include: ["tests/integration/**/*.{test,spec}.ts"],
    // Neon's compute auto-suspends when idle; the first query after a cold
    // start is slow enough to trip Vitest's 5s default.
    testTimeout: 20_000,
    hookTimeout: 20_000,
  },
});
