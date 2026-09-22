import { type Page, expect } from "@playwright/test";

/**
 * Getting the session state onto a WORKING step — FUEL-125.
 *
 * Every spec that measures the session state was written when `Start session`
 * landed on the first working exercise. FUEL-125 made the warm-up and the
 * cool-down steps of the session, so it now lands on the first warm-up row: a
 * short measure with cues instead of a set sub-list, and no set rows at all.
 *
 * Two specs assert against the working step and both broke on it, each in the
 * way it was built to break. `set-rows.spec.ts` waited for a set row that is
 * not drawn there. `session-bar.spec.ts` measures the bar through a scroll and
 * its own guard fired — *the page must actually scroll for this measurement to
 * mean anything* — because a warm-up step scrolls 65px where it wants 100.
 *
 * So this is one helper rather than the same walk written twice. What it does
 * is what a reader does: press `Next exercise` until the work is on screen.
 * Seeding the stage key instead would assert that the key is spelled right
 * rather than that the work is reachable, which is the objection
 * `session-bar.spec.ts` already records against seeding the entered instant.
 */

/** A set row — the work's own marker, drawn on no other kind of step. */
export const SET_ROWS = 'main li:has(input[aria-label^="Set "])';

/**
 * More steps than any lead-in this program prescribes.
 *
 * The seed gives every workout a two-row warm-up. The bound is not that number
 * because a fixture is free to change; it is a bound on a loop that would
 * otherwise spin if `Next exercise` ever stopped advancing, and the assertion
 * after it is what reports the failure.
 */
const LEAD_IN_MAX = 8;

/**
 * Steps from wherever the session opened to its first working exercise.
 *
 * Each press waits for the Title to actually change before the next one, so the
 * walk is driven by the screen rather than by a sleep. A session already on a
 * working step is left where it is, which is what makes this safe to call
 * unconditionally — including for a session with no warm-up at all.
 */
export async function stepIntoWork(page: Page): Promise<void> {
  const rows = page.locator(SET_ROWS).first();
  const title = page.getByRole("heading", { level: 1 });

  for (let step = 0; step < LEAD_IN_MAX; step += 1) {
    if (await rows.isVisible()) break;

    const before = (await title.textContent()) ?? "";

    await page.getByRole("button", { name: /^Next exercise/ }).click();
    await expect(title).not.toHaveText(before);
  }

  await expect(
    rows,
    "the session state should be on a working step, with its set sub-list drawn",
  ).toBeVisible();
}
