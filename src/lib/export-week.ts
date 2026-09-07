import { csvTable } from "./csv";
import { addDays, type CalendarDate } from "./date";
import type {
  ExerciseSet,
  Meal,
  MealLog,
  WeightLog,
  Workout,
  WorkoutExercise,
  WorkoutLog,
} from "./db/schema";
import { type EnergyRange, nearestWeight, sessionEnergy } from "./energy";
import { BURN_SEMANTICS, FILENAME_STEM } from "./export";
import { compareDay, stood } from "./plan-vs-actual";
import type { ResolvedDay, ResolvedMeal } from "./resolve-plan";
import type { TrainingDay } from "./resolve-training";

/**
 * One week, as the file the nutrition assistant opens — FUEL-38, PRD § P6.
 *
 * Pure: no database, no clock, no `server-only`. It is handed a week that has
 * already been resolved and returns the text; `lib/db/queries/week-export.ts`
 * does the reading and `app/api/export/week/route.ts` does the responding. The
 * split `lib/export.ts` keeps for the JSON, and for the reason it gives — this
 * is a module that decides what LEAVES the account, and that claim is best
 * asserted against a value rather than through an HTTP response.
 *
 * ## Who this file is for, and why it is not the JSON one
 *
 * PRD § Target Users: the assistant "never logs into the app" and "consumes an
 * exported file containing weight trend, training adherence, and
 * planned-versus-actual meals". So this is a REPORT, where `lib/export.ts` is a
 * BACKUP, and every difference between the two follows from that:
 *
 *   - it covers one week rather than the account, because a check-in is about a
 *     week;
 *   - it carries names where the JSON carries ids, because nothing downstream
 *     is going to resolve a uuid;
 *   - it answers "what happened in this slot" rather than "which rows exist",
 *     which is the whole of the duplicate-log rule below.
 *
 * Nothing here is the backup. Any row this summarises away is still in the JSON
 * export, whole.
 *
 * ## One file, four sections
 *
 * P6 asks for "one section or file each for weight, training, and meals" and
 * this takes the first option: one attachment on a check-in message, one tap on
 * a phone. The file is therefore ragged — tables with different column counts,
 * separated by blank lines — which every spreadsheet import understands and no
 * CSV reader minds, since a reader is told the shape by the header row it is
 * pointed at.
 *
 * FUEL-97 made it four rather than three. Sets are their own section and not a
 * widening of training, because a training row is one per session and a set row
 * is many per session: they cannot share a header, and packing `12,10,8` into a
 * cell produces a column a spreadsheet cannot pivot, sum or chart — which is the
 * one thing the assistant opens this file to do.
 *
 * A five-line preamble comes first. `week` and `dates` name the seven days;
 * `timezone` is there because a bare column of dates is not readable without it
 * — "2026-08-17" is a day only in some zone, and the JSON export makes the same
 * claim by putting the timezone on `account` rather than leaving it inside
 * `profile`. `est_burn_is` is there because the two modelled columns are the
 * only numbers in the file that nobody measured, and a spreadsheet is precisely
 * where a caveat that lives in a README stops travelling with the data.
 *
 * ## The three meal columns
 *
 * P6's "meal export distinguishes planned, actual, and swapped-with for every
 * slot", one column each. `plan-vs-actual.ts` decides what the three mean and
 * argues the decision; this module renders its answer as cells and adds the
 * macros. The rule lives there rather than here because FUEL-39 gave the JSON
 * export the same three values, and one rule rendered twice cannot drift the
 * way two implementations of it would — a `planned` column meaning one thing in
 * the CSV and another in the JSON would disagree exactly on the swapped days,
 * which are the days anyone would look at.
 *
 * `day_plan_overrides`' own schema comment already anticipates the
 * `swapped_with` column: it is history rather than configuration, so it
 * outlives the meal it names.
 *
 * The four macro columns describe the meal in `actual` when there is one, and
 * otherwise the meal that stood. So a summed column is intake as recorded, and
 * a row with a blank `status` is intake that was planned and never confirmed —
 * the assistant filters on `status = eaten` to separate them. Stated in the
 * README too, because a column whose meaning depends on another column is
 * exactly the thing a reader will otherwise guess at.
 *
 * ## Rows nothing scheduled still appear
 *
 * A meal or a session may be logged on a date the template no longer covers —
 * the template is edited for FUTURE weeks, and a past week resolves against the
 * template as it is TODAY rather than as it was then. Dropping those rows would
 * quietly delete recorded history from the report, which is the failure
 * `lib/export.ts` argues against at length. So the meals section emits a row
 * for any slot that has a plan, a swap or a log, and the training section
 * carries a `scheduled` column saying which of its rows the week asked for.
 *
 * ## A slot reports its most recent log, not all of them
 *
 * `meal_logs` has no unique constraint, so a double tap or a retry after a lost
 * response can leave two rows for one slot. `plan-vs-actual.ts` takes the later
 * of them and states why.
 *
 * `workout_logs` needs no such rule, which is why the training section still
 * finds its log with a plain `find`. It is unique on `(user_id, date,
 * workout_id)` precisely so a correction updates the row it corrects, so there
 * is only ever one to find.
 *
 * ## Deterministic, like the JSON
 *
 * Every row's position comes from the data's own keys — the week's dates, then
 * `SLOT_ORDER` for meals, then the template's order for sessions — never from a
 * row id or from whatever order Postgres returned. Two exports of an unchanged
 * week are byte-identical, which is what makes them diffable and what lets the
 * suite assert on the whole document rather than on a set of lines.
 *
 * The one place with no natural key is a logged session the template does not
 * schedule, since nothing ordered it; those sort by name, tie-broken by id.
 */

