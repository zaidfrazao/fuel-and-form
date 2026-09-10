import { render, screen, within } from "@testing-library/react";
import { describe, expect, test } from "vitest";

import {
  DEFAULT_SPAN,
  DayRuler,
  type LabelAnchor,
  type Slot,
  parseClock,
  positionInSpan,
  scaleLabelClip,
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

  // A degenerate span is not reachable from any current caller, but it used to
  // emit the span's single minute twice — one React duplicate-key warning, and
  // two labels stacked at the same position.
  test("does not repeat a scale mark when the span has no width", () => {
    const noon = parseClock("12:00");

    render(<DayRuler slots={[]} span={{ start: noon, end: noon }} />);

    expect(screen.getAllByText("12")).toHaveLength(1);
  });

  test("renders an empty day without a summary that implies data", () => {
    render(<DayRuler slots={[]} />);

    expect(screen.getByRole("img").getAttribute("aria-label")).toBe(
      "Day ruler, 06:00 to 22:00. No slots.",
    );
  });
});

/**
 * FUEL-113: a scale label the NOW pill reaches stands down whole. At 18:54 on a
 * phone the pill covered all of `18` but its `1`, and the scale read "1 NOW".
 *
 * jsdom has no layout, so this evaluates the `clip-path` string itself at every
 * width the ruler could be given, and checks the answer against the two boxes
 * as Chromium draws them. The sizes below are measured, not the component's
 * constants: those are estimates, and an estimate checked against itself would
 * pass however wrong it was.
 *
 * The sweep calls `scaleLabelClip` directly — a render per minute cost six
 * seconds of jsdom for nothing the builder does not already say — and the test
 * after it pins every rendered label to that builder at its own anchor, so what
 * is swept is what ships.
 */
