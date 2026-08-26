import { getTableName, is } from "drizzle-orm";
import { PgTable } from "drizzle-orm/pg-core";
import { describe, expect, test } from "vitest";

import * as schema from "./db/schema";
import type {
  DayPlanOverride,
  Meal,
  MealIngredient,
  MealLog,
  PlanTemplateEntry,
  Profile,
  ShoppingCheck,
  TrainingTemplateEntry,
  Workout,
  WorkoutExercise,
  WorkoutLog,
  WeightLog,
} from "./db/schema";
import { startOfWeek } from "./date";
import {
  buildExport,
  type ExportTables,
  exportFilename,
  SCHEMA_VERSION,
} from "./export";
import { buildWeekCsv } from "./export-week";
import { type Plan, resolveWeek, templateDay } from "./resolve-plan";

/**
 * The export document — FUEL-37, PRD § P6.
 *
 * Gated at 100% for a reason the other gated files do not share: every way this
 * can be wrong produces a VALID FILE. A missing table, a row that kept its
 * `user_id`, an array in whatever order Postgres returned — each one downloads,
 * opens, parses, and looks exactly like a backup. The failure is discovered
 * when someone tries to restore from it, which is the one moment there is
 * nothing to fall back on.
 *
 * ## The two assertions that carry the criteria
 *
 * "Runs against the logged-in account only" is `tests/integration/export.test.ts`,
 * because scoping is a property of the statements rather than of the shaping.
 * What is asserted HERE is the half that is not about the database: that no row
 * carries a `user_id` out of the account, checked against the serialized text
 * rather than the object, because the text is what leaves.
 *
 * "A stable, documented schema" is asserted as byte-identity: the same rows
 * built twice produce the same string, and rows fed in scrambled order produce
 * the same string as rows fed in order. A schema that is stable per RUN is what
 * makes a backup diffable against last week's.
 *
 * ## The fixtures
 *
 * Invented figures throughout, per Testing Strategy § 1.5 — this repository is
 * public and the owner's real rows live in the database, never in git.
 */

const USER_ID = "11111111-2222-3333-4444-555555555555";
const MEAL_ID = "aaaaaaaa-0000-4000-8000-000000000001";
const WORKOUT_ID = "bbbbbbbb-0000-4000-8000-000000000001";

const ACCOUNT = {
  id: USER_ID,
  kind: "owner" as const,
  displayName: "Sam Rivera",
  timezone: "Europe/London",
};

const EXPORTED_AT = new Date("2026-08-21T09:30:00.000Z");

const profile: Profile = {
  userId: USER_ID,
  heightCm: 172,
  startWeightKg: 84.2,
  targetWeightKg: 76,
  goalPaceKgPerWeek: 0.5,
  targetKcal: 1780,
  targetProteinG: 148,
  targetFatG: 50,
  targetCarbG: 185,
  slotTimes: { breakfast: "07:30" },
  workoutTimes: { circuit: "06:30" },
  programStartDate: "2026-06-01",
  timezone: "Europe/London",
};

const meal = (id: string, name: string): Meal => ({
  id,
  userId: USER_ID,
  name,
  slotType: "breakfast",
  kcal: 420,
  proteinG: 30,
  fatG: 12,
  carbG: 44,
  method: null,
  notes: null,
  isArchived: false,
});

const ingredient = (id: string, sortOrder: number): MealIngredient => ({
  id,
  userId: USER_ID,
  mealId: MEAL_ID,
  name: "oats",
  grams: 60,
  nonScaleMeasure: null,
  category: "grains",
  sortOrder,
});

const templateEntry = (id: string, dayOfWeek: 0 | 1 | 2): PlanTemplateEntry => ({
  id,
  userId: USER_ID,
  dayOfWeek,
  slot: "breakfast",
  mealId: MEAL_ID,
  sortOrder: 0,
});

const override = (id: string, date: string): DayPlanOverride => ({
  id,
  userId: USER_ID,
  date,
  slot: "lunch",
  mealId: MEAL_ID,
  createdAt: new Date("2026-08-10T06:00:00.000Z"),
});

const mealLog = (id: string, date: string): MealLog => ({
  id,
  userId: USER_ID,
  date,
  slot: "dinner",
  mealId: MEAL_ID,
  status: "eaten",
  note: null,
  loggedAt: new Date("2026-08-10T18:40:00.000Z"),
});

const workout = (id: string, name: string): Workout => ({
  id,
  userId: USER_ID,
  name,
  type: "circuit",
  description: null,
  rotationGroup: "circuit",
  rotationIndex: 0,
});

const exercise = (id: string, sortOrder: number): WorkoutExercise => ({
  id,
  userId: USER_ID,
  workoutId: WORKOUT_ID,
  name: "push-ups",
  prescription: "3 x 12",
  sortOrder,
  notes: null,
});

