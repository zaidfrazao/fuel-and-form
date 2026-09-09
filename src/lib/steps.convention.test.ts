import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, test } from "vitest";

/**
 * There is no daily step total — enforced, not merely absent.
 *
 * PRD § P11: *"There is **no daily step total**: this app sees only the walking
 * it recorded, so a daily figure would read low every day while looking like a
 * health metric rather than an app-usage one."* That is a criterion about every
 * file in the repository, including files that do not exist yet.
 *
 * A unit test cannot hold it. It can only assert about the modules somebody
 * remembered to write a test for, and the failure mode here is the module
 * nobody thought of — the natural-sounding ticket that adds "steps today" to
 * the day summary because the number is sitting right there on the row. So this
 * is a scan of the source, on `energy.convention.test.ts`'s precedent and for
 * its stated reason: "the failure mode this guards against is a *new* file
 * nobody thought to add to a test".
 *
 * ## Two bans, because this figure is STORED and the energy estimate is not
 *
 * `energy.convention.test.ts` gets one ban for free: its figure is computed, so
 * a module that never imports `energy.ts` cannot have one. That does not hold
 * here. `workout_logs.steps` is a column, so a daily total can be built by
 * summing rows without this module ever being named — which is exactly the
 * hole an import ban alone would leave, directly under the thing it guards.
 *
 * So there are two lists:
 *
 *   - `NO_IMPORT` — nothing that reports a day's or a week's figures may import
 *     `steps.ts`. Wider than the aggregators, because it also covers the export
 *     path: reporting a STORED number needs no import at all, so an export
 *     builder that imports this module is one doing step arithmetic of its own.
 *   - `NO_STEP_FIELD` — the modules that produce an aggregate may not so much
 *     as NAME a step field. This is the half that catches the sum.
 *
 * The second list is deliberately the narrower one. PRD § P11 requires that
 * "distance, duration, steps and step source reach both formats and both
 * scopes, **one row per walk**" — so the export builders must be free to put a
 * per-walk figure in a cell, and banning the identifier there would be a false
 * positive that teaches the next reader to edit this file rather than respect
 * the constraint. That is how a guard like this one actually dies.
 *
 * ## What neither list can reach, said plainly
 *
 * A query that `SUM()`s the column in SQL, and an artefact that happens to
 * carry a total for some other reason. `energy.convention.test.ts` met the same
 * limit and answered it with `export-energy.test.ts`, which asserts the
 * criterion against the rendered artefacts rather than against the source.
 * FUEL-104 is the ticket that puts these figures in the export and is therefore
 * where that assertion belongs; it is named here rather than left implied.
 */

const THIS_FILE = fileURLToPath(import.meta.url);
const SRC = join(dirname(THIS_FILE), "..");

/**
 * Every import specifier in a file, however it is spelled — `energy`'s regex,
 * verbatim, including all three quote characters. `eslint.config.mjs` enforces
 * no quote style, so a single-quoted import is legal here and would otherwise
 * walk straight past this scan.
 */
