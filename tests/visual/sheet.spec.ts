import { type Locator, type Page, expect, test } from "@playwright/test";

import { FROZEN_NOW_MS } from "./constants";

/**
 * The sheet, measured — Brand Guide § Desktop, "Sheets, against a pointer",
 * FUEL-73.
 *
 * § Desktop rules that a sheet stays a sheet above 1024px, "held to the
 * measure's column", rather than becoming a centred dialog. Held to WHICH column
 * is a number about a rendered page, and every cheaper place to assert it is
 * blind: jsdom has no layout, so the unit suite can hold that the sheet wears
 * `lg:col-start-2` and nothing about where that lands; the baselines hold the
 * picture but report a fault as "some pixels differ".
 *
 * The fault this exists to catch is a specific one. `mx-auto` inside a `fixed
 * inset-x-0` box centres on the VIEWPORT, and the measure is the frame's second
 * column — so the sheet was 68px to the right of the column it was opened from
 * at the frame's cap and beyond. That number is asserted below rather than
 * described, because it is the whole of the bug.
 *
 * ## Why one spec that resizes, rather than the project matrix
 *
 * The same reason `frame.spec.ts` and `action-bar.spec.ts` are each a project of
 * their own: this asks whether two boxes share an edge, which has no theme and
 * does not want eight runs. It also needs 1023, 1024 and 1440 — three widths no
 * baseline covers, and the three where a breakpoint fault would live.
 *
 * ## Why `/`
 *
 * It is where the swap sheet is opened from in the app, and § Desktop's own
 * example: "the swap's cost and its choice may not be put on opposite sides of a
 * gutter". `/plan/template` opens the picker without the totals and is the other
 * composition; the geometry is the same primitive and is asserted once.
 */

/** The frame's cap, and its first two tracks. Read from the same numbers `globals.css` declares. */
const FRAME_MAX = 1272;
const RAIL = 220;
const GUTTER = 28;
const MEASURE = 640;

/**
 * How far the measure's centre sits from the frame's, once the frame has stopped
 * growing: 248 + 320 − 636. Negative because the rail is on the left, so the
 * column the sheet belongs to is left of the middle of the window.
 */
const OFFSET_FROM_CENTRE = RAIL + GUTTER + MEASURE / 2 - FRAME_MAX / 2;

const boxOf = async (locator: Locator) => {
  const box = await locator.boundingBox();

  if (!box) throw new Error("element is not visible, so it has no box");

  return box;
};

/** Open the swap sheet the way a reader does, and wait for it to be there. */
async function openSwapSheet(page: Page) {
  await page.goto("/");
  await expect(page.getByRole("main")).toBeVisible();

  await page.getByRole("button", { name: "Swap" }).click();

  const sheet = page.getByRole("dialog");
  await expect(sheet).toBeVisible();

  return sheet;
}

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(FROZEN_NOW_MS);
});

/**
 * 1023 is the control: below `lg` nothing about this changed, and a diff there
 * means the desktop fix leaked down. 1024 is where the rail arrives, 1272 is the
 * frame's cap, and 1440 and 1920 are past it — where a viewport-centred sheet
 * drifts further from its column the wider the window gets.
 */
const WIDTHS = [1023, 1024, 1272, 1440, 1920];

