import { render, screen, within } from "@testing-library/react";
import { describe, expect, test } from "vitest";

import {
  DEFAULT_SPAN,
  DayRuler,
  type Slot,
  parseClock,
  positionInSpan,
} from "@/components/day-ruler";

/**
 * The percentages `docs/BRAND_GUIDE.html` renders the ruler at. The mock is the
 * oracle here: the guide names it the source of truth for appearance, so a
 * regression in the position map shows up as a divergence from the picture that
 * was actually approved, not from a number someone invented for a test.
 *
 * The mock's inline styles are rounded to one decimal (6.3%, 28.1%, 80.6%); the
 * exact values are asserted, since the rounding is the mock's hand-authoring and
 * not part of the specification.
 */
const FIXTURE: [clock: string, position: number][] = [
  ["06:00", 0],
  ["07:00", 6.25],
  ["10:30", 28.125],
  ["13:00", 43.75],
  ["16:00", 62.5],
  ["17:30", 71.875],
  ["19:00", 81.25],
  ["18:54", 80.625], // the mock's NOW
];

describe("positionInSpan", () => {
  test.each(FIXTURE)(
    "%s sits at %s%% of the default span",
    (clock, position) => {
      expect(positionInSpan(parseClock(clock), DEFAULT_SPAN)).toBeCloseTo(
        position,
        10,
      );
    },
  );

  test("defaults to the 06:00–22:00 span", () => {
    expect(positionInSpan(parseClock("13:00"))).toBe(43.75);
  });

  test("pins the span's own ends to 0 and 100", () => {
    expect(positionInSpan(DEFAULT_SPAN.start)).toBe(0);
    expect(positionInSpan(DEFAULT_SPAN.end)).toBe(100);
  });

  test("clamps rather than dropping a slot outside the span", () => {
    expect(positionInSpan(parseClock("04:30"))).toBe(0);
    expect(positionInSpan(parseClock("23:45"))).toBe(100);
  });

  test("rescales to a custom span", () => {
    const span = { start: parseClock("08:00"), end: parseClock("20:00") };

    expect(positionInSpan(parseClock("14:00"), span)).toBe(50);
    expect(positionInSpan(parseClock("11:00"), span)).toBe(25);
  });

  // A span whose ends are equal or inverted would divide by zero or invert the
  // ruler. Not reachable from any current caller, but it renders rather than
  // throwing, because a graphic taking down the Right Now view is a worse
  // failure than a graphic that is briefly wrong.
  test("survives a degenerate span", () => {
    expect(positionInSpan(600, { start: 600, end: 600 })).toBe(0);
  });
});

describe("parseClock", () => {
  test.each([
    ["00:00", 0],
    ["06:00", 360],
    ["17:30", 1050],
    ["22:00", 1320],
    ["23:59", 1439],
  ])("reads %s as %i minutes", (clock, minutes) => {
    expect(parseClock(clock)).toBe(minutes);
  });

  test.each(["7:00pm", "24:00", "12:60", "1200", "", "12:0"])(
    "rejects %s rather than positioning a mark wrongly",
    (clock) => {
      expect(() => parseClock(clock)).toThrow(RangeError);
    },
  );
});

const SLOTS: Slot[] = [
  {
    id: "coffee",
    label: "Coffee + MCT oil",
    minutes: parseClock("06:00"),
    status: "logged",
  },
  {
    id: "breakfast",
    label: "Breakfast",
    minutes: parseClock("07:00"),
    status: "logged",
  },
  {
    id: "snack-1",
    label: "Snack 1",
    minutes: parseClock("10:30"),
    status: "logged",
  },
  {
    id: "lunch",
    label: "Lunch",
    minutes: parseClock("13:00"),
    status: "logged",
  },
  {
    id: "snack-2",
    label: "Snack 2",
    minutes: parseClock("16:00"),
    status: "skipped",
  },
  {
    id: "workout",
    label: "Circuit B",
    minutes: parseClock("17:30"),
    status: "logged",
  },
  {
    id: "dinner",
    label: "Dinner",
    minutes: parseClock("19:00"),
    status: "upcoming",
  },
];

