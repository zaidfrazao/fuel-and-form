import { csvTable } from "./csv";
import { addDays, type CalendarDate } from "./date";
import { FILENAME_STEM } from "./export";
import type { Meal, MealLog, WeightLog, Workout, WorkoutLog } from "./db/schema";
import { type ResolvedDay, type ResolvedMeal, SLOT_ORDER } from "./resolve-plan";
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
 * ## One file, three sections
 *
 * P6 asks for "one section or file each for weight, training, and meals" and
 * this takes the first option: one attachment on a check-in message, one tap on
 * a phone. The file is therefore ragged — three tables with three different
 * column counts, separated by blank lines — which every spreadsheet import
 * understands and no CSV reader minds, since a reader is told the shape by the
 * header row it is pointed at.
 *
 * A four-line preamble comes first. `week` and `dates` name the seven days;
 * `timezone` is there because a bare column of dates is not readable without it
 * — "2026-08-17" is a day only in some zone, and the JSON export makes the same
 * claim by putting the timezone on `account` rather than leaving it inside
 * `profile`.
 *
 * ## The three meal columns
 *
 * P6's "meal export distinguishes planned, actual, and swapped-with for every
 * slot", one column each and each with a single meaning:
 *
 *   - `planned` — what the weekly TEMPLATE names for that weekday and slot.
 *     The recurring intent, before the week began.
 *   - `swapped_with` — the `day_plan_overrides` meal, blank when the slot was
 *     never swapped. That table's own schema comment already anticipates this
 *     column: it is history rather than configuration, so it outlives the meal
 *     it names.
 *   - `actual` — the meal the `meal_log` names, blank when the slot was never
 *     logged.
 *
 * The three usually agree, because `actions/log.ts` re-resolves the plan on the
 * server and takes the meal id from its own answer. They come apart in exactly
 * the case worth reporting: a slot logged and only afterwards swapped, where
 * `actual` is what was eaten and `swapped_with` is what the plan says now.
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
 * `meal_logs` has no unique constraint — `actions/log.ts` says so, and guards
 * with `alreadyLogged` — so a double tap or a retry after a lost response can
 * leave two rows for one slot. This takes the later of them, by instant then by
 * id, which is `latestLog`'s rule in `log-intent.ts` and the one undo already
 * works by: the most recent decision is the decision. The superseded row is not
 * lost, it is in the JSON export.
 *
 * `workout_logs` needs no such rule. It is unique on `(user_id, date,
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

const TRAINING_HEADER = [
  "date",
  "session",
  "type",
  "scheduled",
  "status",
  "duration_min",
  "note",
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
  weightLogs: readonly WeightLog[];
  /** The library, for naming what a log points at. */
  meals: readonly Meal[];
  workouts: readonly Workout[];
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

/** Indexes rows by their date. Every log table in this file is read that way. */
function byDate<T extends { date: CalendarDate }>(
  rows: readonly T[],
): Map<CalendarDate, T[]> {
  const index = new Map<CalendarDate, T[]>();

  for (const row of rows) {
    const existing = index.get(row.date);

    if (existing) existing.push(row);
    else index.set(row.date, [row]);
  }

  return index;
}

/** Indexes anything the file has to name by its id. */
function byId<T extends { id: string }>(rows: readonly T[]): Map<string, T> {
  return new Map(rows.map((row) => [row.id, row]));
}

/**
 * The later of two logs, by instant then by id.
 *
 * `latestLog` in `log-intent.ts` makes the same call for the same reason, and
 * states it: `logged_at` defaults to `now()`, so two rows written in the same
 * statement can share an instant, and without the id the answer would depend on
 * which row was scanned first.
 */
function later<T extends { loggedAt: Date; id: string }>(a: T, b: T): T {
  const at = a.loggedAt.getTime();
  const bt = b.loggedAt.getTime();

  if (at === bt) return a.id > b.id ? a : b;

  return at > bt ? a : b;
}

/** The one log that speaks for a slot — see the module comment. */
function slotLog(logs: readonly MealLog[], slot: string): MealLog | undefined {
  return logs
    .filter((log) => log.slot === slot)
    .reduce<MealLog | undefined>(
      (latest, log) => (latest ? later(latest, log) : log),
      undefined,
    );
}

/** A date's meals from a resolved week, indexed by slot. */
function slotsOf(days: readonly ResolvedDay[]): Map<CalendarDate, ResolvedMeal[]> {
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
  return Array.from({ length: WEEK_LENGTH }, (_, offset) => addDays(monday, offset));
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
 * Section 2: what the week trained, and what it recorded.
 *
 * The daily walk is a row like any other. It is a `workouts` row whose `type`
 * is `WALK_TYPE`, `trainingDay` resolves it alongside the sessions, and the
 * `type` column carries the distinction — so nothing here needs to know the
 * walk exists, which is what `resolve-training.ts` asks of its callers.
 */
function trainingRows(
  dates: readonly CalendarDate[],
  trainingDays: readonly TrainingDay[],
  logs: readonly WorkoutLog[],
  workouts: readonly Workout[],
): string[][] {
  const scheduled = new Map(trainingDays.map((day) => [day.date, day.sessions]));
  const logsByDate = byDate(logs);
  const library = byId(workouts);

  return dates.flatMap((date) => {
    const sessions = scheduled.get(date) ?? [];
    const dayLogs = logsByDate.get(date) ?? [];
    const planned = new Set(sessions.map((session) => session.workout.id));

    const rows = sessions.map((session) => {
      const log = dayLogs.find((row) => row.workoutId === session.workout.id);

      return [
        date,
        session.workout.name,
        session.workout.type,
        "yes",
        log?.status ?? "",
        cell(log?.durationMin),
        log?.note ?? "",
      ];
    });

    const unplanned = dayLogs
      .filter((log) => !planned.has(log.workoutId))
      .map((log) => {
        const workout = library.get(log.workoutId);

        // Resolved once here rather than in the comparator and again in the
        // row. A log naming a workout the library no longer holds — which a
        // composite foreign key makes unreachable, so this is defensive — must
        // sort under the same name it prints under, and this is the only place
        // that decides what that name is.
        return { log, name: workout?.name ?? "", type: workout?.type ?? "" };
      })
      .sort(
        (a, b) => compare(a.name, b.name) || compare(a.log.workoutId, b.log.workoutId),
      )
      .map(({ log, name, type }) => [
        date,
        name,
        type,
        "no",
        log.status,
        cell(log.durationMin),
        log.note ?? "",
      ]);

    return [...rows, ...unplanned];
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

  return dates.flatMap((date) => {
    const stood = resolved.get(date) ?? [];
    const planned = template.get(date) ?? [];
    const dayLogs = logsByDate.get(date) ?? [];

    return SLOT_ORDER.flatMap((slot) => {
      const onTheDay = stood.find((meal) => meal.slot === slot);
      const fromTemplate = planned.find((meal) => meal.slot === slot);
      const log = slotLog(dayLogs, slot);

      // Nothing planned it, nothing swapped it, nothing logged it. A row of
      // eleven empty cells would say the slot exists, which for a plan that
      // does not use it is not true.
      if (!onTheDay && !fromTemplate && !log) return [];

      const swapped = onTheDay?.source === "override" ? onTheDay.meal : undefined;
      const actual = log ? library.get(log.mealId) : undefined;

      // What the macros describe: what was eaten if anything was, else what
      // stood for the slot. See the module comment.
      const counted = actual ?? onTheDay?.meal;

      return [
        [
          date,
          slot,
          fromTemplate?.meal.name ?? "",
          swapped?.name ?? "",
          actual?.name ?? "",
          log?.status ?? "",
          cell(counted?.kcal),
          cell(counted?.proteinG),
          cell(counted?.fatG),
          cell(counted?.carbG),
          log?.note ?? "",
        ],
      ];
    });
  });
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

  return csvTable([
    ["week", input.monday],
    ["dates", input.monday, addDays(input.monday, WEEK_LENGTH - 1)],
    ["timezone", input.timezone],
    ["exported_at", input.exportedAt.toISOString()],

    [],
    ["weight"],
    [...WEIGHT_HEADER],
    ...weightRows(dates, input.weightLogs),

    [],
    ["training"],
    [...TRAINING_HEADER],
    ...trainingRows(dates, input.trainingDays, input.workoutLogs, input.workouts),

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
