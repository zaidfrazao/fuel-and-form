import { describe, expect, test } from "vitest";

import { ACTION_BAR_AT } from "@/components/action-bar";
import { build, enclosingAtRules } from "@/lib/tailwind-build.test-helper";

/**
 * `/`'s two copies of the bar, compiled rather than read — FUEL-114.
 *
 * `action-bar.test.tsx` holds the spelling. What it cannot hold is what the
 * spelling means, and each fault this file is here for leaves a green unit
 * suite behind it, because jsdom applies no stylesheet:
 *
 *   - **Two bars, or none.** The copies hand over at one width. `lg:hidden` on
 *     one and `max-lg:hidden` on the other are complementary only if both
 *     compile to the same 64rem, one with `>=` and one with `<`. A variant
 *     that sorted or resolved differently would draw both bars in some band,
 *     or neither. That is the fault FUEL-77 shipped with the ruler, found only
 *     by looking at a picture.
 *   - **The band's spacing.** `lg:max-xl:` has to nest the two queries. A
 *     `pt-0` that leaked to the cap would take the 30px the grid needs there,
 *     because the grid has no row gap.
 */

const widthOf = (atRules: readonly string[]) => atRules.join(" ");

describe("the two copies hand over at one width", () => {
  test("the phone's stands down at 1024", async () => {
    const css = await build(["lg:hidden"]);

    expect(widthOf(enclosingAtRules(css, "lg:hidden"))).toMatch(/@media \(width >= 64rem\)/);
  });

  test("the desktop's is drawn from 1024, and not below it", async () => {
    const css = await build(["max-lg:hidden"]);

    expect(widthOf(enclosingAtRules(css, "max-lg:hidden"))).toMatch(/@media \(width < 64rem\)/);
  });

  test("and those are the utilities the two copies wear", () => {
    // The control for the two above: they compile the literal, so they would
    // go on passing if `ACTION_BAR_AT` stopped using it.
    expect(ACTION_BAR_AT.phone.split(" ")).toContain("lg:hidden");
    expect(ACTION_BAR_AT.desktop.split(" ")).toContain("max-lg:hidden");
  });
});

describe("the band's spacing stays in the band", () => {
  test.each(["lg:max-xl:pt-0", "lg:max-xl:mt-0"])(
    "%s is nested inside 1024 and under 1272",
    async (utility) => {
      expect(ACTION_BAR_AT.desktop.split(" ")).toContain(utility);

      const css = await build([utility]);

      expect(css).toMatch(/@media \(width >= 64rem\) \{\s*@media \(width < 1272px\) \{/);
      expect(widthOf(enclosingAtRules(css, utility))).toMatch(/64rem.*1272px/);
    },
  );
});
