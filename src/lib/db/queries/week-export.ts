import "server-only";

import { and, asc, desc, gt, gte, inArray, lt, lte } from "drizzle-orm";

import { addDays, type CalendarDate, startOfWeek, todayIn } from "@/lib/date";
import type { WeekExportInput } from "@/lib/export-week";
import { type Plan, resolveWeek, templateDay } from "@/lib/resolve-plan";
import { trainingDay } from "@/lib/resolve-training";
import type { TrainingPlan } from "@/lib/rotation";
import { getDb } from "../index";
import * as schema from "../schema";
import { scope } from "../scope";
import { byWorkout } from "./today";

/**
 * One week of everything — FUEL-38's read, P6's check-in half.
 *
 * `week.ts`'s sibling, and deliberately not an extension of it. That module
 * serves `/plan`, which needs meals and nothing else; this one needs meals,
 * training and the scale, and adding four tables to `loadWeek` would make every
 * render of the weekly grid pay for a file nobody asked it to build. Two
 * readers with two shapes, which is the division `today.ts` and `week.ts`
 * already keep.
 *
 * In `lib/db/queries/` for the reason the whole directory exists: `getDb()`
 * hands back an UNSCOPED handle and only a module here may hold one. What comes
 * out is a value the pure builder can take — never a handle, never a `Scope`.
 *
 * ## Every read is scoped, and that is an acceptance criterion
 *
 * P6: "the export runs against the logged-in account only — demo sessions
 * export demo data". `scope(userId, getDb())` prepends `user_id = $1` to every
 * statement here, and `scope.select` refuses a caller-supplied `user_id` that
 * would widen one. There is no unscoped statement here to get wrong, which is a
 * stronger guarantee than a rule that has to be remembered; the claim itself is
 * asserted against a real database in `tests/integration/`.
 *
 * ## Which week, and why the caller does not simply say
 *
 * `anchor` is any date in the wanted week, or absent for the current one — the
 * contract `loadWeek` states in full. It cannot default to "this week" without
 * a timezone, the timezone is on the profile, so the date is derived here from
 * `todayIn` AFTER the profile lands. `startOfWeek` then snaps the anchor to its
 * Monday, so a Wednesday and the Monday before it name the same seven days.
 *
 * ## The waves, and the narrowed tables
 *
 * The profile decides the week, so it goes first and alone; the middle wave
 * depends on nothing but the `user_id` already in hand and runs through
 * `Promise.all`; `exercise_sets` needs the log ids and so comes last. On Neon's
 * HTTP driver every statement is its own request, so the shape of this function
 * is most of its latency — three round trips rather than thirteen.
 *
 * The four dated tables are narrowed to Monday..Sunday with a BETWEEN, for
 * `week.ts`'s reason: the dates are contiguous by construction and
 * `calendarDate` sorts chronologically as text, so the range is one predicate
 * that cannot fall out of step with the seven days the file covers. The library
 * tables — meals, workouts, both templates — are fetched whole, because
 * resolution decides which of their rows a date wants and deciding that in SQL
 * would move resolution into the query.
 *
 * `workout_exercises` IS fetched, and was not until FUEL-97. The sentence that
 * stood here said the CSV "names sessions, not the movements inside them" — true
 * until § P10 gave it a sets section, which names the exercise a set was
 * performed on, and an estimate, which apportions a logged duration by the
 * SECTIONS a session's rows fall into. Two columns now read the result, so the
 * statement has stopped being latency spent on nothing. `trainingDay` gets the
 * real map for the same reason `byWorkout` exists.
 *
 * ## Three waves, because `exercise_sets` is addressed by a log id
 *
 * That table has no `date`. Its rows hang off `workout_log_id`, so the ids
 * cannot be known until `workout_logs` has landed and the read cannot join the
 * wave above it — one more round trip, which on Neon's HTTP driver is the unit
 * that costs. Narrowing it to the week's logs is what makes it worth having: the
 * alternative is every set the account has ever recorded, on the table that
 * grows fastest, to print at most a week of them.
 *
 * A week with no logs skips the statement entirely rather than sending
 * `in ()`, which is not a narrower query but an invalid one.
 *
 * ## The weigh-ins are read twice, on purpose
 *
 * `weightLogs` is Monday..Sunday and is what the file's weight SECTION prints.
 * `weighIns` is a different question — which reading a session should be costed
 * at — and its answer routinely lies outside the week: the weigh-in nearest a
 * Monday session is often the previous Thursday's. So the week's rows are joined
 * by the last weigh-in on or before Monday and the first after Sunday, which is
 * provably every candidate `nearestWeight` could pick for any date in the week,
 * and the two are kept as separate fields so that widening one cannot put a
 * foreign date into a file named after a week. `/training` resolves the same
 * pair for its single date, which is what makes the CSV's figure and the
 * screen's figure the same number.
 *
 * ## The snapshot is not transactional, knowingly
 *
 * `queries/export.ts` records the same limitation and it applies unchanged:
 * Neon's HTTP driver has no interactive transaction, so these are independent
 * reads and a write landing between two of them could produce a file one row
 * out of date. The window is milliseconds, on a deliberate tap, by the only
 * person who can also be writing.
 */

