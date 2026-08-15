import { describe, expect, it } from "vitest";

import { addDays, dayOfWeek } from "./date";
import type { TrainingTemplateEntry, Workout } from "./db/schema";
import {
  resolveTraining,
  rotationIndex,
  rotationWorkout,
  type TrainingPlan,
} from "./rotation";

/**
 * Testing Strategy § 1.2 — the eight cases, in order, each named by number.
 *
 * The strategy says case 4 is the one that matters: it is the difference between
 * a deterministic function and one that drifts the first time a session is
 * missed. It is asserted here twice, once for the answer and once for the shape,
 * because the shape is the stronger of the two — a resolver that cannot be
 * HANDED session history cannot come to depend on it later.
 *
 * ## The fixture
 *
 * Program start is Monday 2026-03-02 — the same date resolve-plan.test.ts uses,
 * so the two suites share one calendar and a date checked in either is checked
 * for both. Every weekday named below was verified against it: 2026-03-29 is a
 * Sunday, which fixes the rest.
 *
 *   Mon / Wed / Fri   rotation group 'bodyweight-circuit'
 *   Sun               a fixed walk
 *   Tue / Thu / Sat   nothing
 *
 * The Sunday walk earns its place three times over: it proves fixed and rotated
 * entries coexist, that a fixed entry's days do NOT advance the circuit's
 * counter, and — in case 8 — that the pre-start rule applies to fixed entries
 * too and not only to the rotation arithmetic.
 */

const USER = "user-owner";
const PROGRAM_START = "2026-03-02"; // a Monday
const CIRCUIT = "bodyweight-circuit";

const SUNDAY = 0;
const MONDAY = 1;
const WEDNESDAY = 3;
const FRIDAY = 5;

function workout(id: string, fields: Partial<Workout> = {}): Workout {
  return {
    id,
    userId: USER,
    name: id,
    type: "circuit",
    description: null,
    rotationGroup: null,
    rotationIndex: null,
    ...fields,
  };
}

const CIRCUIT_A = workout("circuit-a", { rotationGroup: CIRCUIT, rotationIndex: 0 });
const CIRCUIT_B = workout("circuit-b", { rotationGroup: CIRCUIT, rotationIndex: 1 });
const CIRCUIT_C = workout("circuit-c", { rotationGroup: CIRCUIT, rotationIndex: 2 });
const WALK = workout("walk", { type: "walk" });

let nextEntryId = 0;

function rotationEntry(day: number, group = CIRCUIT, sortOrder = 0): TrainingTemplateEntry {
  nextEntryId += 1;

  return {
    id: `entry-${nextEntryId}`,
    userId: USER,
    dayOfWeek: day,
    workoutId: null,
    rotationGroup: group,
    sortOrder,
  };
}

function fixedEntry(day: number, workoutId: string, sortOrder = 0): TrainingTemplateEntry {
  nextEntryId += 1;

  return {
    id: `entry-${nextEntryId}`,
    userId: USER,
    dayOfWeek: day,
    workoutId,
    rotationGroup: null,
    sortOrder,
  };
}

const TEMPLATE = [
  rotationEntry(MONDAY),
  rotationEntry(WEDNESDAY),
  rotationEntry(FRIDAY),
  fixedEntry(SUNDAY, "walk"),
];

const PLAN: TrainingPlan = {
  programStartDate: PROGRAM_START,
  template: TEMPLATE,
  workouts: [CIRCUIT_A, CIRCUIT_B, WALK],
};

/** The same plan with Circuit C added — case 7's group of three. */
const PLAN_OF_THREE: TrainingPlan = {
  ...PLAN,
  workouts: [CIRCUIT_A, CIRCUIT_B, CIRCUIT_C, WALK],
};

/** The name of whatever the rotation lands on, for readable expectations. */
const circuitOn = (date: string, plan: TrainingPlan = PLAN) =>
  rotationWorkout(plan, CIRCUIT, date)?.name ?? null;

/**
 * An independent second implementation, deliberately the naive one.
 *
 * Day-by-day from the program start, counting training days as it goes — the
 * definition in the PRD read literally, with none of the closed form's weeks-
 * times-stride arithmetic. It is O(days) and would be the wrong thing to ship,
 * which is exactly what makes it a fair oracle: an off-by-one in the remainder
 * walk or a mishandled week boundary cannot be present in both.
 */
