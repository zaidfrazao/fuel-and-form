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
 * The PRD's § Data Model disagreed with this file in two directions until
 * FUEL-89 reconciled them: its prose counted nine tables where its own listing
 * enumerated twelve, and neither figure included P8's check state — see
 * `shoppingChecks` — or the address P9's web push needs in order to outlive the
 * request — see `pushSubscriptions`. The listing named fourteen here and
 * `exercise_sets` besides; FUEL-91 built the fifteenth, so the two agree.
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

    /**
     * Which client provisioned this demo session — a keyed hash, never an
     * address. Null for the owner, who was not provisioned by anyone.
     *
     * P7 asks that demo provisioning be "rate-limited, so crawlers cannot mass-
     * create sessions". A limit needs something to count per client, and on
     * Vercel's runtime an in-process counter counts nothing: each invocation has
     * its own memory, so a crawler spread across instances is never seen twice.
     * Postgres is the only shared state, which is why the counter is a column.
     *
     * ## Why the hash, and why it is keyed
     *
     * This repository is public and P7's whole subject is what does not end up
     * in it. A raw address is a fact about a person; `hashClientIp` in
     * src/lib/demo.ts reduces it to an HMAC under `SESSION_SECRET`, so the
     * column cannot be read back without the secret and cannot be lined up
     * against the same visitor on another deployment. What is stored is
     * provenance — "these rows came from one client" — and nothing else.
     *
     * ## Why it needs no cleanup of its own
     *
     * The rate-limit window is minutes; a demo session lives two hours. A row
     * still inside its window therefore cannot yet have expired, so the reaper
     * (FUEL-42) never deletes a row the limit still needs, and deletes every row
     * it no longer does. That is one retention rule doing two jobs. A separate
     * table would have needed a second, and a second rule is a second thing to
     * get wrong — for a column that dies with the session it describes.
     */
    ipHash: text("ip_hash"),
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

    // FUEL-40's rate limit reads exactly this: how many sessions one client has
    // provisioned recently. Partial on demo rows, so the owner — the one row
    // with a null `ip_hash`, and the one row never counted — stays out of it.
    //
    // `(ip_hash, created_at)` in that order because the query is an equality on
    // the first and a range on the second, which is the order a btree can serve
    // from a single scan. The reverse would have to filter.
    index("users_demo_ip_hash_idx")
      .on(t.ipHash, t.createdAt)
      .where(sql`"kind" = 'demo'`),
  ],
);

/**
 * The single-row-per-user settings that everything else is measured against.
 *
 * `user_id` is the primary key, so one profile per user is a schema fact rather
 * than something the app has to remember to enforce.
 */
