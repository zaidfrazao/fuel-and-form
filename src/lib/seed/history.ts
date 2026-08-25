import {
  addDays,
  type CalendarDate,
  dayOfWeek,
  type DayOfWeek,
  daysBetween,
  parseTimeOfDay,
} from "@/lib/date";
import type {
  dayPlanOverrides,
  DayPlanOverride,
  Meal,
  mealLogs,
  MealSlot,
  PlanTemplateEntry,
  profiles,
  TrainingTemplateEntry,
  weightLogs,
  Workout,
  workoutLogs,
} from "@/lib/db/schema";
import type { ScopedInsert } from "@/lib/db/scope";
import { type Plan, resolveDay, templateSlot } from "@/lib/resolve-plan";
import { resolveTraining, type TrainingPlan } from "@/lib/rotation";

/**
 * Sam Rivera's twelve weeks of history — FUEL-41, PRD § P7.
 *
 * `persona.ts` is the account existing; this is it looking lived-in. A demo
 * provisioned without this file has a correct plan, a correct training week and
 * a weight chart with nothing on it — which is the one screen a portfolio
 * visitor with sixty seconds is most likely to open, and an empty chart reads
 * as a broken app rather than as a new account.
 *
 * ## Generated, never committed
 *
 * There is no array of weigh-ins in this file, and there must never be one.
 * `scripts/check-no-metrics.sh` is an allowlist over metric-SHAPED values whose
 * own comment asks that the list be kept short; sixty committed weights would
 * be sixty entries on it, and every one of them a value the history scan then
 * waves through for the rest of the repository's life.
 *
 * So the series is DERIVED, and from figures that are already allowlisted
 * because they are already published as fictional in docs/PRD.md: the persona's
 * `startWeightKg` and `goalPaceKgPerWeek`. This module introduces no new
 * metric-shaped literal at all. The rates below are ratios OF the configured
 * pace rather than paces in their own right, for exactly that reason — a `0.55`
 * written out here would be a body metric wearing a different unit.
 *
 * ## Deterministic, and why that is not merely tidy
 *
 * Nothing here calls `Math.random()`. Every varying value is a pure function of
 * the day's offset from the program start, so the same provision date always
 * produces the same history.
 *
 * That is what makes the last acceptance criterion true rather than aspirational
 * — "doubles as the E2E fixture, so the fixture and the feature maintain each
 * other". A fixture that differs per provision cannot be asserted against, so
 * an E2E suite would have to grow its own seed data, and the two would drift
 * the first time either changed. It is also what makes a demo that looks wrong
 * reproducible instead of a story about something someone saw once.
 *
 * ## Resolved by the app's own resolvers, not by a second copy of the rules
 *
 * Training history goes through `resolveTraining` and meals through
 * `resolveDay`. This is the most important decision in the file and it is not
 * about saving code.
 *
 * Mon/Wed/Fri is a rotation GROUP, not a workout: which of Circuit A and B
 * lands on a given Monday is counted from `program_start_date` by rotation.ts.
 * A generator that re-derived that alternation and got it wrong would attach
 * every logged session to the wrong workout id, and the training view would
 * then show a log for a session that was never scheduled sitting beside an
 * unlogged session that was — with nothing in the data looking wrong and no
 * error anywhere. rotation.ts warns about precisely this class of silent
 * failure; the way not to have it is not to own a second copy of the rule.
 *
 * The same argument holds for meals. `resolveDay` returns one meal per slot and
 * skips slots the template leaves empty, so the weekend — whose lunch and
 * dinner are deliberately flex in `plan.ts` — never acquires a fabricated
 * dinner log, and the second of each weekday's two snacks is not logged as
 * eaten when no screen in the app ever showed it (see resolve-plan.ts on that
 * standing inconsistency).
 *
 * ## History ends yesterday
 *
 * Today is deliberately left unlogged. P7 promises a demo that "is fully
 * writable: the visitor can swap meals, tick workouts, log a weigh-in", and a
 * fully-logged today leaves every primary action on the "Right Now" view
 * already done. Nothing renders empty as a result: today's plan and training
 * come from the template, not from logs.
 */

/* -------------------------------------------------------------------------- */
/* Shape                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Everything the generator needs, already fetched and already owned.
 *
 * Rows rather than seed keys: the ids are generated at insert time, so a caller
 * has to have written the library before it can log anything against it. That
 * is why this runs after `loadSeedLibraries` rather than beside it.
 *
 * No `Scope`, no handle, no clock. This module cannot reach a database, which
 * is what lets the whole of it be unit-tested without credentials.
 */
