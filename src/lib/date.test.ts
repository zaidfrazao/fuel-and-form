import { describe, expect, it } from "vitest";

import {
  addDays,
  dayOfWeek,
  daysBetween,
  parseCalendarDate,
  startOfWeek,
  toCalendarDate,
  todayIn,
} from "./date";

/**
 * Unit tests for calendar arithmetic — the layer underneath resolve-plan.test.ts.
 *
 * Testing Strategy § 1.1 cases 7 and 8 are stated in terms of the resolver, and
 * resolve-plan.test.ts asserts them there, end to end. This file pins the same
 * two transitions one level down, where the arithmetic actually lives, so a
 * failure says which of the two broke rather than only that a meal came back
 * wrong.
 *
 * Every instant below was checked against Node's own ICU data before being
 * written down. The 2026 transitions:
 *
 *   Europe/London     spring forward  2026-03-29 01:00 GMT  -> 02:00 BST
 *                     fall back       2026-10-25 02:00 BST  -> 01:00 GMT
 *   America/New_York  chosen for the plain "not UTC" case: it is behind UTC, so
 *                     its evening is the following day in UTC.
 */

const LONDON = "Europe/London";
const NEW_YORK = "America/New_York";

describe("parseCalendarDate", () => {
  it("splits a calendar date into numbers, with a 1-12 month", () => {
    expect(parseCalendarDate("2026-03-29")).toEqual({
      year: 2026,
      month: 3,
      day: 29,
    });
  });

  it.each([
    ["29/03/2026", "day-first with slashes"],
    ["2026-3-29", "an unpadded month"],
    ["2026-03-29T00:00:00Z", "an instant rather than a date"],
    ["", "an empty string"],
  ])("rejects %s (%s)", (input) => {
    expect(() => parseCalendarDate(input)).toThrow(/Not a calendar date/);
  });

  it.each([
    ["2026-02-30", "February 30th"],
    ["2027-02-29", "February 29th of a non-leap year"],
    ["2026-13-01", "a thirteenth month"],
    ["2026-00-10", "a zeroth month"],
    ["2026-04-31", "the 31st of a 30-day month"],
  ])("rejects %s — %s does not exist", (input) => {
    expect(() => parseCalendarDate(input)).toThrow(/No such date/);
  });

  it("accepts February 29th of a leap year", () => {
    expect(parseCalendarDate("2028-02-29").day).toBe(29);
  });

  it("rejects a two-digit year rather than reading it as the 1900s", () => {
    // Date.UTC(26, ...) is 1926, which is exactly the silent wrong answer the
    // round-trip check exists to turn into a loud one.
    expect(() => parseCalendarDate("0026-01-01")).toThrow(/No such date/);
  });
});

