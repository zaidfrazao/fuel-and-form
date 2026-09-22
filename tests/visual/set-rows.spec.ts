import { type Page, expect, test } from "@playwright/test";

import { FROZEN_NOW_MS } from "./constants";
import { stepIntoWork } from "./session";

/**
 * The set row at 375, with last time's reps on it — FUEL-122.
 *
 * The ticket's last criterion is a measurement: "at 375 the row stays ≥46px and
 * one line, measured in a browser". jsdom applies no stylesheet, so the unit
 * suite can say what the clause SAYS and nothing about whether it fits. A dense
 * row's unit line is the `flex-1` span, which holds all of the row's slack
 * (Brand Guide § Lists), so a clause that is too long does not overflow — it
 * wraps, and the row grows.
 *
 * ## Why this does not trust the demo's own figures
 *
 * The frozen demo's current exercise is whichever one the day resolves to, and
 * its target may be one of the short ones. So after asserting the real rows,
 * the spec writes the LONGEST line the seed can produce into a real row's span
 * and measures that too. It changes the DOM of one page and writes nothing to
 * the demo, which `visual-specs-must-not-mutate-the-demo` would forbid.
 */

/** The set rows of the session state: a list item holding a reps box. */
const ROWS = 'main li:has(input[aria-label^="Set "])';

/*
 * The unit line is the span AFTER the box. Not `span.text-slash`: the ordinal
 * carries that class too and comes first, and the first draft of this file
 * measured `01` and then wrote the long line into its 18px column.
 */

/**
 * The widest unit lines the seed can draw — its widest ranges, with last time
 * at the range's top.
 *
 * `Target 30–40` and `Target 12–20` are the two widest labels in
 * `seed/workouts.ts`. Both are measured because the digits are proportional in
 * this face, so the character count does not settle which is wider.
 */
const WIDEST = [
  "Target 30–40 · 40 last time",
  "Target 12–20 · 20 last time",
  /*
   * The timed holds — FUEL-123. Every seconds range in the seed is two digits
   * to two, so these four are the candidates, and all four are measured for
   * the proportional-digit reason above. The unit is `s` against the figure
   * rather than `sec`: `Target 30–60 sec · 60 last time` measured wider than
   * the line's 164px, and wrapped.
   */
  "Target 30–60s · 60 last time",
  "Target 30–45s · 45 last time",
  "Target 20–40s · 40 last time",
  "Target 20–30s · 30 last time",
];

async function enterSession(page: Page) {
  await page.clock.setFixedTime(FROZEN_NOW_MS);
  await page.setViewportSize({ width: 375, height: 800 });
  await page.goto("/training");
  await page.getByRole("button", { name: "Start session" }).click();
  // The session opens on the warm-up since FUEL-125, and a warm-up draws no
  // set rows — PRD § P10 puts set logging on the working section only. So the
  // rows this file measures are two steps in, and `stepIntoWork` walks there
  // the way a reader does.
  await stepIntoWork(page);
}

/** A row's height, and how many lines its unit span wraps to. */
const measure = (page: Page) =>
  page.locator(ROWS).evaluateAll((rows) =>
    rows.map((row) => {
      const unit = row.querySelector<HTMLElement>("input + span");

      if (!unit) throw new Error("a set row with no unit line");

      const lineHeight = parseFloat(getComputedStyle(unit).lineHeight);

      return {
        text: unit.textContent,
        height: row.getBoundingClientRect().height,
        lines: Math.round(unit.getBoundingClientRect().height / lineHeight),
      };
    }),
  );

test.describe("the set row at 375 — FUEL-122", () => {
  test.beforeEach(async ({ page }) => enterSession(page));

  test("carries last time and stays one 46px line", async ({ page }) => {
    const rows = await measure(page);

    // The positive, planted first: without a clause on screen, every
    // assertion below would pass against a build that never draws one.
    expect(rows.some((row) => row.text?.includes("last time"))).toBe(true);

    for (const row of rows) {
      expect(row.height, row.text ?? "").toBeGreaterThanOrEqual(46);
      expect(row.lines, row.text ?? "").toBe(1);
    }
  });

  test("fits the widest line the seed can produce", async ({ page }) => {
    for (const text of WIDEST) {
      await page
        .locator(ROWS)
        .first()
        .evaluate((row, line) => {
          row.querySelector("input + span")!.textContent = line;
        }, text);

      const [row] = await measure(page);

      expect(row?.text).toBe(text);
      expect(row?.height, text).toBeGreaterThanOrEqual(46);
      expect(row?.lines, text).toBe(1);
    }
  });
});