const trainingEntry = (id: string, dayOfWeek: 0 | 1 | 2): TrainingTemplateEntry => ({
  id,
  userId: USER_ID,
  dayOfWeek,
  workoutId: WORKOUT_ID,
  rotationGroup: "circuit",
  sortOrder: 0,
});

const workoutLog = (id: string, date: string): WorkoutLog => ({
  id,
  userId: USER_ID,
  date,
  workoutId: WORKOUT_ID,
  status: "done",
  note: null,
  durationMin: 32,
  loggedAt: new Date("2026-08-10T06:35:00.000Z"),
});

const shoppingCheck = (id: string, weekStart: string, itemKey: string): ShoppingCheck => ({
  id,
  userId: USER_ID,
  weekStart,
  itemKey,
  checkedAt: new Date("2026-08-10T07:05:00.000Z"),
});

const weightLog = (id: string, date: string): WeightLog => ({
  id,
  userId: USER_ID,
  date,
  weightKg: 80.1,
  note: null,
  createdAt: new Date("2026-08-10T05:30:00.000Z"),
});

/** An account with one row in every table. */
const TABLES: ExportTables = {
  profile,
  meals: [meal(MEAL_ID, "Overnight oats")],
  mealIngredients: [ingredient("cccccccc-0000-4000-8000-000000000001", 0)],
  planTemplateEntries: [templateEntry("dddddddd-0000-4000-8000-000000000001", 1)],
  dayPlanOverrides: [override("eeeeeeee-0000-4000-8000-000000000001", "2026-08-10")],
  mealLogs: [mealLog("ffffffff-0000-4000-8000-000000000001", "2026-08-10")],
  workouts: [workout(WORKOUT_ID, "Circuit A")],
  workoutExercises: [exercise("aaaaaaaa-0000-4000-8000-000000000002", 0)],
  trainingTemplateEntries: [trainingEntry("bbbbbbbb-0000-4000-8000-000000000002", 1)],
  workoutLogs: [workoutLog("cccccccc-0000-4000-8000-000000000002", "2026-08-10")],
  weightLogs: [weightLog("dddddddd-0000-4000-8000-000000000002", "2026-08-10")],
  shoppingChecks: [
    shoppingCheck("eeeeeeee-0000-4000-8000-000000000002", "2026-08-10", "rolled oats"),
  ],
};

/** Every table empty — a user set up but with nothing logged yet. */
const EMPTY: ExportTables = {
  profile,
  meals: [],
  mealIngredients: [],
  planTemplateEntries: [],
  dayPlanOverrides: [],
  mealLogs: [],
  workouts: [],
  workoutExercises: [],
  trainingTemplateEntries: [],
  workoutLogs: [],
  weightLogs: [],
  shoppingChecks: [],
};

const build = (tables: ExportTables = TABLES) =>
  buildExport({ account: ACCOUNT, exportedAt: EXPORTED_AT, tables });

describe("the document", () => {
  test("leads with the schema version", () => {
    // First in the object and therefore first in the file: a reader learns
    // which version it holds from the opening bytes, before parsing a document
    // it does not yet know how to read.
    const document = build();

    expect(Object.keys(document)[0]).toBe("schemaVersion");
    expect(document.schemaVersion).toBe(SCHEMA_VERSION);
  });

  test("names the account once, and stamps when the file was made", () => {
    const document = build();

    expect(document.account).toEqual(ACCOUNT);
    expect(document.exportedAt).toBe("2026-08-21T09:30:00.000Z");
  });

  test("carries every user-owned table", () => {
    // P6 calls this the backup. Logs alone cannot restore an account, because
    // each one names a meal or workout that would no longer exist.
    const document = build();

    for (const key of [
      "profile",
      "meals",
      "mealIngredients",
      "planTemplateEntries",
      "dayPlanOverrides",
      "mealLogs",
      "workouts",
      "workoutExercises",
      "trainingTemplateEntries",
      "workoutLogs",
      "weightLogs",
    ] as const) {
      expect(document[key]).toBeDefined();
    }
  });

  test("keeps every table key when the account is empty", () => {
    // Empty arrays rather than absent keys: a reader should not have to tell
    // "no weigh-ins" apart from "this file predates weigh-ins".
    const document = build(EMPTY);

    expect(document.meals).toEqual([]);
    expect(document.weightLogs).toEqual([]);
    expect(document.workoutLogs).toEqual([]);
    expect(document.profile).toBeDefined();
  });
});

