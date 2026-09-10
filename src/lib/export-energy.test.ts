import { describe, expect, test } from "vitest";

import type {
  ExerciseSet,
  Meal,
  MealLog,
  Profile,
  WeightLog,
  Workout,
  WorkoutExercise,
  WorkoutLog,
} from "./db/schema";
import { sessionEnergy } from "./energy";
import { buildExport, type ExportTables } from "./export";
import { buildWeekCsv, type WeekExportInput } from "./export-week";
import type { ResolvedDay, ResolvedMeal } from "./resolve-plan";

/**
 * The estimate never appears inside a total, a net figure or an allowance —
 * checked against the FILES, not against the imports.
 *
 * PRD § P10: *"The estimate is not subtracted from, added to, or combined with
 * `target_kcal` or any macro total anywhere, the export included."*
 *
 * ## Why this file exists, which is a decision somebody made
 *
 * `energy.convention.test.ts` used to hold that criterion for the export by
 * forbidding `lib/export.ts` and `lib/export-week.ts` from importing
 * `lib/energy.ts` at all. FUEL-97 is the ticket that had to lift the ban — the
 * whole point of § P6 is that the assistant never opens the app, so a figure
 * that exists only on `/training` is a figure the person it was built for will
 * never see.
 *
 * The ban was not deleted and it was not routed around. Nine modules still
 * carry it, the two that left it are named there with a reason each, and this
 * file is what replaced the guarantee for those two.
 *
 * ## What it can prove, and what it cannot
 *
 * An import ban is universal over the source. This is a fixture, so it proves
 * the criterion for the artefacts this fixture produces and no others. That is
 * the honest limit and it is written here rather than discovered later.
 *
 * What it does that no source scan could: it checks the ACTUAL RULE. "Never
 * combined" is a statement about arithmetic, and the ban could only ever assert
 * a proxy for it — a module that never sees an `EnergyRange` cannot combine
 * one, which is true and much stronger than necessary. Here the two artefacts
 * are built with intake figures and a burn range whose every combination is a
 * distinctive number, and then every number in both files is checked against
 * the whole set of them.
 *
 * ## The check is proved before it is trusted
 *
 * A test that passes because it is looking in the wrong place reports CLEAN
 * forever. So the last case here plants a netted figure and asserts the
 * machinery FINDS it, and the cases before it assert that the burn and the
 * intake figures are genuinely present in both files — a build that emitted no
 * estimate at all would satisfy "no combination appears" perfectly.
 *
 * ## The fixtures
 *
 * Invented figures throughout, per Testing Strategy § 1.5. They are chosen, not
 * arbitrary: see `NETTED` for the one property they have to have, and
 * `DURATION_MIN` for a value that was changed to give them it.
 */

const USER_ID = "11111111-2222-3333-4444-555555555555";
const MONDAY = "2026-08-17";
const SUNDAY = "2026-08-23";
const DATES = [
  MONDAY,
  "2026-08-18",
  "2026-08-19",
  "2026-08-20",
  "2026-08-21",
  "2026-08-22",
  SUNDAY,
];
const EXPORTED_AT = new Date("2026-08-21T09:30:00.000Z");

const WORKOUT_ID = "bbbbbbbb-0000-4000-8000-000000000001";
const LOG_ID = "dddddddd-0000-4000-8000-000000000001";

/**
 * The bodyweight the session is costed at, supplied as a weigh-in so it is the
 * same on both sides — `nearestWeight` prefers a reading to the fallback.
 */
const BODYWEIGHT_KG = 80;

/**
 * 34 logged minutes, and it started as 30.
 *
 * At 30 the estimate is 160-270, and 160 minus the two meals' carb total (130)
 * is 30 — so the session's own measured duration would have sat in `NETTED` and
 * the check would have failed on a file that nets nothing. Recorded because the
 * next person to touch these numbers needs to know they are load-bearing rather
 * than decorative.
 */
const DURATION_MIN = 34;