/** The week is seven days, Monday first — `startOfWeek`'s convention. */
const WEEK_LENGTH = 7;

const WEIGHT_HEADER = ["date", "weight_kg", "note"] as const;

/**
 * Section 2's columns.
 *
 * The two `est_` columns sit between the measured `duration_min` and the free
 * text, which is where they belong on both counts: a reader scanning left to
 * right meets the session's facts, then its model, then its prose, and `note`
 * stays last because a free-text column in the middle of a table is the one
 * that breaks a hand-edited paste.
 *
 * The prefix is the whole labelling scheme and it is worth stating once: the
 * only bare `kcal` column in this file is the meals section's, which is a
 * `meals` row's own stored figure. Anything modelled carries `est_`. A reader
 * who learns that one rule can tell measured from modelled without a legend,
 * and `est_burn_is` in the preamble says it in the file for the reader who does
 * not.
 */
const TRAINING_HEADER = [
  "date",
  "session",
  "type",
  "scheduled",
  "status",
  "duration_min",
  "est_burn_kcal_low",
  "est_burn_kcal_high",
  "note",
] as const;

/**
 * Section 3's columns — § P10's per-set record, FUEL-97.
 *
 * Long form: one row per set, never `12,10,8` packed into a cell. The ticket is
 * explicit about why and it is the reason this is a section rather than columns
 * on the training row — a training row is one per session and a set row is many
 * per session, so they cannot share a header, and a comma-packed cell is one a
 * spreadsheet cannot pivot, sum, or chart.
 *
 * `session` and not `workout`, matching `TRAINING_HEADER` above. The two
 * sections are meant to be joined on `(date, session)`, which is the whole
 * reason the sets are long form; naming one column two things across one file
 * would break the join for the sake of a synonym.
 *
 * `section` is carried even though every row it can produce today reads `work`
 * — set entry is scoped to the working section by `section.ts`'s `working`. It
 * is not decoration. The vocabulary is open by design, an exercise moved to
 * `cooldown` keeps the sets already logged against it, and the column is what
 * lets the assistant sum working volume without first having to know that the
 * app would never have offered set entry anywhere else.
 */
const SETS_HEADER = [
  "date",
  "session",
  "exercise",
  "section",
  "set_index",
  "reps",
  "load_kg",
] as const;

const MEALS_HEADER = [
  "date",
  "slot",
  "planned",
  "swapped_with",
  "actual",
  "status",
  "kcal",
  "protein_g",
  "fat_g",
  "carb_g",
  "note",
] as const;

/**
 * The week, already resolved.
 *
 * Resolved rather than raw, deliberately: `days` and `templateDays` are what
 * `resolveWeek` and `templateDay` answer, so the report's "planned" column and
 * `/plan`'s grid are the same computation rather than two implementations of
 * the same rule. The rows that are NOT resolved — the three log tables — are
 * passed as they come out of the database, because a log is a fact and needs no
 * resolving.
 */