/** What the route needs: the file's contents, and the name to give it. */
export type WeekExportPayload = {
  /** The Monday the seven days start on — the file's name, and its identity. */
  monday: CalendarDate;
  /** Everything `buildWeekCsv` takes, ready to hand over. */
  input: WeekExportInput;
};

/**
 * One week, for one user.
 *
 * `undefined` when there is no profile row — the contract every loader here
 * keeps. The user exists but has never been set up: no timezone, so no week to
 * be in and no date to name a file with. The route answers 404 rather than
 * inventing a zone.
 *
 * `now` is an argument for the reason it is one everywhere in this app: the
 * request is the only thing that genuinely knows the instant, and a file whose
 * correctness is about dates should not read a clock a test cannot reach.
 *
 * @param anchor any date in the wanted week, or `null` for the current one.
 *   Already validated by the caller — `requestedWeek` turns a malformed one
 *   into `null` rather than a 500.
 */
export async function loadWeekExport(
  userId: string,
  now: Date,
  anchor?: CalendarDate | null,
): Promise<WeekExportPayload | undefined> {
  const s = scope(userId, getDb());

  const profile = await s.selectOne(schema.profiles);

  if (!profile) return undefined;

  const monday = startOfWeek(anchor ?? todayIn(profile.timezone, now));
  const sunday = addDays(monday, 6);

  const [
    meals,
    planTemplate,
    overrides,
    mealLogs,
    workouts,
    workoutExercises,
    trainingTemplate,
    workoutLogs,
    weightLogs,
    weighInBefore,
    weighInAfter,
  ] = await Promise.all([
    s.select(schema.meals),
    s.select(schema.planTemplateEntries),
    s.select(
      schema.dayPlanOverrides,
      and(
        gte(schema.dayPlanOverrides.date, monday),
        lte(schema.dayPlanOverrides.date, sunday),
      ),
    ),
    s.select(
      schema.mealLogs,
      and(gte(schema.mealLogs.date, monday), lte(schema.mealLogs.date, sunday)),
    ),
    s.select(schema.workouts),
    s.select(schema.workoutExercises),
    s.select(schema.trainingTemplateEntries),
    s.select(
      schema.workoutLogs,
      and(
        gte(schema.workoutLogs.date, monday),
        lte(schema.workoutLogs.date, sunday),
      ),
    ),
    s.select(
      schema.weightLogs,
      and(
        gte(schema.weightLogs.date, monday),
        lte(schema.weightLogs.date, sunday),
      ),
    ),

    // The two readings outside the week that a session inside it may be costed
    // at — see "The weigh-ins are read twice". `selectOne` with an `orderBy`,
    // which is `loadTraining`'s shape for the same question asked of one date:
    // the nearest weigh-in in either direction is one of exactly these two, so
    // together with the week's own rows this is every candidate.
    s.selectOne(schema.weightLogs, lt(schema.weightLogs.date, monday), {
      orderBy: desc(schema.weightLogs.date),
    }),
    s.selectOne(schema.weightLogs, gt(schema.weightLogs.date, sunday), {
      orderBy: asc(schema.weightLogs.date),
    }),
  ]);

  /*
   * Wave three. See "Three waves" above for why it cannot join the one before.
   *
   * The guard is not defensive tidiness: `inArray` with an empty list emits
   * `in ()`, which Postgres rejects outright — a week nobody trained would 500
   * on a file that should have been an empty section. `scope.insert` has the
   * same edge and `scope`'s own comment names it.
   */
  const logIds = workoutLogs.map((log) => log.id);
  const sets =
    logIds.length === 0
      ? []
      : await s.select(
          schema.exerciseSets,
          inArray(schema.exerciseSets.workoutLogId, logIds),
        );

  const plan: Plan = {
    programStartDate: profile.programStartDate,
    template: planTemplate,
    overrides,
    meals,
  };

  const training: TrainingPlan = {
    programStartDate: profile.programStartDate,
    template: trainingTemplate,
    workouts,
  };

  const days = resolveWeek(plan, monday);

  return {
    monday,
    input: {
      monday,
      timezone: profile.timezone,
      exportedAt: now,
      days,
      // Keyed off the resolved days rather than recomputing the seven dates, so
      // the "planned" column and the week it belongs to are the same dates in
      // the same order by construction — `loadWeek` pairs them the same way.
      templateDays: days.map(({ date }) => ({
        date,
        meals: templateDay(plan, date),
      })),
      trainingDays: days.map(({ date }) =>
        trainingDay(training, byWorkout(workoutExercises), date),
      ),
      mealLogs,
      workoutLogs,
      weightLogs,
      meals,
      workouts,
      exercises: workoutExercises,
      sets,
      // The week's readings plus the two just outside it. Order is irrelevant —
      // `nearestWeight` scans every candidate rather than assuming a sequence —
      // and a `null` boundary is simply a week with nothing before or after it.
      weighIns: [weightLogs, weighInBefore ?? [], weighInAfter ?? []].flat(),
      startWeightKg: profile.startWeightKg,
    },
  };
}