export const profiles = pgTable(
  "profiles",
  {
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

    /**
     * When the evening walk reminder fires, as 'HH:MM' in `timezone` — FUEL-46,
     * PRD § P9. `null` means the reminder is switched off.
     *
     * ## Two states, where `slot_times` has three
     *
     * A slot can be absent (never configured, take the default), `null`
     * (deliberately unscheduled) or a time. This column has no absent: every
     * profile row has the column, and the migration's default fills the rows that
     * existed before it. So `null` is free to mean the one thing P9 asks for —
     * "the reminder can be disabled entirely" — with no second reading.
     *
     * Defaulted to 19:00 rather than to `null`, because P9 describes an evening
     * nudge and a feature that ships switched off is a feature nobody meets. It
     * is one blank field in settings to turn off.
     *
     * ## Why a column, and not a key in `workout_times`
     *
     * `workout_times` is keyed by `workouts.type`, so the obvious-looking home
     * for this is `{ walk: "19:00" }` — and that key already means something
     * else. A time there is a SCHEDULING WINDOW: `resolve-now.ts` would put the
     * walk on the timeline and make it the active card every evening, displacing
     * dinner on the five days that also have a real session. That is precisely
     * why `EDITABLE_WORKOUT_TYPES` excludes 'walk'. A reminder is not a window,
     * and storing it as one would make the two indistinguishable to the resolver.
     *
     * ## Why `text` with a CHECK rather than `time`
     *
     * `time` reads back as '19:00:00', which is not the 'HH:MM' the whole app
     * means by `TimeOfDay` — every other time in the schema lives in jsonb in
     * that form, and a column that agreed with none of them would need a
     * conversion at every boundary.
     *
     * The CHECK is the constraint `slot_times` cannot have. `slot-times.ts`
     * explains at length what an unvalidated time costs there: the column is
     * free-shaped jsonb, `parseTimeOfDay` throws, and a bad value written by a
     * hand-rolled POST breaks `/` on every request until someone edits the row.
     * This value is read from the ROOT LAYOUT, so the same mistake would break
     * every screen at once — and here the database can hold the line itself.
     */
    walkReminderAt: text("walk_reminder_at").default("19:00"),
  },
  () => [
    check(
      "profiles_walk_reminder_at_format",
      sql`"walk_reminder_at" is null or "walk_reminder_at" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'`,
    ),
  ],
);

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
 *
 * ## Deliberately NOT unique on `(user_id, day_of_week, slot)`
 *
 * `day_plan_overrides` carries exactly that constraint, and resolve-plan.ts
 * once suggested this table should match it. It must not, and FUEL-25 found out
 * the direct way: adding it makes the app's own seed unloadable.
 *
 * `lib/seed/plan.ts` puts TWO snacks on every weekday — "both snacks are eaten
 * every weekday … dropping either costs 18-30g of protein against a 148g goal,
 * so they are not optional extras" — and `sort_order` exists to give the pair a
 * stable order. seed/plan.test.ts asserts that shape. A unique index would
 * refuse the second row outright, and the migration would fail against any
 * database that already holds one.
 *
 * The two tables differ because they answer different questions. An override is
 * a single dated divergence and has to be singular, or a revert would not know
 * which row to delete. The template is a plan for a day, and a day can hold two
 * snacks.
 *
 * KNOWN INCONSISTENCY, pre-dating this: `resolveSlot` returns ONE meal per
 * slot, so the seed's second snack never actually resolves onto a screen or an
 * export. That is worth fixing — the resolver and the seed disagree about
 * whether a slot can hold two meals — but it is a change to what `/` shows,
 * not a schema question, and it is not FUEL-25's.
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
 * additive table alongside this one — not a change to it. FUEL-91 spent that
 * sentence and it held: `exercise_sets` below is the table, the three
 * `target_*` columns above are the additive columns, and nothing existing
 * changed its meaning. What the claim did NOT cover is the two
 * `unique(id, user_id)` constraints the composite keys point at — see below —
 * which are additions rather than changes, and are the only correction the
 * paragraph needs.
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

    /**
     * What a set-by-set record is compared against — § P10, FUEL-91.
     *
     * ## Structured columns BESIDE the prescription, never derived from it
     *
     * The obvious alternative is to read these off `prescription` with a
     * regular expression, and it is wrong in a way that is silent. The seed's
     * real strings include '8–12 rounds — 40 sec on / 40 sec off': the first
     * number a `\d+` finds there is 8, so a session of intervals would be
     * offered eight set rows against a target of eight reps, neither of which
     * anybody wrote. The column above says outright that it is "displayed
     * verbatim, never parsed", and this is what spending that sentence looks
     * like — a second, structured place to say the same thing when it can be
     * said structurally, and nulls when it cannot.
     *
     * All three are nullable and none implies the others. '3 × 45s' is three
     * sets with no rep target at all, and an exercise with no target still logs
     * sets — it simply has nothing to compare them against, which is what
     * `exercise_sets` means when a row has no target row above it.
     *
     * `target_reps_low` and `target_reps_high` are equal for a fixed target
     * ('3 × 12' is 12 to 12) rather than leaving the high null, so a reader
     * never has to decide whether a missing high means "no upper bound" or
     * "same as the low". The check below makes them move together.
     */
    targetSets: integer("target_sets"),
    targetRepsLow: integer("target_reps_low"),
    targetRepsHigh: integer("target_reps_high"),
  },
  (t) => [
    foreignKey({
      name: "workout_exercises_workout_fk",
      columns: [t.workoutId, t.userId],
      foreignColumns: [workouts.id, workouts.userId],
    }).onDelete("cascade"),

    index("workout_exercises_user_workout_idx").on(t.userId, t.workoutId),

    // What `exercise_sets` points at. Trivially satisfied by every row that
    // exists — `id` is already the primary key — so this adds a constraint
    // without changing one, which is the standard FUEL-91 holds itself to.
    // `meals` and `workouts` both carry the identical line for the identical
    // reason; see `ownedReference`.
    unique("workout_exercises_id_user_id_key").on(t.id, t.userId),

    // Both scoped strictly to the columns above, which did not exist until this
    // migration: every row already stored satisfies them by holding nulls.
    check(
      "workout_exercises_target_sets_range",
      sql`"target_sets" is null or "target_sets" between 1 and 20`,
    ),
    check(
      "workout_exercises_target_reps_range",
      sql`("target_reps_low" is null) = ("target_reps_high" is null)
          and ("target_reps_low" is null
               or ("target_reps_low" between 1 and 999
                   and "target_reps_high" between "target_reps_low" and 999))`,
    ),
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

/**
 * Session adherence — the record the weekly export is built from.
 *
 * ## One row per session per date, enforced (FUEL-27)
 *
 * P3's criterion is that a status is "settable", and that past sessions are
 * "viewable and EDITABLE by date". Editing means the second answer replaces the
 * first: a session marked done at 18:00 and corrected to partial at 18:01 has
 * one outcome, not two. Without the unique index below there is no such thing
 * as replacing it — every correction is another insert, and the dot grid, the
 * screen and the weekly export are then all reading a set of rows with no rule
 * for which one wins. Ordering by `logged_at` would be that rule, and it would
 * be a rule each of the three had to remember separately.
 *
 * With the index, a correction is `on conflict do update` — one statement,
 * atomic, and no reader has a tie to break. `weight_logs` makes the identical
 * argument for the identical reason ("re-weighing is an update").
 *
 * `meal_logs` deliberately does NOT get this constraint, and the asymmetry is
 * the same one `plan_template_entries` has against `day_plan_overrides`: a slot
 * can hold two meals, so `(user_id, date, slot)` is not unique there and the
 * app guards duplicates in `alreadyLogged` instead. A date's workout is one
 * workout — the rotation resolves a single row per template entry — so here the
 * database can hold the line the application would otherwise have to.
 *
 * It does not constrain a day to ONE row: the walk and the session are
 * different `workout_id`s on the same date, and both are logged.
 */
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

    // The arbiter `scope.upsert` collides on. `user_id` leads for the same
    // reason it leads every index here — it is in the WHERE clause of every
    // statement — and the scope prepends it to the conflict target itself.
    uniqueIndex("workout_logs_user_date_workout_key").on(t.userId, t.date, t.workoutId),

    // What `exercise_sets` hangs off — FUEL-91, and the same trivially
    // satisfied addition `workout_exercises` takes above.
    unique("workout_logs_id_user_id_key").on(t.id, t.userId),
  ],
);