export type WeekExportInput = {
  /** The Monday the week starts on. The file's identity, and its name. */
  monday: CalendarDate;
  /** The zone every date in the file was recorded against. */
  timezone: string;
  /** When the file was made. The only instant in it that is not a row's. */
  exportedAt: Date;
  /** The seven days, template plus overrides. */
  days: readonly ResolvedDay[];
  /** The same seven dates with overrides ignored — the `planned` column. */
  templateDays: readonly ResolvedDay[];
  /** The seven days' sessions, in template order. */
  trainingDays: readonly TrainingDay[];
  mealLogs: readonly MealLog[];
  workoutLogs: readonly WorkoutLog[];
  /** The week's weigh-ins — section 1, and ONLY section 1. See `weighIns`. */
  weightLogs: readonly WeightLog[];
  /** The library, for naming what a log points at. */
  meals: readonly Meal[];
  workouts: readonly Workout[];
  /**
   * Every session's exercise rows — § P10, FUEL-97.
   *
   * The whole library rather than the week's, because a session resolves to a
   * workout and a workout owns its rows regardless of which weeks it appears
   * in. Two readers want them: the sets section names the exercise a set was
   * performed on, and the estimate needs the SECTIONS to apportion a logged
   * duration between working and support time.
   */
  exercises: readonly WorkoutExercise[];
  /** The week's sets, addressed by `workout_log_id` — § P10, FUEL-91. */
  sets: readonly ExerciseSet[];
  /**
   * The weigh-ins a session may be costed at, which is NOT `weightLogs`.
   *
   * Two fields for what looks like one table, and the duplication is the point.
   * `weightLogs` is the week's rows and it is what section 1 prints: widening it
   * would put a reading from outside the week into a file whose name is that
   * week. This is the candidate set `nearestWeight` scans, and the nearest
   * weigh-in to a Monday session is quite often the previous Thursday's.
   *
   * `queries/week-export.ts` builds it as the week's rows plus the last on or
   * before Monday plus the first after Sunday, which provably contains the
   * nearest reading for every date in the week. Structurally typed rather than
   * taking `energy.ts`'s `WeighIn`, so this module names only the three things
   * `energy.convention.test.ts` allows it to.
   */
  weighIns: readonly { date: CalendarDate; weightKg: number }[];
  /** `profiles.start_weight_kg` — `nearestWeight`'s fallback, for an account
   * that has never stepped on the scale. */
  startWeightKg: number;
};

/**
 * A number, as a cell — or an empty cell when there is nothing to say.
 *
 * `String` rather than `format.ts`'s `figure`, and the distinction is the whole
 * point of the file: `figure` groups thousands for a SCREEN, and "1,715" in a
 * CSV is either a quoted string a spreadsheet will not sum or two columns. What
 * belongs here is the stored number, and the formatting is the reader's.
 *
 * `null` and `undefined` both become blank. They arrive from a nullable column
 * (`duration_min`) and from a lookup that found nothing, and the file has one
 * way of saying "no value" rather than two.
 */
function cell(value: number | null | undefined): string {
  return typeof value === "number" ? String(value) : "";
}

/**
 * Groups rows under a key, preserving the order they arrived in.
 *
 * The arrays it returns are its own, so a caller may sort one in place without
 * touching the `WeekExportInput` it came from — the property `buildWeekCsv`
 * relies on and the suite asserts.
 */
function groupBy<T>(
  rows: readonly T[],
  key: (row: T) => string,
): Map<string, T[]> {
  const index = new Map<string, T[]>();

  for (const row of rows) {
    const existing = index.get(key(row));

    if (existing) existing.push(row);
    else index.set(key(row), [row]);
  }

  return index;
}

/** Indexes rows by their date. Every log table in this file is read that way. */
function byDate<T extends { date: CalendarDate }>(
  rows: readonly T[],
): Map<CalendarDate, T[]> {
  return groupBy(rows, (row) => row.date);
}

/** Indexes anything the file has to name by its id. */
function byId<T extends { id: string }>(rows: readonly T[]): Map<string, T> {
  return new Map(rows.map((row) => [row.id, row]));
}

