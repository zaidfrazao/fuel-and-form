import type { CalendarDate } from "./date";
import type {
  DayPlanOverride,
  Meal,
  MealIngredient,
  MealLog,
  MealSlot,
  PlanTemplateEntry,
  Profile,
  TrainingTemplateEntry,
  User,
  Workout,
  WorkoutExercise,
  WorkoutLog,
  WeightLog,
} from "./db/schema";
import { compareDay } from "./plan-vs-actual";
import { type Plan, resolveDay, templateDay } from "./resolve-plan";

/**
 * The account, as a file — FUEL-37, PRD § P6.
 *
 * Pure: no database, no clock, no `server-only`. It is handed rows and returns
 * the document; `lib/db/queries/export.ts` does the reading and
 * `app/api/export/route.ts` does the responding. The split every feature here
 * keeps, and it matters more than usual because this is the module that decides
 * what LEAVES the account — a claim best asserted against a value rather than
 * through an HTTP response.
 *
 * ## What a backup has to contain
 *
 * Every user-owned table, not the four the ticket lists. P6 calls this "the
 * backup mechanism against the don't-lose-my-history requirement", and logs
 * alone cannot restore an account: every `meal_log` names a `meal_id`, and a
 * file holding the log without the meal restores a date, a slot and a uuid that
 * points at nothing. The library and the templates are the rows that give the
 * logs meaning.
 *
 * `users` is the one table not exported wholesale. Its columns are the session
 * layer's — `expires_at` is P7's reaper's, and a demo visitor's row is gone
 * within the day — so what crosses is the four fields `account` names, chosen
 * rather than spread.
 *
 * ## Ids stay, where `/weight` strips them
 *
 * `app/weight/page.tsx` narrows ids out of the payload it sends the browser and
 * argues the case at length: the date is the address, so an id would be an
 * identifier the client could hold, send back, and have ignored — "a field that
 * looks like it addresses something but does not is worse than one that is
 * absent".
 *
 * None of that transfers. This is not a payload for a screen, it is a backup,
 * and `meal_logs.meal_id → meals.id` is the entire reason the file can be
 * restored. Strip the ids and the export is a heap of disconnected rows that
 * still looks complete. The two decisions differ because the two artefacts do.
 *
 * ## `user_id` does not stay
 *
 * The same value on all eleven tables, and `account.id` already says it once.
 * Repeating it a few thousand times is weight rather than information — and it
 * invites a future importer to trust the copy in the row over the account the
 * file came from, which is the one place that disagreement could restore a
 * person's data into somebody else's id.
 *
 * ## The output is deterministic, and that is a feature
 *
 * Every array is sorted by a stable key, so two exports of unchanged data are
 * byte-identical. That is what makes a backup diffable: `diff` between last
 * week's file and this week's shows what actually changed rather than whatever
 * order Postgres happened to return rows in. It also lets the tests assert on
 * values instead of on sets.
 *
 * Sorting is by the row's own natural key and never by `id`, except as the
 * final tie-break. A uuid is random, so ordering by it would be stable across
 * two exports of the SAME data and meaningless across any edit.
 *
 * ## What `schemaVersion` promises
 *
 * That a reader of version 1 keeps working. So a later change may ADD a key or
 * a field, and may not rename one, remove one, or change what one means. Any of
 * those three is a new version — and the field is first in the document so a
 * reader can learn which it is holding without parsing the rest.
 *
 * ## One derived section, and the argument against it
 *
 * `derived` is the exception to everything above: it is the only key in
 * the file that is not rows. FUEL-39 and PRD § Success Metrics ask that
 * "planned-versus-actual [be] computable for every day", measured as "export
 * contains both columns for 100% of logged days". The weekly CSV answers that
 * for the seven days it covers, and nothing answered it for a day outside them.
 *
 * The objection is real and worth recording rather than arguing away. This file
 * is a BACKUP and the CSV is a REPORT; a resolved triple is a report's shape,
 * it is recomputable from four tables already in this document, and unlike
 * every row beside it, it is not a fact — `planned` for a past date resolves
 * against the template as it stands TODAY, because the app keeps no history of
 * template edits. So the section is a present-tense reading of the past sitting
 * next to immutable rows, and a restorer should ignore it entirely.
 *
 * It is here anyway because the alternative was worse: widening the CSV to an
 * all-time scope makes that file's name, preamble and seven-day shape all
 * conditional, and the check-in artefact's whole identity is "one week". This
 * costs one added key, which version 1 already permits, and the derivation is
 * `plan-vs-actual.ts` — the same module the CSV renders, so the two artefacts
 * cannot come to disagree.
 *
 * Two things follow from conceding the objection rather than dismissing it, and
 * both are structural rather than prose, because a caveat only a README carries
 * reaches nobody holding the file:
 *
 *   - the section is NESTED under `derived` and written LAST, so it is not a
 *     peer of the tables and "ignore `derived`" is a rule a restorer can follow
 *     without knowing what is in it;
 *   - `derived.plannedIs` states in the file what `planned` is an answer to,
 *     so a reader can tell two exports of the same date apart rather than
 *     assuming the earlier one was wrong.
 *
 * If a second interpretation is ever wanted — day macro rollups, adherence,
 * the same triple for training — it goes behind that key or into its own
 * artefact. Never beside the tables. That is the line this concedes once and
 * does not concede again.
 *
 * ## Which dates the section covers
 *
 * Those carrying a `meal_log` or a `day_plan_override`, and no others. "Logged
 * days" is the metric's own denominator, and the overrides are in because a
 * swap on a day nothing was eaten is the same aspiration-versus-reality gap
 * read from the other side.
 *
 * Dates with neither are OUT, and that is the load-bearing half: the template
 * recurs forever and the account has no end date, so covering every date since
 * `program_start_date` would emit a plan for every day between then and now,
 * asserting an intent for days nobody lived. A backup that invents history is
 * worse than one that omits a derived convenience.
 */

