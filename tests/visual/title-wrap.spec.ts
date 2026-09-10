import { type Locator, type Page, expect, test } from "@playwright/test";

import { seedMeals } from "../../src/lib/seed/meals";
import { seedWorkouts } from "../../src/lib/seed/workouts";
import { titleText } from "../../src/lib/title";
import { FROZEN_NOW_MS } from "./constants";

/**
 * Where a Title breaks — FUEL-117, and Brand Guide § Typography.
 *
 * Headings balance, and a name's spaced dash stays with the words in front of
 * it. Both are claims about line breaks, which jsdom does not compute, and the
 * baselines hold only whichever meal the frozen instant lands on. So this puts
 * every name in the library into `/`'s own `<h1>` — the real column, the real
 * stylesheet — and reads the lines back.
 *
 * Three questions, and each fails on a different revert:
 *
 *   - **Does the Title balance?** Its computed style. Fails if the rule leaves
 *     `globals.css`.
 *   - **Does it cost a line?** For every name, balanced against the greedy wrap
 *     of the same text in the same box. This is the claim the rule was taken on
 *     — "it costs no height" — held for every name rather than the one on screen.
 *     A reverted rule passes it trivially; the other two are what catch that.
 *   - **Are the breaks the ones the ticket asked for?** The reported case at
 *     1024 and 1440, where the greedy wrap left "Apple" on its own, and the case
 *     balancing introduced at 375, where the dash opened line 2 until
 *     `titleText` bound it. Fails if either half is reverted.
 *
 * The text is built here with `titleText`, so this holds what the function and
 * the stylesheet do together, not that a component calls it. That half is
 * text rather than layout, and `right-now.test.tsx` and `training.test.tsx`
 * hold it for each Title that carries a library name.
 *
 * The DOM is edited, the demo is not: nothing here is sent to the server, so
 * the fixture every other project photographs is untouched.
 */

/** The ticket's four widths, and the two it reported the fault at. */
const WIDTHS = [375, 820, 1024, 1272, 1440, 1920];

const NAMES = [...seedMeals, ...seedWorkouts].map((item) => item.name);

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(FROZEN_NOW_MS);
});

/** `/`'s one visible `<h1>`, at a width. */
const titleAt = async (page: Page, width: number): Promise<Locator> => {
  await page.setViewportSize({ width, height: 900 });
  await page.goto("/");
  const title = page.locator("h1:visible");
  await expect(title).toHaveCount(1);

  return title;
};

/**
 * Sets the Title to `text` and returns its lines — once as the stylesheet sets
 * them, once forced to a greedy wrap.
 *
 * Lines are read from each character's own box and grouped by its top, which
 * is where a break shows. A no-break space reads back as a space, so the
 * assertions below are written in ordinary text.
 */
const linesOf = (title: Locator, text: string) =>
  title.evaluate((el, text) => {
    const read = () => {
      const node = el.firstChild as Text;
      const lines = new Map<number, string>();
      for (let i = 0; i < node.length; i++) {
        const range = document.createRange();
        range.setStart(node, i);
        range.setEnd(node, i + 1);
        const box = range.getClientRects()[0];
        if (!box) continue;
        const top = Math.round(box.top);
        lines.set(top, (lines.get(top) ?? "") + node.data[i]);
      }

      return [...lines.values()].map((line) => line.replaceAll("\u00A0", " ").trim());
    };

    el.textContent = text;
    const styled = read();
    el.style.textWrap = "wrap";
    const greedy = read();
    el.style.textWrap = "";

    return { styled, greedy };
  }, text);

for (const width of WIDTHS) {
  test(`/'s Title balances at ${width}`, async ({ page }) => {
    const title = await titleAt(page, width);

    await expect(title).toHaveCSS("text-wrap-style", "balance");
  });

  test(`balancing costs no Title a line at ${width}`, async ({ page }) => {
    const title = await titleAt(page, width);

    for (const name of NAMES) {
      const { styled, greedy } = await linesOf(title, titleText(name));

      expect(styled.length, `${name}: ${JSON.stringify(styled)}`).toBe(greedy.length);
    }
  });
}

test("the reported title no longer leaves one word on its own line", async ({ page }) => {
  for (const width of [1024, 1440]) {
    const title = await titleAt(page, width);
    const { styled, greedy } = await linesOf(title, titleText("Overnight Oats — Cinnamon Apple"));

    // The fault as it was reported, so this cannot pass against a column that
    // happens to be wide enough for the name to fit on one line.
    expect(greedy, `greedy at ${width}`).toEqual(["Overnight Oats — Cinnamon", "Apple"]);
    expect(styled, `balanced at ${width}`).toEqual(["Overnight Oats —", "Cinnamon Apple"]);
  }
});

test("a Title's dash ends its line rather than opening the next, at 375", async ({ page }) => {
  const title = await titleAt(page, 375);

  for (const variant of ["PB Cocoa", "Vanilla Berry"]) {
    const { styled } = await linesOf(title, titleText(`Overnight Oats — ${variant}`));

    expect(styled).toEqual(["Overnight Oats —", variant]);
  }
});
