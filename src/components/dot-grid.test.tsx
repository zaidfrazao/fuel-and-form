import { render, screen, within } from "@testing-library/react";
import { describe, expect, test } from "vitest";

import {
  type Day,
  DotGrid,
  type Week,
  weekdayIndex,
} from "@/components/dot-grid";

/**
 * FUEL-5's testing note says "no unit tests, verified visually against
 * BRAND_GUIDE.html", and most of it genuinely is visual — the specimen page at
 * `/dev/dot-grid` is where the 11px dot and the 9px gutter get checked.
 *
 * Two of its acceptance criteria are not visual, though. "Carries an accessible
 * summary and an adjacent data table" and "status encoded by solid/ring/size —
 * survives greyscale" are claims about the DOM, and the second is the one this
 * component deliberately implements differently from the mock. Those are what is
 * tested here, and nothing else: no assertion re-states a Tailwind class.
 */

/**
 * The six weeks `docs/BRAND_GUIDE.html` renders, dated so that the final row is
 * the partial week the mock shows — three days, then four that have not
 * happened. Weeks run Monday to Sunday.
 *
 * Invented data. The repository is public and the owner's real training is
 * confined to docs/, per Testing Strategy § 1.5.
 */
type Status = Day["status"];

const PATTERN: Status[][] = [
  ["done", "done", "skipped", "done", "done", "walk", "walk"],
  ["done", "done", "done", "done", "done", "walk", "walk"],
  ["done", "skipped", "done", "done", "done", "walk", "walk"],
  ["done", "done", "done", "done", "skipped", "walk", "walk"],
  ["done", "done", "done", "done", "done", "walk", "walk"],
  ["done", "done", "done", "none", "none", "none", "none"],
];

/**
 * Indexed access under `noUncheckedIndexedAccess`. Throwing beats a non-null
 * assertion here: a fixture that stops lining up fails with "no item at 5"
 * rather than with a confusing assertion three lines further down.
 */
function at<T>(items: readonly T[], index: number): T {
  const item = items[index];

  if (item === undefined) throw new RangeError(`No item at index ${index}`);

  return item;
}

/** 2026-07-06 is a Monday, so week one starts clean. */
const FIRST_MONDAY = Date.UTC(2026, 6, 6);
const DAY_MS = 24 * 60 * 60 * 1000;

const iso = (offset: number) =>
  new Date(FIRST_MONDAY + offset * DAY_MS).toISOString().slice(0, 10);

const WEEKS: Week[] = PATTERN.map((statuses, week) =>
  statuses.map((status, day) => ({ date: iso(week * 7 + day), status })),
);

/** The Wednesday of the sixth week — the dot the mock renders in umber. */
const TODAY = iso(37);

describe("weekdayIndex", () => {
  test.each([
    ["2026-08-10", 0, "Monday"],
    ["2026-08-11", 1, "Tuesday"],
    ["2026-08-15", 5, "Saturday"],
    ["2026-08-16", 6, "Sunday"],
  ])("%s is column %i (%s)", (date, column) => {
    expect(weekdayIndex(date)).toBe(column);
  });

  test("is unaffected by the machine's timezone", () => {
    // The reason the date is a string and the parse is pinned to UTC. A local
    // parse puts this day one column left of where it belongs anywhere west of
    // Greenwich, and the graphic would be quietly wrong for half the world.
    const original = process.env.TZ;

    try {
      process.env.TZ = "Pacific/Honolulu";
      expect(weekdayIndex("2026-08-10")).toBe(0);
      process.env.TZ = "Pacific/Kiritimati";
      expect(weekdayIndex("2026-08-10")).toBe(0);
    } finally {
      // `process.env.TZ = undefined` assigns the *string* "undefined", not an
      // absence — so restoring a TZ that was never set would leave every later
      // test in this worker running under a bogus zone. Delete it instead.
      if (original === undefined) delete process.env.TZ;
      else process.env.TZ = original;
    }
  });

  test("throws rather than placing a dot in a guessed column", () => {
    expect(() => weekdayIndex("10-08-2026")).toThrow(RangeError);
    expect(() => weekdayIndex("2026-13-01")).toThrow(RangeError);
    expect(() => weekdayIndex("")).toThrow(RangeError);
  });

  test("rejects a date that does not exist, rather than rolling it forward", () => {
    // `Date` normalises an overrun day instead of refusing it: "2026-02-31"
    // parses as 3 March and "2026-04-31" as 1 May. Both pass a shape check and
    // both are a valid Date, so without the round-trip they would land two
    // columns from where the caller meant — the exact silent misplacement this
    // function exists to prevent.
    expect(() => weekdayIndex("2026-02-31")).toThrow(RangeError);
    expect(() => weekdayIndex("2026-02-30")).toThrow(RangeError);
    expect(() => weekdayIndex("2026-04-31")).toThrow(RangeError);
    // 2028 is a leap year and 2026 is not, so this pair also guards the
    // round-trip against being loosened to a day-of-month range check.
    expect(() => weekdayIndex("2026-02-29")).toThrow(RangeError);
    expect(weekdayIndex("2028-02-29")).toBe(1);
  });
});

