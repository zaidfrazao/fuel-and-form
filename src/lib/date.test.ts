import { describe, expect, it } from "vitest";

import {
  addDays,
  dayOfWeek,
  daysBetween,
  MINUTES_PER_DAY,
  minutesOfDayIn,
  parseCalendarDate,
  parseTimeOfDay,
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

/** +05:30 year-round. The zone whose offset is not a whole number of hours. */
const KOLKATA = "Asia/Kolkata";

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

describe("parseTimeOfDay", () => {
  it("counts minutes from local midnight", () => {
    // The whole day, read as a whole: the two ends and the two shapes in
    // between — an on-the-hour slot start and a half-hour one, which is what
    // the PRD's 10:30 snack needs.
    expect(parseTimeOfDay("00:00")).toBe(0);
    expect(parseTimeOfDay("07:00")).toBe(420);
    expect(parseTimeOfDay("10:30")).toBe(630);
    expect(parseTimeOfDay("23:59")).toBe(MINUTES_PER_DAY - 1);
  });

  it("never returns a count outside the day", () => {
    // The invariant the window comparison depends on: an accepted time is
    // somewhere in [0, 1440), so no slot start can sort after the day ends.
    for (const time of ["00:00", "06:00", "13:00", "17:30", "19:00", "23:59"]) {
      const minutes = parseTimeOfDay(time);

      expect(minutes).toBeGreaterThanOrEqual(0);
      expect(minutes).toBeLessThan(MINUTES_PER_DAY);
    }
  });

  it.each([
    ["24:00", "an hour that does not exist — midnight is 00:00"],
    ["25:00", "an hour past the end of the clock"],
    ["07:60", "a minute that does not exist"],
    ["7:30", "an unpadded hour"],
    ["07:3", "an unpadded minute"],
    ["07:30:00", "seconds this app has no use for"],
    ["0730", "no separator"],
    ["07.30", "the wrong separator"],
    ["lunch", "not a time at all"],
    ["", "empty — a slot_times value that was never filled in"],
  ])("rejects %s — %s", (input) => {
    // A slot start comes from free-shaped JSON with no CHECK behind it, so each
    // of these is a plausible typo in a settings form rather than a hypothetical.
    expect(() => parseTimeOfDay(input)).toThrow(/Not a time of day/);
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

describe("minutesOfDayIn — the clock P1 resolves against", () => {
  it("uses the configured zone, not the machine's", () => {
    // 04:30 in London, 23:30 the previous evening in New York. The suite runs in
    // New York (see the config), so `getHours()` would answer 23:30 here: the
    // second assertion is the bug, and the first is what the function does
    // instead. Five and a half hours apart is the difference between breakfast
    // and the day being over.
    const instant = new Date("2026-06-16T03:30:00Z");

    expect(minutesOfDayIn(LONDON, instant)).toBe(4 * 60 + 30);
    expect(minutesOfDayIn(NEW_YORK, instant)).toBe(23 * 60 + 30);
    expect(instant.getHours() * 60 + instant.getMinutes()).toBe(23 * 60 + 30);
  });

  it("reads midnight as 0, not as the end of the day", () => {
    // 23:00 UTC is midnight in BST. An `hour12: false` formatter on an ICU build
    // that resolves it to h24 emits '24' here, and 1440 is past every window —
    // the day-complete state, served at midnight to someone who has not eaten
    // breakfast yet.
    expect(minutesOfDayIn(LONDON, new Date("2026-06-15T23:00:00Z"))).toBe(0);
  });

  it("reads the last minute of the day as the last minute of the day", () => {
    expect(minutesOfDayIn(LONDON, new Date("2026-06-15T22:59:00Z"))).toBe(
      MINUTES_PER_DAY - 1,
    );
  });

  it("keeps the minute part of a zone offset that is not whole hours", () => {
    // 09:00 in Kolkata. A version that read only the hour, or that applied a
    // whole-hour offset, would answer 08:30 or 09:30 — half an hour is enough to
    // put the clock in the wrong window either side of a 10:30 snack.
    expect(minutesOfDayIn(KOLKATA, new Date("2026-06-16T03:30:00Z"))).toBe(9 * 60);
  });

  it("agrees with toCalendarDate about which day it is (§ 1.1 case 7)", () => {
    // The pairing P1's day boundary is made of: 23:30 UTC on the 29th is 00:30
    // BST on the 30th, so the date has rolled over AND the clock has reset. A
    // view that took the date from one source and the time from another could
    // show the 30th's plan with the 29th's clock, and land on dinner.
    const instant = new Date("2026-03-29T23:30:00Z");

    expect(toCalendarDate(instant, LONDON)).toBe("2026-03-30");
    expect(minutesOfDayIn(LONDON, instant)).toBe(30);
  });

  it("jumps the hour the spring-forward day never has", () => {
    // London's clocks go 00:59 GMT -> 02:00 BST. One minute of elapsed time,
    // 61 minutes of wall clock, and no local time in between: a resolver that
    // assumed the clock advances a minute per minute would be an hour out for
    // the rest of that day.
    expect(minutesOfDayIn(LONDON, new Date("2026-03-29T00:59:00Z"))).toBe(59);
    expect(minutesOfDayIn(LONDON, new Date("2026-03-29T01:00:00Z"))).toBe(2 * 60);
  });

  it("returns the same minute twice across the fall-back hour (§ 1.1 case 8)", () => {
    // 01:30 happens twice on 2026-10-25 in London, an hour apart. Both passes
    // are the same wall-clock minute, so both resolve the same slot — the
    // sequence is not monotonic within a day, and nothing may assume it is.
    expect(minutesOfDayIn(LONDON, new Date("2026-10-25T00:30:00Z"))).toBe(90);
    expect(minutesOfDayIn(LONDON, new Date("2026-10-25T01:30:00Z"))).toBe(90);
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