const NOW = parseClock("18:54");

/**
 * The rendering is checked by eye against the guide on `/dev/day-ruler` — jsdom
 * has no layout, so asserting on the marks would only restate the class strings.
 * What is asserted here is the accessibility contract, which is a real guarantee
 * the Brand Guide makes and which nothing else catches.
 */
describe("DayRuler", () => {
  test("carries an accessible summary of the day", () => {
    render(<DayRuler slots={SLOTS} now={NOW} />);

    expect(screen.getByRole("img").getAttribute("aria-label")).toBe(
      "Day ruler, 06:00 to 22:00. 7 slots: 5 logged, 1 skipped, 1 upcoming. Now 18:54.",
    );
  });

  test("states every slot's status as text, so the graphic survives greyscale", () => {
    render(<DayRuler slots={SLOTS} now={NOW} />);

    const rows = within(screen.getByRole("table")).getAllByRole("row").slice(1);

    expect(rows.map((row) => row.textContent)).toEqual([
      "Coffee + MCT oil06:00Logged",
      "Breakfast07:00Logged",
      "Snack 110:30Logged",
      "Lunch13:00Logged",
      "Snack 216:00Skipped",
      "Circuit B17:30Logged",
      "Dinner19:00Upcoming",
    ]);
  });

  test("orders the table chronologically whatever order the slots arrive in", () => {
    render(<DayRuler slots={[...SLOTS].reverse()} />);

    const rows = within(screen.getByRole("table")).getAllByRole("row").slice(1);

    expect(rows[0]?.textContent).toContain("Coffee + MCT oil");
    expect(rows.at(-1)?.textContent).toContain("Dinner");
  });

  test("marks the scale at 06 · 12 · 18 · 22", () => {
    render(<DayRuler slots={SLOTS} now={NOW} />);

    for (const mark of ["06", "12", "18", "22"]) {
      expect(screen.getByText(mark)).toBeDefined();
    }
  });

  test("derives the scale from the span rather than hardcoding it", () => {
    render(
      <DayRuler
        slots={SLOTS}
        span={{ start: parseClock("08:00"), end: parseClock("20:00") }}
      />,
    );

    for (const mark of ["08", "14", "20"]) {
      expect(screen.getByText(mark)).toBeDefined();
    }
    expect(screen.queryByText("06")).toBeNull();
  });

  test("shows NOW when the moment is in span", () => {
    render(<DayRuler slots={SLOTS} now={NOW} />);

    expect(screen.getByText("Now")).toBeDefined();
  });

  test.each([
    ["there is no moment to show", undefined],
    ["the moment is before the span", parseClock("05:30")],
    ["the moment is after the span", parseClock("23:00")],
  ])("omits NOW when %s", (_case, now) => {
    render(<DayRuler slots={SLOTS} now={now} />);

    expect(screen.queryByText("Now")).toBeNull();
    expect(screen.getByRole("img").getAttribute("aria-label")).not.toContain(
      "Now ",
    );
  });

  /**
   * jsdom cannot see this one, so it asserts the structure instead of the
   * effect. `sr-only` hides a box by shrinking it to 1px, which a `display:
   * table` element ignores under automatic layout — the table laid out at its
   * natural width and, being absolutely positioned, widened the whole document.
   * It fitted the viewport at 100% and only scrolled sideways at 200% Dynamic
   * Type, so nothing here would have caught it and nobody would have looked.
   * The wrapper is load-bearing; this says so.
   */
  test("keeps the data table inside a block wrapper that can actually clip it", () => {
    render(<DayRuler slots={SLOTS} now={NOW} />);

    expect(screen.getByRole("table").parentElement?.className).toContain(
      "sr-only",
    );
  });

  test("renders an empty day without a summary that implies data", () => {
    render(<DayRuler slots={[]} />);

    expect(screen.getByRole("img").getAttribute("aria-label")).toBe(
      "Day ruler, 06:00 to 22:00. No slots.",
    );
  });
});
