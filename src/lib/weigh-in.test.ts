import { describe, expect, it } from "vitest";

import { MAX_NOTE_LENGTH } from "./session-entry";
import { MAX_KG, MIN_KG, parseWeighIn, parseWeighInDate, parseWeightKg } from "./weigh-in";

/**
 * FUEL-34's refusals — the trust boundary of P5's write path.
 *
 * Everything a weigh-in says is chosen by the caller: unlike a training write,
 * where `actions/training.ts` re-resolves the date and the workout for itself,
 * there is nothing here for the server to derive. The date, the number and the
 * note are the whole request, so this file is the whole boundary, tested the
 * way `session-entry.test.ts` and `repeat.test.ts` test theirs — as input
 * nobody validated, not as values a form produced.
 *
 * The failure mode being guarded is silence. A refused status throws in
 * Postgres; a bad weight is STORED, and then looks like a measurement on a
 * chart that has no way to say which point is wrong.
 */

/** A fixed today. The parser takes its clock, so no test needs a real one. */
const TODAY = "2026-08-21";

describe("the scale reading", () => {
  it("takes a full stop", () => {
    expect(parseWeightKg("77.4")).toBe(77.4);
  });

  it("takes a comma, and means the same number by it", () => {
    // FUEL-34's criterion. The separator is a property of the phone's locale
    // rather than a thing anyone chose, so both are the same reading.
    expect(parseWeightKg("77,4")).toBe(77.4);
    expect(parseWeightKg("77,4")).toBe(parseWeightKg("77.4"));
  });

  it("takes a whole number", () => {
    expect(parseWeightKg("77")).toBe(77);
  });

  it("ignores the whitespace a paste or a keyboard leaves behind", () => {
    expect(parseWeightKg(" 77,4 ")).toBe(77.4);
  });

  it("reads a single-separator grouping as a decimal, because that is the only reading a scale has", () => {
    // `77,400` is seventy-seven thousand four hundred under one convention.
    // Not in this field: that is not a weight and 77.4 is, so it is read as a
    // decimal rather than refused. Pinned because it is a decision — the
    // pattern permits it, and refusing it would land on someone who typed a
    // comma meaning a decimal point.
    expect(parseWeightKg("77,400")).toBe(77.4);
    expect(parseWeightKg("77.400")).toBe(77.4);
  });

  it("refuses a string carrying both separators rather than guessing", () => {
    // '1,234.5' is English thousands; '1.234,5' is the same number in German.
    // Nothing in the string says which, and a guess is wrong half the time.
    expect(parseWeightKg("1,234.5")).toBeUndefined();
    expect(parseWeightKg("1.234,5")).toBeUndefined();
  });

  it("refuses the strings `Number` would happily turn into a weight", () => {
    // Each of these is a value `Number()` accepts: 0, 0, 77, 100, Infinity.
    // None of them is a scale reading, and all of them are a POST away.
    expect(parseWeightKg("")).toBeUndefined();
    expect(parseWeightKg("   ")).toBeUndefined();
    expect(parseWeightKg("0x4d")).toBeUndefined();
    expect(parseWeightKg("1e2")).toBeUndefined();
    expect(parseWeightKg("Infinity")).toBeUndefined();
  });

  it("refuses a signed reading", () => {
    expect(parseWeightKg("-77.4")).toBeUndefined();
    expect(parseWeightKg("+77.4")).toBeUndefined();
  });

  it("refuses a separator with nothing on one side of it", () => {
    expect(parseWeightKg(".5")).toBeUndefined();
    expect(parseWeightKg("77.")).toBeUndefined();
    expect(parseWeightKg("77,")).toBeUndefined();
    expect(parseWeightKg("1.2.3")).toBeUndefined();
  });

  it("refuses anything that is not a string", () => {
    // The screen sends the input's value, which is always a string. These are
    // what a hand-rolled request sends.
    expect(parseWeightKg(77.4)).toBeUndefined();
    expect(parseWeightKg(null)).toBeUndefined();
    expect(parseWeightKg(undefined)).toBeUndefined();
    expect(parseWeightKg(["77.4"])).toBeUndefined();
    expect(parseWeightKg({ valueOf: () => 77.4 })).toBeUndefined();
  });

  it("rounds to the two decimals the column stores, rather than letting Postgres do it", () => {
    // `numeric(5, 2)` would round these silently and hand back a number the
    // user never typed. Rounding here makes it the app's decision.
    expect(parseWeightKg("77.456")).toBe(77.46);
    expect(parseWeightKg("77.454")).toBe(77.45);
    expect(parseWeightKg("77.999")).toBe(78);
  });

  it("refuses the two ways a reading gets mistyped", () => {
    // A dropped separator, and a doubled digit. Both land outside the range;
    // every real reading lands inside it.
    expect(parseWeightKg("774")).toBeUndefined();
    expect(parseWeightKg("777.4")).toBeUndefined();
  });

  it("holds the range at its edges, on the value that would be stored", () => {
    expect(parseWeightKg(String(MIN_KG))).toBe(MIN_KG);
    expect(parseWeightKg(String(MAX_KG))).toBe(MAX_KG);
    expect(parseWeightKg("19.99")).toBeUndefined();
    expect(parseWeightKg("400.01")).toBeUndefined();
    // Rounding happens first, so this is inside the range by the time it is
    // checked — the bound tests the number the database sees.
    expect(parseWeightKg("400.004")).toBe(MAX_KG);
    expect(parseWeightKg("400.006")).toBeUndefined();
    expect(parseWeightKg("0")).toBeUndefined();
  });
});

