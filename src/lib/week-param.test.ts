import { describe, expect, test } from "vitest";

import { requestedWeek } from "./week-param";

/**
 * `?week=` — the one reading, for `/plan` and `/api/export/week` alike.
 *
 * Extracted from the page in FUEL-38 and gated at 100% on arrival, because the
 * value it reads is the only input on either surface that a stranger fully
 * controls, and the whole contract is "never throws". A regression here is not
 * a wrong week; it is a 500 on an edited URL, or a download whose contents are
 * a different seven days from the grid the link was clicked on.
 */

describe("a value it can read", () => {
  test("is returned unchanged", () => {
    expect(requestedWeek("2026-08-17")).toBe("2026-08-17");
  });

  test("need not be a Monday", () => {
    // Snapping to the week's start is `startOfWeek`'s job, one layer down, so
    // that a date a human might type names the week containing it. This
    // function only decides whether the string is a date at all.
    expect(requestedWeek("2026-08-19")).toBe("2026-08-19");
  });

  test("may be a week the program has nothing in", () => {
    // Before `program_start_date`, or years out. Both name a real week, which
    // resolves to empty days rather than to an error — see `resolveSlot`.
    expect(requestedWeek("2019-01-07")).toBe("2019-01-07");
  });
});

describe("a value it cannot read", () => {
  test.each([
    ["absent", undefined],
    ["empty", ""],
    ["not a date", "next-week"],
    ["a real date in the wrong format", "17/08/2026"],
    ["a date that does not exist", "2026-02-30"],
    ["a date with a time on it", "2026-08-17T00:00:00Z"],
  ])("%s is null rather than a throw", (_name, value) => {
    expect(requestedWeek(value)).toBeNull();
  });

  test("a repeated parameter is refused rather than resolved", () => {
    // `?week=a&week=b` arrives as an array. Picking one of the values would be
    // answering a question that was not asked — a URL saying two different
    // things has not named a week.
    expect(requestedWeek(["2026-08-17", "2026-09-01"])).toBeNull();
  });

  test("a single value in an array is refused too", () => {
    // The callers unwrap a lone value before it gets here. This asserts the
    // rule is about the SHAPE rather than about the count, so a caller that
    // forgot to unwrap fails visibly — as the current week — instead of
    // working by accident on one code path and not the other.
    expect(requestedWeek(["2026-08-17"])).toBeNull();
  });
});
