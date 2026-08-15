import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

/** The four numbers the Testing Strategy means by "Coverage: 100%, enforced." */
const FULLY_COVERED = {
  statements: 100,
  branches: 100,
  functions: 100,
  lines: 100,
};

export default defineConfig({
  plugins: [react()],
  // Resolves the "@/*" alias from tsconfig.json. Native since Vite 7 — this
  // replaces the vite-tsconfig-paths plugin.
  resolve: { tsconfigPaths: true },
  test: {
    environment: "jsdom",
    setupFiles: ["./vitest.setup.ts"],
    // The suite runs in a zone that is neither UTC nor anyone's laptop.
    //
    // Every date bug this project is most exposed to — `new Date("2026-03-29")
    // .getDay()`, `toISOString().slice(0, 10)` — is invisible when the process
    // runs UTC, which is exactly what Vercel's functions and most CI runners
    // do. Pinning a zone behind UTC means those read back the WRONG day here
    // and the test fails, rather than passing everywhere except in production.
    //
    // New York rather than somewhere more exotic because its DST transitions
    // fall on different dates from Europe/London's, which is the zone the
    // resolver fixtures configure: nothing in src/lib/date.test.ts or
    // resolve-plan.test.ts can pass by coinciding with the ambient zone.
    env: { TZ: "America/New_York" },
    include: ["src/**/*.{test,spec}.{ts,tsx}", "tests/unit/**/*.{test,spec}.{ts,tsx}"],
    // tests/e2e and tests/visual are Playwright's (see docs/TESTING_STRATEGY.md § 2.1)
    // and must not be picked up by Vitest.
    exclude: ["node_modules/**", ".next/**", "tests/e2e/**", "tests/visual/**"],
    // Testing Strategy §§ 1.1 and 1.4: "Coverage: 100%, enforced." The gate is
    // scoped to the resolvers and the data-access layer rather than applied
    // repo-wide, so it stays a real guarantee about the logic that is genuinely
    // hard to eyeball instead of a number to be gamed elsewhere. The strategy
    // makes the same argument under "Why not a coverage percentage".
    //
    // It lives HERE, in the hermetic suite, deliberately. The integration suite
    // skips itself without DATABASE_URL_TEST, so a gate that lived there would
    // report success on any machine without a database while having measured
    // nothing — a false green on exactly the promise the PRD makes to strangers
    // on a public URL. scope.ts imports nothing `server-only` precisely so this
    // is possible.
    //
    // NOTE: no GitHub Actions workflow runs `npm run test:coverage` yet — Vercel
    // only builds. Until one exists this gate is enforced by whoever runs it.
    coverage: {
      provider: "v8",
      include: [
        "src/lib/db/scope.ts",
        "src/lib/date.ts",
        "src/lib/resolve-plan.ts",
        "src/lib/rotation.ts",
      ],
      thresholds: {
        "src/lib/db/scope.ts": FULLY_COVERED,
        // § 1.1. date.ts is here because it is where resolve-plan.ts keeps its
        // date arithmetic — a gate on the resolver that let its own calendar
        // maths go unmeasured would cover the easy half of the risk the PRD
        // actually names.
        "src/lib/date.ts": FULLY_COVERED,
        "src/lib/resolve-plan.ts": FULLY_COVERED,
        // § 1.2. The strategy singles out its case 4 — a skipped session must
        // resolve identically — and the guarantee behind it is that rotation.ts
        // never reads workout_logs. An unmeasured branch here is precisely where
        // a shortcut that consults history would sit unnoticed.
        "src/lib/rotation.ts": FULLY_COVERED,
      },
    },
  },
});