/** A date's meals from a resolved week, indexed by slot. */
function slotsOf(
  days: readonly ResolvedDay[],
): Map<CalendarDate, ResolvedMeal[]> {
  return new Map(days.map((day) => [day.date, day.meals]));
}

/**
 * The seven dates, derived from the Monday the file NAMES.
 *
 * From `monday` rather than from `days`, so the file's contents are the week on
 * its own label. A caller that passed a day outside the week — or failed to
 * pass one inside it — produces a file with a missing row rather than one whose
 * name and contents disagree, and the name is what the assistant files it by.
 */
function weekDates(monday: CalendarDate): CalendarDate[] {
  return Array.from({ length: WEEK_LENGTH }, (_, offset) =>
    addDays(monday, offset),
  );
}

/** Section 1: what the scale said. At most one row a day — a unique index. */
function weightRows(
  dates: readonly CalendarDate[],
  logs: readonly WeightLog[],
): string[][] {
  const index = byDate(logs);

  return dates.flatMap((date) => {
    const log = index.get(date)?.[0];

    if (!log) return [];

    return [[date, cell(log.weightKg), log.note ?? ""]];
  });
}

/**
 * One session in the week, as both training sections report it.
 *
 * Resolved once and shared, rather than each section working out for itself
 * which sessions the week held and what to call them. That is not tidiness: the
 * sets section is meant to be JOINED to the training section on
 * `(date, session)`, so a session that appeared under one name in one and
 * another name in the other — or in a different order — would break the one
 * thing long-form rows are for. One list, one order, one name.
 *
 * The daily walk is a session like any other. It is a `workouts` row whose
 * `type` is `WALK_TYPE`, `trainingDay` resolves it alongside the rest, and the
 * `type` column carries the distinction — so nothing here needs to know the
 * walk exists, which is what `resolve-training.ts` asks of its callers.
 */
type WeekSession = {
  date: CalendarDate;
  /** The `session` column in both sections, and the key they join on. */
  name: string;
  type: string;
  /** Whether the week's template asked for this — the `scheduled` column. */
  scheduled: boolean;
  workoutId: string;
  /** `workout_logs`, when the session was recorded at all. */
  log: WorkoutLog | undefined;
};

/**
 * The week's sessions, in report order: the template's for the days it covers,
 * then anything logged that the template did not ask for.
 *
 * A session may be logged on a date the template no longer covers, and those
 * rows are kept and marked rather than dropped — see the module comment. They
 * are the one group with no natural key, since nothing ordered them, so they
 * sort by name and tie-break on the workout id.
 */
function weekSessions(
  dates: readonly CalendarDate[],
  trainingDays: readonly TrainingDay[],
  logs: readonly WorkoutLog[],
  workouts: readonly Workout[],
): WeekSession[] {
  const scheduled = new Map(
    trainingDays.map((day) => [day.date, day.sessions]),
  );
  const logsByDate = byDate(logs);
  const library = byId(workouts);

  return dates.flatMap((date) => {
    const sessions = scheduled.get(date) ?? [];
    const dayLogs = logsByDate.get(date) ?? [];
    const planned = new Set(sessions.map((session) => session.workout.id));

    const asked: WeekSession[] = sessions.map((session) => ({
      date,
      name: session.workout.name,
      type: session.workout.type,
      scheduled: true,
      workoutId: session.workout.id,
      log: dayLogs.find((row) => row.workoutId === session.workout.id),
    }));

    const unplanned: WeekSession[] = dayLogs
      .filter((log) => !planned.has(log.workoutId))
      .map((log) => {
        // Resolved once here rather than in the comparator and again in the
        // row. A log naming a workout the library no longer holds — which a
        // composite foreign key makes unreachable, so this is defensive — must
        // sort under the same name it prints under, and this is the only place
        // that decides what that name is.
        const workout = library.get(log.workoutId);

        return {
          date,
          name: workout?.name ?? "",
          type: workout?.type ?? "",
          scheduled: false,
          workoutId: log.workoutId,
          log,
        };
      })
      .sort(
        (a, b) => compare(a.name, b.name) || compare(a.workoutId, b.workoutId),
      );

    return [...asked, ...unplanned];
  });
}

