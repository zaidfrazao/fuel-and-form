import { describe, expect, test } from "vitest";

import type { Meal, MealLog, WeightLog, Workout, WorkoutLog } from "./db/schema";
import { buildWeekCsv, type WeekExportInput, weekExportFilename } from "./export-week";
import type { ResolvedDay, ResolvedMeal } from "./resolve-plan";
import type { TrainingSession } from "./resolve-training";

/**
 * The weekly CSV — FUEL-38, PRD § P6.
 *
 * Gated at 100% for `lib/export.ts`'s reason, which applies here twice over:
 * every way this can be wrong produces a VALID FILE. A column that silently
 * reports the plan where it promised what was eaten still opens, still sums,
 * and still looks like a week. The difference is only visible to the person it
 * is sent to — PRD § Target Users' nutrition assistant, who never logs in and
 * has nothing to check it against.
 *
 * So the assertions here are mostly against the WHOLE document, byte for byte,
 * rather than against a parsed row. The bytes are what leaves.
 *
 * ## The three columns are the acceptance criterion
 *
 * P6: "meal export distinguishes planned, actual, and swapped-with for every
 * slot". The cases that matter are the ones where the three DISAGREE — a swap,
 * an unlogged slot, and a slot logged before it was swapped — because a build
 * that simply printed the resolved meal three times passes every test that only
 * uses a week where nothing was changed.
 *
 * ## The fixtures
 *
 * Invented figures throughout, per Testing Strategy § 1.5 — this repository is
 * public and the owner's rows live in the database, never in git.
 */

const USER_ID = "11111111-2222-3333-4444-555555555555";
const MONDAY = "2026-08-17";
const SUNDAY = "2026-08-23";
const EXPORTED_AT = new Date("2026-08-21T09:30:00.000Z");

const OATS: Meal = {
  id: "aaaaaaaa-0000-4000-8000-000000000001",
  userId: USER_ID,
  name: "Oats and whey",
  slotType: "breakfast",
  kcal: 430,
  proteinG: 32,
  fatG: 9,
  carbG: 58,
  method: null,
  notes: null,
  isArchived: false,
};

const CHICKEN: Meal = {
  ...OATS,
  id: "aaaaaaaa-0000-4000-8000-000000000002",
  name: "Chicken rice bowl",
  slotType: "lunch",
  kcal: 610,
  proteinG: 48,
  fatG: 18,
  carbG: 62,
};

const BEEF: Meal = {
  ...OATS,
  id: "aaaaaaaa-0000-4000-8000-000000000003",
  name: "Beef and potato",
  slotType: "lunch",
  kcal: 640,
  proteinG: 45,
  fatG: 22,
  carbG: 60,
};

const PUSH: Workout = {
  id: "bbbbbbbb-0000-4000-8000-000000000001",
  userId: USER_ID,
  name: "Push A",
  type: "strength",
  description: null,
  rotationGroup: null,
  rotationIndex: null,
};

const WALK: Workout = {
  ...PUSH,
  id: "bbbbbbbb-0000-4000-8000-000000000002",
  name: "Daily walk",
  type: "walk",
};

/** A planned slot, as `resolveSlot` answers it. */
function planned(slot: ResolvedMeal["slot"], meal: Meal, source: ResolvedMeal["source"] = "template"): ResolvedMeal {
  return { slot, meal, source, entryId: `entry-${slot}-${source}` };
}

/** One day of the resolved week. */
function day(date: string, meals: ResolvedMeal[] = []): ResolvedDay {
  return { date, meals };
}

/** A scheduled session, as `trainingDay` answers it. */
function session(workout: Workout): TrainingSession {
  return {
    workout,
    source: "fixed",
    entryId: `entry-${workout.id}`,
    kind: workout.type === "walk" ? "walk" : "session",
    exercises: [],
  };
}

function mealLog(over: Partial<MealLog> & Pick<MealLog, "date" | "slot" | "mealId">): MealLog {
  return {
    id: "cccccccc-0000-4000-8000-000000000001",
    userId: USER_ID,
    status: "eaten",
    note: null,
    loggedAt: new Date("2026-08-17T08:00:00.000Z"),
    ...over,
  };
}