/**
 * One row per set performed — § P10's per-set logging, FUEL-91.
 *
 * ## It hangs off the LOG, not the plan
 *
 * A set is history. `workout_exercises` is the library — what a session asks
 * for — and it is the same rows on every date the workout comes round, so a set
 * keyed to it alone could not say WHICH Wednesday it was performed on. The log
 * is the session that happened, and it already carries the date, the workout
 * and the outcome. The exercise is named beside it, so a set knows what movement
 * it was, and the two keys together are what let the export print a session as
 * the thing it was rather than as a status.
 *
 * ## Where the parent row comes from
 *
 * `workout_logs` exists once a session has a status, and sets are logged BEFORE
 * anyone marks one — so the first set writes the parent, with status 'partial',
 * `on conflict do nothing`. See `logSet` in `queries/training.ts`: that status
 * is a DEFAULT AT CREATION and nothing recomputes it afterwards. A session
 * marked done and then given a fourth set is still done; a session whose last
 * set is removed is still whatever it was marked. PRD § P10 requires that the
 * status is never derived from set data, and "never derived" has to hold in
 * both directions or the dot grid quietly becomes a completion percentage.
 *
 * ## Both keys composite, and only one of them cascades
 *
 * `(workout_log_id, user_id)` cascades: a session's record taken back takes its
 * sets with it. There is no third option — a set whose log is gone has no date,
 * no workout and nothing to hang off — and `clearSession` is what performs it,
 * deliberately, from a control that lives only in the plan state.
 *
 * `(exercise_id, user_id)` is `no action`, which is `ownedReference`'s rule for
 * history and the reason it exists: under a cascade, removing one movement from
 * the library would erase every record of ever having performed it. Retiring a
 * library entry is `is_archived`'s job — `workout_exercises` has no such column
 * today because nothing in the app retires an exercise, and it is one more
 * additive column on the day something does.
 *
 * The `no action` timing argument `ownedReference` sets out at length applies
 * here unchanged: the demo reaper's `delete from users` removes the exercises
 * and these rows in one statement, and by the time the end-of-statement check
 * runs there is no dangling reference left to refuse.
 *
 * ## `load_kg` ships dormant
 *
 * Nothing writes it until the gym restart. The column is here now because
 * adding it now is free and adding it later is a migration — which is exactly
 * what PRD § Gym-restart readiness promises the restart will not need. When the
 * first weighted session happens, it is a value in an insert.
 */