function countByWalking(date: string, days: number[] = [MONDAY, WEDNESDAY, FRIDAY]): number {
  let count = 0;

  for (let cursor = PROGRAM_START; cursor < date; cursor = addDays(cursor, 1)) {
    if (days.includes(dayOfWeek(cursor))) count += 1;
  }

  return count;
}

describe("§ 1.2 case 1 — the program start date itself", () => {
  it("is index 0, Circuit A", () => {
    // No matching day has elapsed yet, so the count is zero. Day zero is the
    // first training day, not the day before it.
    expect(rotationIndex(PLAN, CIRCUIT, PROGRAM_START)).toBe(0);
    expect(circuitOn(PROGRAM_START)).toBe("circuit-a");
  });
});

describe("§ 1.2 case 2 — the first Mon / Wed / Fri", () => {
  it("alternates A / B / A", () => {
    expect(circuitOn("2026-03-02")).toBe("circuit-a"); // Mon
    expect(circuitOn("2026-03-04")).toBe("circuit-b"); // Wed
    expect(circuitOn("2026-03-06")).toBe("circuit-a"); // Fri
  });

  it("does not advance on the days the group does not train", () => {
    // Tuesday sits between A and B and belongs to neither. The index is still
    // defined for it — the count is a property of the date, not of whether
    // anything is scheduled — but it must not have moved.
    expect(rotationIndex(PLAN, CIRCUIT, "2026-03-03")).toBe(1);
    expect(resolveTraining(PLAN, "2026-03-03")).toEqual([]);
  });

  it("is not advanced by the Sunday walk", () => {
    // A fixed entry on another day is not a tick of this group's counter. If it
    // were, the second Monday would come back A and the whole rotation would be
    // one out from then on.
    expect(circuitOn("2026-03-08")).toBe("circuit-b"); // Sunday, mid-rotation
    expect(circuitOn("2026-03-09")).toBe("circuit-b"); // the Monday after it
  });
});

describe("§ 1.2 case 3 — the second week", () => {
  it("continues the rotation rather than resetting on Monday", () => {
    // The contrast is the assertion: same weekday, different answer. A resolver
    // built on startOfWeek would return A for both.
    expect(circuitOn("2026-03-02")).toBe("circuit-a"); // week 1 Monday
    expect(circuitOn("2026-03-09")).toBe("circuit-b"); // week 2 Monday
    expect(circuitOn("2026-03-16")).toBe("circuit-a"); // week 3 Monday
  });

  it("carries the alternation across the week boundary unbroken", () => {
    // Six consecutive sessions spanning two weeks: A B A B A B, with no repeat
    // and no skip where the weeks meet.
    const sessions = ["2026-03-02", "2026-03-04", "2026-03-06", "2026-03-09", "2026-03-11", "2026-03-13"];

    expect(sessions.map((date) => circuitOn(date))).toEqual([
      "circuit-a",
      "circuit-b",
      "circuit-a",
      "circuit-b",
      "circuit-a",
      "circuit-b",
    ]);
  });
});

describe("§ 1.2 case 4 — a session was skipped", () => {
  it("cannot be given session history at all", () => {
    // The structural half, and the stronger one. `TrainingPlan` has exactly
    // three fields and none is a log, and resolution takes the plan and a date.
    // There is no argument through which "what actually happened" could reach
    // this file, so no future change can quietly start consulting it without
    // changing a type this test is watching.
    expect(Object.keys(PLAN).sort()).toEqual(["programStartDate", "template", "workouts"]);
    expect(resolveTraining.length).toBe(2);
    expect(rotationWorkout.length).toBe(3);
  });

  it("gives a skipped Wednesday the same Friday it would have had", () => {
    // The behavioural half. Wednesday 03-04 was Circuit B and went undone;
    // Friday is still A, and the following Monday is still B. A resolver that
    // served "the one after the last one you did" would return B and A here,
    // and would stay one out for the rest of the program.
    expect(circuitOn("2026-03-06")).toBe("circuit-a");
    expect(circuitOn("2026-03-09")).toBe("circuit-b");
  });

  it("gives a fortnight of missed sessions the same answers too", () => {
    // Nothing at all was done between the 4th and the 20th. The 20th is what it
    // always was — the ninth session of the program, whether or not the eight
    // before it happened — because attendance is not an input.
    expect(countByWalking("2026-03-20")).toBe(8);
    expect(circuitOn("2026-03-20")).toBe("circuit-a"); // Fri, week 3
    expect(circuitOn("2026-03-23")).toBe("circuit-b"); // Mon, week 4
  });
});