function workoutLog(
  over: Partial<WorkoutLog> & Pick<WorkoutLog, "date" | "workoutId">,
): WorkoutLog {
  return {
    id: "dddddddd-0000-4000-8000-000000000001",
    userId: USER_ID,
    status: "done",
    note: null,
    durationMin: null,
    loggedAt: new Date("2026-08-17T18:00:00.000Z"),
    ...over,
  };
}

function weightLog(over: Partial<WeightLog> & Pick<WeightLog, "date" | "weightKg">): WeightLog {
  return {
    id: "eeeeeeee-0000-4000-8000-000000000001",
    userId: USER_ID,
    note: null,
    createdAt: new Date("2026-08-17T07:00:00.000Z"),
    ...over,
  };
}

/** An empty week, which every case below fills in only what it is about. */
function input(over: Partial<WeekExportInput> = {}): WeekExportInput {
  const dates = ["2026-08-17", "2026-08-18", "2026-08-19", "2026-08-20", "2026-08-21", "2026-08-22", SUNDAY];

  return {
    monday: MONDAY,
    timezone: "Europe/London",
    exportedAt: EXPORTED_AT,
    days: dates.map((date) => day(date)),
    templateDays: dates.map((date) => day(date)),
    trainingDays: dates.map((date) => ({ date, sessions: [] })),
    mealLogs: [],
    workoutLogs: [],
    weightLogs: [],
    meals: [OATS, CHICKEN, BEEF],
    workouts: [PUSH, WALK],
    ...over,
  };
}

/** The file as lines, which is how the assertions below want to read it. */
const lines = (csv: string) => csv.split("\r\n");

/** The rows of one section, without its name or its header. */
function section(csv: string, name: string): string[] {
  const all = lines(csv);
  const start = all.indexOf(name);
  const rest = all.slice(start + 2);
  const end = rest.indexOf("");

  return end === -1 ? rest : rest.slice(0, end);
}

describe("the whole document", () => {
  test("is a preamble and three sections, in order", () => {
    const csv = buildWeekCsv(
      input({
        days: [
          day(MONDAY, [planned("breakfast", OATS), planned("lunch", BEEF, "override")]),
          ...["2026-08-18", "2026-08-19", "2026-08-20", "2026-08-21", "2026-08-22", SUNDAY].map((date) => day(date)),
        ],
        templateDays: [
          day(MONDAY, [planned("breakfast", OATS), planned("lunch", CHICKEN)]),
          ...["2026-08-18", "2026-08-19", "2026-08-20", "2026-08-21", "2026-08-22", SUNDAY].map((date) => day(date)),
        ],
        trainingDays: [
          { date: MONDAY, sessions: [session(PUSH), session(WALK)] },
          ...["2026-08-18", "2026-08-19", "2026-08-20", "2026-08-21", "2026-08-22", SUNDAY].map((date) => ({ date, sessions: [] })),
        ],
        mealLogs: [
          mealLog({ date: MONDAY, slot: "breakfast", mealId: OATS.id }),
          mealLog({ id: "cccccccc-0000-4000-8000-000000000002", date: MONDAY, slot: "lunch", mealId: BEEF.id }),
        ],
        workoutLogs: [workoutLog({ date: MONDAY, workoutId: PUSH.id, durationMin: 52 })],
        weightLogs: [
          weightLog({ date: MONDAY, weightKg: 80.4 }),
          weightLog({
            id: "eeeeeeee-0000-4000-8000-000000000002",
            date: "2026-08-19",
            weightKg: 80.1,
            note: "lighter, after a long walk",
          }),
        ],
      }),
    );

    expect(csv).toBe(
      [
        // The preamble. `timezone` is here because a column of bare dates is
        // not readable without it — "2026-08-17" is a day only in some zone.
        "week,2026-08-17",
        "dates,2026-08-17,2026-08-23",
        "timezone,Europe/London",
        "exported_at,2026-08-21T09:30:00.000Z",
        "",
        "weight",
        "date,weight_kg,note",
        "2026-08-17,80.4,",
        // The note's comma is why the field is quoted, end to end.
        '2026-08-19,80.1,"lighter, after a long walk"',
        "",
        "training",
        "date,session,type,scheduled,status,duration_min,note",
        "2026-08-17,Push A,strength,yes,done,52,",
        // Scheduled and never logged: the row is still here, with a blank
        // status. Absent would say the walk was not on the plan.
        "2026-08-17,Daily walk,walk,yes,,,",
        "",
        "meals",
        "date,slot,planned,swapped_with,actual,status,kcal,protein_g,fat_g,carb_g,note",
        "2026-08-17,breakfast,Oats and whey,,Oats and whey,eaten,430,32,9,58,",
        // The swap: three different answers in three columns, which is P6's
        // criterion in one line.
        "2026-08-17,lunch,Chicken rice bowl,Beef and potato,Beef and potato,eaten,640,45,22,60,",
        "",
      ].join("\r\n"),
    );
  });

  test("writes every section for a week with nothing in it", () => {
    // A header with no rows says "nothing was recorded". A missing section is
    // indistinguishable from a broken export by the person opening the file.
    const csv = buildWeekCsv(input());

    expect(lines(csv)).toEqual([
      "week,2026-08-17",
      "dates,2026-08-17,2026-08-23",
      "timezone,Europe/London",
      "exported_at,2026-08-21T09:30:00.000Z",
      "",
      "weight",
      "date,weight_kg,note",
      "",
      "training",
      "date,session,type,scheduled,status,duration_min,note",
      "",
      "meals",
      "date,slot,planned,swapped_with,actual,status,kcal,protein_g,fat_g,carb_g,note",
      "",
    ]);
  });
});

