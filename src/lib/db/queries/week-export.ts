import "server-only";

import { and, gte, lte } from "drizzle-orm";

import { addDays, type CalendarDate, startOfWeek, todayIn } from "@/lib/date";
import type { WeekExportInput } from "@/lib/export-week";
import { type Plan, resolveWeek, templateDay } from "@/lib/resolve-plan";
import { trainingDay } from "@/lib/resolve-training";
import type { TrainingPlan } from "@/lib/rotation";
import { getDb } from "../index";
import * as schema from "../schema";
import { scope } from "../scope";

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
 * export demo data". `scope(userId, getDb())` prepends `user_id = $1` to all
 * seven statements, and `scope.select` refuses a caller-supplied `user_id` that
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
 * ## Two waves, and four narrowed tables
 *
 * The profile decides the week, so it goes first and alone; the other seven
 * statements depend on nothing but the `user_id` already in hand and run
 * through `Promise.all`. On Neon's HTTP driver every statement is its own
 * request, so the shape of this function is most of its latency.
 *
 * The four dated tables are narrowed to Monday..Sunday with a BETWEEN, for
 * `week.ts`'s reason: the dates are contiguous by construction and
 * `calendarDate` sorts chronologically as text, so the range is one predicate
 * that cannot fall out of step with the seven days the file covers. The library
 * tables — meals, workouts, both templates — are fetched whole, because
 * resolution decides which of their rows a date wants and deciding that in SQL
 * would move resolution into the query.
 *
 * `workout_exercises` is NOT fetched. `trainingDay` takes an exercise map and
 * is given an empty one: the CSV names sessions, not the movements inside them,
 * and its own comment says a missing entry resolves to an empty list rather
 * than a throw. A statement whose result no column reads is latency spent on
 * nothing.
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

/** No exercises are read, so every session resolves with an empty list. */
const NO_EXERCISES = new Map<string, never[]>();

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
    trainingTemplate,
    workoutLogs,
    weightLogs,
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
    s.select(schema.trainingTemplateEntries),
    s.select(
      schema.workoutLogs,
      and(gte(schema.workoutLogs.date, monday), lte(schema.workoutLogs.date, sunday)),
    ),
    s.select(
      schema.weightLogs,
      and(gte(schema.weightLogs.date, monday), lte(schema.weightLogs.date, sunday)),
    ),
  ]);

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
      templateDays: days.map(({ date }) => ({ date, meals: templateDay(plan, date) })),
      trainingDays: days.map(({ date }) => trainingDay(training, NO_EXERCISES, date)),
      mealLogs,
      workoutLogs,
      weightLogs,
      meals,
      workouts,
    },
  };
}