/**
 * What a session is estimated to have cost — § P10's figure, FUEL-95/97.
 *
 * A resolver rather than a column computed inline, because the inputs are three
 * indexes and a fallback and threading those through a row builder would put
 * the model in the middle of the printer.
 *
 * ## The same answer `/training` gives, which is the whole requirement
 *
 * `sessionEnergy` is the one implementation and this repeats none of its
 * reasoning — the property `plan-vs-actual.ts` already buys the meals half of
 * both artefacts. The part that would drift silently if it were skipped is
 * `nearestWeight`: a session is costed at the weigh-in nearest ITS OWN date,
 * not the week's last one, so `weighIns` deliberately reaches outside the seven
 * days this file covers. See that field on `WeekExportInput`.
 *
 * ## An unrecorded session has no estimate, and neither do several recorded ones
 *
 * No log means nothing happened, so there is nothing to model. Beyond that,
 * `lib/energy.ts` returns `null` for a workout type with no MET band, for a
 * session carrying neither a duration nor a set, and for a range too wide to
 * mean anything — all three print as two blank cells, which is what this file
 * already means by a blank number.
 *
 * `status` is not consulted. A session marked `skipped` that still carries a
 * logged duration is contradictory data; the screen prices it anyway, and a
 * file that quietly disagreed with a figure somebody watched appear is the
 * harder of the two to explain.
 */
function burnResolver(
  input: WeekExportInput,
  setsByLog: Map<string, ExerciseSet[]>,
): (session: WeekSession) => EnergyRange | null {
  const exercisesByWorkout = groupBy(input.exercises, (row) => row.workoutId);

  return (session) =>
    session.log
      ? sessionEnergy({
          type: session.type,
          exercises: exercisesByWorkout.get(session.workoutId) ?? [],
          sets: setsByLog.get(session.log.id) ?? [],
          durationMin: session.log.durationMin,
          weightKg: nearestWeight(
            input.weighIns,
            session.date,
            input.startWeightKg,
          ),
        })
      : null;
}

/** Section 2: what the week trained, and what it recorded. */
function trainingRows(
  sessions: readonly WeekSession[],
  burn: (session: WeekSession) => EnergyRange | null,
): string[][] {
  return sessions.map((session) => {
    const range = burn(session);

    return [
      session.date,
      session.name,
      session.type,
      session.scheduled ? "yes" : "no",
      session.log?.status ?? "",
      cell(session.log?.durationMin),
      cell(range?.lowKcal),
      cell(range?.highKcal),
      session.log?.note ?? "",
    ];
  });
}

/**
 * Section 3: every set performed in the week, one row each — § P10, FUEL-97.
 *
 * Driven from `weekSessions` rather than from the sets table, so a set row
 * carries the same `date` and `session` the training row above it does and the
 * two sections join. A session with no log contributes nothing, because sets are
 * addressed by `workout_log_id` and there is no log to address.
 *
 * ## The order is the order they were performed in
 *
 * The session's own exercise order — `sort_order`, which is what that column is
 * for — and then `set_index` within an exercise, which is the ordinal the screen
 * prints. Never a row id, and never the order the query returned, which is the
 * determinism promise the rest of this file makes.
 *
 * A set naming an exercise the library does not hold sorts LAST and prints with
 * blank name and section rather than being dropped. The composite foreign key
 * makes it unreachable, so this is defensive in the same way the unplanned-log
 * branch above is — and dropping a row would delete recorded history from the
 * report, which `lib/export.ts` argues against at length. `exerciseId` breaks
 * the tie so two such rows cannot swap places between two exports of one week.
 */
function setRows(
  sessions: readonly WeekSession[],
  input: WeekExportInput,
  setsByLog: Map<string, ExerciseSet[]>,
): string[][] {
  const exercises = byId(input.exercises);

  // Unknown exercises sort behind every real `sort_order`. `MAX_SAFE_INTEGER`
  // rather than `Infinity` because the subtraction below would be NaN for two
  // of them, and a NaN comparator silently leaves an array in input order.
  const rank = (set: ExerciseSet) =>
    exercises.get(set.exerciseId)?.sortOrder ?? Number.MAX_SAFE_INTEGER;

  return sessions.flatMap((session) => {
    if (!session.log) return [];

    // Sorted in place: `groupBy` built this array, so it is not the caller's.
    const sets = (setsByLog.get(session.log.id) ?? []).sort(
      (a, b) =>
        rank(a) - rank(b) ||
        compare(a.exerciseId, b.exerciseId) ||
        a.setIndex - b.setIndex,
    );

    return sets.map((set) => {
      const exercise = exercises.get(set.exerciseId);

      return [
        session.date,
        session.name,
        exercise?.name ?? "",
        exercise?.section ?? "",
        cell(set.setIndex),
        cell(set.reps),
        cell(set.loadKg),
      ];
    });
  });
}

