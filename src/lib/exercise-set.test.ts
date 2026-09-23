import { describe, expect, it } from "vitest";

import {
  currentExercise,
  isComplete,
  lastTimeValue,
  type LoggedSet,
  MAX_REPS,
  MAX_PASSED,
  MAX_SECONDS,
  MAX_SET_INDEX,
  type Moved,
  NOT_MOVED,
  parseMoved,
  parseSetIndex,
  parseSetValue,
  restAfterLog,
  sessionPosition,
  type SetTarget,
  setProgress,
  setsDone,
  setRows,
  setKind,
  setsFor,
  setUnitLine,
  setValue,
  storedSet,
  stepSession,
  stepsByRound,
  targetLabel,
  targetLow,
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
  targetSecondsLow: null,
  targetSecondsHigh: null,
  ...fields,
});

/** '3 × 12' — a fixed rep target, the commonest shape in the seed. */
const FIXED = target({ targetSets: 3, targetRepsLow: 12, targetRepsHigh: 12 });

/** '3 x 8–15' — a range. */
const RANGE = target({ targetSets: 3, targetRepsLow: 8, targetRepsHigh: 15 });

/** '3 x 30–60 sec' — a timed hold: sets of seconds, never reps (FUEL-123). */
const HELD = target({ targetSets: 3, targetSecondsLow: 30, targetSecondsHigh: 60 });

/** A set count and nothing else — what the plank was before FUEL-123. */
const COUNT_ONLY = target({ targetSets: 3 });

const set = (setIndex: number, value = 12): LoggedSet => ({ setIndex, value });

describe("parseSetValue, in reps", () => {
  it("takes a whole number of reps, as a number or as the string an input sends", () => {
    expect(parseSetValue(8, "reps")).toBe(8);
    expect(parseSetValue("8", "reps")).toBe(8);
  });

  it("refuses a set of no reps", () => {
    // Not a set with a blank field — a set that did not happen, and the way to
    // say that is the absence of a row. `parseDuration` refuses zero for the
    // same reason one table up.
    expect(parseSetValue(0, "reps")).toBeUndefined();
    expect(parseSetValue("0", "reps")).toBeUndefined();
  });

  it("refuses a negative count", () => {
    expect(parseSetValue(-5, "reps")).toBeUndefined();
  });

  it("refuses a fraction", () => {
    // `reps` is an `integer` column, so 8.5 would be ROUNDED by Postgres and
    // come back as a number nobody entered.
    expect(parseSetValue(8.5, "reps")).toBeUndefined();
    expect(parseSetValue("8.5", "reps")).toBeUndefined();
  });

  it("refuses the values a text box can produce that are not numbers", () => {
    expect(parseSetValue("", "reps")).toBeUndefined();
    expect(parseSetValue("eight", "reps")).toBeUndefined();
    expect(parseSetValue(Number.NaN, "reps")).toBeUndefined();
    expect(parseSetValue(Number.POSITIVE_INFINITY, "reps")).toBeUndefined();
    expect(parseSetValue(null, "reps")).toBeUndefined();
    expect(parseSetValue(undefined, "reps")).toBeUndefined();
    expect(parseSetValue({}, "reps")).toBeUndefined();
    expect(parseSetValue(true, "reps")).toBeUndefined();
  });

  it("holds the ceiling, and takes the value at it", () => {
    expect(parseSetValue(MAX_REPS, "reps")).toBe(MAX_REPS);
    expect(parseSetValue(MAX_REPS + 1, "reps")).toBeUndefined();
    expect(parseSetValue(1e9, "reps")).toBeUndefined();
  });
});

describe("parseSetValue, in seconds — FUEL-123", () => {
  it("holds seconds to their own ceiling, above the reps one", () => {
    // 1200 is twenty minutes of plank and no rep count anybody performs. One
    // ceiling for both would either refuse the hold or accept the reps.
    expect(parseSetValue(1200, "seconds")).toBe(1200);
    expect(parseSetValue(1200, "reps")).toBeUndefined();
    expect(parseSetValue(MAX_SECONDS, "seconds")).toBe(MAX_SECONDS);
    expect(parseSetValue(MAX_SECONDS + 1, "seconds")).toBeUndefined();
  });

  it("refuses what reps refuse", () => {
    expect(parseSetValue(0, "seconds")).toBeUndefined();
    expect(parseSetValue(-30, "seconds")).toBeUndefined();
    expect(parseSetValue(30.5, "seconds")).toBeUndefined();
    expect(parseSetValue("", "seconds")).toBeUndefined();
    expect(parseSetValue("45", "seconds")).toBe(45);
  });
});