describe("§ 1.2 case 5 — a date months out", () => {
  it("is deterministic six months ahead", () => {
    // 2026-09-02, a Wednesday, 184 days out.
    expect(rotationIndex(PLAN, CIRCUIT, "2026-09-02")).toBe(countByWalking("2026-09-02") % 2);
    expect(circuitOn("2026-09-02")).toBe("circuit-b");
  });

  it("is deterministic a year out, across both DST transitions", () => {
    // 2027-03-01 is a Monday, 364 days out — 52 exact weeks, so the remainder
    // walk contributes nothing and the week stride carries the whole count.
    // London's clocks changed twice in between and moved neither the count nor
    // the weekday, because none of this arithmetic leaves UTC.
    expect(rotationIndex(PLAN, CIRCUIT, "2027-03-01")).toBe(0);
    expect(circuitOn("2027-03-01")).toBe("circuit-a");
  });

  it("agrees with a day-by-day count on every date of a long span", () => {
    // The drift assertion proper: 120 consecutive dates, closed form against the
    // naive walk. Any error in the week stride or the part-week remainder shows
    // up as a diverging date rather than as a value someone has to notice.
    for (let date = PROGRAM_START; date < "2026-07-01"; date = addDays(date, 1)) {
      expect(rotationIndex(PLAN, CIRCUIT, date)).toBe(countByWalking(date) % 2);
    }
  });

  it("agrees with it for a program that starts mid-week, too", () => {
    // The remainder walk is anchored to the START weekday, and a program that
    // begins on a Thursday is where anchoring it to the query's weekday instead
    // would come apart. 2026-03-05 is a Thursday.
    const thursdayStart: TrainingPlan = { ...PLAN, programStartDate: "2026-03-05" };

    for (let date = "2026-03-05"; date < "2026-05-05"; date = addDays(date, 1)) {
      let count = 0;

      for (let cursor = "2026-03-05"; cursor < date; cursor = addDays(cursor, 1)) {
        if ([MONDAY, WEDNESDAY, FRIDAY].includes(dayOfWeek(cursor))) count += 1;
      }

      expect(rotationIndex(thursdayStart, CIRCUIT, date)).toBe(count % 2);
    }
  });
});

describe("§ 1.2 case 6 — a past date", () => {
  it("gives the answer it gave on the day", () => {
    const onTheDay = circuitOn("2026-03-04");

    // Interleave every other kind of query, including ones far in the future,
    // and ask again. Nothing here memoises or mutates, and this is what says so.
    circuitOn("2027-03-01");
    resolveTraining(PLAN, "2026-12-25");
    rotationIndex(PLAN, CIRCUIT, "2026-09-02");

    expect(circuitOn("2026-03-04")).toBe(onTheDay);
    expect(circuitOn("2026-03-04")).toBe("circuit-b");
  });

  it("does not reorder the caller's arrays while reading them", () => {
    // groupWorkouts sorts, and `sort` is in-place on the array it is called on.
    // Sorting `plan.workouts` itself would be a resolver quietly editing the
    // library it was handed.
    const workouts = [CIRCUIT_B, CIRCUIT_A, WALK];
    const template = [...TEMPLATE];
    const plan: TrainingPlan = { ...PLAN, workouts, template };

    rotationWorkout(plan, CIRCUIT, "2026-03-04");
    resolveTraining(plan, "2026-03-02");

    expect(workouts).toEqual([CIRCUIT_B, CIRCUIT_A, WALK]);
    expect(template).toEqual(TEMPLATE);
  });
});

describe("§ 1.2 case 7 — a rotation group of three", () => {
  it("is modulo 3, not a hardcoded 2", () => {
    expect(circuitOn("2026-03-02", PLAN_OF_THREE)).toBe("circuit-a"); // Mon
    expect(circuitOn("2026-03-04", PLAN_OF_THREE)).toBe("circuit-b"); // Wed
    expect(circuitOn("2026-03-06", PLAN_OF_THREE)).toBe("circuit-c"); // Fri
    expect(circuitOn("2026-03-09", PLAN_OF_THREE)).toBe("circuit-a"); // Mon, wrapped
  });

  it("takes one added row to go from two workouts to three", () => {
    // The PRD's claim that "adding Circuit C is one row with index 2, and the
    // resolver's modulo picks it up with no code change" — the two plans differ
    // by exactly that row, and the same Friday resolves differently.
    expect(circuitOn("2026-03-06")).toBe("circuit-a");
    expect(circuitOn("2026-03-06", PLAN_OF_THREE)).toBe("circuit-c");
  });

  it("resolves a group of one to that one workout, always", () => {
    const soloPlan: TrainingPlan = { ...PLAN, workouts: [CIRCUIT_A, WALK] };

    expect(circuitOn("2026-03-02", soloPlan)).toBe("circuit-a");
    expect(circuitOn("2026-03-04", soloPlan)).toBe("circuit-a");
    expect(rotationIndex(soloPlan, CIRCUIT, "2026-09-02")).toBe(0);
  });
});

