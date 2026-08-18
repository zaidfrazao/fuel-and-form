import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  boolean,
  check,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

/**
 * The data model — PRD § Technical Considerations → Data Model.
 *
 * Every user-owned table carries `user_id`, so demo isolation is enforced in the
 * WHERE clause of every statement (see scope.ts) rather than by convention. That
 * is the promise the PRD makes to strangers on a public URL, and this file is
 * the half of it that the database itself holds up.
 *
 * ## Two deliberate departures from the PRD's listing
 *
 * 1. `meal_ingredients` and `workout_exercises` carry `user_id`, which the PRD's
 *    table listing does not give them. Without it they are unreachable through
 *    `scope()` at all — `ScopedTable` requires the column — so the shopping list
 *    (P8) would have to join them to their parent OUTSIDE the scope. That is
 *    precisely the ownership-by-convention the scope exists to eliminate, and it
 *    would leave a working unscoped query in the codebase for the next person to
 *    copy. The denormalised column is pinned to the parent's owner by a
 *    composite foreign key, so the two can never disagree; see `mealIngredients`.
 *
 * 2. `workouts.type` is `text`, not an enum, unlike every other closed set here.
 *    The PRD's gym-restart claim is that weighted training is new ROWS, not a
 *    migration. A gym session is plausibly type 'strength', and under a Postgres
 *    enum that is `ALTER TYPE ... ADD VALUE` — a migration, which would falsify
 *    the claim. So the vocabulary stays open; see `workouts`.
 *
 * The PRD prose says "nine tables" and then enumerates twelve. Twelve is right.
 */

/* -------------------------------------------------------------------------- */
/* Enumerations                                                               */
/* -------------------------------------------------------------------------- */

/**
 * Owner or demo. There is exactly one owner; demo rows are ephemeral and reaped
 * on expiry (P7).
 */
export const userKind = pgEnum("user_kind", ["owner", "demo"]);

/**
 * The meal slots, shared by `meals`, both plan tables and `meal_logs`.
 *
 * One enum across four tables rather than four independent vocabularies: plan
 * resolution matches an override to a template entry by `(day, slot)`, and if
 * the two columns could drift apart the match would silently start missing.
 */
export const mealSlot = pgEnum("meal_slot", [
  "breakfast",
  "lunch",
  "snack",
  "dinner",
  "extra",
]);

/** Whether a planned meal was eaten. Absence of a row means "not logged yet". */
export const mealLogStatus = pgEnum("meal_log_status", ["eaten", "skipped"]);

/** Session adherence. "partial" is a first-class outcome, not a failure state. */
export const workoutLogStatus = pgEnum("workout_log_status", [
  "done",
  "partial",
  "skipped",
]);

/* -------------------------------------------------------------------------- */
/* Shared column builders                                                     */
/* -------------------------------------------------------------------------- */

/**
 * A calendar date, as 'YYYY-MM-DD'.
 *
 * Never a JS `Date`. The PRD pins the app to a single timezone and resolves
 * Circuit A/B by counting days elapsed since `program_start_date` — a `Date`
 * round-trips through UTC and can land on the neighbouring day, which would
 * desynchronise the rotation silently and permanently. A string cannot.
 */
const calendarDate = (name: string) => date(name, { mode: "string" });

/** An instant. `timestamptz` throughout — the app stores UTC and renders local. */
const instant = (name: string) => timestamp(name, { withTimezone: true });

/**
 * Grams of a macronutrient. One decimal place, fixed-point.
 *
 * Not a float: these are summed across every meal in a day and every day in a
 * week (P4, P6), and binary floating point accumulates a visible error over a
 * fortnight of totals. Protein is the binding constraint in this program, so a
 * total that disagrees with the sum of its parts is a real defect.
 */
const macroGrams = (name: string) =>
  numeric(name, { precision: 6, scale: 1, mode: "number" });

/** Kilograms, two decimals — the precision a bathroom scale actually reports. */
const kilograms = (name: string) =>
  numeric(name, { precision: 5, scale: 2, mode: "number" });

/**
 * The owning user. Cascades on delete, which is load-bearing rather than tidy:
 * P7's scheduled reaper deletes expired demo users, and a RESTRICT anywhere in
 * the graph would leave that job failing against rows it cannot see.
 */
const ownerId = () =>
  uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" });