/** Bumped only when a field is renamed, removed, or changed in meaning. */
export const SCHEMA_VERSION = 1;

/** The value of `derived.plannedIs`. See `PlannedSemantics`. */
const PLANNED_SEMANTICS = "template-as-of-export";

/** The filename stem. `fuel-form-2026-08-10.json`, per P6's own example. */
export const FILENAME_STEM = "fuel-form";

/**
 * An instant, as text.
 *
 * Converted here rather than left to `JSON.stringify`, which turns a `Date`
 * into the same ISO string by default. The difference is where the decision
 * lives: relying on the serializer means the file's shape is a property of how
 * it happens to be written out, and a caller that ever swaps the serializer —
 * or hands these rows to anything else — silently gets a different document.
 */
type Instant = string;

/** Whose account this is. Four fields off `users` and `profiles`, chosen. */
export type ExportAccount = {
  id: string;
  kind: User["kind"];
  displayName: string;
  /** The zone every `date` in this file was recorded against. */
  timezone: string;
};

/** The rows, as they arrive from the query layer. */
export type ExportTables = {
  profile: Profile;
  meals: readonly Meal[];
  mealIngredients: readonly MealIngredient[];
  planTemplateEntries: readonly PlanTemplateEntry[];
  dayPlanOverrides: readonly DayPlanOverride[];
  mealLogs: readonly MealLog[];
  workouts: readonly Workout[];
  workoutExercises: readonly WorkoutExercise[];
  trainingTemplateEntries: readonly TrainingTemplateEntry[];
  workoutLogs: readonly WorkoutLog[];
  weightLogs: readonly WeightLog[];
};

/** One row, with `user_id` gone. */
type Exported<T> = Omit<T, "userId">;

/** `profiles`, which has no `id` of its own — `user_id` IS its primary key. */
export type ExportedProfile = Omit<Profile, "userId">;

/**
 * One slot, answered three ways — see "One derived section" above.
 *
 * Ids rather than names, the rule the rest of this file keeps and for the same
 * reason: a copied `meals.name` is a second source of truth that goes stale the
 * moment a meal is renamed, and every id here resolves against the `meals`
 * array in this same document. The CSV carries names because nothing
 * downstream of it will resolve a uuid; this file's reader has the library.
 *
 * `null` means "nothing to report" and never "the same as the column beside
 * it": an unswapped slot has no swap, and an unlogged one nothing eaten.
 */
/**
 * What `plannedMealId` is an answer to.
 *
 * A literal, in the file, rather than a caveat in the README — because the
 * caveat is not a footnote, it is the field's MEANING. `plan_template_entries`
 * carries no timestamps (checked, not assumed), so the app cannot know what the
 * template said last March; `planned` for a past date is therefore the template
 * as it stands at the moment of export, and editing the template changes it.
 *
 * A reader that stores this string alongside the rows can tell two exports of
 * the same date apart. One that ignores it is no worse off than if the field
 * did not exist. Prose in a README reaches neither.
 */