describe("the scale beside the NOW pill", () => {
  /**
   * Chromium on `/dev/day-ruler`, Liberation Sans, at 10.5, 15.75 and 21px: a
   * label is 1.433em at all three, and the pill is 2.924em of tracked text plus
   * 7px of padding a side that does not grow with it. SF Pro is wider than
   * this, and nothing here can say by how much.
   */
  const LABEL_EM = 15.05 / 10.5;
  const pillWidth = (em: number) => (30.7 / 10.5) * em + 14;

  /** Where the pill is drawn: `clamp(2.2em, n%, calc(100% - 2.2em))`. jsdom
   * drops that inline style, so it is restated rather than read. */
  const pillCentre = (at: number, ruler: number, em: number) =>
    Math.max(2.2 * em, Math.min((positionInSpan(at) / 100) * ruler, ruler - 2.2 * em));

  /** Micro is 10.5px; the sweep runs to 200% Dynamic Type. */
  const TEXT_SCALES = [1, 1.5, 2];

  /**
   * The phone's copy runs from ~265px (a 320 screen at 200%) to ~723 (767 at
   * 100%), sampled every 3px because the expression is piecewise linear in the
   * width; then the band's 720, its 776 ceiling, and the header's widths.
   */
  const RULER_WIDTHS = [
    ...Array.from({ length: 177 }, (_, i) => 240 + i * 3),
    720, 776, 968, 1080, 1200, 1400,
  ];

  const MINUTES = Array.from(
    { length: DEFAULT_SPAN.end - DEFAULT_SPAN.start + 1 },
    (_, i) => DEFAULT_SPAN.start + i,
  );

  /** The scale as rendered: first anchored left, last right, the rest centred. */
  const SCALE: { mark: string; at: number; anchor: LabelAnchor }[] = [
    { mark: "06", at: parseClock("06:00"), anchor: 0 },
    { mark: "12", at: parseClock("12:00"), anchor: 0.5 },
    { mark: "18", at: parseClock("18:00"), anchor: 0.5 },
    { mark: "22", at: parseClock("22:00"), anchor: 1 },
  ];

  /**
   * Less than this is nothing a screen can show. It is here for the knife-edge
   * where the two boxes exactly meet and the overlap comes out as 1e-13 rather
   * than 0 — a clip of a ten-millionth of a pixel is not a part-covered label.
   */
  const SUBPIXEL = 0.01;

  /**
   * `inset(0 0 0 <length>)` → the left inset in px, as a function of the ruler's
   * width, the text size and the label's own width (which `%` resolves against).
   * Only the grammar `scaleLabelClip` emits is understood; anything else throws,
   * so a change of shape fails here rather than evaluating to nonsense.
   */
  function compileInset(clipPath: string) {
    const inner = /^inset\(0 0 0 (.+)\)$/.exec(clipPath)?.[1];

    if (!inner) throw new Error(`Not an inset this test reads: ${clipPath}`);

    const unit = { cqw: "W/100", em: "EM", "%": "LW/100" } as const;
    const js = inner
      .replace(
        /(\d+(?:\.\d+)?)(cqw|em|%)/g,
        (_, n: string, u: keyof typeof unit) => `(${n}*${unit[u]})`,
      )
      .replace(/\b(min|max)\(/g, "Math.$1(");

    const residue = js.replace(/Math\.(?:min|max)|clamp|LW|EM|W/g, "");

    if (!/^[\d.\s()*+\-,/]*$/.test(residue)) {
      throw new Error(`Unrecognised unit or function in ${clipPath}`);
    }

    // CSS's clamp: the minimum wins when the bounds cross.
    const clamp = (lo: number, value: number, hi: number) =>
      Math.max(lo, Math.min(value, hi));
    const evaluate = new Function("W", "EM", "LW", "clamp", `return ${js};`);

    return (W: number, EM: number, LW: number): number =>
      evaluate(W, EM, LW, clamp);
  }

  test("every label is either wholly drawn or wholly clipped, at every minute, width and text size", () => {
    const failures: string[] = [];
    let hidden = 0;
    let drawn = 0;

    for (const now of MINUTES) {
      const insets = SCALE.map(({ at, anchor }) =>
        compileInset(scaleLabelClip(at, anchor, now)),
      );

      for (const scale of TEXT_SCALES) {
        const em = 10.5 * scale;
        const labelWidth = LABEL_EM * em;
        const pillHalf = pillWidth(em) / 2;

        for (const ruler of RULER_WIDTHS) {
          const centre = pillCentre(now, ruler, em);

          SCALE.forEach(({ mark, at, anchor }, index) => {
            const left = (positionInSpan(at) / 100) * ruler - anchor * labelWidth;
            const touches =
              centre - pillHalf < left + labelWidth && centre + pillHalf > left;
            const inset = insets[index]!(ruler, em, labelWidth);
            const where = `at ${now} min, ${ruler}px, ×${scale}`;

            if (inset < SUBPIXEL) {
              drawn += 1;
              if (touches) failures.push(`${mark} drawn under the pill ${where}`);
            } else if (inset >= labelWidth) {
              hidden += 1;
            } else {
              failures.push(`${mark} part-clipped (${inset.toFixed(2)}px) ${where}`);
            }
          });
        }
      }
    }

    expect({ count: failures.length, first: failures.slice(0, 5) }).toEqual({
      count: 0,
      first: [],
    });
    // Not vacuous: both outcomes happen, and hiding stays the exception.
    expect(hidden).toBeGreaterThan(0);
    expect(hidden).toBeLessThan(drawn / 4);
  }, 60_000);

  test.each(["06:00", "11:52", "18:54", "22:00"])(
    "renders each label with that builder at its own anchor, at %s",
    (clock) => {
      const now = parseClock(clock);

      render(<DayRuler slots={SLOTS} now={now} />);

      for (const { mark, at, anchor } of SCALE) {
        expect(screen.getByText(mark).style.clipPath).toBe(
          scaleLabelClip(at, anchor, now),
        );
      }
    },
  );

  test("hides the 18 at 18:54 on a phone and keeps it at the band's width", () => {
    const eighteen = compileInset(
      scaleLabelClip(parseClock("18:00"), 0.5, parseClock("18:54")),
    );
    const labelWidth = LABEL_EM * 10.5;

    // 331px is the ruler on the 375 baseline — the "1 NOW" of the ticket.
    expect(eighteen(331, 10.5, labelWidth)).toBe(labelWidth);
    expect(eighteen(720, 10.5, labelWidth)).toBe(0);
  });

  test("clips nothing when there is no NOW on the ruler", () => {
    render(<DayRuler slots={SLOTS} />);

    for (const { mark } of SCALE) {
      expect(screen.getByText(mark).style.clipPath).toBe("");
    }
  });

  // § The Four Rules: one umber element per screen. Standing a label down must
  // not add a second accent thing, and must never colour the scale.
  test("keeps the accent to the rule and the pill", () => {
    const { container } = render(
      <DayRuler slots={SLOTS} now={parseClock("18:54")} />,
    );

    expect(container.querySelectorAll('[class*="accent"]')).toHaveLength(2);
    for (const { mark } of SCALE) {
      expect(screen.getByText(mark).className).not.toContain("accent");
    }
  });
});