describe("what leaves the account", () => {
  test("strips user_id from every row, in the text that actually leaves", () => {
    // Asserted against the serialized file rather than the object, because the
    // string is what crosses the wire. A field hiding behind a getter or a
    // nested object would pass an object-shaped assertion and still ship.
    const text = JSON.stringify(build());

    expect(text).not.toContain("userId");
    expect(text).not.toContain("user_id");
    // The account's own id is still there — once — so the assertion above
    // cannot pass by exporting an empty document.
    expect(text).toContain(USER_ID);
    expect(text.split(USER_ID).length - 1).toBe(1);
  });

  test("keeps the ids that hold the file together", () => {
    // Deliberately unlike `/weight`'s payload narrowing. A backup whose logs
    // cannot find their meals is a heap of rows that still looks complete.
    const document = build();

    expect(document.meals[0]?.id).toBe(MEAL_ID);
    expect(document.mealLogs[0]?.mealId).toBe(MEAL_ID);
    expect(document.mealIngredients[0]?.mealId).toBe(MEAL_ID);
    expect(document.workoutLogs[0]?.workoutId).toBe(WORKOUT_ID);
    expect(document.workoutExercises[0]?.workoutId).toBe(WORKOUT_ID);
  });

  test("writes every instant as an ISO string", () => {
    const document = build();

    expect(document.mealLogs[0]?.loggedAt).toBe("2026-08-10T18:40:00.000Z");
    expect(document.workoutLogs[0]?.loggedAt).toBe("2026-08-10T06:35:00.000Z");
    expect(document.weightLogs[0]?.createdAt).toBe("2026-08-10T05:30:00.000Z");
    expect(document.dayPlanOverrides[0]?.createdAt).toBe("2026-08-10T06:00:00.000Z");
  });

  test("leaves calendar dates as the plain strings they are stored as", () => {
    // `date` columns arrive as `YYYY-MM-DD` and must not pass through a `Date`
    // on the way out — `new Date("2026-08-10")` is the 9th in New York, which
    // is the bug `lib/date.ts` exists to prevent.
    const document = build();

    expect(document.weightLogs[0]?.date).toBe("2026-08-10");
    expect(document.profile.programStartDate).toBe("2026-06-01");
  });
});

describe("determinism", () => {
  test("produces identical text for identical rows", () => {
    // The claim stated as an equality. This is what makes a backup diffable
    // against last week's rather than a fresh 900-line change every time.
    expect(JSON.stringify(build())).toBe(JSON.stringify(build()));
  });

  test("orders rows the same way however they arrive", () => {
    const scrambled: ExportTables = {
      ...TABLES,
      meals: [meal("aaaaaaaa-0000-4000-8000-00000000000f", "Zebra bowl"), ...TABLES.meals],
      weightLogs: [
        weightLog("dddddddd-0000-4000-8000-00000000000f", "2026-08-24"),
        ...TABLES.weightLogs,
      ],
    };
    const reversed: ExportTables = {
      ...scrambled,
      meals: [...scrambled.meals].reverse(),
      weightLogs: [...scrambled.weightLogs].reverse(),
    };

    expect(JSON.stringify(build(scrambled))).toBe(JSON.stringify(build(reversed)));
  });

  test("sorts the library by name and the history by date", () => {
    const document = build({
      ...TABLES,
      meals: [meal("aaaaaaaa-0000-4000-8000-00000000000f", "Zebra bowl"), ...TABLES.meals],
      weightLogs: [
        weightLog("dddddddd-0000-4000-8000-00000000000f", "2026-08-24"),
        ...TABLES.weightLogs,
      ],
    });

    expect(document.meals.map((row) => row.name)).toEqual([
      "Overnight oats",
      "Zebra bowl",
    ]);
    expect(document.weightLogs.map((row) => row.date)).toEqual([
      "2026-08-10",
      "2026-08-24",
    ]);
  });

  test("breaks a tie on id rather than leaving it to the caller's order", () => {
    // Two meals may honestly share a name, and two logs a date. Without the
    // tie-break the file would be stable per run and different between runs,
    // which is the version of "deterministic" that is no use at all.
    const first = meal("aaaaaaaa-0000-4000-8000-000000000003", "Same name");
    const second = meal("aaaaaaaa-0000-4000-8000-000000000004", "Same name");

    const forwards = build({ ...TABLES, meals: [first, second] });
    const backwards = build({ ...TABLES, meals: [second, first] });

    expect(forwards.meals.map((row) => row.id)).toEqual([first.id, second.id]);
    expect(JSON.stringify(forwards)).toBe(JSON.stringify(backwards));
  });

  test("sorts by the row's own key, not by the caller's array", () => {
    // Ingredients within a meal read in their prescribed order, and template
    // entries by weekday — the orders a person expects when they open the file.
    const document = build({
      ...TABLES,
      mealIngredients: [
        ingredient("cccccccc-0000-4000-8000-00000000000b", 2),
        ingredient("cccccccc-0000-4000-8000-00000000000a", 1),
      ],
      planTemplateEntries: [
        templateEntry("dddddddd-0000-4000-8000-00000000000b", 2),
        templateEntry("dddddddd-0000-4000-8000-00000000000a", 0),
      ],
      trainingTemplateEntries: [
        trainingEntry("bbbbbbbb-0000-4000-8000-00000000000b", 2),
        trainingEntry("bbbbbbbb-0000-4000-8000-00000000000a", 0),
      ],
      workoutExercises: [
        exercise("aaaaaaaa-0000-4000-8000-00000000000b", 2),
        exercise("aaaaaaaa-0000-4000-8000-00000000000a", 1),
      ],
      workouts: [workout("bbbbbbbb-0000-4000-8000-00000000000c", "Aardvark")],
      dayPlanOverrides: [
        override("eeeeeeee-0000-4000-8000-00000000000b", "2026-08-24"),
        override("eeeeeeee-0000-4000-8000-00000000000a", "2026-08-03"),
      ],
      mealLogs: [
        mealLog("ffffffff-0000-4000-8000-00000000000b", "2026-08-24"),
        mealLog("ffffffff-0000-4000-8000-00000000000a", "2026-08-03"),
      ],
      workoutLogs: [
        workoutLog("cccccccc-0000-4000-8000-00000000000c", "2026-08-24"),
        workoutLog("cccccccc-0000-4000-8000-00000000000d", "2026-08-03"),
      ],
    });

    expect(document.mealIngredients.map((row) => row.sortOrder)).toEqual([1, 2]);
    expect(document.planTemplateEntries.map((row) => row.dayOfWeek)).toEqual([0, 2]);
    expect(document.trainingTemplateEntries.map((row) => row.dayOfWeek)).toEqual([0, 2]);
    expect(document.workoutExercises.map((row) => row.sortOrder)).toEqual([1, 2]);
    expect(document.workouts.map((row) => row.name)).toEqual(["Aardvark"]);
    expect(document.dayPlanOverrides.map((row) => row.date)).toEqual([
      "2026-08-03",
      "2026-08-24",
    ]);
    expect(document.mealLogs.map((row) => row.date)).toEqual(["2026-08-03", "2026-08-24"]);
    expect(document.workoutLogs.map((row) => row.date)).toEqual([
      "2026-08-03",
      "2026-08-24",
    ]);
  });

  test("does not reorder the caller's own arrays", () => {
    // The route hands rows straight from the query layer, but the contract is
    // the one `weight-chart.ts` keeps: a module that sorts its argument in
    // place is a module that reorders somebody else's state.
    const meals = [meal("aaaaaaaa-0000-4000-8000-00000000000f", "Zebra bowl"), ...TABLES.meals];
    const before = meals.map((row) => row.name);

    build({ ...TABLES, meals });

    expect(meals.map((row) => row.name)).toEqual(before);
  });
});

