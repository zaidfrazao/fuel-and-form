import { describe, expect, it } from "vitest";

import {
  currentExercise,
  isComplete,
  type LoggedSet,
  MAX_REPS,
  MAX_SET_INDEX,
  parseReps,
  parseSetIndex,
  type SetTarget,
  setProgress,
  setRows,
  setsFor,
  targetLabel,
} from "./exercise-set";

/**
 * FUEL-91 — the refusals and the derivations behind § P10's per-set logging.
 *
 * Gated at 100% in vitest.config.mts, and the reason given there is what these
 * tests are shaped around: the refusals fail silently by STORING a bad number,
 * and the derivations fail silently by showing the wrong exercise to somebody
 * holding a phone mid-set. Neither throws.
 */

/** A target as `workout_exercises` stores one. Nulls unless a test says. */
const target = (fields: Partial<SetTarget> = {}): SetTarget => ({
  targetSets: null,
  targetRepsLow: null,
  targetRepsHigh: null,
  ...fields,
});

/** '3 × 12' — a fixed rep target, the commonest shape in the seed. */
const FIXED = target({ targetSets: 3, targetRepsLow: 12, targetRepsHigh: 12 });

/** '3 x 8–15' — a range. */
const RANGE = target({ targetSets: 3, targetRepsLow: 8, targetRepsHigh: 15 });

/** '3 x 30–60 sec' — sets, and nothing this app counts as a rep. */
const HELD = target({ targetSets: 3 });

const set = (setIndex: number, reps = 12): LoggedSet => ({ setIndex, reps });

describe("parseReps", () => {
  it("takes a whole number of reps, as a number or as the string an input sends", () => {
    expect(parseReps(8)).toBe(8);
    expect(parseReps("8")).toBe(8);
  });

  it("refuses a set of no reps", () => {
    // Not a set with a blank field — a set that did not happen, and the way to
    // say that is the absence of a row. `parseDuration` refuses zero for the
    // same reason one table up.
    expect(parseReps(0)).toBeUndefined();
    expect(parseReps("0")).toBeUndefined();
  });

  it("refuses a negative count", () => {
    expect(parseReps(-5)).toBeUndefined();
  });

  it("refuses a fraction", () => {
    // `reps` is an `integer` column, so 8.5 would be ROUNDED by Postgres and
    // come back as a number nobody entered.
    expect(parseReps(8.5)).toBeUndefined();
    expect(parseReps("8.5")).toBeUndefined();
  });

  it("refuses the values a text box can produce that are not numbers", () => {
    expect(parseReps("")).toBeUndefined();
    expect(parseReps("eight")).toBeUndefined();
    expect(parseReps(Number.NaN)).toBeUndefined();
    expect(parseReps(Number.POSITIVE_INFINITY)).toBeUndefined();
    expect(parseReps(null)).toBeUndefined();
    expect(parseReps(undefined)).toBeUndefined();
    expect(parseReps({})).toBeUndefined();
    expect(parseReps(true)).toBeUndefined();
  });

  it("holds the ceiling, and takes the value at it", () => {
    expect(parseReps(MAX_REPS)).toBe(MAX_REPS);
    expect(parseReps(MAX_REPS + 1)).toBeUndefined();
    expect(parseReps(1e9)).toBeUndefined();
  });
});

describe("parseSetIndex", () => {
  it("takes a 1-based ordinal", () => {
    expect(parseSetIndex(1)).toBe(1);
    expect(parseSetIndex("3")).toBe(3);
  });

  it("refuses a zeroth or negative set", () => {
    // The screen prints the ordinal. An index stored as 0 and rendered as 01 is
    // a difference somebody eventually debugs.
    expect(parseSetIndex(0)).toBeUndefined();
    expect(parseSetIndex(-1)).toBeUndefined();
  });

  it("holds the ceiling, and takes the value at it", () => {
    expect(parseSetIndex(MAX_SET_INDEX)).toBe(MAX_SET_INDEX);
    expect(parseSetIndex(MAX_SET_INDEX + 1)).toBeUndefined();
    // The unique index makes `set_index` part of a set's ADDRESS, so an
    // unbounded index is an unbounded number of rows.
    expect(parseSetIndex(1e9)).toBeUndefined();
  });

  it("refuses what is not a whole number", () => {
    expect(parseSetIndex(1.5)).toBeUndefined();
    expect(parseSetIndex("first")).toBeUndefined();
    expect(parseSetIndex(null)).toBeUndefined();
    expect(parseSetIndex(undefined)).toBeUndefined();
    expect(parseSetIndex(Number.NaN)).toBeUndefined();
  });
});