export const exerciseSets = pgTable(
  "exercise_sets",
  {
    id: uuid().primaryKey().defaultRandom(),

    // Plain, not `ownerId()` — the same call `meal_ingredients` and
    // `workout_exercises` make, and for the same reason: the composite key
    // below pins this column to the log's own owner, so the two cannot
    // disagree, and the delete cascade arrives through that key rather than
    // through a second reference to `users`.
    userId: uuid("user_id").notNull(),
    workoutLogId: uuid("workout_log_id").notNull(),
    exerciseId: uuid("exercise_id").notNull(),

    /** 1-based, and the ordinal the screen prints. Bounded by the check below. */
    setIndex: integer("set_index").notNull(),
    reps: integer().notNull(),

    /** Null until the gym restart — see above. Nothing writes it today. */
    loadKg: kilograms("load_kg"),

    createdAt: instant("created_at").notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      name: "exercise_sets_log_fk",
      columns: [t.workoutLogId, t.userId],
      foreignColumns: [workoutLogs.id, workoutLogs.userId],
    }).onDelete("cascade"),

    ownedReference({
      name: "exercise_sets_exercise_fk",
      columns: [t.exerciseId, t.userId],
      foreignColumns: [workoutExercises.id, workoutExercises.userId],
      onDelete: "no action",
    }),

    /**
     * What an upsert collides on when a set is CORRECTED rather than added.
     *
     * Eight reps entered as eighty is one row twice, not two rows — the same
     * argument `workout_logs` makes one table up, and for the same reason: with
     * two rows there is no rule for which the screen, the estimate (FUEL-95) and
     * the export (FUEL-97) should each believe, and each of them would have to
     * remember the same tie-break separately.
     *
     * `user_id` leads because it is in the WHERE clause of every statement and
     * because `scope.upsert` prepends it to the conflict target itself.
     */
    uniqueIndex("exercise_sets_user_log_exercise_index_key").on(
      t.userId,
      t.workoutLogId,
      t.exerciseId,
      t.setIndex,
    ),

    // The screen reads every set of a session at once, and orders them by
    // exercise and index — see `loadTraining`.
    index("exercise_sets_user_log_idx").on(t.userId, t.workoutLogId),

    /*
     * The floors and ceilings, in the database as well as in `exercise-set.ts`.
     *
     * Both layers, on `session-entry.ts`'s reasoning: the parse is what gives
     * the screen a refusal it can render, and the constraint is what holds when
     * a future caller forgets to parse. The figures are far above anything this
     * program prescribes (§ P3's sessions are 25-30 minutes of circuits) and far
     * below the point where a number stops meaning anything — the same shape of
     * bound `MAX_DURATION_MIN` picks, and the same reason for it.
     *
     * Zero reps is refused. A set of no reps did not happen, and the honest way
     * to say a set was not performed is the absence of a row.
     */
    check("exercise_sets_set_index_range", sql`"set_index" between 1 and 20`),
    check("exercise_sets_reps_range", sql`"reps" between 1 and 999`),
    check("exercise_sets_load_positive", sql`"load_kg" is null or "load_kg" > 0`),
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
/* Shopping                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Which lines of a week's shopping list have been ticked off — P8, FUEL-45.
 *
 * ## A row means checked, and there is no third state
 *
 * There is no `checked` boolean. Ticking an item inserts a row, unticking it
 * deletes one, and the list renders a line as checked exactly when a row for it
 * exists. A boolean column would introduce "explicitly unchecked" — a state
 * distinct from "never touched" that nothing in the feature can tell apart, and
 * that every reader would then have to decide how to treat. Presence is the
 * whole predicate.
 *
 * ## The key is the ingredient's NAME, not any id
 *
 * `item_key` holds `shopping-list.ts`'s normalised name, and that file argues
 * the choice at length: P8 requires that *"regenerating after a swap preserves
 * existing check state for unchanged items"*, which needs an identity that
 * survives the regeneration. A `meal_ingredients.id` does not — swap Tuesday's
 * dinner and the mince arrives from a different recipe's row — and a position
 * in the list survives even less. The normalised name is precisely what does
 * not change when the plan around it does.
 *
 * So there is deliberately no foreign key here. The key is not a reference to a
 * row; it is the text two rows agree on, which is what makes the tick stick
 * when the row underneath it is replaced. A tick whose ingredient leaves the
 * week is left in place rather than swept: it renders nowhere, and deleting it
 * on regeneration would destroy exactly the state the criterion asks to keep,
 * in the case where the swap is undone an hour later.
 *
 * ## Scoped to a week, by its Monday
 *
 * `week_start` is always a Monday — `startOfWeek` snaps it on the way in, so a
 * URL naming a Wednesday and one naming its Monday tick the same row. Weeks are
 * separate lists rather than one running list because the shop is: last week's
 * ticks say nothing about this week's, and P8 scopes persistence to "that week"
 * for that reason.
 *
 * The unique index is what makes a tick idempotent — a double-tap upserts the
 * one row rather than inserting a second the reader would then have to count.
 */