describe("the filename", () => {
  test("is the dated name P6 asks for", () => {
    expect(exportFilename("2026-08-10")).toBe("fuel-form-2026-08-10.json");
  });
});

describe("drift", () => {
  /**
   * Every table `schema.ts` exports, by its SQL name — `schema.test.ts`'s own
   * enumeration, for the same reason it widens to `unknown[]` first: the module
   * also exports enums and types, and TypeScript will not narrow that union
   * down to the generic `PgTable` the drizzle helpers want.
   */
  const tableNames = (Object.values(schema) as unknown[])
    .filter((value): value is PgTable => is(value, PgTable))
    .map(getTableName);

  /**
   * `users` is the one table deliberately not exported wholesale.
   *
   * Its columns belong to the session layer — `expires_at` is P7's reaper's —
   * so four chosen fields cross as `account` instead. On the exclusion list
   * rather than quietly absent, because that is the difference between a
   * decision and an oversight.
   */
  const EXCLUDED = new Set(["users"]);

  /**
   * Where a table's key is not just its name in camel case.
   *
   * One entry, and it earns itself: `profiles` holds exactly one row per user —
   * `user_id` is its primary key, which schema.ts calls "a schema fact rather
   * than something the app has to remember" — so the document carries a single
   * `profile` object rather than an array of one. A plural key would promise a
   * collection that cannot exist.
   *
   * A map rather than a looser match, because the looser match is what this
   * whole test is guarding against: `profiles`/`profile` and a table genuinely
   * forgotten are the same thing to a comparison that ignores the ending.
   */
  const ALIAS: Record<string, string> = { profiles: "profile" };

  const key = (name: string) => ALIAS[name] ?? camel(name);

  test("exports every table in the schema, or names why not", () => {
    // The failure this guards against is the only one that would look like
    // nothing: a table added to `schema.ts` in some later task and never added
    // here. The export would keep working, keep parsing, and quietly stop being
    // a backup — discovered at a restore, which is the one moment there is no
    // second copy. This test turns that into a red suite on the commit that
    // adds the table.
    const document = build();
    const exported = new Set(Object.keys(document));

    const missing = tableNames.filter(
      (name) => !EXCLUDED.has(name) && !exported.has(key(name)),
    );

    expect(missing).toEqual([]);
  });

  test("the exclusion list names a table that exists", () => {
    // So a rename in `schema.ts` cannot leave a stale exemption behind that
    // silently excuses a table nobody meant to exclude.
    for (const name of EXCLUDED) {
      expect(tableNames).toContain(name);
    }
  });
});