export type DemoHistoryInput = {
  /** The persona's profile, exactly as `demoProfile()` built it. */
  profile: ScopedInsert<typeof profiles>;

  /** The demo's today, in the persona's zone. History stops the day before. */
  today: CalendarDate;

  meals: Meal[];
  workouts: Workout[];
  planTemplate: PlanTemplateEntry[];
  trainingTemplate: TrainingTemplateEntry[];
};

/** The rows to write, per table. Insert order is the caller's problem. */
export type DemoHistory = {
  weightLogs: ScopedInsert<typeof weightLogs>[];
  dayPlanOverrides: ScopedInsert<typeof dayPlanOverrides>[];
  mealLogs: ScopedInsert<typeof mealLogs>[];
  workoutLogs: ScopedInsert<typeof workoutLogs>[];
};

/* -------------------------------------------------------------------------- */
/* Variation                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * A number in [0, 1) that is always the same for the same `(n, salt)`.
 *
 * Not cryptographic, and not meant to be. It exists so that a Tuesday nine
 * weeks ago is skipped in every demo ever provisioned rather than in some of
 * them — see the module note on determinism. The constants are the usual
 * public-domain mixing primes; `Math.imul` is what keeps the multiplications
 * in 32 bits, and `>>> 0` is what keeps them unsigned.
 *
 * `salt` distinguishes the questions asked about one day. Mixing it through its
 * own multiply rather than adding it to `n` is deliberate: added, `(day 9,
 * salt 4)` and `(day 4, salt 9)` would be the same question, and a day's
 * workout status would correlate with a different day's meal skips.
 */
function variation(n: number, salt: number): number {
  let x = (Math.imul(n, 0x9e3779b1) ^ Math.imul(salt, 0x85ebca6b)) >>> 0;

  x ^= x >>> 15;
  x = Math.imul(x, 0x2545f491) >>> 0;
  x ^= x >>> 13;

  // The final `>>> 0` is not decoration. `^=` evaluates its operands as SIGNED
  // 32-bit integers, so the line above hands back a negative number about half
  // the time, and a negative divided by 2^32 is a negative "probability" — one
  // that is below every threshold in this file at once. The first draft shipped
  // without it and generated a persona who skipped two thirds of her workouts
  // and never swapped a meal, because `Math.floor` of a negative index picks
  // nothing. Nothing threw; the history was simply wrong.
  return (x >>> 0) / 0x1_0000_0000;
}

/** One salt per question, so two questions about a day never share an answer. */
const SALT = {
  workoutStatus: 11,
  workoutDuration: 23,
  workoutNote: 37,
  mealStatus: 53,
  swapPick: 71,
} as const;

/* -------------------------------------------------------------------------- */
/* The weight series                                                          */
/* -------------------------------------------------------------------------- */

/**
 * The mornings Sam steps on the scale — Mon, Tue, Wed, Fri, Sat.
 *
 * Five fixed weekdays rather than a per-day coin flip, for a reason that is
 * arithmetic and not aesthetic. `weight-stats.ts` decides the demo's headline
 * verdict by least-squares regression over the readings within 28 days of the
 * latest, and 28 days holds exactly four of each weekday. A fixed weekly rhythm
 * therefore puts the same set of weekday offsets into every trailing window, so
 * the wobble contributes the same near-nothing to the slope wherever the window
 * happens to fall. A random skip pattern would let the verdict depend on which
 * days the hash happened to drop.
 *
 * It is also what a person actually does. Weighing in on a routine, with two
 * days off it, is more believable than a perfect daily series — which is the
 * least believable thing a tracker can show.
 */
const WEIGH_IN_DAYS = [1, 2, 3, 5, 6] as const satisfies readonly DayOfWeek[];

