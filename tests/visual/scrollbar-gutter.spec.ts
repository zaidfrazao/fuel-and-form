import { expect, test } from "@playwright/test";

import { FROZEN_NOW_MS } from "./constants";

/**
 * The scrollbar's gutter, and the scroll lock that used to compensate for it —
 * FUEL-87.
 *
 * ## What cannot be tested here, said first
 *
 * The reported fault is that the rail moves while a page loads. Its mechanism is
 * measured and certain: everything is centred on `--frame-max`, so a centred
 * element's x is `(clientWidth − 1272) / 2`, and a CLASSIC scrollbar changes
 * `clientWidth` by ~15px the moment a document stops overflowing. `/` at
 * clientWidth 1440 puts the rail at 84.0px; at 1425, at 76.5.
 *
 * **No browser available here can reproduce it.** Chromium and Firefox both draw
 * overlay scrollbars in this environment, and that is measured rather than
 * assumed: `innerWidth − clientWidth` is 0 with the document tall and 0 with it
 * short, in both engines, and it stays 0 under
 * `--disable-features=OverlayScrollbar`, under
 * `widget.gtk.overlay-scrollbars.enabled=false`, and with a styled
 * `::-webkit-scrollbar`.
 *
 * So there is no test below of the form "the rail does not move when the
 * document shrinks". One was written and deleted: under overlay scrollbars it
 * passes against an app with the fix reverted, which is worse than no test —
 * it would report the fault fixed for as long as CI runs on Linux. **The fault
 * is verified on a machine with classic scrollbars, by a person, and that is
 * recorded on the ticket rather than pretended away here.**
 *
 * What follows is the three things that can fail.
 */

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(FROZEN_NOW_MS);
  await page.goto("/");
  await expect(page.getByRole("main")).toBeVisible();
});

test("the document keeps its scrollbar's track at every height", async ({ page }) => {
  // Read off the used style rather than the stylesheet, so a rule overridden
  // later in the cascade fails here. What this catches is the declaration being
  // deleted or beaten — the realistic regression. What it cannot catch is the
  // declaration being present and ineffective, for the reason above.
  expect(
    await page.evaluate(() => getComputedStyle(document.documentElement).overflowY),
  ).toBe("scroll");
});

test("the fix costs nothing where scrollbars are overlays", async ({ page }) => {
  /*
   * What makes the visual baselines safe: forcing the track reserves no width on
   * a browser that draws its scrollbars as overlays, so all 72 screens are
   * byte-identical either side of this change.
   *
   * Not a discriminator between the two candidate fixes — `scrollbar-gutter:
   * stable` reserves nothing here either, once the document is in standards
   * mode. That was measured the wrong way round first: `page.setContent`
   * produces a quirks-mode document where the gutter does reserve 15px, and the
   * number is an artefact of `compatMode` rather than anything about this app.
   */
  for (const width of [1024, 1272, 1440, 1920]) {
    await page.setViewportSize({ width, height: 900 });

    expect(
      await page.evaluate(() => window.innerWidth - document.documentElement.clientWidth),
      `reserved gutter at ${width}px`,
    ).toBe(0);
  }
});

test("our scroll-lock override outranks the library that sets it", async ({ page }) => {
  /*
   * The regression the fix could have introduced, and the one part of it that
   * IS reproducible here.
   *
   * `react-remove-scroll-bar` measures `innerWidth − clientWidth` before locking
   * and adds it to the body as `margin-right !important`, on the assumption that
   * hiding the body's overflow takes a scrollbar away. With the track forced
   * above it does not, so that margin is compensation for nothing — 15px applied
   * the moment a swap opens and removed when it closes, which is this ticket's
   * own jump arriving from the other direction. globals.css cancels it.
   *
   * Whether the cancellation *works* is a CSS cascade question rather than a
   * scrollbar question, so it survives having no classic scrollbar to test
   * against. The library injects its rule at runtime, after this app's
   * stylesheet, with the same `body[data-scroll-locked]` selector and the same
   * `!important` — equal specificity, both important, so source order decides
   * and theirs is later. **The obvious version of our rule loses**, which is
   * what this asserts against: the app ships `html body[data-scroll-locked]`,
   * one element more specific, and this fails if that `html` is ever tidied
   * away.
   */
  await page.setViewportSize({ width: 1440, height: 900 });

  const marginRight = await page.evaluate(() => {
    // Exactly what the library appends when a sheet opens, with a non-zero gap
    // standing in for the classic scrollbar this browser cannot draw.
    const lib = document.createElement("style");
    lib.textContent = "body[data-scroll-locked] { margin-right: 15px !important; }";
    document.head.appendChild(lib);
    document.body.setAttribute("data-scroll-locked", "");

    const computed = getComputedStyle(document.body).marginRight;

    lib.remove();
    document.body.removeAttribute("data-scroll-locked");
    return computed;
  });

  expect(marginRight, "a locked body must not be pushed by a scrollbar that never left").toBe(
    "0px",
  );
});

test("the sheet still opens and closes without moving the page", async ({ page }) => {
  // The behaviour the rule above protects, asserted end to end. Under overlay
  // scrollbars the library's gap is 0 and this would pass without the override
  // — it is here as the statement of what the override is for, and it is the
  // assertion that becomes load-bearing the day this suite runs on a browser
  // whose scrollbars take width.
  await page.setViewportSize({ width: 1440, height: 900 });

  // `locator("main")` and not `getByRole("main")`: the sheet is `aria-modal`, so
  // Radix takes the page out of the accessibility tree while it is open and a
  // role query waits for a landmark that is deliberately no longer there.
  // `sheet.spec.ts` carries the same note and the same workaround.
  //
  // Which leaves the skeleton, and it had no guard at all until FUEL-79 — this
  // failed a full run as `strict mode violation: locator('main') resolved to 2
  // elements`, having passed the two before it on identical code.
  // `(app)/loading.tsx` renders a `<main>` of its own, and the fix the rest of
  // the suite uses does not reach here twice over: `:not([aria-hidden])` works
  // for `.action-bar-fade` because the skeleton's BAR is inside an aria-hidden
  // tree, but the skeleton's `<main>` is not marked at all — and the role query
  // that would otherwise settle it is already spoken for by the sheet.
  //
  // Waiting for the count is what is left, and it is the honest condition
  // anyway: one `main` on the page means the skeleton has gone.
  // `monotonic.spec.ts` has the longer note.
  await expect(page.locator("main")).toHaveCount(1);

  const mainX = () => page.locator("main").evaluate((n) => n.getBoundingClientRect().x);
  const before = await mainX();

  await page.getByRole("button", { name: "Swap" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  expect(await mainX(), "content x with the sheet open").toBeCloseTo(before, 1);

  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toBeHidden();
  expect(await mainX(), "content x after the sheet closes").toBeCloseTo(before, 1);
});