/** `meal_ingredients` → `mealIngredients`, the document's own key spelling. */
function camel(snake: string): string {
  return snake.replace(/_([a-z])/g, (_match, letter: string) => letter.toUpperCase());
}

describe("every tie-break", () => {
  /**
   * Builds with the two rows the WRONG way round and asserts the export put
   * them right.
   *
   * One case per component of every sort chain, because a chain is only as
   * ordered as its least-exercised link: a `||` whose left side always decides
   * is a tie-break nothing has ever run.
   *
   * ## The ids are deliberately the wrong way round
   *
   * Every chain ends on `id`, so a test whose ids happen to agree with the
   * natural key passes even when the natural comparator is deleted — the
   * tie-break silently produces the same answer. That is not a hypothetical:
   * the first version of this block asserted the date ordering of
   * `dayPlanOverrides` with ascending ids, and removing the date comparator
   * entirely left every assertion green.
   *
   * So wherever a NATURAL key is meant to decide, the row that must come first
   * carries the LATER id (`HI`), and the expected order is therefore the
   * reverse of id order. Drop the comparator under test and the tie-break
   * returns the pair reversed, which fails. Where the id itself is the last
   * link, the rows are identical but for it and the expected order is plain.
   */
  const inOrder = <K extends keyof ExportTables>(
    table: K,
    rows: [unknown, unknown],
    expected: [string, string],
  ) => {
    const document = build({ ...TABLES, [table]: [rows[1], rows[0]] } as ExportTables);
    const ids = (document[table as keyof typeof document] as { id: string }[]).map(
      (row) => row.id,
    );

    expect(ids).toEqual(expected);
  };

  /** Sorts LAST by id, and is given to the row that must come FIRST. */
  const HI = "ffffffff-0000-4000-8000-0000000000f9";
  /** Sorts first by id. */
  const LO = "aaaaaaaa-0000-4000-8000-0000000000a1";
  const BY_ID: [string, string] = [LO, HI];
  const AGAINST_ID: [string, string] = [HI, LO];

  test("meals: name, then id", () => {
    inOrder("meals", [meal(HI, "Apple"), meal(LO, "Banana")], AGAINST_ID);
    inOrder("meals", [meal(LO, "Same"), meal(HI, "Same")], BY_ID);
  });

  test("workouts: name, then id", () => {
    inOrder("workouts", [workout(HI, "Circuit A"), workout(LO, "Circuit B")], AGAINST_ID);
    inOrder("workouts", [workout(LO, "Same"), workout(HI, "Same")], BY_ID);
  });

  test("mealIngredients: meal, then sort order, then id", () => {
    const otherMeal = {
      ...ingredient(LO, 0),
      mealId: "ffffffff-0000-4000-8000-00000000000f",
    };

    inOrder("mealIngredients", [ingredient(HI, 0), otherMeal], AGAINST_ID);
    inOrder("mealIngredients", [ingredient(HI, 1), ingredient(LO, 2)], AGAINST_ID);
    inOrder("mealIngredients", [ingredient(LO, 1), ingredient(HI, 1)], BY_ID);
  });

  test("workoutExercises: workout, then sort order, then id", () => {
    const otherWorkout = {
      ...exercise(LO, 0),
      workoutId: "ffffffff-0000-4000-8000-00000000000f",
    };

    inOrder("workoutExercises", [exercise(HI, 0), otherWorkout], AGAINST_ID);
    inOrder("workoutExercises", [exercise(HI, 1), exercise(LO, 2)], AGAINST_ID);
    inOrder("workoutExercises", [exercise(LO, 1), exercise(HI, 1)], BY_ID);
  });

  test("planTemplateEntries: weekday, then slot, then sort order, then id", () => {
    inOrder(
      "planTemplateEntries",
      [templateEntry(HI, 1), templateEntry(LO, 2)],
      AGAINST_ID,
    );
    inOrder(
      "planTemplateEntries",
      [templateEntry(HI, 1), { ...templateEntry(LO, 1), slot: "lunch" as const }],
      AGAINST_ID,
    );
    inOrder(
      "planTemplateEntries",
      [templateEntry(HI, 1), { ...templateEntry(LO, 1), sortOrder: 1 }],
      AGAINST_ID,
    );
    inOrder("planTemplateEntries", [templateEntry(LO, 1), templateEntry(HI, 1)], BY_ID);
  });

  test("trainingTemplateEntries: weekday, then sort order, then id", () => {
    inOrder(
      "trainingTemplateEntries",
      [trainingEntry(HI, 1), trainingEntry(LO, 2)],
      AGAINST_ID,
    );
    inOrder(
      "trainingTemplateEntries",
      [trainingEntry(HI, 1), { ...trainingEntry(LO, 1), sortOrder: 1 }],
      AGAINST_ID,
    );
    inOrder("trainingTemplateEntries", [trainingEntry(LO, 1), trainingEntry(HI, 1)], BY_ID);
  });

  test("dayPlanOverrides: date, then slot, then id", () => {
    inOrder(
      "dayPlanOverrides",
      [override(HI, "2026-08-03"), override(LO, "2026-08-24")],
      AGAINST_ID,
    );
    inOrder(
      "dayPlanOverrides",
      [
        { ...override(HI, "2026-08-03"), slot: "breakfast" as const },
        { ...override(LO, "2026-08-03"), slot: "lunch" as const },
      ],
      AGAINST_ID,
    );
    inOrder(
      "dayPlanOverrides",
      [override(LO, "2026-08-03"), override(HI, "2026-08-03")],
      BY_ID,
    );
  });

  test("mealLogs: date, then slot, then id", () => {
    inOrder("mealLogs", [mealLog(HI, "2026-08-03"), mealLog(LO, "2026-08-24")], AGAINST_ID);
    inOrder(
      "mealLogs",
      [
        { ...mealLog(HI, "2026-08-03"), slot: "breakfast" as const },
        { ...mealLog(LO, "2026-08-03"), slot: "lunch" as const },
      ],
      AGAINST_ID,
    );
    inOrder("mealLogs", [mealLog(LO, "2026-08-03"), mealLog(HI, "2026-08-03")], BY_ID);
  });

  test("workoutLogs: date, then id", () => {
    inOrder(
      "workoutLogs",
      [workoutLog(HI, "2026-08-03"), workoutLog(LO, "2026-08-24")],
      AGAINST_ID,
    );
    inOrder(
      "workoutLogs",
      [workoutLog(LO, "2026-08-03"), workoutLog(HI, "2026-08-03")],
      BY_ID,
    );
  });

  test("weightLogs: date, then id", () => {
    inOrder(
      "weightLogs",
      [weightLog(HI, "2026-08-03"), weightLog(LO, "2026-08-24")],
      AGAINST_ID,
    );
    inOrder("weightLogs", [weightLog(LO, "2026-08-03"), weightLog(HI, "2026-08-03")], BY_ID);
  });

  test("shoppingChecks: week, then item, then id", () => {
    inOrder(
      "shoppingChecks",
      [
        shoppingCheck(HI, "2026-08-03", "onion"),
        shoppingCheck(LO, "2026-08-24", "beef mince"),
      ],
      AGAINST_ID,
    );
    inOrder(
      "shoppingChecks",
      [
        shoppingCheck(HI, "2026-08-03", "beef mince"),
        shoppingCheck(LO, "2026-08-03", "onion"),
      ],
      AGAINST_ID,
    );
    // The last link is unreachable through the unique index — one week cannot
    // hold the same item twice — and is asserted anyway, on this suite's own
    // rule that a chain is only as ordered as its least-exercised link. A
    // database constraint is not a reason to leave a comparator branch nothing
    // has ever run.
    inOrder(
      "shoppingChecks",
      [shoppingCheck(LO, "2026-08-03", "onion"), shoppingCheck(HI, "2026-08-03", "onion")],
      BY_ID,
    );
  });
});