describe("planned, swapped_with and actual", () => {
  test("an untouched slot names the same meal in planned and actual", () => {
    const csv = buildWeekCsv(
      input({
        days: [day(MONDAY, [planned("breakfast", OATS)]), ...[]],
        templateDays: [day(MONDAY, [planned("breakfast", OATS)])],
        mealLogs: [mealLog({ date: MONDAY, slot: "breakfast", mealId: OATS.id })],
      }),
    );

    expect(section(csv, "meals")).toEqual([
      "2026-08-17,breakfast,Oats and whey,,Oats and whey,eaten,430,32,9,58,",
    ]);
  });

  test("an unlogged slot carries the plan's macros and no status", () => {
    // The row is intake that was PLANNED. `status` blank is what separates it
    // from intake that happened, and it is the column the assistant filters on.
    const csv = buildWeekCsv(
      input({
        days: [day(MONDAY, [planned("breakfast", OATS)])],
        templateDays: [day(MONDAY, [planned("breakfast", OATS)])],
      }),
    );

    expect(section(csv, "meals")).toEqual([
      "2026-08-17,breakfast,Oats and whey,,,,430,32,9,58,",
    ]);
  });

  test("a skipped slot names the meal it skipped", () => {
    // Macros and all. The meal is what was NOT eaten, and `status` says so —
    // zeroing the columns would lose the size of the miss, which is the thing a
    // check-in is looking at.
    const csv = buildWeekCsv(
      input({
        days: [day(MONDAY, [planned("breakfast", OATS)])],
        templateDays: [day(MONDAY, [planned("breakfast", OATS)])],
        mealLogs: [
          mealLog({ date: MONDAY, slot: "breakfast", mealId: OATS.id, status: "skipped" }),
        ],
      }),
    );

    expect(section(csv, "meals")).toEqual([
      "2026-08-17,breakfast,Oats and whey,,Oats and whey,skipped,430,32,9,58,",
    ]);
  });

  test("a slot logged before it was swapped keeps both answers", () => {
    // The case the three columns exist for. The log names the meal that was
    // eaten; the override names what the plan says now. A file reporting only
    // the resolved meal would claim the beef was eaten, which it was not.
    const csv = buildWeekCsv(
      input({
        days: [day(MONDAY, [planned("lunch", BEEF, "override")])],
        templateDays: [day(MONDAY, [planned("lunch", CHICKEN)])],
        mealLogs: [mealLog({ date: MONDAY, slot: "lunch", mealId: CHICKEN.id })],
      }),
    );

    expect(section(csv, "meals")).toEqual([
      "2026-08-17,lunch,Chicken rice bowl,Beef and potato,Chicken rice bowl,eaten,610,48,18,62,",
    ]);
  });

  test("a swap into a slot the template leaves empty has no planned meal", () => {
    // An extra meal, today only — `resolveSlot` calls it "a real action". The
    // blank `planned` column is the honest answer: nothing recurring put it
    // there.
    const csv = buildWeekCsv(
      input({
        days: [day(MONDAY, [planned("extra", BEEF, "override")])],
        templateDays: [day(MONDAY)],
      }),
    );

    expect(section(csv, "meals")).toEqual([
      "2026-08-17,extra,,Beef and potato,,,640,45,22,60,",
    ]);
  });

  test("a log on a slot nothing plans is still reported", () => {
    // The template is edited for FUTURE weeks, so a past week resolves against
    // the template as it is today. Dropping this row would delete recorded
    // history from the report.
    const csv = buildWeekCsv(
      input({
        mealLogs: [mealLog({ date: MONDAY, slot: "dinner", mealId: BEEF.id })],
      }),
    );

    expect(section(csv, "meals")).toEqual([
      "2026-08-17,dinner,,,Beef and potato,eaten,640,45,22,60,",
    ]);
  });

  test("a slot with nothing at all is not a row", () => {
    // Eleven empty cells would say the slot exists. For a plan that does not
    // use it, that is not true — and five of them a day is thirty-five rows of
    // nothing in a file someone reads by eye.
    expect(section(buildWeekCsv(input()), "meals")).toEqual([]);
  });

  test("slots are in the order they are eaten", () => {
    // `SLOT_ORDER`, not the order the rows arrived in.
    const csv = buildWeekCsv(
      input({
        days: [
          day(MONDAY, [
            planned("dinner", BEEF),
            planned("breakfast", OATS),
            planned("lunch", CHICKEN),
          ]),
        ],
        templateDays: [
          day(MONDAY, [
            planned("dinner", BEEF),
            planned("breakfast", OATS),
            planned("lunch", CHICKEN),
          ]),
        ],
      }),
    );

    expect(section(csv, "meals").map((row) => row.split(",")[1])).toEqual([
      "breakfast",
      "lunch",
      "dinner",
    ]);
  });
});