/**
 * What the estimate comes out at: 190 to 310 kcal.
 *
 * 34 minutes over three exercise rows, two of them working — so 22.67 working
 * minutes at the circuit band (5.0-8.0) and 11.33 support minutes at 2.0-3.0,
 * against 80.1kg. 190.6 to 301.8 raw, rounded outward to the 10.
 *
 * Written out rather than recomputed, even though this file may import
 * `lib/energy.ts` and does. `sessionEnergy` is imported for the last case,
 * which needs to plant a figure the app itself would produce; the expected
 * range is a literal because a range recomputed by the function under
 * examination is a range no change to that function can fail.
 */
const BURN = { lowKcal: 190, highKcal: 310 };

/**
 * The walk beside the circuit — § P11's estimate, FUEL-104.
 *
 * ## Why this fixture grew a second session
 *
 * FUEL-104 gave the walk its own estimate, priced off a measured distance, and
 * it reaches the export and nowhere else — Brand Guide § The Route Trace closes
 * the list of what the walk shows on screen, and a burn range is not on it. So
 * these two files are the ONLY place the figure exists outside the model, and
 * with two walks a day it is the estimate they carry most often. A fixture with
 * only a circuit in it would keep passing while the commonest estimate in the
 * file the assistant reads went unchecked.
 *
 * ## The numbers
 *
 * 2.88 km in 40 minutes is 4.32 km/h, inside the 4.0-4.8 km/h bracket whose
 * METs are 3.0 and 3.5. Deliberately not a pace landing ON a table point, where
 * binary rounding decides which bracket it falls in.
 *
 * At `BODYWEIGHT_KG` that is 3.0 x 3.5 x 80 / 200 = 4.2 kcal/min and 4.9 at the
 * top, over 40 minutes: 168 and 196 raw, rounded outward to 160 and 200.
 *
 * These are as load-bearing as `DURATION_MIN` above, and for the same reason —
 * they have to avoid `NETTED`, which now carries the walk's combinations too.
 * The first attempt was a 50-minute walk, whose 210-250 put `250 - 78` — the
 * high bound less the two meals' protein total — exactly on `heightCm`, 172.
 * That is the same trap `DURATION_MIN` records falling into, and it is worth
 * two notes rather than one: these fixtures are numerically tuned, and a walk
 * casually relengthened here will fail this file for a reason that looks
 * nothing like the change that caused it.
 */
const WALK_DURATION_MIN = 40;
const WALK_DISTANCE_M = 2880;
const WALK_STEPS = 3800;
const WALK_BURN = { lowKcal: 160, highKcal: 200 };

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
  walkReminderAt: "19:00",
};

const OATS: Meal = {
  id: "aaaaaaaa-0000-4000-8000-000000000001",
  userId: USER_ID,
  name: "Oats and whey",
  slotType: "breakfast",
  kcal: 511,
  proteinG: 37,
  fatG: 13,
  carbG: 59,
  method: null,
  notes: null,
  isArchived: false,
};

const BEEF: Meal = {
  ...OATS,
  id: "aaaaaaaa-0000-4000-8000-000000000002",
  name: "Beef and potato",
  slotType: "lunch",
  kcal: 643,
  proteinG: 41,
  fatG: 19,
  carbG: 71,
};

const CIRCUIT: Workout = {
  id: WORKOUT_ID,
  userId: USER_ID,
  name: "Full body circuit",
  type: "circuit",
  description: null,
  rotationGroup: null,
  rotationIndex: null,
};

const exercise = (
  id: string,
  sortOrder: number,
  section: string,
): WorkoutExercise => ({
  id,
  userId: USER_ID,
  workoutId: WORKOUT_ID,
  name: `movement ${sortOrder}`,
  prescription: "3 x 11",
  sortOrder,
  notes: null,
  section,
  targetSets: null,
  targetRepsLow: null,
  targetRepsHigh: null,
  mediaKey: null,
  mediaKind: null,
  mediaAlt: null,
  mediaCredit: null,
});

/** Two working rows and a cool-down — the split the estimate apportions by. */
const EXERCISES = [
  exercise("ffffffff-0000-4000-8000-000000000001", 0, "work"),
  exercise("ffffffff-0000-4000-8000-000000000002", 1, "work"),
  exercise("ffffffff-0000-4000-8000-000000000003", 2, "cooldown"),
];

