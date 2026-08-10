import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

/**
 * Testing Library unmounts between tests automatically, but only when Vitest
 * runs with `globals: true` — it looks for a global `afterEach` to hook into and
 * silently does nothing when there isn't one. Tests here import `expect` and
 * `test` explicitly, which is worth keeping, so the hook is registered by hand.
 *
 * Without it, every `render` in a file stacks up in the same `document.body` and
 * the second one onwards fails with "found multiple elements" — a failure that
 * points at the query rather than at the missing unmount.
 */
afterEach(cleanup);