/**
 * Day-to-day noise, in kilograms, by position in `WEIGH_IN_DAYS`.
 *
 * Weekday-shaped rather than random, which is both what real weight does — a
 * weekend eats differently from a Tuesday, and the scale says so on Monday —
 * and what makes the demo's headline rate stable. Two properties are chosen
 * rather than stumbled into, and history.test.ts asserts both:
 *
 *   1. The offsets SUM TO ZERO. A table with a non-zero mean would shift every
 *      reading by the same amount and misreport the weight lost.
 *
 *   2. They sum to zero AGAIN when weighted by weekday position (0, 1, 2, 4, 5
 *      for Mon, Tue, Wed, Fri, Sat). This is the one that matters for the
 *      verdict. `weight-stats.ts` fits a least-squares line through the
 *      trailing 28 days, which holds exactly four of each weigh-in weekday, so
 *      the wobble's contribution to the SLOPE is this weighted sum — a fixed
 *      quantity, the same in every window. At zero it contributes nothing, and
 *      the reported rate is the trend itself rather than the trend plus an
 *      artefact of which weekday the visitor happened to arrive on.
 *
 * An earlier draft rotated these by week to avoid a repeating pattern. That
 * broke property 2 — a rotation permutes which offset lands on which weekday,
 * so the weighted sum moves with the week — and spread the reported rate across
 * the entire width of the on-pace band, touching both edges. The repetition it
 * was avoiding is 0.2 kg against a fall of more than five, which is not visible
 * on the chart; the rate landing outside the band would have been.
 *
 * The first entry is zero so the very first weigh-in — the program starts on a
 * Monday, and Monday leads this list — lands exactly on the profile's
 * `startWeightKg`. A chart whose first point disagrees with the start weight
 * printed beside it is a small thing that reads as a bug.
 */
const WEIGH_IN_OFFSETS_KG = [0, 0.15, 0, -0.05, -0.1] as const;

/**
 * How the cut actually went, as multiples of the configured goal pace.
 *
 * A ruled line from start weight to today is the other way a generated series
 * gives itself away, so this one has the shape a real cut has: an eager start
 * that runs ahead of target, a week where the scale simply stops, and a steadier
 * groove after it.
 *
 * The groove is slightly UNDER the goal pace, and that is the tuned number in
 * this file. `weight-stats.ts` calls a rate "on pace" only inside a two-sided
 * band — within `PACE_TOLERANCE_KG` under the configured pace, and no faster,
 * so 0.45 to 0.50 kg/week for this persona. Sitting the recent trend at 0.95 of
 * goal puts the demo's headline stat in the middle of that band rather than on
 * its upper edge, where the daily wobble and the rounding to one decimal would
 * be enough to tip it out. history.test.ts asserts the verdict through the real
 * `weightStats()` for every weekday a demo can be provisioned on.
 */
const PACE_FACTOR = { groove: 0.95, eager: 1.1 } as const;

/** The recent stretch the groove covers — comfortably wider than the window. */
const GROOVE_DAYS = 35;

/** The stall: where it starts, counting back from the last day, and how long. */
const STALL = { daysBack: 45, length: 7 } as const;

/**
 * The weight lost on one day, given how far back from the last day it sits.
 *
 * Expressed per day rather than per week because it is summed forward from the
 * start weight — a rate that changes partway through a program cannot be
 * applied as a single multiplication without the segments disagreeing about
 * where the boundary was.
 */
function dailyLossKg(daysBack: number, goalPaceKgPerWeek: number): number {
  const perDay = (factor: number) => (goalPaceKgPerWeek * factor) / 7;

  if (daysBack < GROOVE_DAYS) return perDay(PACE_FACTOR.groove);

  if (daysBack >= STALL.daysBack && daysBack < STALL.daysBack + STALL.length) return 0;

  return perDay(PACE_FACTOR.eager);
}

/**
 * The scale reading for a day, or `null` on a day Sam does not weigh in.
 *
 * Two decimals — the precision `weight_logs.weight_kg` actually holds, and what
 * a connected scale reports. `/weight` prints one, so this is not a change to
 * anything a visitor reads.
 *
 * It IS a change to what the verdict reads. Rounding to a single decimal puts an
 * error of up to 0.05 kg on every point, and those errors are not noise: the
 * underlying trend advances by a fixed fraction of a kilogram per day, so the
 * rounding lands in a repeating pattern that correlates with the regression's
 * own axis. Measured across the seven weekdays a demo can start on, that alone
 * moved the reported rate by up to 0.03 kg/week and pushed one of them out of
 * the on-pace band. At two decimals the same effect is a tenth the size and the
 * band has real margin either side.
 */
function weighIn(date: CalendarDate, runningWeightKg: number): number | null {
  const position = (WEIGH_IN_DAYS as readonly DayOfWeek[]).indexOf(dayOfWeek(date));

  if (position === -1) return null;

  // Indexed by weekday position and nothing else — see the offsets table on why
  // this must not be permuted per week. `indexOf` returned this position from
  // the parallel array above, so it is in range; the assertion states that
  // rather than adding a fallback no test could reach, as `rotationWorkout`
  // does for the same reason.
  const offset = WEIGH_IN_OFFSETS_KG[position]!;

  return Math.round((runningWeightKg + offset) * 100) / 100;
}