const SETS: ExerciseSet[] = [
  {
    id: "cccccccc-0000-4000-8000-000000000001",
    userId: USER_ID,
    workoutLogId: LOG_ID,
    exerciseId: EXERCISES[0]!.id,
    setIndex: 1,
    reps: 11,
    loadKg: null,
    createdAt: new Date("2026-08-17T18:05:00.000Z"),
  },
];

const WORKOUT_LOG: WorkoutLog = {
  id: LOG_ID,
  userId: USER_ID,
  date: MONDAY,
  workoutId: WORKOUT_ID,
  status: "done",
  note: null,
  durationMin: DURATION_MIN,
  distanceM: null,
  steps: null,
  stepsSource: null,
  loggedAt: new Date("2026-08-17T18:00:00.000Z"),
};

const WALK_ID = "bbbbbbbb-0000-4000-8000-000000000002";
const WALK_LOG_ID = "dddddddd-0000-4000-8000-000000000002";

const WALK: Workout = {
  id: WALK_ID,
  userId: USER_ID,
  name: "Daily walk",
  type: "walk",
  description: null,
  rotationGroup: null,
  rotationIndex: null,
};

/** The walk as it is recorded: a duration, a distance, and a step estimate. */
const WALK_LOG: WorkoutLog = {
  id: WALK_LOG_ID,
  userId: USER_ID,
  date: MONDAY,
  workoutId: WALK_ID,
  status: "done",
  note: null,
  durationMin: WALK_DURATION_MIN,
  distanceM: WALK_DISTANCE_M,
  steps: WALK_STEPS,
  stepsSource: "estimated",
  loggedAt: new Date("2026-08-17T19:00:00.000Z"),
};

const WEIGHT_LOG: WeightLog = {
  id: "eeeeeeee-0000-4000-8000-000000000001",
  userId: USER_ID,
  date: MONDAY,
  weightKg: BODYWEIGHT_KG,
  note: null,
  createdAt: new Date("2026-08-17T07:00:00.000Z"),
};

const mealLog = (
  id: string,
  slot: MealLog["slot"],
  mealId: string,
): MealLog => ({
  id,
  userId: USER_ID,
  date: MONDAY,
  slot,
  mealId,
  status: "eaten",
  note: null,
  loggedAt: new Date("2026-08-17T08:00:00.000Z"),
});

const MEAL_LOGS = [
  mealLog("aaaaaaaa-0000-4000-8000-00000000000a", "breakfast", OATS.id),
  mealLog("aaaaaaaa-0000-4000-8000-00000000000b", "lunch", BEEF.id),
];

const resolved = (slot: ResolvedMeal["slot"], meal: Meal): ResolvedMeal => ({
  slot,
  meal,
  source: "template",
  entryId: `entry-${slot}`,
});

const DAYS: ResolvedDay[] = DATES.map((date) =>
  date === MONDAY
    ? { date, meals: [resolved("breakfast", OATS), resolved("lunch", BEEF)] }
    : { date, meals: [] },
);

const TABLES: ExportTables = {
  profile,
  meals: [OATS, BEEF],
  mealIngredients: [],
  planTemplateEntries: [],
  dayPlanOverrides: [],
  mealLogs: MEAL_LOGS,
  workouts: [CIRCUIT, WALK],
  workoutExercises: EXERCISES,
  trainingTemplateEntries: [],
  workoutLogs: [WORKOUT_LOG, WALK_LOG],
  exerciseSets: SETS,
  weightLogs: [WEIGHT_LOG],
  shoppingChecks: [],
};

const WEEK: WeekExportInput = {
  monday: MONDAY,
  timezone: "Europe/London",
  exportedAt: EXPORTED_AT,
  days: DAYS,
  templateDays: DAYS,
  trainingDays: DATES.map((date) => ({
    date,
    sessions:
      date === MONDAY
        ? [
            {
              workout: CIRCUIT,
              source: "fixed" as const,
              entryId: "entry-circuit",
              kind: "session" as const,
              exercises: EXERCISES,
            },
            {
              workout: WALK,
              source: "fixed" as const,
              entryId: "entry-walk",
              kind: "walk" as const,
              exercises: [],
            },
          ]
        : [],
  })),
  mealLogs: MEAL_LOGS,
  workoutLogs: [WORKOUT_LOG, WALK_LOG],
  weightLogs: [WEIGHT_LOG],
  meals: [OATS, BEEF],
  workouts: [CIRCUIT, WALK],
  exercises: EXERCISES,
  sets: SETS,
  weighIns: [WEIGHT_LOG],
  startWeightKg: profile.startWeightKg,
};