export const shoppingChecks = pgTable(
  "shopping_checks",
  {
    id: uuid().primaryKey().defaultRandom(),
    userId: ownerId(),

    /** The Monday of the week being shopped for. */
    weekStart: calendarDate("week_start").notNull(),
    /** `shopping-list.ts`'s normalised ingredient name. See above. */
    itemKey: text("item_key").notNull(),
    checkedAt: instant("checked_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("shopping_checks_user_week_item_key").on(t.userId, t.weekStart, t.itemKey),
  ],
);

/* -------------------------------------------------------------------------- */
/* Push                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Where a browser can be reached with a notification — P9, FUEL-47.
 *
 * P9's second layer: "web push, subscribe from settings, delivered by a
 * scheduled job". The in-app banner needs nothing stored — it is decided from
 * `profiles.walk_reminder_at` on every render — but a notification sent while
 * the app is CLOSED has no request to hang off, so the address has to be kept.
 *
 * ## The three columns are the browser's own words, stored verbatim
 *
 * `PushSubscription.toJSON()` yields exactly `{ endpoint, keys: { p256dh,
 * auth } }`, and all three are opaque: the endpoint is a URL the push service
 * minted for one browser, `p256dh` is that browser's public key and `auth` a
 * shared secret, both base64url. Nothing here parses, normalises or validates
 * them beyond their presence, because there is no format this app is entitled
 * to have an opinion about — Google, Mozilla and Apple each mint their own, and
 * a check that rejected a shape one of them started using tomorrow would be a
 * notification that silently stopped arriving.
 *
 * Flattened into three columns rather than kept as the `jsonb` blob the browser
 * hands over. `slot_times` is jsonb because its KEYS vary; these are three
 * fixed strings, and `not null` on each is a constraint the database can hold
 * that a blob cannot — a subscription missing its `auth` key is one that can
 * never be encrypted for, and it should fail at the insert rather than at
 * 19:00 six weeks later.
 *
 * ## Unique on `(user_id, endpoint)`, not on `endpoint` alone
 *
 * An endpoint identifies a BROWSER, and this app puts two identities in one
 * browser routinely: a demo visitor arrives on the public URL, and the owner
 * signs in on the same phone. Those are two subscriptions to two different
 * accounts, each with its own walk to be unlogged, and a unique constraint on
 * the endpoint alone would make the second one overwrite or reject the first.
 *
 * What the pair does buy is idempotence, which is the point. `pushManager
 * .subscribe()` returns the SAME endpoint every time it is called for a given
 * browser and application server key, so re-subscribing — a second tap, a
 * reinstall, a page reloaded mid-flow — upserts the one row rather than growing
 * a duplicate that would then deliver a second notification for the same day.
 *
 * ## `last_notified_on`, and why it lives here rather than on the profile
 *
 * P9 caps delivery at "one notification per day maximum". The cap is enforced
 * by writing the sent date and refusing to send again for the same date, and it
 * is per-SUBSCRIPTION because a person with a phone and a laptop has two, and
 * both should ring once. A profile-level "last notified" would silence the
 * second device for the rest of the day the first one was reached.
 *
 * A calendar date rather than an instant, in the profile's own zone, so the cap
 * means what a person means by "today" rather than a rolling 24 hours that
 * drifts an hour later every evening.
 *
 * Null until the first successful send. That is the ordinary state of a
 * subscription made this afternoon, not a missing value: nothing has been sent
 * yet, so there is no date to record.
 *
 * ## Nothing here needs cleaning up
 *
 * `ownerId()` cascades, so a demo visitor's subscription is deleted with their
 * account by the reaper (FUEL-42) with nothing added to it. The other way a row
 * dies is the push service reporting 404 or 410 — the browser threw the
 * subscription away — and the scheduled job prunes it on the spot. Neither path
 * needs a retention rule of its own.
 */
export const pushSubscriptions = pgTable(
  "push_subscriptions",
  {
    id: uuid().primaryKey().defaultRandom(),
    userId: ownerId(),

    /** The push service's URL for this browser. Opaque; see above. */
    endpoint: text().notNull(),
    /** The browser's public key, base64url. */
    p256dh: text().notNull(),
    /** The shared auth secret, base64url. */
    auth: text().notNull(),

    createdAt: instant("created_at").notNull().defaultNow(),

    /**
     * The last date a notification was delivered to this browser, in the
     * profile's zone. Null until the first send. See above.
     */
    lastNotifiedOn: calendarDate("last_notified_on"),
  },
  (t) => [uniqueIndex("push_subscriptions_user_endpoint_key").on(t.userId, t.endpoint)],
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

export type ExerciseSet = typeof exerciseSets.$inferSelect;
export type NewExerciseSet = typeof exerciseSets.$inferInsert;

export type WeightLog = typeof weightLogs.$inferSelect;
export type NewWeightLog = typeof weightLogs.$inferInsert;

export type ShoppingCheck = typeof shoppingChecks.$inferSelect;
export type NewShoppingCheck = typeof shoppingChecks.$inferInsert;

export type PushSubscription = typeof pushSubscriptions.$inferSelect;
export type NewPushSubscription = typeof pushSubscriptions.$inferInsert;