export type PlannedSemantics = "template-as-of-export";

export type PlanVsActualRow = {
  date: CalendarDate;
  slot: MealSlot;
  /** `plan_template_entries` — the recurring intent, overrides ignored. */
  plannedMealId: string | null;
  /** `day_plan_overrides` — the swap, `null` if the slot was not swapped. */
  swappedWithMealId: string | null;
  /** `meal_logs` — what was eaten, `null` if the slot was not logged. */
  actualMealId: string | null;
  status: MealLog["status"] | null;
  note: string | null;
};

/**
 * Everything in the file that is a reading rather than a row.
 *
 * One container, and the reason it exists rather than the section sitting at
 * the top level beside the tables: a key that is a peer of `mealLogs` reads as
 * a peer of `mealLogs`. Nested, it cannot be mistaken for restorable state by a
 * reader who never got as far as the README, and "ignore `derived`" is a rule a
 * restorer can follow without knowing what is inside it — today or after
 * anything else is ever added here.
 *
 * It is also the boundary. A backup that has grown one interpretation grows
 * others — day macro rollups, adherence percentages, the same triple for
 * training — until it is a report bundle. Anything of that kind belongs behind
 * this key or in its own artefact, and never beside the tables.
 */
export type ExportDerived = {
  /** What `plannedMealId` means. See `PlannedSemantics`. */
  plannedIs: PlannedSemantics;
  planVsActual: PlanVsActualRow[];
};

export type ExportDocument = {
  schemaVersion: number;
  /** When the file was made. The only instant in it that is not a row's. */
  exportedAt: Instant;
  account: ExportAccount;
  profile: ExportedProfile;
  meals: Exported<Meal>[];
  mealIngredients: Exported<MealIngredient>[];
  planTemplateEntries: Exported<PlanTemplateEntry>[];
  dayPlanOverrides: (Omit<DayPlanOverride, "userId" | "createdAt"> & {
    createdAt: Instant;
  })[];
  mealLogs: (Omit<MealLog, "userId" | "loggedAt"> & { loggedAt: Instant })[];
  workouts: Exported<Workout>[];
  workoutExercises: Exported<WorkoutExercise>[];
  trainingTemplateEntries: Exported<TrainingTemplateEntry>[];
  workoutLogs: (Omit<WorkoutLog, "userId" | "loggedAt"> & { loggedAt: Instant })[];
  weightLogs: (Omit<WeightLog, "userId" | "createdAt"> & { createdAt: Instant })[];
  /** Readings, not rows. Last in the file, and the only key a restore skips. */
  derived: ExportDerived;
};

/**
 * Drops `user_id` from a row.
 *
 * By destructuring rather than by listing what to keep, deliberately: a column
 * added to a table then flows into the export on its own. The alternative —
 * naming every field — would make a new column silently absent from the backup,
 * which is the failure this whole file is written to avoid, and it would look
 * like nothing at all in a diff.
 */
function withoutUser<T extends { userId: string }>(row: T): Omit<T, "userId"> {
  const { userId: _userId, ...rest } = row;

  return rest;
}

/**
 * Sorts in place, which is safe here and nowhere else.
 *
 * Every caller hands this the result of a `.map()` — either `withoutUser` or an
 * instant-stamping projection — so the array being sorted is always one this
 * function's own call site just created, never the `ExportTables` the caller
 * passed in. `buildExport` therefore leaves its argument untouched, which is
 * the property that actually matters and the one the suite asserts.
 *
 * This began as `[...rows].sort(by)`, on `weight-chart.ts`'s precedent of
 * copying before sorting. Mutation testing showed no test could tell the copy
 * from its absence, and the reason is the maps above: the defensive copy was
 * defending against a call that does not exist. Removed rather than left with a
 * test that cannot fail — the same treatment FUEL-35 gave its unobservable
 * comparator branch.
 *
 * The obligation this creates is on the CALLER, so it is stated here: pass a
 * projection, never a row array straight off `tables`.
 */
function ordered<T>(rows: T[], by: (a: T, b: T) => number): T[] {
  return rows.sort(by);
}