const csv = buildWeekCsv(WEEK);
const document = buildExport({
  account: {
    id: USER_ID,
    kind: "owner",
    displayName: "Owner",
    timezone: profile.timezone,
  },
  exportedAt: EXPORTED_AT,
  tables: TABLES,
});

/**
 * Every number in the CSV, taken a whole cell at a time.
 *
 * A cell rather than a regular expression over the text, because `2026-08-17`
 * would otherwise contribute 2026, 8 and 17 and the check would be about
 * substrings of dates. A netted figure would be a cell.
 *
 * The fixture writes no note and no name containing a comma, so a naive split
 * is exact here — and if that ever stops being true the split produces MORE
 * cells rather than fewer, which cannot hide a number.
 */
function csvNumbers(text: string): Set<number> {
  const found = new Set<number>();

  for (const line of text.split("\r\n")) {
    for (const cell of line.split(",")) {
      if (cell !== "" && Number.isFinite(Number(cell))) found.add(Number(cell));
    }
  }

  return found;
}

/**
 * Every number anywhere in the JSON, however deeply nested — INCLUDING one
 * spelled as a string.
 *
 * The string case is not hypothetical tidiness, and it is the asymmetry an
 * external review pointed at: the CSV scanner above reads numbers out of text
 * because every CSV cell IS text, so a netted figure there is caught whatever
 * it is. This one started by trusting `typeof value === "number"`, which means
 * `"netKcal": "1490"` — a perfectly ordinary thing to write when somebody wants
 * to label or format a figure — would have walked straight through the guard
 * that exists to catch exactly that field.
 *
 * A guard whose two halves disagree about what counts as a number is a guard
 * with a documented way round it. Numeric strings count.
 */
const NUMERIC = /^-?\d+(\.\d+)?$/;

function jsonNumbers(value: unknown, found = new Set<number>()): Set<number> {
  if (typeof value === "number") found.add(value);
  else if (typeof value === "string" && NUMERIC.test(value))
    found.add(Number(value));
  else if (Array.isArray(value))
    for (const item of value) jsonNumbers(item, found);
  else if (value && typeof value === "object") {
    for (const item of Object.values(value)) jsonNumbers(item, found);
  }

  return found;
}

/**
 * Every intake figure in play — the measured side, which the estimate may never
 * be combined with.
 *
 * The four targets, both meals' four macros each, and the sums a reader would
 * form from them. The sums are the important half: no total is written into
 * either artefact today, so "the burn is not inside a total" is only a real
 * assertion if the totals a spreadsheet would compute are in the forbidden set
 * whether or not the file contains them.
 */
const INTAKE = [
  profile.targetKcal,
  profile.targetProteinG,
  profile.targetFatG,
  profile.targetCarbG,
  ...[OATS, BEEF].flatMap((meal) => [
    meal.kcal,
    meal.proteinG,
    meal.fatG,
    meal.carbG,
  ]),
  OATS.kcal + BEEF.kcal,
  OATS.proteinG + BEEF.proteinG,
  OATS.fatG + BEEF.fatG,
  OATS.carbG + BEEF.carbG,
];

/**
 * Every way the estimate could be netted against intake, as a set of numbers.
 *
 * Both bounds against every intake figure, in all three directions: intake
 * minus burn (a "net" or a remaining allowance), intake plus burn (a budget),
 * and burn minus intake (the same mistake inverted).
 *
 * ## The floor, and why it is not a fudge
 *
 * Combinations below 100 are dropped. Three of them exist here — 5, 42 and 60,
 * all from subtracting the burn from a macro GRAM figure — and none of them is
 * a number anybody would compute, while all three are in range of a set index,
 * a rep count, a sort order or a day of the week. Keeping them would trade a
 * class of failure that cannot happen for false positives that can, and a test
 * that cries wolf is a test somebody eventually edits rather than obeys.
 *
 * A netted kcal figure is a kcal-scale number. That is what this is looking for.
 */