describe("a slot logged more than once", () => {
  const twice = (first: Partial<MealLog>, second: Partial<MealLog>) =>
    section(
      buildWeekCsv(
        input({
          mealLogs: [
            mealLog({ date: MONDAY, slot: "breakfast", mealId: OATS.id, ...first }),
            mealLog({ date: MONDAY, slot: "breakfast", mealId: CHICKEN.id, ...second }),
          ],
        }),
      ),
      "meals",
    );

  test("reports the later log", () => {
    // `meal_logs` has no unique constraint — `actions/log.ts` says so and
    // guards with `alreadyLogged` — so a double tap or a retry after a lost
    // response can leave two rows. The most recent decision is the decision,
    // which is the rule undo already works by.
    expect(
      twice(
        { loggedAt: new Date("2026-08-17T08:00:00.000Z") },
        { loggedAt: new Date("2026-08-17T09:00:00.000Z") },
      ),
    ).toEqual(["2026-08-17,breakfast,,,Chicken rice bowl,eaten,610,48,18,62,"]);
  });

  test("reports the later log whichever order the rows arrive in", () => {
    expect(
      twice(
        { loggedAt: new Date("2026-08-17T09:00:00.000Z") },
        { loggedAt: new Date("2026-08-17T08:00:00.000Z") },
      ),
    ).toEqual(["2026-08-17,breakfast,,,Oats and whey,eaten,430,32,9,58,"]);
  });

  test("breaks a tied instant on the id", () => {
    // `logged_at` defaults to `now()`, so two rows written in one statement can
    // share an instant. Without the id the answer would depend on which row was
    // scanned first, and the file would not be reproducible.
    const at = new Date("2026-08-17T08:00:00.000Z");

    expect(
      twice(
        { id: "cccccccc-0000-4000-8000-00000000000a", loggedAt: at },
        { id: "cccccccc-0000-4000-8000-00000000000b", loggedAt: at },
      ),
    ).toEqual(["2026-08-17,breakfast,,,Chicken rice bowl,eaten,610,48,18,62,"]);
  });

  test("breaks a tied instant on the id whichever order the rows arrive in", () => {
    // The same two rows, swapped. A comparator that answered "the second one"
    // rather than "the higher id" passes the case above and fails this one,
    // and the file it produces would depend on the order Postgres returned.
    const at = new Date("2026-08-17T08:00:00.000Z");

    expect(
      twice(
        { id: "cccccccc-0000-4000-8000-00000000000b", loggedAt: at },
        { id: "cccccccc-0000-4000-8000-00000000000a", loggedAt: at },
      ),
    ).toEqual(["2026-08-17,breakfast,,,Oats and whey,eaten,430,32,9,58,"]);
  });
});