/**
 * Two strings, in byte order.
 *
 * `<` rather than `localeCompare`, for `format.ts`'s reason: `localeCompare`
 * reads the RUNTIME's collation, so a file whose row order depended on the
 * server's locale would not be the byte-identical artefact this module
 * promises. Byte order is the same order everywhere.
 */
function text(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Two numbers. Subtraction rather than comparison, so there is no branch to get
 * backwards — every one of `dayOfWeek` and `sortOrder` is a small integer.
 */
function num(a: number, b: number): number {
  return a - b;
}

/**
 * Every date the comparison has anything to say about, in order.
 *
 * A `Set` because the two sources overlap on the ordinary day — something was
 * swapped and then eaten — and a date must not be compared twice. Sorted with
 * `text` rather than a bare `.sort()`, which would read the runtime's default
 * comparator; `calendarDate` is `YYYY-MM-DD`, so byte order IS chronological.
 */
function comparedDates(tables: ExportTables): CalendarDate[] {
  const dates = new Set<CalendarDate>();

  for (const log of tables.mealLogs) dates.add(log.date);
  for (const override of tables.dayPlanOverrides) dates.add(override.date);

  return ordered([...dates], text);
}

/**
 * The plan-versus-actual section — see the module comment for why it exists.
 *
 * Resolution is done here, date by date, rather than fetched: `resolveDay` and
 * `templateDay` are the same functions `/plan`'s grid and the weekly CSV go
 * through, so "planned" means one thing across the app rather than three.
 *
 * The result needs no sorting. Dates come out of `comparedDates` in order and
 * `compareDay` answers in `SLOT_ORDER`, so the section is ordered by
 * construction — which is a stronger guarantee than sorting afterwards, since
 * there is no comparator to get backwards.
 */
function planVsActual(tables: ExportTables): PlanVsActualRow[] {
  const library = new Map(tables.meals.map((meal) => [meal.id, meal]));

  // Only the entries whose meal this document actually carries.
  //
  // `resolve-plan`'s `hydrate` THROWS when a plan names a meal it was not
  // given, and that is right for a screen: a day silently missing a meal is
  // worse than an error, because the macro totals beside it stay confident. It
  // is wrong here. This is the backup — the file you reach for when something
  // has already gone wrong — and refusing to produce one because a derived
  // convenience could not be computed would lose the rows as well as the
  // reading of them. The composite foreign key makes the case unreachable
  // anyway; `queries/export.ts` selects the whole `meals` table, archived rows
  // included.
  //
  // Filtered rather than caught, deliberately. A `try` around resolution would
  // turn any future throw into a silently shortened section, including ones
  // that mean something else entirely. This drops exactly the rows it can name
  // a reason for, and drops them only from the DERIVED section: the template
  // entry and the override are still in the document above, so a reader can
  // see the dangling reference rather than being told a slot was never planned.
  const carried = (entry: { mealId: string }) => library.has(entry.mealId);

  // Copied out of `tables` because `Plan`'s arrays are mutable and this
  // function must leave its argument untouched — the property `ordered`'s
  // comment makes `buildExport`'s caller rely on. `filter` already returns a
  // new array; `meals` is spread for the same reason.
  const plan: Plan = {
    programStartDate: tables.profile.programStartDate,
    template: tables.planTemplateEntries.filter(carried),
    overrides: tables.dayPlanOverrides.filter(carried),
    meals: [...tables.meals],
  };

  const logsByDate = new Map<CalendarDate, MealLog[]>();

  for (const log of tables.mealLogs) {
    const existing = logsByDate.get(log.date);

    if (existing) existing.push(log);
    else logsByDate.set(log.date, [log]);
  }

  return comparedDates(tables).flatMap((date) =>
    compareDay({
      templateMeals: templateDay(plan, date),
      resolvedMeals: resolveDay(plan, date),
      logs: logsByDate.get(date) ?? [],
      meals: library,
    }).map((comparison) => ({
      date,
      slot: comparison.slot,
      plannedMealId: comparison.planned?.id ?? null,
      swappedWithMealId: comparison.swappedWith?.id ?? null,
      actualMealId: comparison.actual?.id ?? null,
      status: comparison.status,
      note: comparison.note,
    })),
  );
}

/**
 * The account as one document — every user-owned row, ordered and stripped.
 *
 * `exportedAt` is a parameter rather than a `new Date()` here, the contract
 * every module in this app keeps: nothing below the route reads a clock, so the
 * instant a test asks for is the instant it gets.
 */
export function buildExport({
  account,
  exportedAt,
  tables,
}: {
  account: ExportAccount;
  exportedAt: Date;
  tables: ExportTables;
}): ExportDocument {
  return {
    // First in the object, and therefore first in the file: a reader can learn
    // which version it is holding from the opening bytes rather than by parsing
    // a document it does not yet know how to read.
    schemaVersion: SCHEMA_VERSION,
    exportedAt: exportedAt.toISOString(),
    account,
    profile: withoutUser(tables.profile),

    // Library rows sort by name — what a person reading the file looks for —
    // with `id` breaking the tie, because two meals may honestly share a name.
    // Every chain ends on `id`, so no two rows can compare equal and the order
    // is total: that is what makes two exports of unchanged data identical
    // rather than merely similar.
    meals: ordered(
      tables.meals.map(withoutUser),
      (a, b) => text(a.name, b.name) || text(a.id, b.id),
    ),
    mealIngredients: ordered(
      tables.mealIngredients.map(withoutUser),
      (a, b) =>
        text(a.mealId, b.mealId) || num(a.sortOrder, b.sortOrder) || text(a.id, b.id),
    ),
    planTemplateEntries: ordered(
      tables.planTemplateEntries.map(withoutUser),
      (a, b) =>
        num(a.dayOfWeek, b.dayOfWeek) ||
        text(a.slot, b.slot) ||
        num(a.sortOrder, b.sortOrder) ||
        text(a.id, b.id),
    ),

    // Dated rows sort by date first, so the file reads as a history.
    dayPlanOverrides: ordered(
      tables.dayPlanOverrides.map((row) => ({
        ...withoutUser(row),
        createdAt: row.createdAt.toISOString(),
      })),
      (a, b) => text(a.date, b.date) || text(a.slot, b.slot) || text(a.id, b.id),
    ),
    mealLogs: ordered(
      tables.mealLogs.map((row) => ({
        ...withoutUser(row),
        loggedAt: row.loggedAt.toISOString(),
      })),
      (a, b) => text(a.date, b.date) || text(a.slot, b.slot) || text(a.id, b.id),
    ),

    workouts: ordered(
      tables.workouts.map(withoutUser),
      (a, b) => text(a.name, b.name) || text(a.id, b.id),
    ),
    workoutExercises: ordered(
      tables.workoutExercises.map(withoutUser),
      (a, b) =>
        text(a.workoutId, b.workoutId) ||
        num(a.sortOrder, b.sortOrder) ||
        text(a.id, b.id),
    ),
    trainingTemplateEntries: ordered(
      tables.trainingTemplateEntries.map(withoutUser),
      (a, b) =>
        num(a.dayOfWeek, b.dayOfWeek) || num(a.sortOrder, b.sortOrder) || text(a.id, b.id),
    ),
    workoutLogs: ordered(
      tables.workoutLogs.map((row) => ({
        ...withoutUser(row),
        loggedAt: row.loggedAt.toISOString(),
      })),
      (a, b) => text(a.date, b.date) || text(a.id, b.id),
    ),
    weightLogs: ordered(
      tables.weightLogs.map((row) => ({
        ...withoutUser(row),
        createdAt: row.createdAt.toISOString(),
      })),
      (a, b) => text(a.date, b.date) || text(a.id, b.id),
    ),

    // Last in the object and therefore last in the file, for the reason
    // `schemaVersion` is first: position is the cheapest signal a format has.
    // Every row comes before every reading of one.
    derived: {
      plannedIs: PLANNED_SEMANTICS,
      planVsActual: planVsActual(tables),
    },
  };
}

/**
 * `fuel-form-2026-08-10.json` — P6's own example, and its dated-filename
 * criterion.
 *
 * The date is passed in rather than derived, because the only correct one is
 * today in the USER's zone. `todayIn(profile.timezone)` is what produces it,
 * one layer up, for the reason `resolve-now.ts` and `today.ts` both give: a
 * file named from the server's clock would be dated tomorrow for anyone the
 * server is ahead of, on the one artefact whose name is its whole index.
 */
export function exportFilename(date: string): string {
  return `${FILENAME_STEM}-${date}.json`;
}
