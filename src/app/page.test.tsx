import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";

import Home from "@/app/page";

// Smoke test. Its job is to prove the Vitest + JSX + path-alias toolchain runs,
// so that `npm run test` is a green target for every task after this one — not
// to assert anything about the placeholder page, which FUEL-3 replaces.
test("renders the app shell", () => {
  render(<Home />);

  expect(
    screen.getByRole("heading", { level: 1, name: "Fuel & Form" }),
  ).toBeDefined();
});