describe("the training section", () => {
  test("marks a logged session the week did not schedule", () => {
    const csv = buildWeekCsv(
      input({
        trainingDays: [{ date: MONDAY, sessions: [session(WALK)] }],
        workoutLogs: [
          workoutLog({ date: MONDAY, workoutId: WALK.id, durationMin: 30 }),
          workoutLog({
            id: "dddddddd-0000-4000-8000-000000000002",
            date: MONDAY,
            workoutId: PUSH.id,
            status: "partial",
            note: "squeezed it in",
          }),
        ],
      }),
    );

    expect(section(csv, "training")).toEqual([
      "2026-08-17,Daily walk,walk,yes,done,30,",
      "2026-08-17,Push A,strength,no,partial,,squeezed it in",
    ]);
  });

  test("names a workout the library no longer holds by nothing at all", () => {
    // Defensive: a composite foreign key guarantees the workout exists and the
    // query fetches every one of them. If that ever stops being true, the row
    // still carries the date and the status — the facts the log itself holds —
    // rather than disappearing or throwing.
    const csv = buildWeekCsv(
      input({
        workoutLogs: [workoutLog({ date: MONDAY, workoutId: "gone" })],
      }),
    );

    expect(section(csv, "training")).toEqual(["2026-08-17,,,no,done,,"]);
  });

  test("orders unscheduled sessions by name", () => {
    // Nothing scheduled them, so there is no template order to follow. A name
    // is the only key the reader can see; the id breaks a tie so the order is
    // total.
    const csv = buildWeekCsv(
      input({
        workoutLogs: [
          workoutLog({ date: MONDAY, workoutId: PUSH.id }),
          workoutLog({
            id: "dddddddd-0000-4000-8000-000000000002",
            date: MONDAY,
            workoutId: WALK.id,
          }),
        ],
      }),
    );

    expect(section(csv, "training").map((row) => row.split(",")[1])).toEqual([
      "Daily walk",
      "Push A",
    ]);
  });

  test("sorts an unnamed session first rather than dropping it", () => {
    // Two unscheduled logs, one naming a workout the library no longer holds.
    // The comparator has to cope with a missing name, and the row has to stay:
    // the log is a fact whether or not the thing it names still exists.
    const csv = buildWeekCsv(
      input({
        workoutLogs: [
          workoutLog({ date: MONDAY, workoutId: PUSH.id }),
          workoutLog({
            id: "dddddddd-0000-4000-8000-000000000002",
            date: MONDAY,
            workoutId: "gone",
          }),
        ],
      }),
    );

    expect(section(csv, "training")).toEqual([
      "2026-08-17,,,no,done,,",
      "2026-08-17,Push A,strength,no,done,,",
    ]);
  });

  test("breaks a tie between two sessions of the same name on the id", () => {
    // Two workouts may honestly share a name — `lib/export.ts` makes the same
    // point about meals. Without the second comparator the order would be
    // whatever Postgres returned, and the file would stop being reproducible.
    const twin: Workout = { ...PUSH, id: "bbbbbbbb-0000-4000-8000-00000000000a" };

    const csv = buildWeekCsv(
      input({
        workouts: [twin, PUSH],
        workoutLogs: [
          workoutLog({ date: MONDAY, workoutId: PUSH.id, durationMin: 40 }),
          workoutLog({
            id: "dddddddd-0000-4000-8000-000000000002",
            date: MONDAY,
            workoutId: twin.id,
            durationMin: 55,
          }),
        ],
      }),
    );

    // Ordered by id in byte order, where a digit sorts before a letter — so
    // `...0001` comes first and the 40-minute row leads.
    expect(section(csv, "training")).toEqual([
      "2026-08-17,Push A,strength,no,done,40,",
      "2026-08-17,Push A,strength,no,done,55,",
    ]);
  });

  test("keeps the template's order for what it did schedule", () => {
    // `resolve-training.ts`: the walk is given a `sort_order` that puts it
    // second on days that have a session, because "it is the day's second
    // activity, not its headline". Re-sorting here would overrule the one place
    // that is configured.
    const csv = buildWeekCsv(
      input({
        trainingDays: [{ date: MONDAY, sessions: [session(PUSH), session(WALK)] }],
      }),
    );

    expect(section(csv, "training").map((row) => row.split(",")[1])).toEqual([
      "Push A",
      "Daily walk",
    ]);
  });
});

