import { describe, expect, it } from "vitest";

import { REPEAT_COUNTS, REPEAT_MAX, REPEAT_MIN, repeatDates } from "./repeat";

/**
 * The repeat's bound and its dates — FUEL-24.
 *
 * Two halves, and they are tested for different reasons.
 *
 * The RANGE half is the security half. `days` is the first client-supplied
 * value in the app that multiplies the number of rows a request writes, so
 * every case below that expects `null` is a refusal that has to hold against a
 * hand-rolled POST rather than against a stepper that cannot produce it.
 *
 * The DATES half is the Testing Strategy's § 1.1 cases 11 and 12 arriving one
 * layer down. The resolver's own tests already prove that overrides on three
 * consecutive dates all resolve, and that a run across a month end resolves on
 * both sides of it; what they assume is that something produced the right three
 * dates. This is that something, so the boundaries are named here explicitly —
 * a repeat that smeared into the wrong month would pass every resolver test in
 * the file and still put chilli on the wrong day.
 *
 * The suite runs in America/New_York (vitest.config.mts), five hours behind the
 * dates below. Every assertion here is on calendar strings, so a version of
 * `addDays` that reconstituted a `Date` in the ambient zone would fail rather
 * than coincide.
 */

describe("the range", () => {
  it("accepts the shortest run", () => {
    expect(repeatDates("2026-03-10", REPEAT_MIN)).toHaveLength(REPEAT_MIN);
  });

  it("accepts the longest", () => {
    expect(repeatDates("2026-03-10", REPEAT_MAX)).toHaveLength(REPEAT_MAX);
  });

  it("refuses one day — that is the substitute, not a repeat", () => {
    expect(repeatDates("2026-03-10", 1)).toBeNull();
  });

  it("refuses a run longer than a week", () => {
    // The PRD's line about template editing being separate. Eight days is where
    // "this batch of mince" stops being a plausible reading.
    expect(repeatDates("2026-03-10", REPEAT_MAX + 1)).toBeNull();
  });

  it("refuses a count no control could produce", () => {
    // The hand-rolled POST. Nothing in the sheet can send any of these.
    for (const days of [0, -1, -7, 30, 100_000]) {
      expect(repeatDates("2026-03-10", days)).toBeNull();
    }
  });

  it("refuses a fraction", () => {
    expect(repeatDates("2026-03-10", 2.5)).toBeNull();
  });

  it("refuses NaN and both infinities", () => {
    // Infinity is the one that matters most: it is in range under a naive
    // `days % 1 !== 0` check, and `Array.from({ length: Infinity })` throws —
    // which would turn a refusal into a 500 on a Server Action whose contract
    // is that it never throws.
    for (const days of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(repeatDates("2026-03-10", days)).toBeNull();
    }
  });

  it("refuses a non-number that a widened type or JSON.parse could deliver", () => {
    for (const days of ["3", null, undefined, {}, []]) {
      expect(repeatDates("2026-03-10", days as unknown as number)).toBeNull();
    }
  });
});

describe("the counts the control offers", () => {
  it("is exactly the range the validator accepts", () => {
    // The drift this exists to rule out: a stepper offering a count the
    // endpoint refuses reads as the button being broken, not as a bound.
    expect(REPEAT_COUNTS).toEqual([2, 3, 4, 5, 6, 7]);

    for (const days of REPEAT_COUNTS) {
      expect(repeatDates("2026-03-10", days)).not.toBeNull();
    }
  });
});

describe("the dates", () => {
  it("includes the day it starts on", () => {
    // "Repeat for 2 days" is Tuesday AND Wednesday — the Brand Guide's own
    // button copy and the PRD's mince story. Two rows, not three.
    expect(repeatDates("2026-03-10", 2)).toEqual(["2026-03-10", "2026-03-11"]);
  });

  it("runs forwards, never backwards", () => {
    // A repeat pushes a meal onto FOLLOWING days. A sign error here would
    // rewrite days that have already been eaten.
    expect(repeatDates("2026-03-10", 3)).toEqual([
      "2026-03-10",
      "2026-03-11",
      "2026-03-12",
    ]);
  });

  it("is strictly increasing and distinct", () => {
    // Not a restatement of the case above: it is the precondition the batch
    // write depends on. Postgres refuses one INSERT ... ON CONFLICT DO UPDATE
    // that would touch the same row twice, and two equal dates in one batch is
    // the only way this could produce that.
    const dates = repeatDates("2026-03-10", REPEAT_MAX) ?? [];

    expect(new Set(dates).size).toBe(REPEAT_MAX);
    expect([...dates].sort()).toEqual(dates);
  });

  it("crosses a week boundary", () => {
    // Saturday into Sunday into Monday. The resolver maps day_of_week
    // Monday-first for display and 0 = Sunday in storage, so a run that stopped
    // at the week end would be the most plausible-looking bug available here.
    expect(repeatDates("2026-03-07", 3)).toEqual([
      "2026-03-07",
      "2026-03-08",
      "2026-03-09",
    ]);
  });

  it("crosses a month boundary — § 1.1 case 12's dates", () => {
    // The exact run resolve-plan.test.ts asserts resolves on all three days.
    expect(repeatDates("2026-03-30", 3)).toEqual([
      "2026-03-30",
      "2026-03-31",
      "2026-04-01",
    ]);
  });

  it("crosses a leap day", () => {
    // 2028 is a leap year, so February has a 29th and the run must not skip it.
    expect(repeatDates("2028-02-28", 3)).toEqual([
      "2028-02-28",
      "2028-02-29",
      "2028-03-01",
    ]);
  });

  it("crosses a non-leap February", () => {
    // The same three calendar positions a year earlier, where the 29th does not
    // exist. A version that added days by string arithmetic would produce one.
    expect(repeatDates("2027-02-27", 3)).toEqual([
      "2027-02-27",
      "2027-02-28",
      "2027-03-01",
    ]);
  });

  it("crosses a year boundary", () => {
    expect(repeatDates("2026-12-31", 2)).toEqual(["2026-12-31", "2027-01-01"]);
  });

  it("crosses a daylight-saving transition as exactly one day per date", () => {
    // Europe/London springs forward on 2026-03-29. The arithmetic is UTC, so a
    // day is 24 hours here by construction — a local-midnight implementation
    // would land twice on the 29th or skip it.
    expect(repeatDates("2026-03-28", 3)).toEqual([
      "2026-03-28",
      "2026-03-29",
      "2026-03-30",
    ]);
  });

  it("throws on a malformed start date rather than reporting a refused repeat", () => {
    // `from` is server-derived and never crosses the wire, so a bad one is a
    // bug in this codebase. It gets `parseCalendarDate`'s throw, not the `null`
    // that means "the client asked for something we do not do".
    expect(() => repeatDates("10-03-2026", 2)).toThrow(/Not a calendar date/);
    expect(() => repeatDates("2026-02-30", 2)).toThrow(/No such date/);
  });
});