describe("plan versus actual", () => {
  /**
   * PRD § Success Metrics: "planned-versus-actual computable for every day",
   * measured as "export contains both columns for 100% of logged days". The
   * weekly CSV answers that inside the seven days it covers; this section is
   * what answers it for the days outside them.
   *
   * The comparison itself is `plan-vs-actual.test.ts`. What is asserted here is
   * the part that belongs to the document: which dates it covers, what the
   * fields carry, and that adding it left the backup unable to fail.
   */
  const rowsOn = (date: string) =>
    build().derived.planVsActual.filter((row) => row.date === date);

  test("answers all three for a date that was planned, swapped and logged", () => {
    // The fixture's one date: breakfast from the template, lunch swapped,
    // dinner logged. Three slots, three different shapes of answer.
    expect(rowsOn("2026-08-10")).toEqual([
      {
        date: "2026-08-10",
        slot: "breakfast",
        plannedMealId: MEAL_ID,
        swappedWithMealId: null,
        actualMealId: null,
        status: null,
        note: null,
      },
      {
        date: "2026-08-10",
        slot: "lunch",
        plannedMealId: null,
        swappedWithMealId: MEAL_ID,
        actualMealId: null,
        status: null,
        note: null,
      },
      {
        date: "2026-08-10",
        slot: "dinner",
        plannedMealId: null,
        swappedWithMealId: null,
        actualMealId: MEAL_ID,
        status: "eaten",
        note: null,
      },
    ]);
  });

  test("covers a logged day no weekly export would reach", () => {
    // The whole reason the section is in this file. The CSV is one week; a day
    // logged in June is in no week anyone downloads at a check-in in August.
    const document = build({
      ...TABLES,
      mealLogs: [
        mealLog("ffffffff-0000-4000-8000-000000000001", "2026-06-03"),
        mealLog("ffffffff-0000-4000-8000-000000000002", "2026-08-10"),
      ],
    });

    const logged = new Set(document.mealLogs.map((row) => row.date));
    const compared = new Set(document.derived.planVsActual.map((row) => row.date));

    for (const date of logged) expect(compared).toContain(date);
  });

  test("covers a swapped day nothing was eaten on", () => {
    // The same gap read from the other side: the plan changed and no log
    // followed. A section keyed only on logs would drop it.
    const document = build({ ...TABLES, mealLogs: [] });

    expect(document.derived.planVsActual.map((row) => row.date)).toContain("2026-08-10");
  });

  test("says nothing about a date that has neither a log nor a swap", () => {
    // The load-bearing omission. The template recurs forever and the account
    // has no end date, so covering every date since program_start_date would
    // assert an intent for every day between June and now — a backup that
    // invents history.
    const dates = new Set(build().derived.planVsActual.map((row) => row.date));

    expect(dates).toEqual(new Set(["2026-08-10"]));
  });

  test("is nested under `derived` and written last, never beside the tables", () => {
    // Structural, because the caveat is structural. A key that is a peer of
    // `mealLogs` reads as a peer of `mealLogs`; nested and last, "ignore
    // `derived`" is a rule a restorer can follow without knowing what is in it.
    // Position is the cheapest signal a format has, and it is the one a reader
    // who never reached the README still receives.
    const keys = Object.keys(build());

    expect(keys).not.toContain("planVsActual");
    expect(keys.at(-1)).toBe("derived");
  });

  test("says in the file what `planned` is an answer to", () => {
    // `plan_template_entries` carries no timestamps, so the app cannot know
    // what the template said last March: `planned` for a past date is the
    // template as it stands at export time, and editing the template changes
    // it. A reader that keeps this string can tell two exports of the same date
    // apart instead of assuming the earlier one was wrong. Prose in a README
    // reaches nobody holding the file.
    expect(build().derived.plannedIs).toBe("template-as-of-export");
  });

  test("is empty, and still present, for an account with nothing in it", () => {
    // An empty array rather than an absent key, for the reason every other
    // table here keeps one: "nothing was logged" must not read as "this file
    // predates the section".
    expect(build(EMPTY).derived.planVsActual).toEqual([]);
  });

  test("names meals by id, and every id is in the file's own library", () => {
    // Ids rather than names, the rule the rest of the document keeps: a copied
    // meals.name goes stale the moment a meal is renamed, and this file's
    // reader has the library to resolve against.
    const document = build();
    const known = new Set(document.meals.map((row) => row.id));

    const named = document.derived.planVsActual.flatMap((row) =>
      [row.plannedMealId, row.swappedWithMealId, row.actualMealId].filter(
        (id) => id !== null,
      ),
    );

    expect(named).not.toHaveLength(0);
    for (const id of named) expect(known).toContain(id);
  });

  test("reports a day logged before the program started", () => {
    // Nothing is planned before program_start_date, so the template resolves to
    // nothing and the log stands alone. The row is still emitted: it is
    // recorded history, and dropping it would lose a logged day from the one
    // section that claims to cover all of them.
    const document = build({
      ...TABLES,
      dayPlanOverrides: [],
      mealLogs: [mealLog("ffffffff-0000-4000-8000-000000000001", "2026-05-04")],
    });

    expect(document.derived.planVsActual).toEqual([
      {
        date: "2026-05-04",
        slot: "dinner",
        plannedMealId: null,
        swappedWithMealId: null,
        actualMealId: MEAL_ID,
        status: "eaten",
        note: null,
      },
    ]);
  });

  test("orders by date and then by slot, whatever order the rows arrive in", () => {
    // Ordered by construction rather than by a comparator — the dates are
    // sorted and the slots come from the enum — which is what keeps two
    // exports of unchanged data byte-identical.
    const scrambled = build({
      ...TABLES,
      mealLogs: [
        mealLog("ffffffff-0000-4000-8000-000000000002", "2026-08-17"),
        mealLog("ffffffff-0000-4000-8000-000000000001", "2026-06-03"),
      ],
    });

    expect(scrambled.derived.planVsActual.map((row) => `${row.date} ${row.slot}`)).toEqual([
      "2026-06-03 dinner",
      "2026-08-10 breakfast",
      "2026-08-10 lunch",
      "2026-08-17 breakfast",
      "2026-08-17 dinner",
    ]);
  });

  test("still builds a backup when the plan names a meal the file does not carry", () => {
    // resolve-plan's hydrate THROWS on a plan naming a meal it was not given,
    // which is right for a screen and wrong here. This is the file you reach
    // for when something has already gone wrong, and refusing to produce one
    // because a derived convenience could not be computed would lose the rows
    // as well as the reading of them.
    const orphaned = () => build({ ...TABLES, meals: [] });

    expect(orphaned).not.toThrow();

    // The template entry and the override are still in the document above, so
    // the dangling reference is visible rather than reported as "never planned".
    const document = orphaned();

    expect(document.planTemplateEntries).toHaveLength(1);
    expect(document.dayPlanOverrides).toHaveLength(1);
    expect(document.derived.planVsActual).toEqual([
      {
        date: "2026-08-10",
        slot: "dinner",
        plannedMealId: null,
        swappedWithMealId: null,
        actualMealId: null,
        status: "eaten",
        note: null,
      },
    ]);
  });

  test("leaves the tables it is derived from untouched", () => {
    // buildExport's standing promise. This section resolves a plan out of three
    // of them, and resolution sorts template entries to break ties.
    const template = [templateEntry("dddddddd-0000-4000-8000-000000000001", 1)];
    const tables = { ...TABLES, planTemplateEntries: template };

    buildExport({ account: ACCOUNT, exportedAt: EXPORTED_AT, tables });

    expect(tables.planTemplateEntries).toBe(template);
    expect(template).toHaveLength(1);
  });
});