describe("DotGrid", () => {
  test("carries an accessible summary of the pattern", () => {
    render(<DotGrid weeks={WEEKS} today={TODAY} />);

    const summary = screen.getByRole("img").getAttribute("aria-label");

    expect(summary).toContain("Training adherence, 6 weeks");
    expect(summary).toContain("6 July 2026 to 16 August 2026");
    expect(summary).toContain("42 days");
    expect(summary).toContain("Today 12 August 2026, done.");
  });

  test("reports without grading — no score, no streak, no praise", () => {
    render(<DotGrid weeks={WEEKS} today={TODAY} />);

    const summary = screen.getByRole("img").getAttribute("aria-label") ?? "";

    // The PRD's position: adherence visible without a score, divergence as data
    // rather than guilt. A percentage would reintroduce the grade the whole
    // graphic exists to avoid.
    expect(summary).not.toMatch(/%|streak|great|well done|keep|goal/i);
  });

  test("tallies every status the guide names", () => {
    render(<DotGrid weeks={WEEKS} today={TODAY} />);

    const summary = screen.getByRole("img").getAttribute("aria-label") ?? "";

    expect(summary).toContain("25 done");
    expect(summary).toContain("3 skipped");
    expect(summary).toContain("10 walk only");
    expect(summary).toContain("4 not recorded");
  });

  test("states every day's status as text in the adjacent data table", () => {
    render(<DotGrid weeks={WEEKS} today={TODAY} />);

    const rows = within(screen.getByRole("table")).getAllByRole("row");

    // One header row plus one per week.
    expect(rows).toHaveLength(7);
    expect(within(at(rows, 1)).getByRole("rowheader").textContent).toBe(
      "Week of 6 July 2026",
    );
    expect(
      within(at(rows, 1))
        .getAllByRole("cell")
        .map((cell) => cell.textContent),
    ).toEqual([
      "Done",
      "Done",
      "Skipped",
      "Done",
      "Done",
      "Walk only",
      "Walk only",
    ]);
  });

  test("names today in the table, so it is not carried by colour alone", () => {
    render(<DotGrid weeks={WEEKS} today={TODAY} />);

    const rows = within(screen.getByRole("table")).getAllByRole("row");
    const cells = within(at(rows, 6))
      .getAllByRole("cell")
      .map((cell) => cell.textContent);

    expect(at(cells, 2)).toBe("Done, today");
    expect(at(cells, 3)).toBe("Not recorded");
  });

  test("gives partial its own dot, at the same weight as done", () => {
    // FUEL-27. `workout_log_status` has held `partial` since the first
    // migration and schema.ts calls it "a first-class outcome, not a failure
    // state" — so it may not borrow either neighbour's rendering. Same 11px as
    // done (§ The Governing Principle: "the same visual weight — only the
    // status label differs"), filled rather than ringed, and a different ink.
    const mixed: Week = [
      { date: "2026-08-10", status: "done" },
      { date: "2026-08-11", status: "partial" },
      { date: "2026-08-12", status: "skipped" },
    ];

    const { container } = render(<DotGrid weeks={[mixed]} />);
    const [done, partial, skipped] = [
      ...container.querySelectorAll<HTMLElement>(".rounded-full"),
    ];

    expect(partial?.style.width).toBe(done?.style.width);
    expect(partial?.style.width).toBe(skipped?.style.width);
    // Filled, so it is not read as a skip; a different ink from done, so the
    // two are still distinguishable with colour removed.
    expect(partial?.style.backgroundColor).toBe("var(--text-tertiary)");
    expect(partial?.style.backgroundColor).not.toBe(done?.style.backgroundColor);
    expect(partial?.style.boxShadow).toBe("");

    // And it is stated as text, per § Accessibility — never carried by the dot
    // alone.
    expect(screen.getByRole("img").getAttribute("aria-label")).toContain("1 partial");
    expect(within(screen.getByRole("table")).getByText("Partial")).toBeTruthy();
  });

  test("says a day is unrecorded rather than saying no session happened", () => {
    // The distinction `lib/adherence.ts` depends on. An unlogged Circuit B is
    // `none` — inferring a skip would have the graphic accusing the user of a
    // decision they never made — and the data table has to say that without
    // claiming there was no session, which would contradict the label beside it.
    const unlogged: Week = [{ date: "2026-08-12", label: "Circuit B", status: "none" }];

    render(<DotGrid weeks={[unlogged]} />);

    expect(
      within(screen.getByRole("table")).getByText("Not recorded, Circuit B"),
    ).toBeTruthy();
  });

  test("keeps the data table inside a block wrapper that can actually clip it", () => {
    render(<DotGrid weeks={WEEKS} today={TODAY} />);

    // `sr-only` cannot clip a `display: table` box — it lays out at its natural
    // width and adds itself to the page's scrollable width, which at 200% zoom
    // scrolls the page sideways. The wrapper is the fix, and this is the guard.
    const table = screen.getByRole("table");

    expect(table.parentElement?.className).toContain("sr-only");
    expect(table.className).not.toContain("sr-only");
  });

  test("puts each day under its true weekday, so a partial week still aligns", () => {
    // A week that starts on the Thursday. Placed by position it would sit under
    // Monday; placed by date it sits where the header says it does.
    const thursday: Week = [
      { date: "2026-08-13", status: "done" },
      { date: "2026-08-14", status: "skipped" },
    ];

    const { container } = render(<DotGrid weeks={[thursday]} />);
    // The second `.grid-cols-7` is the dots; the first is the weekday header.
    const grid = at([...container.querySelectorAll(".grid-cols-7")], 1);
    const cells = [...grid.children];

    expect(at(cells, 0).children).toHaveLength(0); // Monday, absent
    expect(at(cells, 3).children).toHaveLength(1); // Thursday
    expect(at(cells, 4).children).toHaveLength(1); // Friday
    expect(at(cells, 6).children).toHaveLength(0); // Sunday, absent
  });

  test("today changes a dot's tone without discarding its status", () => {
    // The divergence from BRAND_GUIDE.html, and the reason it exists. The mock
    // replaces the status class with an accent fill, which loses the status
    // entirely — in greyscale a skipped today and a done today become the same
    // disc. Here today keeps its ring and gains the halo, so AC 6 holds: status
    // is still carried by solid / ring / size.
    const skipped: Week = [{ date: "2026-08-11", status: "skipped" }];

    const { container } = render(
      <DotGrid weeks={[skipped]} today="2026-08-11" />,
    );
    const dot = container.querySelector<HTMLElement>(".rounded-full");

    expect(dot?.style.boxShadow).toContain("inset 0 0 0 1.5px var(--accent)");
    expect(dot?.style.boxShadow).toContain("0 0 0 3px var(--accent-subtle)");
    // A ring, not a fill. Filling it would make a skipped day read as a done one.
    expect(dot?.style.backgroundColor).toBe("");
  });

  test("omits today entirely when it falls outside the weeks shown", () => {
    render(<DotGrid weeks={WEEKS} today="2026-09-01" />);

    const summary = screen.getByRole("img").getAttribute("aria-label") ?? "";

    // A past window under review has no present moment in it, and accenting an
    // edge would assert one that isn't there.
    expect(summary).not.toContain("Today");
    expect(
      within(screen.getByRole("table")).queryByText(/today/),
    ).toBeNull();
  });

  test("renders an empty grid without a summary that implies data", () => {
    render(<DotGrid weeks={[]} />);

    expect(screen.getByRole("img").getAttribute("aria-label")).toBe(
      "Training adherence. No days recorded.",
    );
  });

  test("keeps the first day when a week names the same weekday twice", () => {
    const duplicated: Week = [
      { date: "2026-08-11", label: "Circuit A", status: "done" },
      { date: "2026-08-11", label: "Walk", status: "walk" },
    ];

    render(<DotGrid weeks={[duplicated]} />);

    // Ignoring the second is a choice; overwriting the first would silently swap
    // one day's status for another's. The summary counts the dots that were
    // actually drawn, so it agrees with the table rather than with the input.
    expect(screen.getByRole("img").getAttribute("aria-label")).toContain(
      "1 day: 1 done",
    );
    expect(within(screen.getByRole("table")).getByText("Done, Circuit A")).toBeTruthy();
  });
});