describe("setsFor", () => {
  const SETS = [
    { exerciseId: "b", setIndex: 1, reps: 10 },
    { exerciseId: "a", setIndex: 2, reps: 8 },
    { exerciseId: "a", setIndex: 1, reps: 9 },
  ];

  it("takes one exercise's sets and leaves the rest of the session's", () => {
    expect(setsFor("a", SETS)).toEqual([
      { setIndex: 1, reps: 9 },
      { setIndex: 2, reps: 8 },
    ]);
  });

  it("orders them by index whatever order they arrived in", () => {
    expect(setsFor("a", SETS).map((row) => row.setIndex)).toEqual([1, 2]);
  });

  it("is empty for an exercise nothing was logged against", () => {
    expect(setsFor("c", SETS)).toEqual([]);
  });
});

describe("setRows", () => {
  it("draws the target's rows before anything is logged", () => {
    // What makes a target visible as an offer rather than as a sentence.
    expect(setRows(FIXED, [])).toEqual([
      { index: 1, reps: null },
      { index: 2, reps: null },
      { index: 3, reps: null },
    ]);
  });

  it("fills the rows that have sets and leaves the rest offered", () => {
    // The mock's own state: two logged against a target of three.
    expect(setRows(FIXED, [set(1, 8), set(2, 8)])).toEqual([
      { index: 1, reps: 8 },
      { index: 2, reps: 8 },
      { index: 3, reps: null },
    ]);
  });

  it("offers one more row once the target is met", () => {
    // A fourth set is a thing that happens, and it has to be enterable
    // somewhere.
    expect(setRows(FIXED, [set(1), set(2), set(3)])).toHaveLength(4);
    expect(setRows(FIXED, [set(1), set(2), set(3)]).at(3)).toEqual({
      index: 4,
      reps: null,
    });
  });

  it("gives an exercise with no target a single empty row to start from", () => {
    expect(setRows(target(), [])).toEqual([{ index: 1, reps: null }]);
  });

  it("keeps offering the next row to an exercise with no target", () => {
    expect(setRows(target(), [set(1, 20), set(2, 18)])).toEqual([
      { index: 1, reps: 20 },
      { index: 2, reps: 18 },
      { index: 3, reps: null },
    ]);
  });

  it("keeps a set logged beyond the target, and does not renumber it", () => {
    // A row logged at 4 against a target of 3 keeps its own ordinal: the index
    // is the set's address in the database, not its position in this array.
    const rows = setRows(FIXED, [set(1), set(4, 6)]);

    expect(rows).toHaveLength(4);
    expect(rows.at(3)).toEqual({ index: 4, reps: 6 });
    expect(rows.at(1)).toEqual({ index: 2, reps: null });
  });

  it("never offers a row the action would refuse", () => {
    // The offer is capped where `parseSetIndex` stops. A row the screen draws
    // and the server refuses is a control that reports a failure the reader
    // cannot understand.
    const full = Array.from({ length: MAX_SET_INDEX }, (_row, index) =>
      set(index + 1),
    );

    expect(setRows(target({ targetSets: MAX_SET_INDEX }), full)).toHaveLength(
      MAX_SET_INDEX,
    );
  });
});