describe("toCalendarDate — the one place a timezone can reach", () => {
  it("uses the configured zone, not UTC", () => {
    // 03:30 UTC on the 16th is still the evening of the 15th in New York.
    const instant = new Date("2026-06-16T03:30:00Z");

    expect(instant.toISOString().slice(0, 10)).toBe("2026-06-16");
    expect(toCalendarDate(instant, NEW_YORK)).toBe("2026-06-15");
  });

  it("gives different zones different answers for the same instant", () => {
    // The clearest statement that the CONFIGURED zone decides and nothing about
    // the process running the code does: one instant, two configured zones, two
    // calendar dates. Whatever TZ this suite happens to run under, at most one
    // of these can be the ambient one.
    const instant = new Date("2026-06-16T03:30:00Z");

    expect(toCalendarDate(instant, LONDON)).toBe("2026-06-16");
    expect(toCalendarDate(instant, NEW_YORK)).toBe("2026-06-15");
  });

  it("reuses the formatter it built for a zone", () => {
    // Second call for the same zone takes the cached branch. Same answer, which
    // is the only externally visible thing a cache is allowed to change.
    const instant = new Date("2026-06-16T03:30:00Z");

    expect(toCalendarDate(instant, LONDON)).toBe(toCalendarDate(instant, LONDON));
  });

  describe("across the spring-forward transition (§ 1.1 case 7)", () => {
    it("puts the instants of the short day on that one date", () => {
      // 2026-03-29 in London is 23 hours long. Both ends of it are the 29th.
      expect(toCalendarDate(new Date("2026-03-29T00:30:00Z"), LONDON)).toBe("2026-03-29");
      expect(toCalendarDate(new Date("2026-03-29T22:30:00Z"), LONDON)).toBe("2026-03-29");
    });

    it("rolls over an hour before UTC does, because BST has begun", () => {
      // 23:30 UTC is 00:30 BST — already the 30th in London while UTC still
      // says the 29th. Truncating an ISO string would show the previous day's
      // plan to anyone awake after midnight for the rest of the summer.
      const instant = new Date("2026-03-29T23:30:00Z");

      expect(instant.toISOString().slice(0, 10)).toBe("2026-03-29");
      expect(toCalendarDate(instant, LONDON)).toBe("2026-03-30");
    });
  });

  describe("across the fall-back transition (§ 1.1 case 8)", () => {
    it("puts both passes of the repeated hour on the same date", () => {
      // 01:30 local happens twice on 2026-10-25 in London — once as BST and an
      // hour later as GMT. One calendar date, not two, and not a day that
      // repeats itself.
      const firstPass = new Date("2026-10-25T00:30:00Z"); // 01:30 BST
      const secondPass = new Date("2026-10-25T01:30:00Z"); // 01:30 GMT

      expect(toCalendarDate(firstPass, LONDON)).toBe("2026-10-25");
      expect(toCalendarDate(secondPass, LONDON)).toBe("2026-10-25");
    });

    it("covers all 25 hours of the long day with exactly one date", () => {
      // The day starts an hour "early" in UTC terms (BST is still running) and
      // ends on the hour (GMT by then). Both ends, and the boundaries either
      // side, land where they should.
      expect(toCalendarDate(new Date("2026-10-24T22:30:00Z"), LONDON)).toBe("2026-10-24");
      expect(toCalendarDate(new Date("2026-10-24T23:30:00Z"), LONDON)).toBe("2026-10-25");
      expect(toCalendarDate(new Date("2026-10-25T23:30:00Z"), LONDON)).toBe("2026-10-25");
      expect(toCalendarDate(new Date("2026-10-26T00:30:00Z"), LONDON)).toBe("2026-10-26");
    });
  });
});

