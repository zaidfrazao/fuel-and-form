import type {
  DayPlanOverride,
  Meal,
  MealIngredient,
  MealLog,
  PlanTemplateEntry,
  Profile,
  TrainingTemplateEntry,
  User,
  Workout,
  WorkoutExercise,
  WorkoutLog,
  WeightLog,
} from "./db/schema";

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
 */

/** Bumped only when a field is renamed, removed, or changed in meaning. */
export const SCHEMA_VERSION = 1;

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
 * Sorts a copy, so the caller's array — which it may still be rendering — stays
 * put. `weight-chart.ts` copies before sorting for the same reason.
 */
function ordered<T>(rows: readonly T[], by: (a: T, b: T) => number): T[] {
  return [...rows].sort(by);
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