describe("isComplete", () => {
  it("is the target met, when there is one", () => {
    expect(isComplete(FIXED, [set(1), set(2)])).toBe(false);
    expect(isComplete(FIXED, [set(1), set(2), set(3)])).toBe(true);
  });

  it("counts a set beyond the target as complete", () => {
    expect(isComplete(FIXED, [set(1), set(2), set(3), set(4)])).toBe(true);
  });

  it("is a single set for an exercise with no target", () => {
    // The asymmetry is deliberate: `setRows` always offers one more row than is
    // filled, so an untargeted exercise is never "full" and a definition that
    // waited for it to be would strand the session on it.
    expect(isComplete(target(), [])).toBe(false);
    expect(isComplete(target(), [set(1, 20)])).toBe(true);
  });

  it("counts sets rather than reps against the target", () => {
    // A target of three sets is met by three sets, whatever was performed in
    // them — § P10 forbids grading, and this is the shape that would start it.
    expect(isComplete(FIXED, [set(1, 1), set(2, 1), set(3, 1)])).toBe(true);
  });
});

describe("currentExercise", () => {
  const EXERCISES = [
    { id: "a", ...FIXED },
    { id: "b", ...RANGE },
    { id: "c", ...HELD },
  ];

  const logged = (exerciseId: string, count: number) =>
    Array.from({ length: count }, (_set, index) => ({
      exerciseId,
      setIndex: index + 1,
      reps: 10,
    }));

  it("is the first exercise before anything is logged", () => {
    expect(currentExercise(EXERCISES, [])).toBe(0);
  });

  it("stays on an exercise whose sets are unfinished", () => {
    expect(currentExercise(EXERCISES, logged("a", 2))).toBe(0);
  });

  it("moves on when an exercise's target is met", () => {
    expect(currentExercise(EXERCISES, logged("a", 3))).toBe(1);
  });

  it("skips back to an exercise left unfinished", () => {
    // Derived from an absolute rather than accumulated: a set removed from the
    // first exercise takes the session back to it, which a stored cursor would
    // not do. That is what makes a reload free.
    expect(currentExercise(EXERCISES, [...logged("a", 2), ...logged("b", 3)])).toBe(0);
  });

  it("holds on the last exercise once every set is logged", () => {
    const everything = [...logged("a", 3), ...logged("b", 3), ...logged("c", 3)];

    // Not `-1`, and not empty. The state is still entered, the reader is still
    // standing in the gym, and the screen emptying itself on the last tick
    // would take away the thing they were looking at.
    expect(currentExercise(EXERCISES, everything)).toBe(2);
  });

  it("is -1 for a session with no exercises", () => {
    expect(currentExercise([], [])).toBe(-1);
  });
});

describe("targetLabel", () => {
  it("names a fixed target once", () => {
    expect(targetLabel(FIXED)).toBe("Target 12");
  });

  it("names a range with an en dash", () => {
    // The figure dash the seed's own prescriptions use, so the two spellings of
    // a range on one screen are the same character.
    expect(targetLabel(RANGE)).toBe("Target 8–15");
  });

  it("says nothing for sets that are not counted in reps", () => {
    // '3 x 30–60 sec' has a set count and no rep target. A label here would be
    // "Target 30–60" against a plank.
    expect(targetLabel(HELD)).toBeNull();
    expect(targetLabel(target())).toBeNull();
  });

  it("says nothing when only one end of the range is known", () => {
    // The check constraint makes the pair move together, so this is a row the
    // database refuses — the guard is here because the type cannot say so.
    expect(targetLabel(target({ targetRepsLow: 8 }))).toBeNull();
    expect(targetLabel(target({ targetRepsHigh: 15 }))).toBeNull();
  });
});

describe("setProgress", () => {
  it("counts against the target when there is one", () => {
    expect(setProgress(FIXED, [set(1), set(2)])).toBe("2 of 3 sets");
  });

  it("counts alone when there is not", () => {
    expect(setProgress(target(), [set(1), set(2)])).toBe("2 sets");
    expect(setProgress(target(), [set(1)])).toBe("1 set");
  });

  it("says nothing at all for an exercise with no sets", () => {
    // What keeps the plan state looking exactly as it did before this ticket on
    // every date nobody trained. "0 of 3 sets" on every row would be reporting
    // an absence, which § Tone of Voice asks an empty state not to do.
    expect(setProgress(FIXED, [])).toBeNull();
    expect(setProgress(target(), [])).toBeNull();
  });

  it("reports more sets than the target rather than capping the count", () => {
    expect(setProgress(FIXED, [set(1), set(2), set(3), set(4)])).toBe("4 of 3 sets");
  });
});
