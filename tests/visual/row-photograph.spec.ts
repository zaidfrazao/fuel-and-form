import { type Page, expect, test } from "@playwright/test";

import { FROZEN_NOW_MS, WIDTHS } from "./constants";

/**
 * The row's photograph on `/training` — FUEL-129, § Lists › The row's
 * photograph.
 *
 * Every claim here is a layout claim or a network claim, and jsdom can make
 * neither: it applies no stylesheet, so `self-start` in a baseline row and a
 * column that belongs to a group are both invisible to the unit suite, and it
 * fetches nothing, so "`/` loads no media" can only be asserted by watching a
 * real page's requests.
 *
 * Read-only against the shared demo, as every visual spec must be: tapping a
 * row opens its sets sheet and records nothing.
 */

/** The drawn copy of `/training`'s plan-state list — FUEL-118 renders two. */
const LIST = "main [data-list]:visible";

/** A row's name — the first Body-size text in it; the ordinal is Slash. */
const NAME = ".text-body";

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(FROZEN_NOW_MS);
});

type Row = {
  name: string;
  nameX: number;
  nameTop: number;
  img: { x: number; top: number; width: number; height: number } | null;
};

/** Every row of the drawn list, grouped by its section heading. */
async function groups(page: Page): Promise<Record<string, Row[]>> {
  return page.locator(LIST).evaluate((list, name) => {
    const out: Record<string, Row[]> = {};

    for (const section of list.querySelectorAll("section")) {
      const heading = section.querySelector("h2")!.textContent!;
      out[heading] = [...section.querySelectorAll("li")].map((li) => {
        const label = li.querySelector(name)!.getBoundingClientRect();
        const img = li.querySelector("img")?.getBoundingClientRect();
        return {
          name: li.querySelector(name)!.textContent!,
          nameX: label.left,
          nameTop: label.top,
          img: img ? { x: img.left, top: img.top, width: img.width, height: img.height } : null,
        };
      });
    }

    return out;
  }, NAME);
}

for (const { width, height } of WIDTHS) {
  test(`the work leads with its photographs and the bookends draw no column, at ${width}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height });
    await page.goto("/training");
    await expect(page.locator(LIST)).toBeVisible();

    const drawn = await groups(page);
    const [warmUp = [], work = [], coolDown = []] = ["Warm-up", "Work", "Cool-down"].map(
      (heading) => drawn[heading],
    );

    // The fixture's session is five working rows, every one with a reference.
    // If that ever stops being true this spec is no longer measuring the
    // case it was written for, and should say so rather than pass on less.
    expect(work.length, "the fixture's working rows").toBe(5);

    for (const row of work) {
      expect(row.img, `${row.name} should lead with its photograph`).not.toBeNull();
      // 72×48 is 850×567 at 72 wide, so the height is 48.02, not 48.
      expect(row.img!.width).toBe(72);
      expect(row.img!.height).toBeCloseTo(48, 0);
      // Top-aligned with the row's first line, not hung from its baseline.
      expect(row.img!.top, `${row.name}'s photograph against its name`).toBeCloseTo(
        row.nameTop,
        0,
      );
      // Leading: the name starts after the photograph and its 12px gap.
      expect(row.nameX).toBe(row.img!.x + 72 + 12);
    }

    // The group owns the column, so its names start on one x.
    expect(new Set(work.map((row) => row.nameX)).size).toBe(1);

    // No reference in either bookend, so neither draws the column: their names
    // start where the work's photographs do.
    for (const row of [...warmUp, ...coolDown]) {
      expect(row.img, `${row.name} has no reference`).toBeNull();
      expect(row.nameX, `${row.name} should not be indented by an empty column`).toBe(
        work[0]!.img!.x,
      );
    }
  });
}

test("nothing moves as the photographs arrive", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 667 });

  /*
   * Hold every photograph until the list has been measured without them. The
   * manifest's `width` and `height` are the whole claim: without them each row
   * would be drawn with an empty 72×0 box and grow as its file landed.
   */
  let release!: () => void;
  const held = new Promise<void>((resolve) => (release = resolve));
  await page.route("**/form/**", async (route) => {
    await held;
    await route.continue();
  });

  await page.goto("/training");
  const list = page.locator(LIST);
  await expect(list).toBeVisible();

  const before = await list.evaluate((el) => el.getBoundingClientRect().height);
  expect(
    await list
      .locator("img")
      .evaluateAll((imgs) => imgs.filter((img) => (img as HTMLImageElement).complete).length),
    "the photographs must not have loaded yet, or this measures nothing",
  ).toBe(0);

  release();
  await list.locator("img").last().scrollIntoViewIfNeeded();
  await expect
    .poll(() =>
      list
        .locator("img")
        .evaluateAll((imgs) =>
          imgs.every((img) => (img as HTMLImageElement).complete && (img as HTMLImageElement).naturalWidth > 0),
        ),
    )
    .toBe(true);

  expect(await list.evaluate((el) => el.getBoundingClientRect().height)).toBe(before);
});

test("`/` draws no photograph and requests nothing from /form/", async ({ page }) => {
  const requested: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname.startsWith("/form/")) requested.push(request.url());
  });

  await page.goto("/");
  await expect(page.getByRole("main")).toBeVisible();
  await page.waitForLoadState("networkidle");

  await expect(page.locator("main img")).toHaveCount(0);
  expect(requested).toEqual([]);
});

test("the photograph is part of the row: tapping it opens the row's sheet", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 667 });
  await page.goto("/training");

  const photo = page.locator(`${LIST} img`).first();
  await photo.scrollIntoViewIfNeeded();
  await photo.click();

  await expect(page.getByRole("dialog")).toBeVisible();
});

test("a 16:9 reference keeps its own ratio rather than being cropped to 3:2", async ({ page }) => {
  /*
   * The dead bug's frames are 1280×720, the one asset that is not 850×567.
   * § The row's photograph refuses a crop and a fill both, so its box is the
   * column's 72 by its own 40.5 — not 72×48 with `object-fit` cutting the
   * hand and the foot off the sides.
   *
   * Found by walking the frozen week rather than by naming a date, because
   * which day carries the core session is the seed's to decide.
   */
  await page.setViewportSize({ width: 820, height: 1180 });

  const monday = new Date(FROZEN_NOW_MS);
  monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7));

  for (let day = 0; day < 7; day += 1) {
    const date = new Date(monday);
    date.setUTCDate(monday.getUTCDate() + day);
    await page.goto(`/training?date=${date.toISOString().slice(0, 10)}`);
    await expect(page.getByRole("main")).toBeVisible();

    const row = page.locator(`${LIST} li`, { hasText: "Dead bug" });
    if ((await row.count()) === 0) continue;

    const box = await row.locator("img").evaluate((img) => {
      const rect = img.getBoundingClientRect();
      return { width: rect.width, height: rect.height };
    });

    expect(box.width).toBe(72);
    expect(box.height).toBeCloseTo(40.5, 0);
    return;
  }

  throw new Error("no day in the frozen week draws the dead bug — the fixture has moved");
});