describe("§ 1.2 case 8 — a date before the program start", () => {
  it("has no rotation index, and no negative one", () => {
    // The day before, a week before, and a year before. `%` in JavaScript keeps
    // the sign of its left operand, so an unguarded count of -201 over two
    // workouts is -1 — a number, and one that indexes nothing. Asserting the
    // type as well as the value is what says none of these took that path.
    for (const date of ["2026-03-01", "2026-02-25", "2026-02-01", "2025-03-02"]) {
      const index = rotationIndex(PLAN, CIRCUIT, date);

      expect(index).toBeNull();
      expect(typeof index).not.toBe("number");
    }
  });

  it("resolves to nothing rather than throwing", () => {
    expect(rotationWorkout(PLAN, CIRCUIT, "2026-02-23")).toBeNull();
    expect(resolveTraining(PLAN, "2026-02-23")).toEqual([]);
  });

  it("applies to fixed entries as well as rotated ones", () => {
    // 2026-03-01 is the Sunday before the program starts, and the template has
    // a walk on Sundays. Nothing is scheduled before day zero — the rule is
    // about the program, not about the arithmetic.
    expect(dayOfWeek("2026-03-01")).toBe(SUNDAY);
    expect(resolveTraining(PLAN, "2026-03-01")).toEqual([]);
    expect(resolveTraining(PLAN, "2026-03-08")).toHaveLength(1);
  });
});

describe("resolveTraining", () => {
  it("returns the fixed workout a day names outright", () => {
    expect(resolveTraining(PLAN, "2026-03-08")).toEqual([
      { workout: WALK, source: "fixed", entryId: "entry-4" },
    ]);
  });

  it("returns the rotated workout with the entry that produced it", () => {
    expect(resolveTraining(PLAN, "2026-03-04")).toEqual([
      { workout: CIRCUIT_B, source: "rotation", entryId: "entry-2" },
    ]);
  });

  it("returns a day's entries in sort_order, ties broken by id", () => {
    const late = fixedEntry(MONDAY, "walk", 2);
    const circuit = rotationEntry(MONDAY, CIRCUIT, 1);
    const early = fixedEntry(MONDAY, "walk", 1);
    const plan: TrainingPlan = { ...PLAN, template: [late, circuit, early] };
    const resolved = resolveTraining(plan, PROGRAM_START);

    // sort_order 1 twice, then 2. Within the tie, the lower entry id first —
    // total, and the same on every machine, rather than however the rows arrived.
    expect(resolved.map((entry) => entry.entryId)).toEqual([circuit.id, early.id, late.id]);
    expect(resolved.map((entry) => entry.source)).toEqual(["rotation", "fixed", "fixed"]);
  });

  it("skips a rotation entry whose group has no workouts left", () => {
    // 'rotation_group' is free text with no foreign key, so deleting the last
    // Circuit workout leaves this entry pointing at nothing. The Sunday walk
    // still resolves; the orphaned Monday is simply empty.
    const plan: TrainingPlan = { ...PLAN, workouts: [WALK] };

    expect(resolveTraining(plan, PROGRAM_START)).toEqual([]);
    expect(resolveTraining(plan, "2026-03-08")).toHaveLength(1);
  });

  it("throws when a fixed entry names a workout it was not given", () => {
    // A composite foreign key makes this impossible in the database, so it means
    // the caller fetched a partial library — a bug, and a much worse one as a
    // session that silently disappears from the week.
    const plan: TrainingPlan = { ...PLAN, workouts: [CIRCUIT_A, CIRCUIT_B] };

    expect(() => resolveTraining(plan, "2026-03-08")).toThrow(/not in the workouts/);
  });

  it("returns nothing for a day the template does not cover", () => {
    expect(resolveTraining(PLAN, "2026-03-07")).toEqual([]); // a Saturday
  });
});