describe("the week it names", () => {
  test("covers seven days from the Monday, and nothing else", () => {
    // Rows are emitted per date in the week rather than per row handed in, so
    // a log from the week before cannot arrive in a file named for this one.
    const csv = buildWeekCsv(
      input({
        weightLogs: [
          weightLog({ date: "2026-08-16", weightKg: 80.8 }),
          weightLog({ id: "eeeeeeee-0000-4000-8000-00000000000b", date: SUNDAY, weightKg: 79.3 }),
          weightLog({ id: "eeeeeeee-0000-4000-8000-00000000000c", date: "2026-08-24", weightKg: 77.4 }),
        ],
      }),
    );

    expect(section(csv, "weight")).toEqual(["2026-08-23,79.3,"]);
  });

  test("reads the dates from the Monday rather than from the days handed in", () => {
    // A caller that passed the wrong week produces a file with missing rows,
    // never one whose name and contents disagree. The name is what the file is
    // filed by.
    const csv = buildWeekCsv(
      input({
        days: [day("2026-09-07", [planned("breakfast", OATS)])],
        templateDays: [day("2026-09-07", [planned("breakfast", OATS)])],
      }),
    );

    expect(lines(csv)[0]).toBe("week,2026-08-17");
    expect(section(csv, "meals")).toEqual([]);
  });
});

describe("the document is reproducible", () => {
  test("two builds of the same week are byte-identical", () => {
    // What makes a check-in diffable against last week's, and what lets the
    // assertions above compare whole documents at all.
    const twice = () =>
      buildWeekCsv(
        input({
          days: [day(MONDAY, [planned("breakfast", OATS)])],
          templateDays: [day(MONDAY, [planned("breakfast", OATS)])],
          weightLogs: [weightLog({ date: MONDAY, weightKg: 80.4 })],
        }),
      );

    expect(twice()).toBe(twice());
  });

  test("leaves what it was given untouched", () => {
    // `lib/export.ts` sorts arrays it built itself for exactly this reason. The
    // caller's rows are read here and never reordered in place.
    const rows = [
      weightLog({ date: SUNDAY, weightKg: 79.3 }),
      weightLog({ id: "eeeeeeee-0000-4000-8000-00000000000b", date: MONDAY, weightKg: 80.4 }),
    ];
    const before = [...rows];

    buildWeekCsv(input({ weightLogs: rows }));

    expect(rows).toEqual(before);
  });
});

describe("the filename", () => {
  test("is dated by the week's Monday", () => {
    // Not by the day it was downloaded, which is the one difference from
    // `exportFilename`: a backup's question is "when was this taken", a
    // check-in's is "which week is this". Two downloads of one week overwrite
    // rather than accumulate.
    expect(weekExportFilename(MONDAY)).toBe("fuel-form-week-2026-08-17.csv");
  });

  test("shares the stem the JSON export uses", () => {
    expect(weekExportFilename(MONDAY).startsWith("fuel-form-")).toBe(true);
  });
});