describe("the two exports agree", () => {
  /**
   * The assertion that pays for `plan-vs-actual.ts` existing.
   *
   * Before FUEL-39 the triple lived privately inside the CSV builder. Deriving
   * it a second time for the JSON would have produced two implementations that
   * do not fail together: a `planned` meaning "what the template says" in one
   * file and "what stood after the swap" in the other disagrees only on the
   * swapped days, which are the days the whole feature exists for. Both now
   * render one module's answer, and this is what holds them to it.
   *
   * The fixture is the case where all three genuinely differ — a slot logged,
   * and only afterwards swapped.
   */
  const BEEF_ID = "aaaaaaaa-0000-4000-8000-00000000000b";
  const MONDAY = "2026-08-10";

  const tables: ExportTables = {
    ...TABLES,
    meals: [meal(MEAL_ID, "Overnight oats"), meal(BEEF_ID, "Beef and potato")],
    planTemplateEntries: [templateEntry("dddddddd-0000-4000-8000-000000000001", 1)],
    dayPlanOverrides: [
      {
        ...override("eeeeeeee-0000-4000-8000-000000000001", MONDAY),
        slot: "breakfast",
        mealId: BEEF_ID,
      },
    ],
    mealLogs: [
      {
        ...mealLog("ffffffff-0000-4000-8000-000000000001", MONDAY),
        slot: "breakfast",
        mealId: MEAL_ID,
      },
    ],
  };

  const plan: Plan = {
    programStartDate: profile.programStartDate,
    template: [...tables.planTemplateEntries],
    overrides: [...tables.dayPlanOverrides],
    meals: [...tables.meals],
  };

  /** The meals section of the CSV, as `date|slot -> [planned, swapped, actual]`. */
  const csvTriples = () => {
    const days = resolveWeek(plan, MONDAY);

    const csv = buildWeekCsv({
      monday: startOfWeek(MONDAY),
      timezone: ACCOUNT.timezone,
      exportedAt: EXPORTED_AT,
      days,
      templateDays: days.map((day) => ({
        date: day.date,
        meals: templateDay(plan, day.date),
      })),
      trainingDays: [],
      mealLogs: tables.mealLogs,
      workoutLogs: [],
      weightLogs: [],
      meals: tables.meals,
      workouts: [],
    });

    const lines = csv.split("\n");
    const header = lines.indexOf("date,slot,planned,swapped_with,actual,status,kcal,protein_g,fat_g,carb_g,note");

    // Naive split: no fixture name here contains a comma, and `csv.test.ts`
    // owns quoting. What is being read is the column ORDER, not the escaping.
    return new Map(
      lines
        .slice(header + 1)
        .filter((line) => line !== "")
        .map((line) => line.split(","))
        .map((cells) => [`${cells[0]}|${cells[1]}`, cells.slice(2, 5)]),
    );
  };

  test("name the same planned, swapped-with and actual meals", () => {
    const document = buildExport({ account: ACCOUNT, exportedAt: EXPORTED_AT, tables });
    const names = new Map(document.meals.map((row) => [row.id, row.name]));
    const name = (id: string | null) => (id === null ? "" : (names.get(id) ?? ""));

    const fromCsv = csvTriples();

    // The fixture has to actually exercise the disagreement, or this test
    // passes on a week where every column happens to hold the same meal.
    const swapped = document.derived.planVsActual.find((row) => row.date === MONDAY);

    expect(swapped).toMatchObject({
      slot: "breakfast",
      plannedMealId: MEAL_ID,
      swappedWithMealId: BEEF_ID,
      actualMealId: MEAL_ID,
    });

    expect(fromCsv.size).toBeGreaterThan(0);

    for (const row of document.derived.planVsActual) {
      expect(fromCsv.get(`${row.date}|${row.slot}`)).toEqual([
        name(row.plannedMealId),
        name(row.swappedWithMealId),
        name(row.actualMealId),
      ]);
    }
  });
});