describe("todayIn", () => {
  it("resolves the instant it is given", () => {
    expect(todayIn(LONDON, new Date("2026-03-29T23:30:00Z"))).toBe("2026-03-30");
  });

  it("defaults to now", () => {
    // The clock is real here, so the assertion is about shape and neighbourhood
    // rather than a fixed value: no zone is more than a day from UTC.
    const today = todayIn(NEW_YORK);
    const utcToday = new Date().toISOString().slice(0, 10);

    expect(today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect([addDays(utcToday, -1), utcToday, addDays(utcToday, 1)]).toContain(today);
  });
});

describe("dayOfWeek", () => {
  it("is 0 for Sunday through 6 for Saturday", () => {
    // A single week, so the mapping is readable as a whole rather than as seven
    // separate claims. 2026-03-29 is a Sunday.
    const week = ["2026-03-29", "2026-03-30", "2026-03-31", "2026-04-01", "2026-04-02", "2026-04-03", "2026-04-04"];

    expect(week.map(dayOfWeek)).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  it("reads the date it was given, not the machine's zone", () => {
    // `new Date("2026-03-29").getDay()` is 6 anywhere west of Greenwich, because
    // the string parses as UTC midnight and getDay renders it locally. This must
    // be 0 under every TZ the suite could run in.
    expect(dayOfWeek("2026-03-29")).toBe(0);
  });

  it("is unmoved by either DST transition", () => {
    expect(dayOfWeek("2026-03-29")).toBe(0);
    expect(dayOfWeek("2026-10-25")).toBe(0);
  });
});

describe("addDays", () => {
  it("steps forward and back", () => {
    expect(addDays("2026-03-10", 1)).toBe("2026-03-11");
    expect(addDays("2026-03-10", -1)).toBe("2026-03-09");
    expect(addDays("2026-03-10", 0)).toBe("2026-03-10");
  });

  it("crosses a month end in both directions", () => {
    expect(addDays("2026-01-31", 1)).toBe("2026-02-01");
    expect(addDays("2026-02-01", -1)).toBe("2026-01-31");
  });

  it("crosses a year end", () => {
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2027-01-01", -1)).toBe("2026-12-31");
  });

  it("knows February's length in both a leap year and an ordinary one", () => {
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
    expect(addDays("2026-02-28", 1)).toBe("2026-03-01");
  });

  it("advances exactly one day across both DST transitions", () => {
    // The 23-hour day and the 25-hour day. Adding an hour count would land on
    // 2026-03-29 twice and skip 2026-10-26; adding a day cannot.
    expect(addDays("2026-03-28", 1)).toBe("2026-03-29");
    expect(addDays("2026-03-29", 1)).toBe("2026-03-30");
    expect(addDays("2026-10-24", 1)).toBe("2026-10-25");
    expect(addDays("2026-10-25", 1)).toBe("2026-10-26");
  });

  it("stays exact over a long span", () => {
    expect(addDays("2026-01-01", 365)).toBe("2027-01-01");
    expect(addDays("2026-01-01", 730)).toBe("2028-01-01"); // 2028 is the leap year
  });
});

describe("daysBetween", () => {
  it("counts forward, backward and zero", () => {
    expect(daysBetween("2026-03-02", "2026-03-09")).toBe(7);
    expect(daysBetween("2026-03-09", "2026-03-02")).toBe(-7);
    expect(daysBetween("2026-03-02", "2026-03-02")).toBe(0);
  });

  it("is the inverse of addDays", () => {
    // The property that matters to rotation.ts: the two functions have to agree
    // about how long a day is, or stepping and counting drift apart.
    for (const offset of [-400, -31, -1, 0, 1, 31, 400]) {
      expect(daysBetween("2026-03-02", addDays("2026-03-02", offset))).toBe(offset);
    }
  });

  it("counts whole days across both DST transitions", () => {
    // The 23-hour day and the 25-hour day, each crossed. Subtracting local
    // midnights would give 0.958 and 1.042 here; a rotation built on that would
    // drift by a session twice a year, permanently.
    expect(daysBetween("2026-03-28", "2026-03-29")).toBe(1);
    expect(daysBetween("2026-03-29", "2026-03-30")).toBe(1);
    expect(daysBetween("2026-10-24", "2026-10-25")).toBe(1);
    expect(daysBetween("2026-10-25", "2026-10-26")).toBe(1);

    // And the whole summer at once — 214 days that include both transitions,
    // so any per-day error would have accumulated into a visible one.
    expect(daysBetween("2026-03-25", "2026-10-25")).toBe(214);
  });

  it("counts through a leap day", () => {
    expect(daysBetween("2028-02-28", "2028-03-01")).toBe(2);
    expect(daysBetween("2026-02-28", "2026-03-01")).toBe(1);
  });

  it("stays exact over years", () => {
    expect(daysBetween("2026-01-01", "2027-01-01")).toBe(365);
    expect(daysBetween("2026-01-01", "2029-01-01")).toBe(1096); // 2028 is the leap year
  });

  it("rejects a malformed date on either side", () => {
    expect(() => daysBetween("2026-3-02", "2026-03-09")).toThrow(/Not a calendar date/);
    expect(() => daysBetween("2026-03-02", "2026-02-30")).toThrow(/No such date/);
  });
});

describe("startOfWeek", () => {
  it("returns the Monday of the week containing the date", () => {
    // 2026-03-30 is a Monday.
    expect(startOfWeek("2026-03-30")).toBe("2026-03-30");
    expect(startOfWeek("2026-04-01")).toBe("2026-03-30");
    expect(startOfWeek("2026-04-05")).toBe("2026-03-30");
  });

  it("places Sunday at the end of its week, not the start", () => {
    // The whole reason Monday-first is a display concern layered over 0=Sunday
    // storage: a naive `addDays(date, -dayOfWeek(date))` would send this Sunday
    // forward into its own week's start rather than back to the Monday before.
    expect(startOfWeek("2026-04-05")).toBe("2026-03-30");
    expect(dayOfWeek("2026-04-05")).toBe(0);
  });

  it("crosses a month boundary to reach its Monday", () => {
    expect(startOfWeek("2026-02-01")).toBe("2026-01-26");
  });
});
