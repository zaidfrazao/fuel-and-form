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
        "src/lib/adherence.ts",
        "src/lib/auth/token.ts",
        "src/lib/auth/compare.ts",
        "src/lib/auth/cookies.ts",
        "src/lib/csv.ts",
        "src/lib/cursor.ts",
        "src/lib/date.ts",
        "src/lib/day-summary.ts",
        "src/lib/export.ts",
        "src/lib/export-week.ts",
        "src/lib/log-intent.ts",
        "src/lib/macros.ts",
        "src/lib/repeat.ts",
        "src/lib/resolve-plan.ts",
        "src/lib/resolve-now.ts",
        "src/lib/resolve-training.ts",
        "src/lib/rotation.ts",
        "src/lib/session-entry.ts",
        "src/lib/slot-times.ts",
        "src/lib/template-plan.ts",
        "src/lib/walk.ts",
        "src/lib/weigh-in.ts",
        "src/lib/weight-chart.ts",
        "src/lib/weight-stats.ts",
        "src/lib/week-grid.ts",
        "src/lib/week-param.ts",
        "src/lib/week-totals.ts",
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
        // FUEL-24, and the same reasoning as cursor.ts and slot-times.ts: every
        // branch in it is a refusal reachable by anyone who can POST to the
        // repeat action. It is the first value in the app that MULTIPLIES the
        // rows a request writes rather than choosing which one — so an
        // unmeasured branch here is not a wrong answer on a screen, it is an
        // unbounded write nobody looked at. The one that must not throw matters
        // most: `Array.from({ length: Infinity })` would turn a refusal into a
        // 500 on a Server Action whose contract is that it never throws.
        "src/lib/repeat.ts": FULLY_COVERED,
        "src/lib/resolve-plan.ts": FULLY_COVERED,
        // FUEL-27. The dot grid is a claim about the user's own history, made
        // at a glance and with no figures beside it to check it against — so a
        // wrong dot is not a wrong number, it is a wrong account of what
        // someone did. Every branch here is one of those accounts: an unlogged
        // session that must not become a skip, a walk that must not answer for
        // the session it shares a day with, a log matched to the workout the
        // rotation actually landed on. None of them throw and none of them
        // look wrong on the screen.
        "src/lib/adherence.ts": FULLY_COVERED,
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
        // FUEL-26, and the layer rotation.ts hands its answer to. It is gated
        // for what it JOINS rather than for arithmetic it does not do: the
        // exercise list and the walk/session distinction are what P3 renders,
        // and both fail quietly. A list joined to the wrong workout is a
        // plausible session — Circuit A's name over Circuit B's movements — and
        // a walk mistaken for a session is a rest day that asks for a duration.
        // Neither throws, and the empty-exercise branch is shared by the walk,
        // which is ordinary, and by a caller that under-fetched, which is a bug.
        "src/lib/resolve-training.ts": FULLY_COVERED,
        // § 1.2. The strategy singles out its case 4 — a skipped session must
        // resolve identically — and the guarantee behind it is that rotation.ts
        // never reads workout_logs. An unmeasured branch here is precisely where
        // a shortcut that consults history would sit unnoticed.
        "src/lib/rotation.ts": FULLY_COVERED,
        // FUEL-21, and the same reasoning as cursor.ts: every branch in it is
        // reachable by anyone who can POST to the settings action, and the one
        // that matters is the one that must REFUSE. `slot_times` is free-shaped
        // jsonb with no CHECK, and `parseTimeOfDay` throws — so a malformed
        // time this failed to reject would not break settings, it would break
        // `/` on every subsequent request, until someone edited the row by hand.
        "src/lib/slot-times.ts": FULLY_COVERED,
        // FUEL-27, and the same argument as repeat.ts and template-plan.ts's
        // two guards: every branch is a refusal reachable by anyone who can
        // POST to the training action, and each one fails silently rather than
        // loudly. An unchecked status reaches Postgres as an invalid enum
        // value, which throws — a 500 from an endpoint whose contract is that
        // it never throws. An unchecked duration is simply STORED: -40, 0.5,
        // 1e9, each of them a figure the weekly export will later sum and
        // present as fact.
        "src/lib/session-entry.ts": FULLY_COVERED,
        // FUEL-25, and the same argument as cursor.ts, repeat.ts and
        // slot-times.ts: `isDayOfWeek` and `isMealSlot` are the template
        // endpoint's refusals, and every branch in them is reachable by anyone
        // who can POST to the app. What they guard is the widest write in the
        // app by blast radius — one row, and one row that decides every future
        // occurrence of a weekday. An unmeasured branch here is not a wrong
        // answer on a screen; it is a template row the resolver can never
        // reach, silently accepted, that the editor then cannot show and the
        // user cannot delete.
        //
        // The shaping half is gated for a quieter reason: it breaks a duplicate
        // the same way resolve-plan.ts does, and the day those two disagree is
        // the day the editor offers to change one row while the resolver serves
        // another.
        "src/lib/template-plan.ts": FULLY_COVERED,
        // FUEL-29. Small, and gated for what DEPENDS on it rather than for its
        // own difficulty: three callers ask it the same question — the row on
        // `/`, the undo stack in `actions/log.ts`, and the summary's line in
        // `day-summary.ts` — and every way it can be wrong is silent. A walk
        // left in the stack steps the card back past an item that is still
        // logged; one wrongly taken out of it leaves a real log with no control
        // anywhere that can take it back. Neither throws and neither looks
        // wrong on the screen that caused it.
        "src/lib/walk.ts": FULLY_COVERED,
        // FUEL-35, and gated on macros.ts's argument rather than on a refusal:
        // every way this can be wrong DRAWS something. A domain that stopped
        // including the target is a chart quietly missing a line nobody counts;
        // a reversed sort is a loss drawn as a gain, on the screen P5 calls
        // "the single number the whole program is judged on".
        //
        // Its three division-by-zero cases are the specific reason the number
        // is 100 rather than "covered". One reading, a history that never
        // moves, and a flat history sitting exactly on its target are all
        // ordinary data, and each puts NaN into a coordinate — which SVG
        // DISCARDS SILENTLY. There is no crash, no console error and no empty
        // state; there is a chart with nothing on it, on a screen where a
        // person cannot tell that apart from having logged nothing.
        // FUEL-37. This is the file that decides what LEAVES the account, and
        // every way it can be wrong produces a VALID FILE: a table missing, a
        // row that kept its `user_id`, an array in whatever order Postgres
        // returned. Each one downloads, opens, parses and looks exactly like a
        // backup — and is found out at a restore, which is the one moment there
        // is nothing to fall back on. P6 calls this the answer to "don't lose
        // my history", so an unmeasured branch here is a promise nobody checked.
        "src/lib/export.ts": FULLY_COVERED,
        // FUEL-38, and the same argument for the other file P6 hands out — one
        // week, for a reader who never logs in and has nothing to check it
        // against. A column that reports the plan where it promised what was
        // eaten still opens, still sums, and still looks like a week.
        //
        // `csv.ts` is here for a different reason, and a weaker gate would be
        // worse than none: escaping is four lines whose input space is not four
        // lines wide, so 100% is reached by a single field containing a comma
        // while a quote, a newline and a trailing space are all still wrong.
        // The number is a floor under a suite that has to choose its cases by
        // input class — see the head of `csv.test.ts`. A misquoted field does
        // not throw; it shifts one row by one column, days later, on someone
        // else's machine.
        "src/lib/export-week.ts": FULLY_COVERED,
        "src/lib/csv.ts": FULLY_COVERED,
        // FUEL-38. Small, and gated because of WHERE it sits: `?week=` is the
        // one input `/plan` and `/api/export/week` both take from a stranger,
        // and the whole contract is "never throws". A regression is not a wrong
        // week — it is a 500 on an edited URL, or a file whose seven days are
        // not the seven the link was clicked on.
        "src/lib/week-param.ts": FULLY_COVERED,
        "src/lib/weight-chart.ts": FULLY_COVERED,
        // FUEL-36, and the chart's argument taken one step further. The chart
        // DRAWS a claim about someone's own history; this file STATES one, and
        // it is the only place in the app that says whether the program is
        // working — `adherence.ts` refuses to grade at all, and the difference
        // is that P5 asks for the rate "against the configured goal pace",
        // which is a comparison and therefore a verdict.
        //
        // Both ways the verdict fails are silent. A band a hundredth too wide
        // colours a miss green; one a hundredth too narrow leaves a hit in
        // grey; a sign the wrong way round reports a gain as a loss. Every one
        // of them is a number a person will believe, on the figure P5 calls
        // "the single number the whole program is judged on", and none of them
        // throws or looks wrong in a diff.
        "src/lib/weight-stats.ts": FULLY_COVERED,
        // FUEL-28, and template-plan.ts's argument one table across. It decides
        // which of thirty-five cells is empty, and an empty cell is not
        // cosmetic here: it is what the 45° hatch marks, what a tap fills, and
        // — through `source` — what the `accent-subtle` tint is drawn from.
        //
        // Every way it can be wrong is a plausible-looking screen rather than a
        // crash: a slot silently missing from a column, a swapped cell drawn as
        // an ordinary one, the one umber marker on the wrong day. None of them
        // throw, and none would look wrong in a diff.
        "src/lib/week-grid.ts": FULLY_COVERED,
        "src/lib/week-totals.ts": FULLY_COVERED,
        // FUEL-34, and the same reasoning as session-entry.ts and slot-times.ts:
        // every branch in it is a refusal reachable by anyone who can POST to
        // the weigh-in action. What puts it here rather than in the ungated
        // majority is what a missed branch COSTS. A refused status throws in
        // Postgres and is therefore visible; a weight that gets past this file
        // is stored, and `numeric(5, 2)` takes 774 as readily as 77.4. P5 calls
        // this "the single number the whole program is judged on" — FUEL-35
        // draws a chart from it and FUEL-36 a trailing rate — so one unmeasured
        // branch is a point on that chart with nothing on either screen to say
        // it is the wrong one.
        "src/lib/weigh-in.ts": FULLY_COVERED,
      },
    },
  },
});
