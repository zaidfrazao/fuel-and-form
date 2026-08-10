import { expect, test } from "vitest";

import { cn } from "@/lib/utils";

// Regression guard, not a unit test of tailwind-merge. Left unregistered, the
// Brand Guide's type-scale names (Display … Micro) are read as *colours*, so a
// size and a colour land in the same conflict group and one is silently
// dropped — which rendered ink text on an ink fill on every button. The failure
// is invisible to typecheck, lint and the build, so it is pinned here.
test("a type-scale size and a text colour survive together", () => {
  const result = cn("text-body", "text-ink-fg");

  expect(result).toContain("text-body");
  expect(result).toContain("text-ink-fg");
});

test("type-scale sizes still conflict with each other", () => {
  expect(cn("text-body", "text-micro")).toBe("text-micro");
});

test("text colours still conflict with each other", () => {
  expect(cn("text-ink-fg", "text-text-secondary")).toBe("text-text-secondary");
});
