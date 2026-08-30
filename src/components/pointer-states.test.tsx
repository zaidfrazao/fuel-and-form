import { render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";

import { Tile } from "@/components/tile";
import { Button } from "@/components/ui/button";

/**
 * The two places a pointer state can be lost between `pointer.ts` and the DOM.
 *
 * This file asserts class names, which the rest of the component suite
 * deliberately does not — `up-link.test.tsx` sets out the reason: a register is
 * "a claim about pixels", and pixels are the visual suite's and the Appearance
 * checklist's. Neither of the two things below is a claim about pixels. They
 * are mechanical questions about which of two conflicting declarations survives
 * composition, and the answer is decided by `twMerge` and by the CSS cascade
 * rather than by anything visible in the source of either component.
 *
 * What is NOT here: whether `surface` is the right ground, whether the ring is
 * 1.5px, whether any of it is scoped to a pointer. Those are `pointer.test.ts`'s
 * (compiled), `pointer.contrast.test.ts`'s (measured) and the visual suite's
 * (photographed).
 */

describe("the Destructive button's two rest states", () => {
  /*
   * § Buttons gives this variant no fill ordinarily and an `error` fill inside
   * a confirmation sheet, and § Desktop puts those two on different rows of its
   * table — "it is the control where getting this wrong is least affordable,
   * since a delete that gives no feedback is a delete pressed twice."
   *
   * The variant carries the unfilled half and the call site overrides it for
   * the filled one, so the two arrive at `cn()` as conflicting `hover:bg-*`
   * utilities in the same class list. Nothing in either file says which wins;
   * `twMerge` does, and only because `cva` appends `className` last.
   */
  test("unfilled: the ground every other ghost gets", () => {
    render(<Button variant="destructive">Delete</Button>);
    const classes = screen.getByRole("button").className;

    expect(classes).toContain("hover:bg-surface");
    // The tinted ground § Desktop names as the one divergence it does not
    // ratify: "a tinted ground no other control has".
    expect(classes).not.toContain("hover:bg-destructive/10");
  });

  test("filled: the call site's fill at 90% wins outright", () => {
    render(
      <Button
        variant="destructive"
        className="w-full bg-destructive text-ink-fg hover:bg-destructive/90"
      >
        Delete
      </Button>,
    );
    const classes = screen.getByRole("button").className;

    expect(classes).toContain("hover:bg-destructive/90");
    // Both would otherwise be present, and the one that lost is the one that
    // would have shown: a filled red button hovering to `surface`.
    expect(classes).not.toContain("hover:bg-surface");
  });
});

describe("the cursor every button lost to Tailwind v4", () => {
  /*
   * § Desktop: "browsers give `<button>` `cursor: default`, not `pointer`, and
   * Tailwind v4's preflight does not add one — v3's did." Asserted on the
   * variants rather than on one, because the base string is where it lives and
   * a variant-level `cursor-*` would be the way it went missing from three of
   * them silently.
   */
  test.each(["default", "secondary", "outline", "ghost", "destructive", "link"] as const)(
    "%s",
    (variant) => {
      render(<Button variant={variant}>Act</Button>);
      expect(screen.getByRole("button").className).toContain("cursor-pointer");
    },
  );
});

describe("a tile that is shown rather than offered", () => {
  test("the `div` tile gets neither a hover nor a cursor", () => {
    // § Desktop, "What takes no hover": a state on something that does nothing
    // "would promise an action that does not exist, which is worse than no
    // feedback".
    const { container } = render(<Tile name="Chicken & Rice" motif="plate" />);
    const classes = container.firstElementChild?.className ?? "";

    expect(classes).not.toContain("hover:");
    expect(classes).not.toContain("cursor-pointer");
  });

  test.each([
    ["ink", "hover:bg-ink/90"],
    ["surface", "hover:shadow-[inset_0_0_0_1.5px_var(--text-tertiary)]"],
  ] as const)("the %s tile takes its own row of the table", (material, expected) => {
    render(<Tile as="button" name="Chicken & Rice" motif="plate" material={material} />);
    expect(screen.getByRole("button").className).toContain(expected);
  });
});

describe("selection outranks hover", () => {
  /*
   * § Desktop argues this at length and it is the one state in the section that
   * no class can express: the accent ring and the hover ring are the same
   * property at the same weight, so "a pointer crossing the chosen tile would
   * take its umber away and leave grey, reporting the opposite of what had
   * happened."
   *
   * What prevents it is the cascade — the accent ring is an inline `style`,
   * which beats the hover class — rather than a conditional in `tile.tsx`. That
   * makes it correct by construction and invisible in the source, which is
   * exactly the kind of thing that gets refactored away by someone tidying an
   * inline style into a class. `dot-grid.test.tsx` pins its own inset ring the
   * same way, for the same reason.
   */
  test("a selected stone tile keeps its umber under the pointer", () => {
    render(
      <Tile as="button" selected name="Chicken & Rice" motif="plate" material="surface" />,
    );
    const tile = screen.getByRole("button");

    expect(tile.style.boxShadow).toBe("inset 0 0 0 1.5px var(--accent)");
    // The hover class is still on the element — it has to be, for the
    // unselected case — and loses to the inline style rather than being
    // withheld.
    expect(tile.className).toContain(
      "hover:shadow-[inset_0_0_0_1.5px_var(--text-tertiary)]",
    );
  });

  test("an unselected tile has no inline shadow for the hover to fight", () => {
    render(
      <Tile as="button" selected={false} name="Chicken & Rice" motif="plate" />,
    );
    expect(screen.getByRole("button").style.boxShadow).toBe("");
  });
});