/**
 * A reference to a row in this user's own meal or workout library.
 *
 * ## Why the foreign key is composite, always
 *
 * A plain `meal_id` foreign key says the meal exists. It does NOT say the meal
 * is YOURS. `scope()` fills in `user_id` and refuses to let a caller name it —
 * but `meal_id` is an ordinary argument, supplied by the request. So a demo
 * visitor swapping a slot could pass the OWNER's meal id: the insert succeeds,
 * `user_id` is honestly their own, and the day view then renders the owner's
 * meal name and macros. That is a cross-tenant read, and because an invalid id
 * is rejected while a valid one is accepted, it doubles as an oracle for
 * enumerating the owner's rows — the exact thing scope.ts refuses to leak.
 *
 * Pairing `user_id` into the key closes it in the database: `(meal_id, user_id)`
 * must match a real `(id, user_id)` on `meals`, so another user's meal is not a
 * candidate at all. Postgres enforces it; no application code has to remember.
 *
 * Nullable child columns are safe here — the default MATCH SIMPLE skips the
 * check when any key column is null, which is what `training_template_entries`
 * wants for a row that names a `rotation_group` instead of a workout.
 *
 * ## Why `no action` for history, `cascade` for configuration
 *
 * A log is history, and the export exists so history is never lost (P6, and the
 * "don't lose my history" requirement behind it). Under a cascade, hard-deleting
 * one meal silently erases every record of having eaten it — months of check-in
 * evidence, gone, with no error. `is_archived` is the supported way to retire a
 * library entry, and `no action` is what makes it the ONLY way.
 *
 * `no action` rather than `restrict` specifically: both refuse the delete, but
 * `restrict` fires immediately while `no action` is checked at end of statement
 * — and the demo reaper's `delete from users` removes the meal AND the logs in
 * that one statement, via each row's own `user_id` cascade. By the time the
 * check runs there is no dangling reference, so the reaper still cascades
 * cleanly. `restrict` would abort it. Verified both ways against real Postgres.
 *
 * Template entries cascade instead: they are current configuration, not history.
 * Removing a meal from the library should remove it from the recurring plan —
 * and with logs protected, a meal that has any history cannot be deleted anyway.
 */
const ownedReference = (config: {
  name: string;
  columns: [AnyPgColumn, AnyPgColumn];
  foreignColumns: [AnyPgColumn, AnyPgColumn];
  onDelete: "cascade" | "no action";
}) =>
  foreignKey({
    name: config.name,
    columns: config.columns,
    foreignColumns: config.foreignColumns,
  }).onDelete(config.onDelete);

/** 0 = Sunday through 6 = Saturday, matching `Date.prototype.getDay()`. */
const dayOfWeek = () => integer("day_of_week").notNull();

const dayOfWeekInRange = (table: string) =>
  check(`${table}_day_of_week_range`, sql`"day_of_week" between 0 and 6`);

/* -------------------------------------------------------------------------- */
/* Identity                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * The account. One owner, plus one ephemeral row per demo visit.
 *
 * The only table here without a `user_id` — its own `id` IS the owner — and so
 * the only one `scope()` cannot read. That is intended: resolving a session
 * cookie to a user happens before there is a user to scope by. schema.test.ts
 * names this table explicitly as the sole exemption, so a future table that
 * forgets `user_id` fails the suite rather than quietly bypassing the scope.
 */
export const users = pgTable(
  "users",
  {
    id: uuid().primaryKey().defaultRandom(),
    kind: userKind().notNull(),
    displayName: text("display_name").notNull(),
    createdAt: instant("created_at").notNull().defaultNow(),

    /**
     * When this demo session stops being valid. Null for the owner, who never
     * expires — nullable precisely so "owner" and "demo that outlives its
     * expiry" are different states rather than the same one.
     */
    expiresAt: instant("expires_at"),
  },
  (t) => [
    // The reaper's only query: expired demo sessions. Partial, so the owner row
    // — and every unexpired session, once the index is scanned — stays out of it.
    index("users_expires_at_idx").on(t.expiresAt).where(sql`"expires_at" is not null`),

    // "One owner" as a database fact rather than an application habit.
    //
    // `ownerUserId()` provisions the owner row on first correct login, and a
    // check-then-insert cannot be made safe in application code: two logins
    // racing on a fresh deployment both read "no owner" and both insert. The
    // result is two owner identities, with `limit(1)` picking between them
    // arbitrarily from then on — data silently split across two accounts, and
    // no error anywhere. Partial, so it constrains owners only and leaves demo
    // rows, of which there are deliberately many, alone.
    uniqueIndex("users_single_owner_key").on(t.kind).where(sql`"kind" = 'owner'`),
  ],
);

