import { render } from "@testing-library/react";
import { describe, expect, test } from "vitest";

import { MOTIF_NAMES, Motif } from "@/components/motifs";

/**
 * The marks themselves are checked by eye at `/dev/primitives` against the
 * sprite in `docs/BRAND_GUIDE.html`. What is asserted here is the stroke
 * contract from Brand Guide § Line Motifs — 1.6px, `currentColor`, round caps
 * and joins, on a 48×48 viewBox — because that is what lets one set work on ink
 * and on stone in both modes, and because a motif that silently loses
 * `currentColor` looks fine on canvas and vanishes on an ink tile.
 */
describe("Motif", () => {
  test.each(MOTIF_NAMES)("%s draws to the guide's stroke spec", (name) => {
    const { container } = render(<Motif name={name} />);
    const svg = container.querySelector("svg");
    const group = container.querySelector("g");

    expect(svg?.getAttribute("viewBox")).toBe("0 0 48 48");
    expect(group?.getAttribute("stroke")).toBe("currentColor");
    expect(group?.getAttribute("stroke-width")).toBe("1.6");
    expect(group?.getAttribute("fill")).toBe("none");
    expect(group?.getAttribute("stroke-linecap")).toBe("round");
    expect(group?.getAttribute("stroke-linejoin")).toBe("round");
    expect(group?.children.length).toBeGreaterThan(0);
  });

  test("covers the eight marks the guide says are the whole library", () => {
    expect([...MOTIF_NAMES]).toEqual([
      "bowl",
      "cup",
      "roll",
      "pot",
      "plate",
      "bar",
      "egg",
      "walk",
    ]);
  });

  test("is hidden from assistive technology unless given a title", () => {
    // Beside a tile's name the motif repeats a label the user has already heard,
    // and § Deliberately Absent opens with "icons that repeat their own label".
    const { container } = render(<Motif name="bowl" />);

    expect(container.querySelector("svg")?.getAttribute("aria-hidden")).toBe(
      "true",
    );
  });

  test("becomes an image with an accessible name when it carries meaning", () => {
    const { container } = render(<Motif name="walk" title="Walk" />);
    const svg = container.querySelector("svg");

    expect(svg?.getAttribute("role")).toBe("img");
    expect(svg?.hasAttribute("aria-hidden")).toBe(false);
    expect(svg?.querySelector("title")?.textContent).toBe("Walk");
  });
});