const NETTED = new Set(
  INTAKE.flatMap((intake) =>
    // Both estimates in the file, not just the circuit's — FUEL-104.
    [BURN.lowKcal, BURN.highKcal, WALK_BURN.lowKcal, WALK_BURN.highKcal].flatMap((burn) => [
      intake - burn,
      intake + burn,
      burn - intake,
    ]),
  ).filter((value) => value >= 100),
);

describe("the estimate is present in both artefacts", () => {
  /*
   * The half that makes the rest of this file mean something. "No combination
   * appears" is trivially true of a file with no estimate in it.
   */

  test("the weekly CSV carries the range as two labelled columns", () => {
    // The three blanks are FUEL-104's `distance_m`, `steps` and `steps_source`,
    // which a circuit has none of. Spelled out rather than skipped over: they
    // sit between the duration and the burn, so a change to the column order
    // fails here rather than moving what this assertion happens to match.
    expect(csv).toContain(`${DURATION_MIN},,,,${BURN.lowKcal},${BURN.highKcal},`);
    expect(csv).toContain("est_burn_kcal_low,est_burn_kcal_high");
    // The caveat travels in the file, not only in the README.
    expect(csv).toContain("est_burn_is,estimated-not-measured");
  });

  test("the JSON carries the range under `derived`", () => {
    // Both sessions, the walk included — FUEL-104. Ordered as `buildExport`
    // orders them, which is by date then by WORKOUT id. The log ids here sort
    // the same way, so this does not pin that tie-break and is not meant to —
    // `export.test.ts` owns the ordering, and this file owns the arithmetic.
    expect(document.derived.sessionEnergy).toEqual([
      { date: MONDAY, workoutId: WORKOUT_ID, ...BURN },
      { date: MONDAY, workoutId: WALK_ID, ...WALK_BURN },
    ]);
    expect(document.derived.burnIs).toBe("estimated-not-measured");
  });

  test("the walk's own estimate is in both artefacts too", () => {
    /*
     * The non-vacuity half, for the figure FUEL-104 added. Everything below
     * asserts that no COMBINATION of the burn and intake appears; a build that
     * priced the walk at nothing would satisfy that perfectly while quietly
     * dropping § P11's estimate from the file the assistant reads.
     *
     * The walk is priced off its pace, so this also pins the distance and
     * duration reaching the estimate at all: a build that ignored `distance_m`
     * would fall back to the unknown-pace band and produce a different range.
     */
    expect(csvNumbers(csv)).toContain(WALK_BURN.lowKcal);
    expect(csvNumbers(csv)).toContain(WALK_BURN.highKcal);
    expect(jsonNumbers(document)).toContain(WALK_BURN.lowKcal);
    expect(jsonNumbers(document)).toContain(WALK_BURN.highKcal);

    // And the walk's measured figures travel with it, which is the other half
    // of the ticket — a burn with no distance beside it cannot be checked.
    expect(csvNumbers(csv)).toContain(WALK_DISTANCE_M);
    expect(csvNumbers(csv)).toContain(WALK_STEPS);
  });

  test("both files carry the intake figures the estimate must not touch", () => {
    // The other half of non-vacuity: a file with no macros in it would also
    // pass the netting check, and for the same empty reason.
    for (const figure of [OATS.kcal, BEEF.kcal, OATS.proteinG, BEEF.carbG]) {
      expect(csvNumbers(csv)).toContain(figure);
    }

    expect(jsonNumbers(document)).toContain(profile.targetKcal);
  });
});