describe("the date", () => {
  it("takes today", () => {
    expect(parseWeighInDate(TODAY, TODAY)).toBe(TODAY);
  });

  it("takes any past date, including one before the program started", () => {
    // Unlike the plan actions, which refuse a pre-program date. The starting
    // weight predates the program and is what every later reading is measured
    // against — P5's "% of the way to target" has no meaning without it.
    expect(parseWeighInDate("2026-08-20", TODAY)).toBe("2026-08-20");
    expect(parseWeighInDate("2019-01-01", TODAY)).toBe("2019-01-01");
  });

  it("refuses tomorrow", () => {
    // A measurement that has not been taken is not a measurement. The input's
    // `max` is what stops this by accident; this is what stops a POST.
    expect(parseWeighInDate("2026-08-22", TODAY)).toBeUndefined();
    expect(parseWeighInDate("2027-01-01", TODAY)).toBeUndefined();
  });

  it("refuses a date that does not exist, without throwing", () => {
    // `parseCalendarDate` throws on both. The action above this must never
    // throw, so the catch is here rather than there.
    expect(parseWeighInDate("2026-02-30", TODAY)).toBeUndefined();
    expect(parseWeighInDate("2026-13-01", TODAY)).toBeUndefined();
  });

  it("refuses anything that is not a calendar date", () => {
    expect(parseWeighInDate("21/08/2026", TODAY)).toBeUndefined();
    expect(parseWeighInDate("2026-8-21", TODAY)).toBeUndefined();
    expect(parseWeighInDate("", TODAY)).toBeUndefined();
    expect(parseWeighInDate(20260821, TODAY)).toBeUndefined();
    expect(parseWeighInDate(null, TODAY)).toBeUndefined();
    expect(parseWeighInDate(undefined, TODAY)).toBeUndefined();
    expect(parseWeighInDate([TODAY], TODAY)).toBeUndefined();
  });

  it("takes the 29th of February in a leap year", () => {
    expect(parseWeighInDate("2024-02-29", TODAY)).toBe("2024-02-29");
  });
});

describe("the whole weigh-in", () => {
  it("carries the three fields through", () => {
    expect(parseWeighIn({ date: TODAY, weight: "77,4", note: " after the walk " }, TODAY)).toEqual({
      date: TODAY,
      weightKg: 77.4,
      note: "after the walk",
    });
  });

  it("treats an absent, empty or whitespace note as a note deliberately cleared", () => {
    // `null` and a refusal are different answers: `null` is what the update
    // must write to remove a note that was there before.
    expect(parseWeighIn({ date: TODAY, weight: "77.4" }, TODAY)?.note).toBeNull();
    expect(parseWeighIn({ date: TODAY, weight: "77.4", note: "" }, TODAY)?.note).toBeNull();
    expect(parseWeighIn({ date: TODAY, weight: "77.4", note: "   " }, TODAY)?.note).toBeNull();
    expect(parseWeighIn({ date: TODAY, weight: "77.4", note: null }, TODAY)?.note).toBeNull();
  });

  it("refuses a note past the cap rather than storing the first 500 characters", () => {
    const note = "x".repeat(MAX_NOTE_LENGTH);

    expect(parseWeighIn({ date: TODAY, weight: "77.4", note }, TODAY)?.note).toBe(note);
    expect(parseWeighIn({ date: TODAY, weight: "77.4", note: `${note}x` }, TODAY)).toBeNull();
  });

  it("refuses the whole weigh-in when any one field is bad", () => {
    // One answer for all of them: the screen's response is identical, and
    // distinguishing them would tell a prober something for nothing.
    expect(parseWeighIn({ date: "2026-08-22", weight: "77.4" }, TODAY)).toBeNull();
    expect(parseWeighIn({ date: TODAY, weight: "774" }, TODAY)).toBeNull();
    expect(parseWeighIn({ date: TODAY, weight: "77.4", note: 12 }, TODAY)).toBeNull();
    expect(parseWeighIn({ date: undefined, weight: undefined }, TODAY)).toBeNull();
  });
});