/**
 * The single-row-per-user settings that everything else is measured against.
 *
 * `user_id` is the primary key, so one profile per user is a schema fact rather
 * than something the app has to remember to enforce.
 */
export const profiles = pgTable("profiles", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),

  heightCm: integer("height_cm").notNull(),
  startWeightKg: kilograms("start_weight_kg").notNull(),
  targetWeightKg: kilograms("target_weight_kg").notNull(),
  goalPaceKgPerWeek: numeric("goal_pace_kg_per_week", {
    precision: 4,
    scale: 2,
    mode: "number",
  }).notNull(),

  targetKcal: integer("target_kcal").notNull(),
  targetProteinG: macroGrams("target_protein_g").notNull(),
  targetFatG: macroGrams("target_fat_g").notNull(),
  targetCarbG: macroGrams("target_carb_g").notNull(),

  /**
   * When each slot is eaten, e.g. `{ breakfast: "07:30" }`. Free-shaped on
   * purpose: these are display hints for the "Right Now" view (P1), not
   * something any query filters or joins on, so a column per slot would buy
   * nothing and cost a migration every time the routine shifts.
   *
   * Three states per slot, and settings (FUEL-21) can write all three. A time
   * is a configured window; an ABSENT key means "never set", which takes the
   * default; and an explicit `null` means "deliberately unscheduled", which
   * takes no default and sends the slot to `anytime`. Absent and null have to
   * differ because a profile starts out `{}` and must still render a day —
   * see `scheduleFor` in resolve-now.ts.
   */
  slotTimes: jsonb("slot_times").$type<Partial<Record<MealSlot, string | null>>>().notNull(),

  /**
   * When training happens, keyed by `workouts.type` — `{ circuit: "06:30" }`.
   *
   * A second free-shaped column rather than more keys in `slot_times`, because
   * the two are keyed by different vocabularies: `slot_times` by the closed
   * `meal_slot` enum, this by the deliberately OPEN `workouts.type` text (see
   * the note on `workouts`). Merging them would mean one bag whose keys come
   * from two namespaces that are each free to grow into the other's.
   *
   * Same three states as `slot_times`, and `null` is the one that matters
   * here: the daily walk is unscheduled on purpose, and a gym session someone
   * does whenever should be expressible the same way.
   */
  workoutTimes: jsonb("workout_times")
    .$type<Record<string, string | null>>()
    .notNull()
    .default({}),

  /** Day zero for Circuit A/B alternation. See `trainingTemplateEntries`. */
  programStartDate: calendarDate("program_start_date").notNull(),

  /** IANA zone, e.g. 'Europe/London'. One zone per user; no travel handling. */
  timezone: text().notNull(),
});

/* -------------------------------------------------------------------------- */
/* Meals                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * The meal library — recipes, with per-serving macros as supplied.
 *
 * Macros are stored, never recomputed from `meal_ingredients` (PRD Assumptions).
 * A meal is therefore valid with no ingredient rows at all, which is what lets
 * P1–P6 ship before the shopping list has any data behind it.
 */
export const meals = pgTable(
  "meals",
  {
    id: uuid().primaryKey().defaultRandom(),
    userId: ownerId(),

    name: text().notNull(),
    slotType: mealSlot("slot_type").notNull(),

    kcal: integer().notNull(),
    proteinG: macroGrams("protein_g").notNull(),
    fatG: macroGrams("fat_g").notNull(),
    carbG: macroGrams("carb_g").notNull(),

    /** Markdown. Rendered in the kitchen, so it is prose, not structured steps. */
    method: text(),
    notes: text(),

    /**
     * Retired from the library but kept whole. This is the delete path for a
     * meal: history in `meal_logs` names it, and an export that reads "meal
     * deleted" for last month's dinners is a worse answer than one extra column.
     */
    isArchived: boolean("is_archived").notNull().default(false),
  },
  (t) => [
    index("meals_user_slot_idx").on(t.userId, t.slotType),

    // Backs the composite foreign key from `meal_ingredients`. Not a constraint
    // the app queries — its whole job is to be referenceable.
    unique("meals_id_user_id_key").on(t.id, t.userId),
  ],
);