/* -------------------------------------------------------------------------- */
/* Training                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * How often each kind of session goes unfinished, as cumulative thresholds.
 *
 * The walk and the sessions get different profiles because a uniform mix is its
 * own kind of fake: the walk is the easy one and is almost always done, while a
 * bodyweight circuit is the thing that loses to a bad night's sleep. `partial`
 * is a first-class outcome in this schema rather than a failure state — the
 * `workout_log_status` enum says so — so it is well represented, and the
 * resulting adherence lands where a viewer reads "someone doing well, but not
 * a machine" rather than the 100% that would read as generated.
 *
 * Keyed by `workouts.type`, which schema.ts is explicit is a rendering
 * discriminator and not a closed set, so an unrecognised type takes the
 * session profile rather than falling through to nothing.
 */
const ADHERENCE = {
  walk: { skipped: 0.06, partial: 0.12 },
  session: { skipped: 0.1, partial: 0.25 },
} as const;

/** How long a session runs, by type: the shortest it gets, and the spread. */
const DURATION_MIN = {
  walk: { from: 30, spread: 16 },
  circuit: { from: 26, spread: 12 },
  intervals: { from: 20, spread: 10 },
  other: { from: 25, spread: 15 },
} as const;

/**
 * Notes, dropped on a minority of sessions.
 *
 * Enough that the training view and the export's note column show something
 * other than a run of nulls, few enough that they do not read as a diary. They
 * carry no figures at all — a note is free text on a public repository, and the
 * cheapest way to keep a body metric out of one is not to write a number in it.
 */
const WORKOUT_NOTES = [
  "Legs still heavy from the circuit.",
  "Cut it short, ran out of morning.",
  "Felt strong today.",
  "Swapped the last round for a stretch.",
  "Walked the long way round.",
] as const;

/** How often a session carries a note. */
const NOTE_RATE = 0.18;

/* -------------------------------------------------------------------------- */
/* Meals                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * How much of the history carries meal logs — the trailing four weeks.
 *
 * Deliberately shorter than the weigh-in and training history, and stated here
 * rather than left to be discovered. The chart, the dot grid and the adherence
 * figure all read the whole program, so those cover twelve weeks. The plan
 * views and the weekly export are week-scoped and a visitor arrives on the
 * current one, so logging every slot of every earlier week would put several
 * hundred more rows into a transaction a visitor is waiting on, to populate
 * weeks nobody navigates to.
 *
 * If a demo ever needs deeper meal history — a monthly export, say — this is
 * the number to raise, and the cost is provisioning latency.
 */
export const MEAL_LOG_WEEKS = 4;

/** The stride that keeps one day's slots apart — `SLOT_ORDER`'s length, above. */
const SLOTS_PER_DAY = 8;

/** Used only for a slot the profile has no time for — `slot_times` is `Partial`. */
const MEAL_FALLBACK_TIME = "12:00";

/** How often a planned meal was not eaten, by slot. Snacks lose most often. */
const MEAL_SKIP_RATE: Readonly<Record<MealSlot, number>> = {
  breakfast: 0.04,
  lunch: 0.1,
  snack: 0.18,
  dinner: 0.06,
  extra: 0.14,
};

/* -------------------------------------------------------------------------- */
/* Swaps                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * How many days back the recent swaps sit, and which slot they touch.
 *
 * Three candidates rather than one because the slot has to be a slot the
 * template actually fills on that weekday, and a weekend dinner is deliberately
 * empty in `plan.ts` — an override there would invent a plan that never
 * existed. Whichever of these fall on a weekday become swaps; at least one
 * always does, whatever weekday the demo is provisioned on, and
 * history.test.ts checks all seven rather than trusting the arithmetic.
 *
 * Dinner because it is the slot a person actually swaps, and the slot P2's
 * weekly grid opens on.
 */
const SWAP_DAYS_BACK = [2, 5, 9] as const;
const SWAP_SLOT: MealSlot = "dinner";

/** Used only if a profile leaves the swapped slot's time unset — `slot_times`
 *  is `Partial`, so the key is genuinely optional and this is genuinely reachable. */
const SWAP_FALLBACK_TIME = "18:00";

/* -------------------------------------------------------------------------- */
/* Instants                                                                   */
/* -------------------------------------------------------------------------- */