const SPECIFIER = /(?:from|import|require)\s*\(?\s*["'`]([^"'`]+)["'`]/g;

/**
 * Whether one specifier names this module, in ANY spelling.
 *
 * Matched on the resolved TAIL rather than on the two forms the app happens to
 * use today. `energy.convention.test.ts` records what the literal version cost:
 * `lib/db/queries/export.ts` is two directories down and reached that module as
 * `"../../energy"`, sailing through a scan that was supposedly guarding it.
 * Anything ending in a segment called `steps` trips this, which is broader than
 * "this module" on purpose — a future `lib/foo/steps.ts` is a false positive
 * somebody has to come here and think about, rather than a false negative
 * nobody ever sees.
 */
const namesSteps = (specifier: string) =>
  /(^|\/)steps(\.tsx?)?$/.test(specifier.replace(/^@\/|^\.{1,2}\//, "/"));

/**
 * Nothing here may import `steps.ts`.
 *
 * The aggregators, plus the whole export path. The export entries are the ones
 * to read carefully: they are NOT banned from carrying a per-walk figure — § P11
 * requires that they do — they are banned from importing the module that
 * derives one. Reporting a stored number needs no import, so a builder that
 * names this module is a builder computing rather than reporting, which is
 * where a figure starts being adjusted before it is printed.
 */
const NO_IMPORT = [
  "lib/macros.ts",
  "lib/day-summary.ts",
  "lib/week-totals.ts",
  "lib/week-grid.ts",
  "lib/adherence.ts",
  "lib/plan-vs-actual.ts",
  "lib/csv.ts",
  "lib/export.ts",
  "lib/export-week.ts",
  "lib/db/queries/export.ts",
  "lib/db/queries/week-export.ts",
  "components/week-totals.tsx",
  "components/day-complete.tsx",
];

/**
 * Nothing here may even NAME a step field — the half that catches the sum.
 *
 * Every module on this list produces a figure ABOUT A DAY OR A WEEK: the macro
 * totals, the day's summary, the week's totals and grid, the adherence
 * pattern, the plan-against-actual reading, and the two components that draw
 * them. A step count is a per-walk quantity, so none of them has any business
 * reading one, and an identifier is what a sum cannot be written without.
 *
 * The export builders are deliberately absent — see the header. They may hold a
 * per-walk figure and put it in a cell.
 */
const NO_STEP_FIELD = [
  "lib/macros.ts",
  "lib/day-summary.ts",
  "lib/week-totals.ts",
  "lib/week-grid.ts",
  "lib/adherence.ts",
  "lib/plan-vs-actual.ts",
  "components/week-totals.tsx",
  "components/day-complete.tsx",
];

/**
 * Every file allowed to import the module at all, and why each one is.
 *
 * The shape of the list is the argument: the schema that takes its vocabulary
 * from here, the query that computes the estimate at the write, the view model
 * that carries it, the two components that draw it, the seed that gives the
 * demo something to draw, and the module's own tests. Nothing that adds up a
 * day is on it, and nothing can be added without a sentence here saying why.
 */
const ALLOWED = new Map([
  [
    "lib/db/schema.ts",
    "Builds the `step_source` enum from `STEP_SOURCES`, the direction " +
      "`MEDIA_KINDS`, `SECTIONS` and `MAX_ROUTE_POINTS` already run — so the " +
      "database and the display cannot come to disagree about what the words are.",
  ],
  [
    "lib/db/queries/training.ts",
    "Computes the estimate at the one place a walk's distance is written, and " +
      "holds the rule that a device count is never overwritten by one.",
  ],
  [
    "lib/walk.ts",
    "A type-only import for `StepSource`. `WalkEntryView` carries the figure " +
      "and its origin to both screens that draw a walk.",
  ],
  [
    "components/walk-row.tsx",
    "Draws the Slash line — Brand Guide § The Route Trace's " +
      "`/ 3.2 km · 34 min · ~4,300 steps`. One walk's figure, on one walk's row.",
  ],
  [
    "components/walk-sheet.tsx",
    "Draws the trace's adjacent data table, which § The Route Trace defines as " +
      "the walk's own figures — the estimate and its source among them.",
  ],
  [
    "lib/seed/history.ts",
    "Gives the demo's recorded walks a step figure, so the thing the two " +
      "components draw is visible to a reader and to the visual suite. A " +
      "per-walk value on a per-walk row; the seed computes no total.",
  ],
  ["lib/steps.test.ts", "The module's own tests."],
]);

function* walk(directory: string): Generator<string> {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);

    if (entry.isDirectory()) yield* walk(path);
    else if (/\.(m|c)?[jt]sx?$/.test(entry.name)) yield path;
  }
}

/**
 * Comments removed, so this file's own prose — and `steps.ts`'s header, which
 * names the aggregating modules in the paragraph explaining why they must never
 * see it — is not read as code.
 */
const stripComments = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/.*$/gm, "$1");

/**
 * String literals blanked, for the identifier scan and for nothing else.
 *
 * A CSV header or an `aria-label` containing the word "steps" is not a sum, and
 * a test that failed on one would be a false positive of exactly the kind that
 * gets a guard deleted. The import scan does NOT get this — specifiers are
 * string literals.
 */
const stripStrings = (source: string) =>
  source.replace(/"[^"\n]*"|'[^'\n]*'|`[^`]*`/g, '""');

const SOURCES = [...walk(SRC)]
  .map((path) => {
    const code = stripComments(readFileSync(path, "utf8"));

    return { rel: relative(SRC, path), code, identifiers: stripStrings(code) };
  })
  .filter(({ rel }) => rel !== relative(SRC, THIS_FILE));

const imports = (code: string) =>
  [...code.matchAll(SPECIFIER)].some((match) => namesSteps(match[1]!));

/** A re-export — `export ... from "..."` — which is how a ban gets laundered. */
const REEXPORT = /export\s[^;]*?\sfrom\s+["'`]([^"'`]+)["'`]/g;

const reexports = (code: string) =>
  [...code.matchAll(REEXPORT)].some((match) => namesSteps(match[1]!));

/**
 * A step field being named — `.steps`, `steps:`, `stepsSource`, `steps_source`.
 *
 * Property access and object keys both, because a sum can be written either
 * way: `logs.reduce((n, l) => n + l.steps, 0)` and a `{ steps }` destructuring
 * are the same defect. `stepsLabel` and `stepsFigure` are deliberately NOT
 * matched — they are the display functions, they are covered by the import ban
 * above, and a word-boundary match on `steps` alone would trip on both.
 */
const STEP_FIELD = /\.steps\b|\bsteps\s*:|\bsteps(?:_s|S)ource\b/;

describe("there is no daily step total", () => {
  test("no module that reports a day, a week or the export imports it", () => {
    const offenders = SOURCES.filter(
      ({ rel, code }) => NO_IMPORT.includes(rel) && imports(code),
    ).map(({ rel }) => rel);

    expect(offenders).toEqual([]);
  });

  test("no module that produces an aggregate so much as names a step field", () => {
    const offenders = SOURCES.filter(
      ({ rel, identifiers }) =>
        NO_STEP_FIELD.includes(rel) && STEP_FIELD.test(identifiers),
    ).map(({ rel }) => rel);

    expect(offenders).toEqual([]);
  });

  test("every module the two bans name still exists", () => {
    // The half that stops the lists rotting. A renamed or deleted module would
    // otherwise leave an entry guarding nothing, and the tests above would keep
    // passing for the wrong reason.
    const present = new Set(SOURCES.map(({ rel }) => rel));
    const missing = [...new Set([...NO_IMPORT, ...NO_STEP_FIELD])].filter(
      (rel) => !present.has(rel),
    );

    expect(missing).toEqual([]);
  });

  test("only the modules on the allowlist import it at all", () => {
    const importers = SOURCES.filter(({ code }) => imports(code)).map(
      ({ rel }) => rel,
    );

    expect(importers.sort()).toEqual([...ALLOWED.keys()].sort());
  });

  test("nothing re-exports it, which is how a ban gets laundered", () => {
    /*
     * `queries/training.ts` is on the allowlist — it must be, it computes the
     * estimate — so it is the natural launderer: one `export { estimateSteps }
     * from "@/lib/steps"` there and every banned module can reach the figure
     * through a specifier this file's own import scan considers innocent.
     *
     * Asserted over the whole tree rather than over the allowlist, because a
     * module that does not import this one can still re-export it.
     */
    const launderers = SOURCES.filter(({ code }) => reexports(code)).map(
      ({ rel }) => rel,
    );

    expect(launderers).toEqual([]);
  });
});