describe("the estimate is never netted against intake", () => {
  test("no netted figure appears anywhere in the weekly CSV", () => {
    const offenders = [...csvNumbers(csv)].filter((value) => NETTED.has(value));

    expect(offenders).toEqual([]);
  });

  test("no netted figure appears anywhere in the JSON export", () => {
    const offenders = [...jsonNumbers(document)].filter((value) =>
      NETTED.has(value),
    );

    expect(offenders).toEqual([]);
  });

  test("the burn appears in the JSON only under `derived.sessionEnergy`", () => {
    /*
     * Structural, and a different failure from the one above: a build that
     * copied the range onto `workoutLogs` would net nothing and would still
     * have filed a model among the facts. `lib/export.ts` argues that line at
     * length for `planVsActual` and this is the same line for this key.
     */
    const { sessionEnergy: _burn, ...restOfDerived } = document.derived;
    const withoutBurn = { ...document, derived: restOfDerived };
    const numbers = jsonNumbers(withoutBurn);

    expect(numbers).not.toContain(BURN.lowKcal);
    expect(numbers).not.toContain(BURN.highKcal);
  });

  test("only one column in the CSV is a measured kcal, and it is the meals'", () => {
    /*
     * The naming rule, asserted as a property rather than by retyping the four
     * header lines here — two files spelling one literal, each with its own
     * passing test, pin the drift rather than catch it.
     *
     * A spreadsheet is precisely where someone subtracts two columns because
     * they are adjacent, so what has to hold is that the reader can tell which
     * is measured and which is modelled from the header alone.
     */
    const headers = csv
      .split("\r\n")
      .filter((line) => line.includes("date,"))
      .flatMap((line) => line.split(","));

    const kcalColumns = headers.filter((name) => name.includes("kcal"));

    // In file order: the training section comes before the meals section, so
    // the two modelled columns are met first and the measured one last.
    expect(kcalColumns).toEqual([
      "est_burn_kcal_low",
      "est_burn_kcal_high",
      "kcal",
    ]);
    expect(kcalColumns.filter((name) => !name.startsWith("est_"))).toEqual([
      "kcal",
    ]);

    // No column claims to be a net, a remainder or an allowance — the three
    // words a combined figure would arrive under.
    expect(
      headers.filter((name) => /net|remaining|allowance/.test(name)),
    ).toEqual([]);
  });
});

describe("the check itself", () => {
  test("finds a netted figure when one is planted", () => {
    /*
     * A guard is only proven by a plant. This one nets the estimate against the
     * kcal target exactly the way § P10 forbids — a `net_kcal` column holding
     * "what is left of the allowance" — and asserts both halves of the
     * machinery catch it: the number is in `NETTED`, and the scanner finds it
     * in a document that contains it.
     *
     * Without this, every assertion above would pass just as happily if
     * `csvNumbers` returned an empty set, or if `NETTED` were empty because a
     * rename left `INTAKE` unpopulated.
     */
    const planted = `date,net_kcal\r\n${MONDAY},${profile.targetKcal - BURN.lowKcal}\r\n`;

    expect(NETTED).toContain(profile.targetKcal - BURN.lowKcal);
    expect(
      [...csvNumbers(planted)].filter((value) => NETTED.has(value)),
    ).toEqual([profile.targetKcal - BURN.lowKcal]);

    // And the JSON half of the scanner, on the same planted figure nested as
    // deeply as the real document nests its own.
    expect(
      [
        ...jsonNumbers({
          derived: { net: [{ kcal: profile.targetKcal + BURN.highKcal }] },
        }),
      ].filter((value) => NETTED.has(value)),
    ).toEqual([profile.targetKcal + BURN.highKcal]);

    // The same figure spelled as a STRING, which is the way round the JSON
    // scanner used to have. See `jsonNumbers`.
    expect(
      [
        ...jsonNumbers({
          derived: {
            net: [{ kcal: String(profile.targetKcal - BURN.highKcal) }],
          },
        }),
      ].filter((value) => NETTED.has(value)),
    ).toEqual([profile.targetKcal - BURN.highKcal]);
  });

  test("the range this file asserts is the one the app computes", () => {
    /*
     * The one place `sessionEnergy` is called here. `BURN` is a literal
     * everywhere above, so that a change to the model fails these tests rather
     * than silently moving what they assert — but a literal that has drifted
     * from the app is a fixture testing itself, so it is pinned once, here,
     * against the real function.
     */
    expect(
      sessionEnergy({
        type: CIRCUIT.type,
        exercises: EXERCISES,
        sets: SETS,
        durationMin: DURATION_MIN,
        distanceM: null,
        weightKg: BODYWEIGHT_KG,
      }),
    ).toEqual(BURN);
  });
});