/** When the walk gets logged, since `workoutTimes.walk` is null by design. */
const WALK_LOGGED_HOUR = 18;

/** Used only for a workout type the profile has no window for. */
const SESSION_FALLBACK_TIME = "07:00";

/**
 * How many sessions one day's salt has to keep apart.
 *
 * The template puts at most a session and a walk on any date, and this is the
 * stride that gives each its own answer (see the loop). Comfortably above what
 * the seed schedules, so adding a third daily entry does not silently start
 * reusing another day's rolls.
 */
const SESSIONS_PER_DAY = 4;

/**
 * A plausible instant for a row that was written on `date` at `wallMinutes`.
 *
 * Built as UTC from the calendar date, which is approximate by up to an hour in
 * the persona's zone across British Summer Time. That is acceptable HERE and
 * nowhere else in this codebase: `logged_at` means "when this was recorded",
 * nothing resolves a plan or a rotation from it, and the app reads it only to
 * break ties between two logs of the same slot — which this generator never
 * writes. What it buys is a JSON export whose timestamps march through twelve
 * weeks instead of all reading the instant the demo was provisioned, which is
 * the tell that would give the whole history away.
 */
function loggedAt(date: CalendarDate, wallMinutes: number): Date {
  const hours = String(Math.floor(wallMinutes / 60)).padStart(2, "0");
  const minutes = String(wallMinutes % 60).padStart(2, "0");

  return new Date(`${date}T${hours}:${minutes}:00Z`);
}

/* -------------------------------------------------------------------------- */
/* The generator                                                              */
/* -------------------------------------------------------------------------- */

/** Picks from a list by a variation, without an out-of-range index. */
function pick<T>(items: readonly T[], value: number): T | undefined {
  return items[Math.floor(value * items.length)];
}

/**
 * Twelve weeks of weigh-ins, sessions, meals and a swap or two.
 *
 * Ordered so that each stage can see the one before it: the swaps are decided
 * first, and the meal logs then resolve THROUGH them, so the day Sam swapped
 * dinner is logged as having eaten what the swap put there. That is what gives
 * the export's planned / actual / swapped-with columns (FUEL-39) three
 * different things to say in at least one row, which is the only way a visitor
 * ever sees that feature exists.
 */
