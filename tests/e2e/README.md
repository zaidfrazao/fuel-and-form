# `tests/e2e/` — the flow specs

**Empty on purpose, and owned by FUEL-48.**

`vitest.config.mts:36` has excluded this path since before it existed, so that
Vitest never picks up a Playwright spec. FUEL-69 created the directory and
installed the harness; the four flows that go in it are FUEL-48's.

From `docs/TESTING_STRATEGY.md` § 2.1, the flows are:

| Flow | Why it cannot be a unit test |
| --- | --- |
| Demo cold start | A clean profile reaching a populated view in one click |
| Log and advance | The view advancing, totals updating, the day-complete summary |
| Swap with preview | The override reaching the weekly grid without touching the template |
| Export | A file actually downloading, and its JSON parsing |

## What is already here for you

`playwright.config.ts` at the repository root covers this directory
(`testDir: "tests"`). Anything added here runs with `npm run test:visual`'s
harness but **not** its projects — the eight width-and-theme projects are scoped
to `screens.spec.ts`, so a flow spec needs a project of its own.

Two things worth reusing rather than rebuilding:

- **`tests/visual/demo.setup.ts`** provisions a demo account, empties the test
  branch first so the rate limit cannot lock the suite out, and proves the rows
  landed in `DATABASE_URL_TEST` rather than the live database. A flow spec that
  needs a signed-in demo should depend on that setup project.
- **`tests/visual/freeze-clock.mjs`** pins the server's clock. Flow specs that
  assert on dates will want it; ones that only click through may not.

Do not add a second Playwright config. The install is deliberately one harness —
FUEL-69's ticket says so explicitly, and two configs is how a project ends up
with two answers to "which database do the tests use".