/**
 * Two strings, in byte order.
 *
 * `<` rather than `localeCompare`, which `lib/export.ts` and `format.ts` both
 * argue: `localeCompare` reads the runtime's collation, so a file whose row
 * order depended on the server's locale would not be the byte-identical
 * artefact this module promises.
 */
function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Section 3: planned, swapped-with and actual, for every slot. */
function mealRows(
  dates: readonly CalendarDate[],
  input: WeekExportInput,
): string[][] {
  const resolved = slotsOf(input.days);
  const template = slotsOf(input.templateDays);
  const logsByDate = byDate(input.mealLogs);
  const library = byId(input.meals);

  return dates.flatMap((date) =>
    compareDay({
      templateMeals: template.get(date) ?? [],
      resolvedMeals: resolved.get(date) ?? [],
      logs: logsByDate.get(date) ?? [],
      meals: library,
    }).map((comparison) => {
      // What the macros describe: what was eaten if anything was, else what
      // stood for the slot. See the module comment.
      const counted = comparison.actual ?? stood(comparison);

      return [
        date,
        comparison.slot,
        comparison.planned?.name ?? "",
        comparison.swappedWith?.name ?? "",
        comparison.actual?.name ?? "",
        comparison.status ?? "",
        cell(counted?.kcal),
        cell(counted?.proteinG),
        cell(counted?.fatG),
        cell(counted?.carbG),
        comparison.note ?? "",
      ];
    }),
  );
}

/**
 * The week as one CSV.
 *
 * The sections are written whether or not they have rows: a header with nothing
 * under it says "nothing was recorded that week", which is a true and useful
 * answer, where a missing section is indistinguishable from a broken export by
 * the person opening the file.
 */
export function buildWeekCsv(input: WeekExportInput): string {
  const dates = weekDates(input.monday);
  const sessions = weekSessions(
    dates,
    input.trainingDays,
    input.workoutLogs,
    input.workouts,
  );

  // Built once and shared by the two readers of it — the estimate and the sets
  // section — so the week's fastest-growing table is walked once.
  const setsByLog = groupBy(input.sets, (row) => row.workoutLogId);

  return csvTable([
    ["week", input.monday],
    ["dates", input.monday, addDays(input.monday, WEEK_LENGTH - 1)],
    ["timezone", input.timezone],
    // What the two `est_` columns are, said IN the file. `plannedIs` in the
    // JSON export is the same move for the same reason, and the string is
    // imported from there rather than respelled here.
    ["est_burn_is", BURN_SEMANTICS],
    ["exported_at", input.exportedAt.toISOString()],

    [],
    ["weight"],
    [...WEIGHT_HEADER],
    ...weightRows(dates, input.weightLogs),

    [],
    ["training"],
    [...TRAINING_HEADER],
    ...trainingRows(sessions, burnResolver(input, setsByLog)),

    // Directly after training, because it is that section read at a finer
    // grain: a reader who has just met a session meets its sets next, and the
    // join between the two is one screen apart rather than a file apart.
    [],
    ["sets"],
    [...SETS_HEADER],
    ...setRows(sessions, input, setsByLog),

    [],
    ["meals"],
    [...MEALS_HEADER],
    ...mealRows(dates, input),
  ]);
}

/**
 * `fuel-form-week-2026-08-17.csv` — P6's dated-filename criterion, on the week.
 *
 * Dated by the week's MONDAY rather than by the day it was downloaded, which is
 * the one difference from `exportFilename`. That file is a backup and its
 * question is "when was this taken"; this one is a check-in and its question is
 * "which week is this", so two downloads of the same week overwrite rather than
 * accumulate, and a folder of them sorts into a history.
 *
 * The stem is imported rather than restated, so the two exports cannot come to
 * be called different things.
 */
export function weekExportFilename(monday: CalendarDate): string {
  return `${FILENAME_STEM}-week-${monday}.csv`;
}