for (const width of WIDTHS) {
  test(`the sheet stands in the content's column at ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });

    const sheet = await openSwapSheet(page);

    /**
     * `locator("main")` and not `getByRole("main")`, which finds nothing here.
     *
     * The sheet is `aria-modal`, so Radix marks everything outside it
     * `aria-hidden` — the page is gone from the accessibility tree for as long
     * as the sheet is up, which is the behaviour that stops a screen reader
     * wandering into the list behind. A role query respects that and waits for a
     * landmark that is deliberately no longer there; a CSS selector still finds
     * the box, which is all this needs.
     */
    const main = await boxOf(page.locator("main"));
    const box = await boxOf(sheet);

    /**
     * The same left edge and the same width as the column behind it — which is
     * the criterion in its exact words, "centred on the same grid as the
     * content, not on the viewport".
     *
     * Asserted as the box rather than as the centre, and that is deliberate: two
     * boxes can share a centre and disagree about their width, which at the
     * measure would be a sheet wider than the column it sits in. `frame.spec.ts`
     * asks about centres because a notice band and a column are not the same
     * width by design; here they are.
     *
     * A pixel of tolerance for sub-pixel layout: an odd remainder either side of
     * a centred frame lands on a half.
     */
    expect(Math.abs(box.x - main.x)).toBeLessThan(1);
    expect(Math.abs(box.width - main.width)).toBeLessThan(1);
  });
}

test("the sheet is not centred on the window once the frame has stopped growing", async ({
  page,
}) => {
  /**
   * The fault, stated as the number it was. Above the frame's cap the measure's
   * centre is a fixed 68px left of the window's, so a sheet that agreed with the
   * window would be 68px out — and the wider the screen, the more obviously.
   *
   * This is the assertion a "the sheet looks fine" screenshot cannot make. It
   * fails if anyone reintroduces a viewport centring, and it fails in the one
   * direction that matters rather than on any movement at all.
   */
  for (const width of [1272, 1440, 1920]) {
    await page.setViewportSize({ width, height: 900 });

    const sheet = await openSwapSheet(page);
    const box = await boxOf(sheet);

    // The window's own centre, as the page sees it. `innerWidth` rather than the
    // viewport size passed in: the scroll lock has taken the scrollbar away, and
    // the sheet is laid out against what is left.
    const windowCentre = (await page.evaluate(() => window.innerWidth)) / 2;
    const sheetCentre = box.x + box.width / 2;

    expect(Math.abs(sheetCentre - windowCentre - OFFSET_FROM_CENTRE)).toBeLessThan(1);
  }
});

/**
 * § Desktop: "What a pointer does change is how it closes. The grabber is a drag
 * affordance for a thumb and a mouse will not drag it. The backdrop is clickable
 * to dismiss and `Escape` closes the sheet — at every width."
 *
 * Radix supplies both, so these hold them rather than build them — and the first
 * is the one the positioning layer could plausibly break, since that layer spans
 * the window and lies over the scrim on either side of the sheet.
 */
test("the scrim closes it, including the width beside the sheet", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });

  const sheet = await openSwapSheet(page);
  const box = await boxOf(sheet);

  // Level with the sheet and well to its left: inside the positioning layer's
  // own box, which is exactly where a `pointer-events` mistake would swallow the
  // press and leave the reader clicking a scrim that does nothing.
  await page.mouse.click(box.x / 2, box.y + 40);

  await expect(sheet).toBeHidden();
});

test("Escape closes it", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });

  const sheet = await openSwapSheet(page);

  await page.keyboard.press("Escape");

  await expect(sheet).toBeHidden();
});

test("the scrim still covers the whole window", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });

  await openSwapSheet(page);

  const scrim = await boxOf(page.locator(".bg-scrim"));
  const viewport = await page.evaluate(() => ({
    width: window.innerWidth,
    height: window.innerHeight,
  }));

  expect(scrim.x).toBe(0);
  expect(scrim.y).toBe(0);
  expect(Math.abs(scrim.width - viewport.width)).toBeLessThan(1);
  expect(Math.abs(scrim.height - viewport.height)).toBeLessThan(1);
});

test("takes the page out of the accessibility tree while it is up", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });

  const sheet = await openSwapSheet(page);

  /**
   * Found while writing the measurement above, and worth holding rather than
   * merely working around: `aria-modal` is only as good as what it hides, and a
   * reader who can still reach the meal list behind the picker by swiping is in
   * exactly the position the focus trap exists to prevent.
   *
   * The landmark is present in the DOM and absent from the tree, and the two
   * assertions are not the same one twice. `<main>` does not itself carry
   * `aria-hidden` — Radix marks the portal's siblings at the top of the body, so
   * what is hidden is an ANCESTOR of main, and asserting the attribute on main
   * fails against an element that is correctly hidden. The role query is the
   * only one of the three that asks the question a screen reader asks.
   */
  await expect(page.getByRole("main")).toHaveCount(0);
  await expect(page.locator("main")).toBeVisible();
  expect(await page.locator('body > [aria-hidden="true"]').count()).toBeGreaterThan(0);

  await page.keyboard.press("Escape");
  await expect(sheet).toBeHidden();

  // And it comes back. A dialog that left the page hidden would be the worse
  // half of the same bug, invisible until someone closed one.
  await expect(page.getByRole("main")).toBeVisible();
});