describe("rotationIndex edges", () => {
  it("counts a weekday named by two entries once", () => {
    // Two rows on the same Wednesday are one training day. Counting them twice
    // would tick the rotation for a day that happens once, and the Friday after
    // would come back B.
    const plan: TrainingPlan = {
      ...PLAN,
      template: [...TEMPLATE, rotationEntry(WEDNESDAY, CIRCUIT, 1)],
    };

    expect(circuitOn("2026-03-06", plan)).toBe("circuit-a");
    expect(rotationIndex(plan, CIRCUIT, "2026-03-09")).toBe(1);
  });

  it("selects by position, so a gap in rotation_index still alternates", () => {
    // (0, 1, 3) — what a group looks like after the workout at index 2 was
    // replaced. A lookup for "the workout whose index is 2" finds nothing here;
    // position finds the third one.
    const gapped: TrainingPlan = {
      ...PLAN,
      workouts: [
        CIRCUIT_A,
        CIRCUIT_B,
        workout("circuit-d", { rotationGroup: CIRCUIT, rotationIndex: 3 }),
      ],
    };

    expect(circuitOn("2026-03-02", gapped)).toBe("circuit-a");
    expect(circuitOn("2026-03-04", gapped)).toBe("circuit-b");
    expect(circuitOn("2026-03-06", gapped)).toBe("circuit-d");
  });

  it("orders a duplicated rotation_index by id rather than by arrival", () => {
    const duplicated = (workouts: Workout[]): TrainingPlan => ({ ...PLAN, workouts });
    const first = workout("circuit-x", { rotationGroup: CIRCUIT, rotationIndex: 1 });
    const second = workout("circuit-y", { rotationGroup: CIRCUIT, rotationIndex: 1 });

    // Same two workouts, opposite order in the array, same answer.
    expect(circuitOn("2026-03-04", duplicated([CIRCUIT_A, first, second]))).toBe("circuit-x");
    expect(circuitOn("2026-03-04", duplicated([CIRCUIT_A, second, first]))).toBe("circuit-x");
  });

  it("treats a null rotation_index as ordering before an explicit one", () => {
    // The column is nullable, and the schema's CHECK only ties it to
    // rotation_group being set. A row that slipped through with a group and no
    // index still has to land somewhere deterministic.
    const unindexed = workout("circuit-z", { rotationGroup: CIRCUIT });
    const alsoUnindexed = workout("circuit-w", { rotationGroup: CIRCUIT });

    // Both orders, because the comparator sees the pair either way round and a
    // null on the right has to be handled as a null on the left is.
    for (const workouts of [[CIRCUIT_B, unindexed], [unindexed, CIRCUIT_B]]) {
      const plan: TrainingPlan = { ...PLAN, workouts };

      expect(circuitOn("2026-03-02", plan)).toBe("circuit-z");
      expect(circuitOn("2026-03-04", plan)).toBe("circuit-b");
    }

    // Two of them, so the id tie-break decides with no index to separate them.
    const plan: TrainingPlan = { ...PLAN, workouts: [unindexed, alsoUnindexed] };

    expect(circuitOn("2026-03-02", plan)).toBe("circuit-w");
    expect(circuitOn("2026-03-04", plan)).toBe("circuit-z");
  });

  it("is null for a group with no workouts in the library", () => {
    expect(rotationIndex(PLAN, "gym-split", PROGRAM_START)).toBeNull();
    expect(rotationWorkout(PLAN, "gym-split", PROGRAM_START)).toBeNull();
  });

  it("is 0 for a group the template never trains on", () => {
    // No matching day can have elapsed, so the count is honestly zero: where the
    // rotation would start if the group were put on the template tomorrow.
    const plan: TrainingPlan = { ...PLAN, template: [fixedEntry(SUNDAY, "walk")] };

    expect(rotationIndex(plan, CIRCUIT, "2026-09-02")).toBe(0);
  });

  it("throws on a malformed date rather than answering", () => {
    expect(() => rotationIndex(PLAN, CIRCUIT, "2026-3-02")).toThrow(/Not a calendar date/);
    expect(() => resolveTraining(PLAN, "2026-02-30")).toThrow(/No such date/);
    expect(() => rotationIndex({ ...PLAN, programStartDate: "" }, CIRCUIT, PROGRAM_START)).toThrow(
      /Not a calendar date/,
    );
  });
});
