import { describe, expect, it } from "vitest";

import { workoutLogStatus } from "./db/schema";
import {
  isSessionStatus,
  MAX_DURATION_MIN,
  MAX_NOTE_LENGTH,
  parseSessionEntry,
  SESSION_STATUSES,
} from "./session-entry";

/**
 * FUEL-27's refusals — every one of them reachable by anyone who can POST to
 * the app, and every one of them silent if it fails open.
 *
 * The three fields here are the only part of a training write a caller chooses:
 * `actions/training.ts` re-resolves the date and the workout for itself. So
 * this is the whole trust boundary of P3's write path, tested the way
 * `repeat.test.ts` and `cursor.test.ts` test theirs — as input nobody
 * validated, not as values a form produced.
 */

const entry = (input: Parameters<typeof parseSessionEntry>[0]) => parseSessionEntry(input);

describe("the status", () => {
  it("matches the database's own vocabulary", () => {
    // The list is restated as a value so a client component can import this
    // module without pulling pg-core into the bundle. This is what stops the
    // restatement from drifting: a status added to the enum and not here would
    // be refused by the app while Postgres accepted it, silently, forever.
    // Compared as sets: the order here is the screen's — done first, because it
    // is the primary button — and the enum's is the migration's.
    expect([...SESSION_STATUSES].sort()).toEqual([...workoutLogStatus.enumValues].sort());
  });

  it("accepts exactly the three outcomes", () => {
    expect(isSessionStatus("done")).toBe(true);
    expect(isSessionStatus("partial")).toBe(true);
    expect(isSessionStatus("skipped")).toBe(true);
  });

  it("refuses anything else, including the meal log's own vocabulary", () => {
    // 'eaten' is a real status in this schema — on the other log table. A guard
    // that took any string would send it to Postgres as an invalid enum value,
    // which throws, which is a 500 on an endpoint whose contract is that it
    // never throws.
    expect(isSessionStatus("eaten")).toBe(false);
    expect(isSessionStatus("DONE")).toBe(false);
    expect(isSessionStatus("")).toBe(false);
    expect(isSessionStatus(undefined)).toBe(false);
    expect(isSessionStatus(null)).toBe(false);
    expect(isSessionStatus(0)).toBe(false);
    expect(isSessionStatus(["done"])).toBe(false);
    // `includes` on an array of strings would say yes to a prototype property
    // if this were an object lookup instead. It is not, and this is the guard.
    expect(isSessionStatus("toString")).toBe(false);
  });

  it("refuses the whole entry when the status is bad, however good the rest is", () => {
    expect(entry({ status: "finished", note: "felt strong", durationMin: 28 })).toBeNull();
  });
});

describe("the note", () => {
  it("stores what was written, trimmed", () => {
    expect(entry({ status: "done", note: "  8, 8, 6 reps  " })).toEqual({
      status: "done",
      note: "8, 8, 6 reps",
      durationMin: null,
    });
  });

  it("treats absence, emptiness and whitespace as no note", () => {
    // All three are "there is no note", and storing "   " would put an empty
    // line on the screen that nothing explains and no control obviously removes.
    expect(entry({ status: "done" })?.note).toBeNull();
    expect(entry({ status: "done", note: null })?.note).toBeNull();
    expect(entry({ status: "done", note: "" })?.note).toBeNull();
    expect(entry({ status: "done", note: "   \n  " })?.note).toBeNull();
  });

  it("refuses a note past the limit rather than truncating it", () => {
    // Truncation is the tempting answer and the wrong one: the user would see
    // their own sentence come back cut off with nothing to explain why.
    expect(entry({ status: "done", note: "x".repeat(MAX_NOTE_LENGTH) })?.note).toHaveLength(
      MAX_NOTE_LENGTH,
    );
    expect(entry({ status: "done", note: "x".repeat(MAX_NOTE_LENGTH + 1) })).toBeNull();
  });

  it("refuses a note that is not a string", () => {
    expect(entry({ status: "done", note: 42 })).toBeNull();
    expect(entry({ status: "done", note: { toString: "felt fine" } })).toBeNull();
  });
});

describe("the duration", () => {
  it("stores whole minutes", () => {
    expect(entry({ status: "done", durationMin: 28 })?.durationMin).toBe(28);
    expect(entry({ status: "done", durationMin: MAX_DURATION_MIN })?.durationMin).toBe(
      MAX_DURATION_MIN,
    );
  });

  it("reads the string a number input actually sends", () => {
    expect(entry({ status: "done", durationMin: "28" })?.durationMin).toBe(28);
  });

  it("treats absence and an emptied field as no duration", () => {
    // An emptied number input sends "", and clearing the field is something the
    // screen offers — so it is a value to write, not a request to refuse.
    expect(entry({ status: "done" })?.durationMin).toBeNull();
    expect(entry({ status: "done", durationMin: null })?.durationMin).toBeNull();
    expect(entry({ status: "done", durationMin: "" })?.durationMin).toBeNull();
  });

  it("refuses everything that is not a whole number of minutes in range", () => {
    // `duration_min` is an integer column, so a fraction would be rounded by
    // Postgres and come back as a figure nobody entered. The rest are stored as
    // given and summed by the weekly export as fact.
    expect(entry({ status: "done", durationMin: 20.5 })).toBeNull();
    expect(entry({ status: "done", durationMin: 0 })).toBeNull();
    expect(entry({ status: "done", durationMin: -40 })).toBeNull();
    expect(entry({ status: "done", durationMin: MAX_DURATION_MIN + 1 })).toBeNull();
    expect(entry({ status: "done", durationMin: Number.NaN })).toBeNull();
    expect(entry({ status: "done", durationMin: Number.POSITIVE_INFINITY })).toBeNull();
    expect(entry({ status: "done", durationMin: "half an hour" })).toBeNull();
    expect(entry({ status: "done", durationMin: true })).toBeNull();
    expect(entry({ status: "done", durationMin: [28] })).toBeNull();
  });
});

describe("the entry as a whole", () => {
  it("carries all three fields when all three are good", () => {
    expect(
      entry({ status: "partial", note: "cut it short", durationMin: "15" }),
    ).toEqual({ status: "partial", note: "cut it short", durationMin: 15 });
  });

  it("refuses the entry when any one field is bad, so a row is never half-written", () => {
    // The three are written together in one statement, so they are refused
    // together. A caller that recorded the status and dropped the note it
    // could not store would report success for a write that lost half its
    // meaning.
    expect(entry({ status: "done", note: "x".repeat(999), durationMin: 28 })).toBeNull();
    expect(entry({ status: "done", note: "fine", durationMin: -1 })).toBeNull();
  });
});
