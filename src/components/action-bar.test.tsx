import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { render } from "@testing-library/react";
import { describe, expect, test } from "vitest";

import { ACTION_BAR, APP_ACTION_BAR } from "@/components/action-bar";

import Loading from "@/app/(app)/loading";

/**
 * The action bar's one class string — FUEL-83.
 *
 * `/`'s bar, `/training`'s, the `/` skeleton and the `/dev/nav-shell` specimen
 * were four identical literals held in step by hand across FUEL-58, FUEL-65 and
 * FUEL-83. This file is what replaces the hand.
 *
 * Two halves, because the drift has two shapes. `right-now.test.tsx` and
 * `training.test.tsx` assert their own bars ARE `APP_ACTION_BAR`, and the
 * skeleton's is asserted here since it has no suite of its own; that catches a
 * bar wired to something else. The source scan below catches the other and more
 * likely one — a fifth bar written as a literal by someone who never learned
 * there was a constant.
 */

const THIS_FILE = fileURLToPath(import.meta.url);
const SRC = join(dirname(THIS_FILE), "..");
const CONSTANTS = join(SRC, "components/action-bar.ts");
const CSS = readFileSync(join(SRC, "app/globals.css"), "utf8");

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return walk(path);
    return /\.(ts|tsx)$/.test(entry.name) ? [path] : [];
  });
}

describe("the skeleton takes the same string as the bar it stands in for", () => {
  test("not merely a string that looks like it", () => {
    // § Feedback: "skeletons matching final layout". The property that matters
    // is that nothing moves on swap-in, and every part of this string can break
    // it — `loading.tsx` records the 86px jump a skeleton pinned to 0 produced
    // while the real bar cleared `--nav-shell-h`. Identity rather than
    // `toContain`, so a skeleton that gains or loses one class is caught too.
    const { container } = render(<Loading />);

    const bar = container.querySelector(".action-bar-fade");

    expect(bar).not.toBeNull();
    expect(bar?.className).toBe(APP_ACTION_BAR);
  });
});

describe("no second copy of the string", () => {
  // The literal that used to be written out four times. Anything still carrying
  // it is a bar that has stopped following the other three.
  const LITERAL = "bottom-[var(--nav-shell-h)]";

  test.each(walk(SRC).filter((path) => path !== CONSTANTS && path !== THIS_FILE))(
    "%s does not spell the bar out for itself",
    (path) => {
      expect(readFileSync(path, "utf8")).not.toContain(LITERAL);
    },
  );

  test("and the constants file is where it does live", () => {
    // The guard above passes vacuously if the string is ever renamed and this
    // file is not — every file would be clean because none of them, including
    // the real one, would contain it. Planting the positive is the cheap half.
    expect(readFileSync(CONSTANTS, "utf8")).toContain(LITERAL);
  });

  test("the specimen's bar is the shared one minus the desktop release", () => {
    // `/dev/nav-shell` frames a 375×667 phone inside a page usually read on a
    // desktop, so `lg:` there would answer to the browser window rather than to
    // the frame. That is the one difference between the four, and it is a
    // difference in what is ADDED — the specimen cannot drift in the parts it
    // shares without this failing.
    expect(APP_ACTION_BAR).toBe(`${ACTION_BAR} lg:bottom-0`);
    expect(ACTION_BAR).not.toContain("lg:");
  });
});

describe("the scroll edge", () => {
  /**
   * The rule, matched by shape rather than by position: the media query it sits
   * in and the declarations it carries, in one go. Reading it by slicing the
   * file at the selector and anchoring the query to the end of the slice worked,
   * but tied the assertions to how `globals.css` happens to be formatted — a
   * Prettier run that moved a blank line would have failed a test about a
   * stylesheet that had not changed.
   */
  const RULE = CSS.match(
    /@media \(([^)]+)\)\s*\{\s*\.action-bar-fade\s*\{([^}]*)\}/,
  );

  function declaration(property: string): string {
    const found = RULE?.[2]?.match(new RegExp(`${property}:\\s*([^;]+);`))?.[1];

    expect(found, `${property} not declared on .action-bar-fade`).toBeDefined();
    return found ?? "";
  }

  test("is one rule, in one media query, in globals.css", () => {
    // Everything below reads out of this match, so its absence would make the
    // rest of the block assert nothing.
    expect(RULE).not.toBeNull();
  });

  test("is a class the bar actually carries, and globals.css actually defines", () => {
    // Two files, one name, and nothing in the type system joining them. Either
    // half renamed alone leaves a bar with a hard edge and no error anywhere.
    expect(ACTION_BAR).toContain("action-bar-fade");
    expect(CSS).toContain(".action-bar-fade");
  });

  test("finishes inside the bar's head, so the focus ring stays opaque", () => {
    // The load-bearing number, and the reason the ramp is not simply the full
    // 30px of padding. § Accessibility: a 2px ring at 2px offset, "never
    // removed" — so the primary's ring rises 4px above it, and a ramp running
    // the whole head fades the top of it. Not a deduction: at 375×667 a 30px
    // ramp measurably dims 664 pixels of that ring against a 24px one, which is
    // its whole top arc. Read from the CSS and the class string rather than
    // restated, so shortening the head or lengthening the ramp fails here
    // instead of dimming a focus ring nobody is looking at.
    const ramp = Number(declaration("mask-image").match(/(\d+)px/)?.[1]);
    const head = Number(APP_ACTION_BAR.match(/pt-\[(\d+)px\]/)?.[1]);
    const ring = 2 + 2;

    expect(ramp).toBeGreaterThan(0);
    expect(head).toBeGreaterThan(0);
    expect(ramp + ring).toBeLessThanOrEqual(head);
  });

  test("is scoped to the widths where the bar is pinned over a scrolling page", () => {
    // Below `lg` only. FUEL-72 may release the pinning at desktop widths, at
    // which point the bar comes to rest at the foot of its column with real
    // content above it — where a fade would ghost content with nothing passing
    // under it to justify the ramp. Scoping now means that ticket finds nothing
    // here to undo.
    expect(RULE?.[1]).toBe("width < 64rem");
  });
});
