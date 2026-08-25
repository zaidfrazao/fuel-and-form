import { addDays, type CalendarDate, startOfWeek, todayIn } from "@/lib/date";
import type { profiles } from "@/lib/db/schema";
import type { ScopedInsert } from "@/lib/db/scope";

/**
 * Sam Rivera — the fictional persona a demo session is a clone of (PRD § P7).
 *
 * ## Why these figures are safe to commit, and why no others are
 *
 * This repository is public and P7 promises that "no personal metrics" reach
 * git history, ever. Sam is invented: the figures below are already published
 * in docs/PRD.md, labelled as fictional, and named in the allowlist that
 * `scripts/check-no-metrics.sh` checks every metric-shaped value against. That
 * is the mechanism, not this comment — a figure that is not Sam's fails the
 * scan whatever a comment beside it claims.
 *
 * The rule for anyone editing this file: it may hold Sam's numbers and nobody
 * else's. The owner's real profile lives in `scripts/seed-local.ts`, which is
 * gitignored for exactly this reason.
 *
 * ## Why the targets are not free numbers
 *
 * PRD Open Question 7 resolved them "to sit within ~3% of what the seeded meal
 * library actually delivers, so the demo's macro deltas read near-zero rather
 * than permanently over". A demo whose every day reports "220 kcal over" reads
 * as a broken app to a visitor with sixty seconds and no way to check. So the
 * targets are answerable to `meals.ts` and `plan.ts`, and persona.test.ts
 * recomputes the library's weekday average and holds them to it rather than to
 * a second copy of the same literals.
 *
 * ## What this file is deliberately NOT
 *
 * The persona's HISTORY — roughly twelve weeks of weigh-ins and logged sessions
 * — is FUEL-41, and it belongs beside this profile when it lands. FUEL-40 is
 * the account existing and being usable; FUEL-41 is it looking lived-in. Until
 * then a fresh demo has a populated "Right Now", plan and training view, and a
 * weight chart with nothing on it yet.
 */

/** The name on the demo account. Shown in the app; identifies nothing. */
export const DEMO_DISPLAY_NAME = "Sam Rivera";

/** One zone per account, as `profiles.timezone` requires. */
export const DEMO_TIMEZONE = "Europe/London";

/**
 * How many weeks of program the persona is into when a demo is provisioned.
 *
 * The window FUEL-41 will fill with history, chosen here because
 * `program_start_date` is what anchors it — P7 asks for "roughly 12 weeks of
 * generated weigh-in and training history", and a start date that disagreed
 * with the history would put weigh-ins before the program they belong to.
 */
export const DEMO_PROGRAM_WEEKS = 12;

/**
 * Day zero for the Circuit A/B alternation, as of `now`.
 *
 * ## Computed, not committed
 *
 * `scripts/seed-local.ts` hardcodes a date, which is right for a real account
 * that really did start on one. It is wrong here. A demo provisioned a year
 * from now would show a persona who "started" fifteen months ago, mid-cut and
 * fifty weeks past a target they never reached — and the rotation would have
 * drifted an arbitrary distance from the week it was designed around. The
 * persona is not a person with a history; it is a person who started twelve
 * weeks before whenever you happen to click.
 *
 * ## Why it must be a Monday
 *
 * `rotationWorkout()` counts elapsed sessions from this date, so Circuit A
 * lands on it, and the training template puts circuits on Mon/Wed/Fri. A start
 * date mid-week shifts the whole A/B alternation off the week it was built for
 * — silently, since both circuits are perfectly plausible on any given day.
 * `startOfWeek` is Monday-first, so this cannot be anything else.
 *
 * Resolved in the persona's own zone rather than the server's: `todayIn` is
 * what keeps a provision just after midnight in London from being dated to the
 * previous day by a function running in UTC.
 */
export function demoProgramStart(now: Date): CalendarDate {
  return addDays(startOfWeek(todayIn(DEMO_TIMEZONE, now)), -7 * (DEMO_PROGRAM_WEEKS - 1));
}

/**
 * The profile a demo account is created with.
 *
 * A function of `now` because `programStartDate` is — see above. Everything
 * else is constant, and is written out here rather than spread from a partial
 * so that `check-no-metrics.sh`'s profile-field pattern sees every assignment
 * it is meant to police.
 */
export function demoProfile(now: Date): ScopedInsert<typeof profiles> {
  return {
    heightCm: 172,

    /** Where the program started, and where it is going. */
    startWeightKg: 84.2,
    targetWeightKg: 76,

    /** Kilograms per week — the rate the seeded plan's deficit is built around. */
    goalPaceKgPerWeek: 0.5,

    /** Held to the seeded library's actual weekday output by persona.test.ts. */
    targetKcal: 1780,
    targetProteinG: 148,
    targetFatG: 50,
    targetCarbG: 185,

    /**
     * When each slot is eaten — display hints for P1, not something any query
     * filters on. One time per slot rather than per weekday, which is all the
     * column can express; the same values `scripts/seed-local.ts` documents.
     */
    slotTimes: {
      breakfast: "07:10",
      lunch: "12:30",
      snack: "16:00",
      dinner: "19:00",
      extra: "06:45",
    },

    /**
     * When training happens, keyed by `workouts.type` — a different vocabulary
     * from `slotTimes`, which is why it is a separate column (see schema.ts).
     *
     * The walk is explicitly `null`: it is on the template every single day, so
     * a start time would make it the active card every evening and displace
     * dinner on the five days that also have a real session. PRD § P1 says so
     * outright — "the walk has no window on purpose" — and `null` is how that
     * is expressed, distinct from an absent key, which would take a default.
     */
    workoutTimes: {
      circuit: "06:30",
      intervals: "06:30",
      walk: null,
    },

    programStartDate: demoProgramStart(now),
    timezone: DEMO_TIMEZONE,
  };
}