export function demoHistory(input: DemoHistoryInput): DemoHistory {
  const { profile, today, meals, workouts, planTemplate, trainingTemplate } = input;

  const programStart = profile.programStartDate;
  const days = daysBetween(programStart, today);

  const history: DemoHistory = {
    weightLogs: [],
    dayPlanOverrides: [],
    mealLogs: [],
    workoutLogs: [],
  };

  // Nothing has happened yet. Reachable only from a `today` on or before the
  // program start, which `demoProgramStart` never produces — but this module
  // takes its dates as arguments and a caller that passed its own should get an
  // empty history rather than a loop that counts backwards.
  if (days <= 0) return history;

  const lastIndex = days - 1;

  const training: TrainingPlan = {
    programStartDate: programStart,
    template: trainingTemplate,
    workouts,
  };

  /* ---- Swaps, first, so the meal logs can resolve through them --------- */

  const plan: Plan = {
    programStartDate: programStart,
    template: planTemplate,
    meals,
    overrides: [],
  };

  // The meals this template uses in the swapped slot on OTHER weekdays. A swap
  // to another dinner from the rotation is what a person actually does; picking
  // any row from the library would put the morning coffee on a Tuesday evening
  // and make the demo's one visible swap look like a bug.
  const slotMeals = [
    ...new Set(
      planTemplate.filter((entry) => entry.slot === SWAP_SLOT).map((entry) => entry.mealId),
    ),
  ];

  // Resolution needs whole rows, and these are never inserted: the ids below are
  // placeholders that exist only so `resolveDay` can report which row won, and
  // they are dropped again when the inserts are built. The database generates
  // the real ones.
  const overrides: DayPlanOverride[] = [];

  for (const daysBack of SWAP_DAYS_BACK) {
    const date = addDays(today, -daysBack);
    const planned = templateSlot(plan, date, SWAP_SLOT);

    // A weekend, whose dinner the template leaves flex. Not an error — there is
    // simply nothing there to swap away from.
    if (!planned) continue;

    const alternatives = slotMeals.filter((mealId) => mealId !== planned.meal.id);
    const swappedIn = pick(alternatives, variation(daysBack, SALT.swapPick));

    // A library with only one meal in this slot, which the seeded one is not.
    if (!swappedIn) continue;

    // Half an hour before the meal itself: a swap is decided while deciding
    // what to cook, not written up afterwards.
    const decidedAt = loggedAt(
      date,
      parseTimeOfDay(profile.slotTimes[SWAP_SLOT] ?? SWAP_FALLBACK_TIME) - 30,
    );

    const row = { date, slot: SWAP_SLOT, mealId: swappedIn, createdAt: decidedAt };

    history.dayPlanOverrides.push(row);
    overrides.push({ ...row, id: `demo-swap-${date}`, userId: "" });
  }

  plan.overrides = overrides;

  /* ---- Day by day ------------------------------------------------------- */

  const mealLogsFrom = daysBetween(programStart, addDays(today, -MEAL_LOG_WEEKS * 7));

  let runningWeightKg = profile.startWeightKg;

  for (let dayIndex = 0; dayIndex <= lastIndex; dayIndex += 1) {
    const date = addDays(programStart, dayIndex);

    if (dayIndex > 0) runningWeightKg -= dailyLossKg(lastIndex - dayIndex, profile.goalPaceKgPerWeek);

    /* ---- Weigh-in ------------------------------------------------------ */

    const weightKg = weighIn(date, runningWeightKg);

    if (weightKg !== null) {
      history.weightLogs.push({ date, weightKg, createdAt: loggedAt(date, 7 * 60 + 5) });
    }

    /* ---- Training ------------------------------------------------------ */

    // The salt carries the session's POSITION in the day as well as the day, so
    // the circuit and the walk that share a Monday get independent answers. Two
    // rolls off the same salt would tie them together — every skipped circuit
    // would come with a skipped walk, which is the opposite of how a bad
    // morning actually goes.
    resolveTraining(training, date).forEach(({ workout }, position) => {
      const day = dayIndex * SESSIONS_PER_DAY + position;

      const rates = workout.type === "walk" ? ADHERENCE.walk : ADHERENCE.session;
      const roll = variation(day, SALT.workoutStatus);

      const status =
        roll < rates.skipped ? "skipped" : roll < rates.partial ? "partial" : "done";

      const duration =
        DURATION_MIN[workout.type as keyof typeof DURATION_MIN] ?? DURATION_MIN.other;

      const noteRoll = variation(day, SALT.workoutNote);

      // The walk has no window on purpose — `workoutTimes.walk` is null, which
      // persona.ts explains — so it is stamped with an evening hour instead of
      // taking a default that would put it on the morning's start time.
      const wallMinutes =
        workout.type === "walk"
          ? WALK_LOGGED_HOUR * 60
          : parseTimeOfDay(
              // Optional twice over, and both reachable: the column carries a
              // `{}` default so the whole object is absent from an insert that
              // omits it, and it is keyed by free-text `workouts.type`, which
              // schema.ts is explicit may hold a value nothing here anticipates.
              profile.workoutTimes?.[workout.type] ?? SESSION_FALLBACK_TIME,
            ) + 60;

      history.workoutLogs.push({
        date,
        workoutId: workout.id,
        status,
        // A session that did not happen has no duration. Writing one would put
        // time nobody spent into the export.
        durationMin:
          status === "skipped"
            ? null
            : duration.from +
              Math.floor(variation(day, SALT.workoutDuration) * duration.spread),
        note:
          noteRoll < NOTE_RATE ? (pick(WORKOUT_NOTES, noteRoll / NOTE_RATE) ?? null) : null,
        loggedAt: loggedAt(date, wallMinutes),
      });
    });

    /* ---- Meals, for the recent weeks only ------------------------------ */

    if (dayIndex < mealLogsFrom) continue;

    // Position within the day again, for the reason the training loop gives:
    // one roll per day would make every skipped lunch come with a skipped
    // dinner.
    resolveDay(plan, date).forEach((resolved, position) => {
      const roll = variation(dayIndex * SLOTS_PER_DAY + position, SALT.mealStatus);

      history.mealLogs.push({
        date,
        slot: resolved.slot,
        mealId: resolved.meal.id,
        status: roll < MEAL_SKIP_RATE[resolved.slot] ? "skipped" : "eaten",
        loggedAt: loggedAt(
          date,
          parseTimeOfDay(profile.slotTimes[resolved.slot] ?? MEAL_FALLBACK_TIME) + 10,
        ),
      });
    });
  }

  return history;
}