/**
 * Ingredients for the shopping list (P8), in both grams and non-scale measures.
 *
 * ## Why `user_id` is here when the PRD does not list it
 *
 * `scope()` can only reach a table that carries the column, so without it the
 * shopping list's read would have to join to `meals` outside the scope — the one
 * thing the scope layer exists to make impossible. The composite foreign key
 * below is what makes the duplication safe: `(meal_id, user_id)` must match a
 * real `(id, user_id)` pair on `meals`, so an ingredient can never claim an
 * owner its meal does not have. Postgres enforces the agreement; nothing relies
 * on the application getting it right.
 *
 * No separate FK to `users` — this one already reaches it through `meals`, and a
 * second path would be a second cascade to reason about for no added guarantee.
 */
export const mealIngredients = pgTable(
  "meal_ingredients",
  {
    id: uuid().primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull(),
    mealId: uuid("meal_id").notNull(),

    name: text().notNull(),

    /** Nullable: "salt to taste" has no weight, and inventing one is worse. */
    grams: numeric({ precision: 7, scale: 1, mode: "number" }),

    /** '1 cup', '2 handfuls' — the measure actually used; there is no scale. */
    nonScaleMeasure: text("non_scale_measure"),

    /** Rough shopping aisle: produce / dairy / meat / dry goods / other. */
    category: text(),
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (t) => [
    foreignKey({
      name: "meal_ingredients_meal_fk",
      columns: [t.mealId, t.userId],
      foreignColumns: [meals.id, meals.userId],
    }).onDelete("cascade"),

    // Serves the scoped read directly: user_id first because every statement
    // filters on it, meal_id second because the shopping list narrows by meal.
    index("meal_ingredients_user_meal_idx").on(t.userId, t.mealId),
  ],
);

/**
 * The recurring weekly intent — what is eaten on a given weekday, by default.
 *
 * This is the table a swap must NOT touch. Divergence lands in
 * `day_plan_overrides` instead, which is what makes a swap one-off by
 * construction rather than by discipline.
 */
export const planTemplateEntries = pgTable(
  "plan_template_entries",
  {
    id: uuid().primaryKey().defaultRandom(),
    userId: ownerId(),

    dayOfWeek: dayOfWeek(),
    slot: mealSlot().notNull(),
    mealId: uuid("meal_id").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (t) => [
    dayOfWeekInRange("plan_template_entries"),
    ownedReference({
      name: "plan_template_entries_meal_fk",
      columns: [t.mealId, t.userId],
      foreignColumns: [meals.id, meals.userId],
      onDelete: "cascade",
    }),
    index("plan_template_entries_user_day_idx").on(t.userId, t.dayOfWeek),
  ],
);

/**
 * Sparse overrides — only the slots where reality diverged from the template.
 *
 * A week with no swaps stores zero rows here. Resolution for any date is: this
 * table's row for `(user_id, date, slot)` if one exists, otherwise the template
 * row for `(user_id, day_of_week, slot)`.
 *
 * The unique constraint is what makes "the row" singular, and what lets a
 * second swap of the same slot be an upsert rather than a duplicate that
 * resolution would then have to break a tie between.
 */
export const dayPlanOverrides = pgTable(
  "day_plan_overrides",
  {
    id: uuid().primaryKey().defaultRandom(),
    userId: ownerId(),

    date: calendarDate("date").notNull(),
    slot: mealSlot().notNull(),

    // History, not configuration: the export's "planned" column reads this, so
    // it outlives the meal it names. See `ownedReference`.
    mealId: uuid("meal_id").notNull(),
    createdAt: instant("created_at").notNull().defaultNow(),
  },
  (t) => [
    ownedReference({
      name: "day_plan_overrides_meal_fk",
      columns: [t.mealId, t.userId],
      foreignColumns: [meals.id, meals.userId],
      onDelete: "no action",
    }),
    uniqueIndex("day_plan_overrides_user_date_slot_key").on(t.userId, t.date, t.slot),
  ],
);

/**
 * What was actually eaten.
 *
 * Kept separate from `day_plan_overrides` on purpose: that table records what
 * was SCHEDULED after a swap, this one what was CONSUMED. Collapsing them would
 * cost the export its planned / actual / swapped-with columns (P6), which is the
 * whole evidentiary value of the weekly check-in.
 *
 * Indexed, not unique, on `(user_id, date)`: a slot can hold more than one meal.
 */
export const mealLogs = pgTable(
  "meal_logs",
  {
    id: uuid().primaryKey().defaultRandom(),
    userId: ownerId(),

    date: calendarDate("date").notNull(),
    slot: mealSlot().notNull(),
    mealId: uuid("meal_id").notNull(),
    status: mealLogStatus().notNull(),
    note: text(),
    loggedAt: instant("logged_at").notNull().defaultNow(),
  },
  (t) => [
    ownedReference({
      name: "meal_logs_meal_fk",
      columns: [t.mealId, t.userId],
      foreignColumns: [meals.id, meals.userId],
      onDelete: "no action",
    }),
    index("meal_logs_user_date_idx").on(t.userId, t.date),
  ],
);

/* -------------------------------------------------------------------------- */
/* Training                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * The workout library.
 *
 * ## Why `type` is text and not an enum
 *
 * Every other closed set in this file is a Postgres enum. This one is not,
 * because the PRD's gym-restart readiness claim is that weighted training
 * arrives as new ROWS and no migration. A gym session is plausibly type
 * 'strength', and adding that to an enum is `ALTER TYPE ... ADD VALUE` — a
 * migration, which is exactly what the claim rules out. Today's values are
 * 'circuit', 'intervals' and 'walk'; the column is a rendering discriminator,
 * not a contract, and the UI must handle a value it does not recognise.
 *
 * ## Rotation
 *
 * `rotation_group` names a set of workouts that alternate ('bodyweight-circuit'),
 * and `rotation_index` orders them within it (0 = A, 1 = B). Both nullable and
 * constrained to move together: a walk belongs to no rotation, and a workout
 * with a group but no index has no defined position in it. Adding Circuit C is
 * one row with index 2 — the resolver's modulo picks it up with no code change.
 */
export const workouts = pgTable(
  "workouts",
  {
    id: uuid().primaryKey().defaultRandom(),
    userId: ownerId(),

    name: text().notNull(),
    type: text().notNull(),
    description: text(),

    rotationGroup: text("rotation_group"),
    rotationIndex: integer("rotation_index"),
  },
  (t) => [
    check(
      "workouts_rotation_pair",
      sql`("rotation_group" is null) = ("rotation_index" is null)`,
    ),
    index("workouts_user_rotation_idx").on(t.userId, t.rotationGroup),
    unique("workouts_id_user_id_key").on(t.id, t.userId),
  ],
);

/**
 * The exercises within a workout, with their prescriptions.
 *
 * Carries `user_id` for the same reason as `meal_ingredients`, pinned to its
 * parent by the same composite foreign key. See that table for the argument.
 *
 * Per-set load and rep logging, if the gym restart ever wants it, is one
 * additive table alongside this one — not a change to it.
 */
export const workoutExercises = pgTable(
  "workout_exercises",
  {
    id: uuid().primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull(),
    workoutId: uuid("workout_id").notNull(),

    name: text().notNull(),

    /** '3 x 12', '30s on / 30s off' — displayed verbatim, never parsed. */
    prescription: text().notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
    notes: text(),
  },
  (t) => [
    foreignKey({
      name: "workout_exercises_workout_fk",
      columns: [t.workoutId, t.userId],
      foreignColumns: [workouts.id, workouts.userId],
    }).onDelete("cascade"),

    index("workout_exercises_user_workout_idx").on(t.userId, t.workoutId),
  ],
);

/**
 * The weekly training schedule.
 *
 * A row names EITHER a fixed `workout_id` (the daily walk, every day) OR a
 * `rotation_group` (Circuit A/B, resolved per date). The check constraint makes
 * that an exclusive choice: a row naming both would leave resolution with two
 * answers and no rule for choosing, and a row naming neither schedules nothing.
 *
 * Alternation is computed from `profiles.program_start_date`, not stored — so it
 * never drifts, and a skipped session does not shift what comes next.
 */
export const trainingTemplateEntries = pgTable(
  "training_template_entries",
  {
    id: uuid().primaryKey().defaultRandom(),
    userId: ownerId(),

    dayOfWeek: dayOfWeek(),
    workoutId: uuid("workout_id"),
    rotationGroup: text("rotation_group"),
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (t) => [
    dayOfWeekInRange("training_template_entries"),
    ownedReference({
      name: "training_template_entries_workout_fk",
      columns: [t.workoutId, t.userId],
      foreignColumns: [workouts.id, workouts.userId],
      onDelete: "cascade",
    }),
    check(
      "training_template_entries_target",
      sql`("workout_id" is null) != ("rotation_group" is null)`,
    ),
    index("training_template_entries_user_day_idx").on(t.userId, t.dayOfWeek),
  ],
);

/** Session adherence — the record the weekly export is built from. */
export const workoutLogs = pgTable(
  "workout_logs",
  {
    id: uuid().primaryKey().defaultRandom(),
    userId: ownerId(),

    date: calendarDate("date").notNull(),
    workoutId: uuid("workout_id").notNull(),
    status: workoutLogStatus().notNull(),
    note: text(),
    durationMin: integer("duration_min"),
    loggedAt: instant("logged_at").notNull().defaultNow(),
  },
  (t) => [
    ownedReference({
      name: "workout_logs_workout_fk",
      columns: [t.workoutId, t.userId],
      foreignColumns: [workouts.id, workouts.userId],
      onDelete: "no action",
    }),
    index("workout_logs_user_date_idx").on(t.userId, t.date),
  ],
);

/* -------------------------------------------------------------------------- */
/* Weight                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Weigh-ins — the single number the whole program is judged on (P5).
 *
 * Unique on `(user_id, date)`: one weigh-in per day. Two readings on the same
 * morning are the same measurement taken twice, and averaging them silently
 * would make the trailing-rate calculation depend on how many times someone
 * stepped on the scale. Re-weighing is an update.
 */
export const weightLogs = pgTable(
  "weight_logs",
  {
    id: uuid().primaryKey().defaultRandom(),
    userId: ownerId(),

    date: calendarDate("date").notNull(),
    weightKg: kilograms("weight_kg").notNull(),
    note: text(),
    createdAt: instant("created_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("weight_logs_user_date_key").on(t.userId, t.date)],
);

/* -------------------------------------------------------------------------- */
/* Inferred types                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Row and insert types, inferred rather than restated.
 *
 * Every consumer — resolvers, the export, the seed script — types against these,
 * so a column that changes shape here becomes a compile error there rather than
 * a runtime surprise. Note the insert types still include `userId`; callers
 * going through `scope()` get `ScopedInsert<T>`, which removes it.
 */
export type MealSlot = (typeof mealSlot.enumValues)[number];
export type UserKind = (typeof userKind.enumValues)[number];
export type MealLogStatus = (typeof mealLogStatus.enumValues)[number];
export type WorkoutLogStatus = (typeof workoutLogStatus.enumValues)[number];

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;

export type Profile = typeof profiles.$inferSelect;
export type NewProfile = typeof profiles.$inferInsert;

export type Meal = typeof meals.$inferSelect;
export type NewMeal = typeof meals.$inferInsert;

export type MealIngredient = typeof mealIngredients.$inferSelect;
export type NewMealIngredient = typeof mealIngredients.$inferInsert;

export type PlanTemplateEntry = typeof planTemplateEntries.$inferSelect;
export type NewPlanTemplateEntry = typeof planTemplateEntries.$inferInsert;

export type DayPlanOverride = typeof dayPlanOverrides.$inferSelect;
export type NewDayPlanOverride = typeof dayPlanOverrides.$inferInsert;

export type MealLog = typeof mealLogs.$inferSelect;
export type NewMealLog = typeof mealLogs.$inferInsert;

export type Workout = typeof workouts.$inferSelect;
export type NewWorkout = typeof workouts.$inferInsert;

export type WorkoutExercise = typeof workoutExercises.$inferSelect;
export type NewWorkoutExercise = typeof workoutExercises.$inferInsert;

export type TrainingTemplateEntry = typeof trainingTemplateEntries.$inferSelect;
export type NewTrainingTemplateEntry = typeof trainingTemplateEntries.$inferInsert;

export type WorkoutLog = typeof workoutLogs.$inferSelect;
export type NewWorkoutLog = typeof workoutLogs.$inferInsert;

export type WeightLog = typeof weightLogs.$inferSelect;
export type NewWeightLog = typeof weightLogs.$inferInsert;
