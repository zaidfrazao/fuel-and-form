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
        "src/lib/auth/token.ts",
        "src/lib/auth/compare.ts",
        "src/lib/auth/cookies.ts",
        "src/lib/cursor.ts",
        "src/lib/date.ts",
        "src/lib/day-summary.ts",
        "src/lib/log-intent.ts",
        "src/lib/macros.ts",
        "src/lib/resolve-plan.ts",
        "src/lib/resolve-now.ts",
        "src/lib/rotation.ts",
      ],
      thresholds: {
        "src/lib/db/scope.ts": FULLY_COVERED,
        // § 1.4 case 5, request-boundary half. scope.ts proves a forged
        // identity reaches no data; this is what stops one being minted in the
        // first place. Every branch in it is a rejection, so an unmeasured one
        // is a way past the gate that nothing looked at. Coverable here at all
        // only because token.ts takes its secret and clock as arguments.
        "src/lib/auth/token.ts": FULLY_COVERED,
        // Guards both the cookie signature and the owner's password. Small
        // enough that 100% is unremarkable, and load-bearing enough that an
        // unmeasured line in it is a timing leak nobody looked at.
        "src/lib/auth/compare.ts": FULLY_COVERED,
        // The cookie flags the PRD names in § Security & Compliance. Separated
        // from session.ts so they can be asserted at all: a flag that is only
        // ever exercised by a running browser is one no test can hold still,
        // and losing `httpOnly` looks identical until someone reads the cookie.
        "src/lib/auth/cookies.ts": FULLY_COVERED,
        // FUEL-19, and the untrusted-input half of it. Every branch in
        // `parseCursor` is reachable by anyone who can edit a cookie in their
        // own browser, and the one that matters most is the one that must NOT
        // throw: `/` is the screen the app exists for, and a malformed cookie
        // turning it into a 500 would be a self-inflicted denial of the only
        // view that has to render. The flags are here for the same reason
        // auth/cookies.ts is — a property only a real browser exercises is one
        // no test can hold still.
        "src/lib/cursor.ts": FULLY_COVERED,
        // § 1.1. date.ts is here because it is where resolve-plan.ts keeps its
        // date arithmetic — a gate on the resolver that let its own calendar
        // maths go unmeasured would cover the easy half of the risk the PRD
        // actually names.
        "src/lib/date.ts": FULLY_COVERED,
        "src/lib/resolve-plan.ts": FULLY_COVERED,
        // P1's acceptance criteria, and the resolver they all pass through. It
        // belongs here for the same reason resolve-plan.ts does, one step further
        // on: every branch in it decides which single card the app puts in front
        // of someone, and every wrong answer it can give is a plausible one — a
        // window off by a minute, a skip that eats two items, a day boundary read
        // in the server's zone. None of them throw, so an unmeasured branch here
        // is a screen that is confidently wrong with nothing to notice it.
        "src/lib/resolve-now.ts": FULLY_COVERED,
        // FUEL-19's decision layer: which row a tap becomes, whether one like
        // it already exists, and which one undo takes back. Every way it can be
        // wrong is silent and plausible — a skip filed as 'eaten', a double-tap
        // doubling a day's protein, an undo removing the wrong log — and none
        // of them surface on the screen that caused them. The gate is here
        // because the writes it decides are the only ones P1 makes.
        "src/lib/log-intent.ts": FULLY_COVERED,
        // FUEL-20's arithmetic and its join. Every way it can be wrong is a
        // plausible-looking wrong number on a screen the user is asked to
        // trust — a skipped meal counted, a swapped meal counted twice, a log
        // ordered so that undo appears to take back a different line from the
        // one it will. None of them throw, and the summary is the last thing
        // the day says.
        "src/lib/day-summary.ts": FULLY_COVERED,
        // § 1.3. The totals are what P4 puts in front of a swap, so an
        // unmeasured branch here is a number the user is asked to trust that
        // nothing checked. The rounding and the untracked skip are both single
        // branches whose failure mode is a plausible-looking wrong figure
        // rather than a crash — precisely what a coverage gate is for.
        "src/lib/macros.ts": FULLY_COVERED,
        // § 1.2. The strategy singles out its case 4 — a skipped session must
        // resolve identically — and the guarantee behind it is that rotation.ts
        // never reads workout_logs. An unmeasured branch here is precisely where
        // a shortcut that consults history would sit unnoticed.
        "src/lib/rotation.ts": FULLY_COVERED,
      },
    },
  },
});