describe("the unit a set is counted in — FUEL-123", () => {
  it("is seconds for a seconds target and reps for everything else", () => {
    expect(setKind(HELD)).toBe("seconds");
    expect(setKind(RANGE)).toBe("reps");
    // No target at all is reps, which is what every set was before timed
    // sets existed — an untargeted row keeps meaning what it meant.
    expect(setKind(COUNT_ONLY)).toBe("reps");
    expect(setKind(target())).toBe("reps");
  });

  it("offers the low end in the exercise's own unit", () => {
    // What the placeholder shows and what an empty tick logs: 30 seconds for
    // the plank, 8 reps for the range, and nothing where there is no target.
    expect(targetLow(HELD)).toBe(30);
    expect(targetLow(RANGE)).toBe(8);
    expect(targetLow(COUNT_ONLY)).toBeNull();
  });

  it("stores a number in its own column and null in the other", () => {
    expect(storedSet("seconds", 45)).toEqual({ reps: null, seconds: 45 });
    expect(storedSet("reps", 12)).toEqual({ reps: 12, seconds: null });
  });

  it("reads a stored set back from whichever column holds it", () => {
    // A row written before FUEL-123 is a reps row, and reads unchanged.
    expect(setValue({ reps: 12, seconds: null })).toBe(12);
    expect(setValue({ reps: null, seconds: 45 })).toBe(45);
    expect(setValue(storedSet("seconds", 45))).toBe(45);
  });

  it("refuses a row holding neither, which the schema never stores", () => {
    expect(() => setValue({ reps: null, seconds: null })).toThrow();
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
    { exerciseId: "b", setIndex: 1, value: 10 },
    { exerciseId: "a", setIndex: 2, value: 8 },
    { exerciseId: "a", setIndex: 1, value: 9 },
  ];

  it("takes one exercise's sets and leaves the rest of the session's", () => {
    expect(setsFor("a", SETS)).toEqual([
      { setIndex: 1, value: 9 },
      { setIndex: 2, value: 8 },
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
      { index: 1, value: null },
      { index: 2, value: null },
      { index: 3, value: null },
    ]);
  });

  it("fills the rows that have sets and leaves the rest offered", () => {
    // The mock's own state: two logged against a target of three.
    expect(setRows(FIXED, [set(1, 8), set(2, 8)])).toEqual([
      { index: 1, value: 8 },
      { index: 2, value: 8 },
      { index: 3, value: null },
    ]);
  });

  it("offers one more row once the target is met", () => {
    // A fourth set is a thing that happens, and it has to be enterable
    // somewhere.
    expect(setRows(FIXED, [set(1), set(2), set(3)])).toHaveLength(4);
    expect(setRows(FIXED, [set(1), set(2), set(3)]).at(3)).toEqual({
      index: 4,
      value: null,
    });
  });

  it("gives an exercise with no target a single empty row to start from", () => {
    expect(setRows(target(), [])).toEqual([{ index: 1, value: null }]);
  });

  it("keeps offering the next row to an exercise with no target", () => {
    expect(setRows(target(), [set(1, 20), set(2, 18)])).toEqual([
      { index: 1, value: 20 },
      { index: 2, value: 18 },
      { index: 3, value: null },
    ]);
  });

  it("keeps a set logged beyond the target, and does not renumber it", () => {
    // A row logged at 4 against a target of 3 keeps its own ordinal: the index
    // is the set's address in the database, not its position in this array.
    const rows = setRows(FIXED, [set(1), set(4, 6)]);

    expect(rows).toHaveLength(4);
    expect(rows.at(3)).toEqual({ index: 4, value: 6 });
    expect(rows.at(1)).toEqual({ index: 2, value: null });
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
      value: 10,
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

describe("stepsByRound", () => {
  it("is a circuit, and nothing else", () => {
    expect(stepsByRound("circuit")).toBe(true);
    // Skipping Intervals + Core keeps its exercise-by-exercise step, and so
    // does a type the app has never seen: `workouts.type` is open text.
    expect(stepsByRound("intervals")).toBe(false);
    expect(stepsByRound("strength")).toBe(false);
  });
});

describe("sessionPosition", () => {
  // Three working exercises of three sets, the circuits' own shape.
  const CIRCUIT = [
    { id: "a", ...FIXED },
    { id: "b", ...RANGE },
    { id: "c", ...HELD },
  ];

  const at = (exerciseId: string, ...indexes: number[]) =>
    indexes.map((setIndex) => ({ exerciseId, setIndex, value: 10 }));

  const where = (sets: ReturnType<typeof at>, exercises = CIRCUIT) =>
    sessionPosition(exercises, sets, true);

  it("starts on the first exercise in round 1 of 3", () => {
    expect(where([])).toEqual({ index: 0, round: 1, rounds: 3 });
  });

  it("moves to the next exercise's set 1 after the first set", () => {
    // The ticket's own case: after squats' set 1, push-ups, not squats' set 2.
    expect(where(at("a", 1))).toEqual({ index: 1, round: 1, rounds: 3 });
  });

  it("begins round 2 at the first exercise after the last one", () => {
    expect(where([...at("a", 1), ...at("b", 1), ...at("c", 1)])).toEqual({
      index: 0,
      round: 2,
      rounds: 3,
    });
  });

  it("walks the middle of a later round", () => {
    expect(where([...at("a", 1, 2), ...at("b", 1, 2), ...at("c", 1)])).toEqual({
      index: 2,
      round: 2,
      rounds: 3,
    });
  });

  it("returns to the gap a removed set leaves", () => {
    // Round 2 under way, then b's set 1 is removed. The position goes back to
    // exactly that gap — and forward again when it is re-logged.
    const midRound2 = [...at("a", 1, 2), ...at("c", 1), ...at("b", 2)];

    expect(where(midRound2)).toEqual({ index: 1, round: 1, rounds: 3 });
    expect(where([...midRound2, ...at("b", 1)])).toEqual({ index: 2, round: 2, rounds: 3 });
  });

  it("is moved by nothing when a set is logged ahead of its round", () => {
    // a's set 3 in round 1 fills no gap. A count would read three sets on a as
    // "a is done", which is the straight-sets reading this replaces.
    expect(where(at("a", 3))).toEqual({ index: 0, round: 1, rounds: 3 });
    expect(where(at("a", 1, 3))).toEqual({ index: 1, round: 1, rounds: 3 });
  });

  it("ignores a set beyond an exercise's target", () => {
    const everything = [...at("a", 1, 2, 3, 4), ...at("b", 1, 2, 3), ...at("c", 1, 2)];

    expect(where(everything)).toEqual({ index: 2, round: 3, rounds: 3 });
  });

  it("drops an exercise with a shorter target out of the later rounds", () => {
    const mixed = [
      { id: "a", ...FIXED },
      { id: "short", ...target({ targetSets: 2 }) },
      { id: "c", ...HELD },
    ];

    // Round 3 goes straight from a to c: "short" had its two rounds.
    expect(where([...at("a", 1, 2, 3), ...at("short", 1, 2), ...at("c", 1, 2)], mixed)).toEqual({
      index: 2,
      round: 3,
      rounds: 3,
    });
  });

  it("gives an untargeted exercise round 1 only", () => {
    const mixed = [{ id: "a", ...FIXED }, { id: "free", ...target() }];

    expect(where(at("a", 1), mixed)).toEqual({ index: 1, round: 1, rounds: 3 });
    expect(where([...at("a", 1), ...at("free", 1)], mixed)).toEqual({
      index: 0,
      round: 2,
      rounds: 3,
    });
    // Not offered again in round 2, even with no set 2.
    expect(where([...at("a", 1, 2), ...at("free", 1)], mixed)).toEqual({
      index: 0,
      round: 3,
      rounds: 3,
    });
  });

  it("holds on the last exercise in the last round once everything is logged", () => {
    const everything = [...at("a", 1, 2, 3), ...at("b", 1, 2, 3), ...at("c", 1, 2, 3)];

    expect(where(everything)).toEqual({ index: 2, round: 3, rounds: 3 });
  });

  it("names no round for a circuit whose exercises have one set each", () => {
    // "Round 1 of 1" would count nothing.
    const once = [{ id: "a", ...target({ targetSets: 1 }) }, { id: "b", ...target() }];

    expect(where(at("a", 1), once)).toEqual({ index: 1, round: null, rounds: null });
  });

  it("is -1 with no round for a session with no exercises", () => {
    expect(where([], [])).toEqual({ index: -1, round: null, rounds: null });
  });

  it("steps exercise by exercise when the session is not a circuit", () => {
    // The same sets, read both ways. Not by round: a stays current until its
    // three sets are in, exactly as `currentExercise` has it.
    const sets = [...at("a", 1), ...at("b", 1)];

    expect(sessionPosition(CIRCUIT, sets, false)).toEqual({
      index: 0,
      round: null,
      rounds: null,
    });
    expect(sessionPosition(CIRCUIT, sets, true)).toEqual({ index: 2, round: 1, rounds: 3 });
  });
});

describe("sessionPosition — the last step", () => {
  it("holds on the last exercise that takes part in the last round", () => {
    // An untargeted exercise last takes part in round 1 only, so "Round 3 of 3"
    // is drawn over the exercise that HAS a round 3, not over one without it.
    const mixed = [{ id: "a", ...FIXED }, { id: "free", ...target() }];
    const sets = [1, 2, 3].map((setIndex) => ({ exerciseId: "a", setIndex, value: 10 }));

    expect(
      sessionPosition(mixed, [...sets, { exerciseId: "free", setIndex: 1, value: 10 }], true),
    ).toEqual({ index: 0, round: 3, rounds: 3 });
  });
});

describe("parseMoved", () => {
  it("reads nothing stored as nothing moved", () => {
    expect(parseMoved(null)).toBe(NOT_MOVED);
  });

  it("reads back what the screen stores", () => {
    const moved: Moved = { passed: ["a#1", "b"], at: "a#1" };

    expect(parseMoved(JSON.stringify(moved))).toEqual(moved);
    expect(parseMoved(JSON.stringify({ passed: [], at: null }))).toEqual(NOT_MOVED);
  });

  it.each([
    ["not JSON", "{"],
    ["a bare value", "3"],
    ["null", "null"],
    ["no passed", JSON.stringify({ at: null })],
    ["passed not an array", JSON.stringify({ passed: "a", at: null })],
    ["a passed key not a string", JSON.stringify({ passed: ["a", 1], at: null })],
    ["at a number", JSON.stringify({ passed: [], at: 2 })],
    ["no at", JSON.stringify({ passed: [] })],
  ])("reads %s as nothing moved", (_case, raw) => {
    expect(parseMoved(raw)).toBe(NOT_MOVED);
  });

  it("reads at most MAX_PASSED passed steps", () => {
    const passed = Array.from({ length: MAX_PASSED + 5 }, (_unused, i) => `x${i}`);
    const read = parseMoved(JSON.stringify({ passed, at: null }));

    expect(read.passed).toHaveLength(MAX_PASSED);
    expect(read.passed[0]).toBe("x0");
  });
});

describe("stepSession — FUEL-120", () => {
  /** Push-ups 3 × 8–15 between squats and lunges: the ticket's own session. */
  const STRAIGHT = [
    { id: "squats", ...FIXED },
    { id: "pushups", ...RANGE },
    { id: "lunges", ...FIXED },
  ];

  const at = (exerciseId: string, ...indexes: number[]) =>
    indexes.map((setIndex) => ({ exerciseId, setIndex, value: 10 }));

  /** Squats done, push-ups two sets of three: the state that had no way on. */
  const SHORT = [...at("squats", 1, 2, 3), ...at("pushups", 1, 2)];

  describe("not by round", () => {
    const step = (sets: ReturnType<typeof at>, moved: Moved, direction: "next" | "previous") =>
      stepSession(STRAIGHT, sets, false, moved, direction);

    it("moves on from an exercise short of its target without a set", () => {
      expect(sessionPosition(STRAIGHT, SHORT, false).index).toBe(1);

      const next = step(SHORT, NOT_MOVED, "next");

      expect(next).toEqual({
        position: { index: 2, round: null, rounds: null },
        moved: { passed: ["pushups"], at: null },
      });
      expect(sessionPosition(STRAIGHT, SHORT, false, next!.moved).index).toBe(2);
    });

    it("stays past the passed exercise once the next one is finished", () => {
      // The derived position must not fall back to push-ups when lunges' last
      // set lands: it holds on lunges, the last step.
      const moved = { passed: ["pushups"], at: null };

      expect(
        sessionPosition(STRAIGHT, [...SHORT, ...at("lunges", 1, 2, 3)], false, moved).index,
      ).toBe(2);
    });

    it("goes back to the passed exercise, where its third set can still be logged", () => {
      const moved = { passed: ["pushups"], at: null };
      const back = step(SHORT, moved, "previous");

      expect(back).toEqual({
        position: { index: 1, round: null, rounds: null },
        moved: { passed: ["pushups"], at: "pushups" },
      });
      expect(sessionPosition(STRAIGHT, SHORT, false, back!.moved).index).toBe(1);
      // Logged there, the reader stays there until they move on.
      expect(
        sessionPosition(STRAIGHT, [...SHORT, ...at("pushups", 3)], false, back!.moved).index,
      ).toBe(1);
    });

    it("goes back to a finished exercise, and Next from it returns to the derived one", () => {
      const back = step(SHORT, NOT_MOVED, "previous");

      expect(back).toEqual({
        position: { index: 0, round: null, rounds: null },
        moved: { passed: [], at: "squats" },
      });

      // Squats is logged, so moving on from it passes nothing, and lands on
      // push-ups, the derived step, by clearing `at`.
      expect(step(SHORT, back!.moved, "next")).toEqual({
        position: { index: 1, round: null, rounds: null },
        moved: { passed: [], at: null },
      });
    });

    it("steps back through every step one at a time, and forward again", () => {
      const moved = { passed: ["pushups"], at: null };
      const once = step(SHORT, moved, "previous")!;
      const twice = step(SHORT, once.moved, "previous")!;

      expect(twice.position.index).toBe(0);
      expect(twice.moved).toEqual({ passed: ["pushups"], at: "squats" });

      // Forward from squats lands on push-ups — still behind the derived
      // lunges, so by going back to it rather than by clearing.
      const forward = step(SHORT, twice.moved, "next")!;

      expect(forward).toEqual({
        position: { index: 1, round: null, rounds: null },
        moved: { passed: ["pushups"], at: "pushups" },
      });
      // A passed step is not passed twice.
      expect(step(SHORT, forward.moved, "next")!.moved).toEqual({
        passed: ["pushups"],
        at: null,
      });
    });

    it("offers no step before the first exercise or after the last", () => {
      expect(step([], NOT_MOVED, "previous")).toBeNull();
      expect(step(SHORT, { passed: ["pushups"], at: null }, "next")).toBeNull();
    });

    it("offers nothing either way for a session with no exercises", () => {
      expect(stepSession([], [], false, NOT_MOVED, "next")).toBeNull();
      expect(stepSession([], [], false, NOT_MOVED, "previous")).toBeNull();
    });

    it("lets the data win over a step gone back to", () => {
      // Back on squats, then a squats set is removed: the derived position is
      // squats itself, so `at` is not BEHIND it and is inert.
      const moved = { passed: [], at: "squats" };

      expect(sessionPosition(STRAIGHT, SHORT, false, moved).index).toBe(0);
      expect(sessionPosition(STRAIGHT, at("squats", 1, 2), false, moved).index).toBe(0);
      // Back on push-ups, then a squats set is removed: the derived position is
      // now squats, BEHIND the step gone back to, and the data wins.
      const onPushups = { passed: ["pushups"], at: "pushups" };
      const squatsShort = [...at("squats", 1, 2), ...at("pushups", 1, 2)];

      expect(sessionPosition(STRAIGHT, squatsShort, false, onPushups).index).toBe(0);
      expect(step(at("squats", 1, 2), moved, "next")).toEqual({
        position: { index: 1, round: null, rounds: null },
        moved: { passed: ["squats"], at: null },
      });
    });

    it("ignores keys for exercises the session no longer has", () => {
      const moved = { passed: ["gone"], at: "also-gone" };

      expect(sessionPosition(STRAIGHT, SHORT, false, moved)).toEqual(
        sessionPosition(STRAIGHT, SHORT, false),
      );
    });

    it("holds on the last step when everything is passed", () => {
      const moved = { passed: ["squats", "pushups", "lunges"], at: null };

      expect(sessionPosition(STRAIGHT, [], false, moved).index).toBe(2);
    });
  });

  describe("by round", () => {
    const CIRCUIT = [
      { id: "a", ...FIXED },
      { id: "b", ...RANGE },
      { id: "c", ...HELD },
    ];

    const step = (sets: ReturnType<typeof at>, moved: Moved, direction: "next" | "previous") =>
      stepSession(CIRCUIT, sets, true, moved, direction);

    it("moves past one exercise's set in a round, not the whole exercise", () => {
      const next = step(at("a", 1), NOT_MOVED, "next")!;

      expect(next).toEqual({
        position: { index: 2, round: 1, rounds: 3 },
        moved: { passed: ["b#1"], at: null },
      });

      // After c's set 1, round 2 starts at a — b's round 1 stays passed, and
      // b is offered again in round 2.
      const later = [...at("a", 1), ...at("c", 1)];

      expect(sessionPosition(CIRCUIT, later, true, next.moved)).toEqual({
        index: 0,
        round: 2,
        rounds: 3,
      });
      expect(sessionPosition(CIRCUIT, [...later, ...at("a", 2)], true, next.moved)).toEqual({
        index: 1,
        round: 2,
        rounds: 3,
      });
    });

    it("goes back across a round boundary", () => {
      const round2 = [...at("a", 1), ...at("b", 1), ...at("c", 1)];

      expect(step(round2, NOT_MOVED, "previous")).toEqual({
        position: { index: 2, round: 1, rounds: 3 },
        moved: { passed: [], at: "c#1" },
      });
    });

    it("steps exactly once past a set logged ahead of its round", () => {
      // b's set 1 is already in. Back on a#1, Next lands on b#1 by going back
      // to it — the derived position is c#1, a step further.
      const sets = [...at("a", 1), ...at("b", 1)];
      const moved = { passed: [], at: "a#1" };

      expect(sessionPosition(CIRCUIT, sets, true, moved)).toEqual({
        index: 0,
        round: 1,
        rounds: 3,
      });
      expect(step(sets, moved, "next")).toEqual({
        position: { index: 1, round: 1, rounds: 3 },
        moved: { passed: [], at: "b#1" },
      });
    });

    it("does not read a straight-sets key in a circuit", () => {
      // The two key spellings never collide, so a key left from one reading
      // names nothing in the other.
      expect(sessionPosition(CIRCUIT, [], true, { passed: ["a"], at: null })).toEqual({
        index: 0,
        round: 1,
        rounds: 3,
      });
    });
  });
});

describe("restAfterLog — FUEL-126", () => {
  const CIRCUIT = [
    { id: "a", ...FIXED },
    { id: "b", ...RANGE },
    { id: "c", ...HELD },
  ];

  const at = (exerciseId: string, ...indexes: number[]) =>
    indexes.map((setIndex) => ({ exerciseId, setIndex, value: 10 }));

  const rest = (
    sets: ReturnType<typeof at>,
    exerciseId: string,
    setIndex: number,
    { byRound = true, moved = NOT_MOVED, exercises = CIRCUIT } = {},
  ) => restAfterLog(exercises, sets, byRound, moved, { exerciseId, setIndex });

  it("rests between exercises when the round goes on", () => {
    expect(rest([], "a", 1)).toBe("exercise");
    expect(rest(at("a", 1), "b", 1)).toBe("exercise");
  });

  it("rests between rounds when the log finishes one", () => {
    expect(rest([...at("a", 1), ...at("b", 1)], "c", 1)).toBe("round");
    expect(rest([...at("a", 1, 2), ...at("b", 1, 2), ...at("c", 1)], "c", 2)).toBe("round");
  });

  it("starts no rest after the session's last set", () => {
    const all = [...at("a", 1, 2, 3), ...at("b", 1, 2, 3), ...at("c", 1, 2)];

    expect(rest(all, "c", 3)).toBeNull();
  });

  it("starts no rest when the session ends on a step logged ahead of its round", () => {
    // c's set 3 was ticked early; b's set 3 is the last open step, and the
    // state lands on c's, which has nothing left to do.
    const all = [...at("a", 1, 2, 3), ...at("b", 1, 2), ...at("c", 1, 2, 3)];

    expect(rest(all, "b", 3)).toBeNull();
  });

  it("starts no rest for a correction, which re-logs a set already there", () => {
    // Round 2 on a: correcting a's set 1, or the set just before the position.
    const sets = [...at("a", 1), ...at("b", 1), ...at("c", 1)];

    expect(rest(sets, "a", 1)).toBeNull();
    expect(rest(sets, "c", 1)).toBeNull();
  });

  it("starts no rest outside a circuit, however the sets stand", () => {
    // Straight sets would otherwise read as "exercise" after a's set 1.
    expect(rest([], "a", 1, { byRound: false })).toBeNull();
    expect(rest(at("a", 1, 2), "a", 3, { byRound: false })).toBeNull();
  });

  it("starts no rest in a circuit with one round, which has no rounds to name", () => {
    const single = [
      { id: "a", ...target({ targetSets: 1, targetRepsLow: 10 }) },
      { id: "b", ...target({ targetSets: 1, targetRepsLow: 10 }) },
    ];

    expect(rest([], "a", 1, { exercises: single })).toBeNull();
  });

  it("starts no rest for a set logged ahead of its round", () => {
    // Round 1 is on b; a's set 2 fills no gap and moves nothing.
    expect(rest(at("a", 1), "a", 2)).toBeNull();
    // Nor for another exercise's set in the current round.
    expect(rest(at("a", 1), "c", 1)).toBeNull();
  });

  it("starts no rest where the state holds a step gone back to", () => {
    // Round 2, gone back to c's round-1 step, which was passed without a log.
    const sets = [...at("a", 1), ...at("b", 1), ...at("a", 2)];
    const moved: Moved = { passed: ["c#1"], at: "c#1" };

    expect(sessionPosition(CIRCUIT, sets, true, moved)).toEqual({
      index: 2,
      round: 1,
      rounds: 3,
    });
    expect(rest(sets, "c", 1, { moved })).toBeNull();
  });

  it("follows a passed step to where the state goes next", () => {
    // b's round-1 step passed, so c's set 1 is the last of round 1.
    const moved: Moved = { passed: ["b#1"], at: null };

    expect(rest(at("a", 1), "c", 1, { moved })).toBe("round");
  });

  it("follows a shorter target out of the later rounds", () => {
    const shorter = [
      { id: "a", ...FIXED },
      { id: "b", ...target({ targetSets: 2, targetRepsLow: 10 }) },
    ];
    const sets = [...at("a", 1, 2), ...at("b", 1, 2)];

    // b has no round 3, so a's set 3 is the last set of all.
    expect(rest(sets, "a", 3, { exercises: shorter })).toBeNull();
    // And a's set 2 in round 2 is followed by b's, within the round.
    expect(rest([...at("a", 1), ...at("b", 1)], "a", 2, { exercises: shorter })).toBe(
      "exercise",
    );
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

  it("names a seconds target with its unit — FUEL-123", () => {
    // A bare "Target 30–60" against a plank reads as reps, which is the bug.
    expect(targetLabel(HELD)).toBe("Target 30–60s");
    expect(targetLabel(target({ targetSecondsLow: 45, targetSecondsHigh: 45 }))).toBe(
      "Target 45s",
    );
  });

  it("says nothing for a set count with no target beside it", () => {
    expect(targetLabel(COUNT_ONLY)).toBeNull();
    expect(targetLabel(target())).toBeNull();
  });

  it("says nothing when only one end of the range is known", () => {
    // The check constraint makes the pair move together, so this is a row the
    // database refuses — the guard is here because the type cannot say so.
    expect(targetLabel(target({ targetRepsLow: 8 }))).toBeNull();
    expect(targetLabel(target({ targetRepsHigh: 15 }))).toBeNull();
    expect(targetLabel(target({ targetSecondsLow: 30 }))).toBeNull();
  });
});

describe("lastTimeValue — FUEL-122", () => {
  it("reads the same set number from last time", () => {
    const previous = [set(1, 10), set(2, 9), set(3, 7)];

    expect(lastTimeValue(1, previous)).toBe(10);
    expect(lastTimeValue(2, previous)).toBe(9);
    expect(lastTimeValue(3, previous)).toBe(7);
  });

  it("matches by set number, not by position", () => {
    // Last time logged sets 1 and 3 and skipped 2. Row 2 has nothing to
    // recall, and row 3 is set 3's figure rather than the second one listed.
    const previous = [set(1, 10), set(3, 7)];

    expect(lastTimeValue(2, previous)).toBeNull();
    expect(lastTimeValue(3, previous)).toBe(7);
  });

  it("gives a row beyond last time's sets nothing", () => {
    expect(lastTimeValue(3, [set(1, 10), set(2, 9)])).toBeNull();
  });

  it("gives a first session nothing", () => {
    expect(lastTimeValue(1, [])).toBeNull();
  });
});

describe("setUnitLine — FUEL-122", () => {
  it("is the unit alone with no last time", () => {
    // No dash, no zero, no "first time": a row with nothing to recall says
    // exactly what it said before this ticket.
    expect(setUnitLine(RANGE, false, null)).toBe("Target 8–15");
    expect(setUnitLine(RANGE, true, null)).toBe("reps");
    expect(setUnitLine(COUNT_ONLY, false, null)).toBe("reps");
  });

  it("follows the target with last time on a row still on offer", () => {
    expect(setUnitLine(RANGE, false, 10)).toBe("Target 8–15 · 10 last time");
    expect(setUnitLine(FIXED, false, 12)).toBe("Target 12 · 12 last time");
  });

  it("keeps last time once the set is logged", () => {
    // The figure is what the reader compares the number they just wrote
    // against, so it stays after the tick rather than leaving with the target.
    expect(setUnitLine(RANGE, true, 10)).toBe("reps · 10 last time");
  });

  it("names the unit with last time for an exercise with no target", () => {
    expect(setUnitLine(COUNT_ONLY, false, 30)).toBe("reps · 30 last time");
  });

  it("says seconds for a timed hold, and names the unit once — FUEL-123", () => {
    // On offer, logged, and with last time. The target is `30–60s` and the
    // logged unit `sec`; the clause carries no unit of its own, because the
    // line has already said it and the 375 row has no width for a repeat.
    expect(setUnitLine(HELD, false, null)).toBe("Target 30–60s");
    expect(setUnitLine(HELD, true, null)).toBe("sec");
    expect(setUnitLine(HELD, false, 45)).toBe("Target 30–60s · 45 last time");
    expect(setUnitLine(HELD, true, 45)).toBe("sec · 45 last time");
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

describe("setsDone — FUEL-128", () => {
  it("reads the values back in set order, with the unit once", () => {
    expect(setsDone(RANGE, [set(1, 10), set(2, 10), set(3, 8)])).toBe("10 · 10 · 8 reps");
  });

  it("orders by set number, not by the order it was given", () => {
    // A correction re-sends set 1 after set 3, and a reader that trusted the
    // array would recap the session in the order it was typed.
    expect(setsDone(RANGE, [set(3, 8), set(1, 12), set(2, 10)])).toBe("12 · 10 · 8 reps");
  });

  it("says seconds for a timed hold — FUEL-123", () => {
    expect(setsDone(HELD, [set(1, 45), set(2, 40)])).toBe("45 · 40 sec");
  });

  it("is one value for one set, and reps for an exercise with no target", () => {
    expect(setsDone(COUNT_ONLY, [set(1, 20)])).toBe("20 reps");
  });

  it("never counts against the target", () => {
    // § P10: the ratio is the one thing the recap may not say. An extra set is
    // simply a fourth value, not "4 of 3".
    const line = setsDone(FIXED, [set(1), set(2), set(3), set(4)]);

    expect(line).toBe("12 · 12 · 12 · 12 reps");
    expect(line).not.toMatch(/ of |%|\//);
  });

  it("says nothing for an exercise with no sets", () => {
    expect(setsDone(FIXED, [])).toBeNull();
  });
});
