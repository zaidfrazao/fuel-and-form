import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, test } from "vitest";

/**
 * The estimate is never netted against intake — enforced, not merely intended.
 *
 * PRD § P10: *"The estimate is not subtracted from, added to, or combined with
 * `target_kcal` or any macro total anywhere, the export included."* That is a
 * criterion about every file in the repository, including files that do not
 * exist yet — FUEL-97 is the export ticket and it is written to add sets,
 * sections *and the estimate* to both export formats, which is exactly the edit
 * that would put `lib/energy.ts` one import away from `macros.ts`'s totals.
 *
 * A unit test cannot hold that. It can only assert about the modules somebody
 * remembered to write a test for, and the failure mode here is the module nobody
 * thought of. So this is a scan of the source, on `pointer.convention.test.ts`'s
 * precedent and for the same stated reason: "the failure mode this guards
 * against is a *new* file nobody thought to add to a test".
 *
 * It is deliberately about the IMPORT rather than about the arithmetic. A scan
 * looking for `targetKcal - burn` would be a scan that any rename defeats and
 * that a two-line indirection walks straight past. An import is the one thing
 * the netting cannot happen without: a module that never sees an `EnergyRange`
 * cannot combine one with anything.
 *
 * ## Both directions
 *
 * Downward: no module that does intake arithmetic may import `energy.ts`.
 * Upward: `energy.ts` may not import them either — a burn module that reached
 * for `target_kcal` itself would be the same defect written the other way
 * round, and it is the more likely one, because "show it against target" is a
 * natural-sounding thing to ask for.
 *
 * And the complete list of importers is asserted, not just the forbidden one.
 * An allowlist that only names what is banned rots the first time somebody adds
 * a module the ban did not anticipate; naming every importer makes a new one a
 * deliberate edit to this file, with a sentence saying why.
 */

const THIS_FILE = fileURLToPath(import.meta.url);
const SRC = join(dirname(THIS_FILE), "..");

/** The module under guard, as both spellings reach it. */
const SPECIFIERS = [/from\s+"@\/lib\/energy"/, /from\s+"\.\/energy"/];

/**
 * Where the intake arithmetic lives — the measured side, which this figure may
 * never touch.
 *
 * `macros.ts` is the fixed-point summation itself; `day-summary.ts`,
 * `week-totals.ts` and `plan-vs-actual.ts` are the three readers that put a
 * total against `target_kcal`; the two export modules and `csv.ts` are the file
 * the check-in is built from, which PRD § P10 names by name.
 */
const FORBIDDEN = [
  "lib/macros.ts",
  "lib/day-summary.ts",
  "lib/week-totals.ts",
  "lib/plan-vs-actual.ts",
  "lib/export.ts",
  "lib/export-week.ts",
  "lib/csv.ts",
  "lib/db/queries/export.ts",
  "lib/db/queries/week-export.ts",
  "components/week-totals.tsx",
  "components/day-complete.tsx",
];

/**
 * Every file allowed to import the estimate, and why each one is.
 *
 * Three, and the shape of the list is the argument: the query that resolves the
 * bodyweight, the screen that draws the figure, and the tests that constrain it.
 * Nothing that adds up food is on it, and nothing can be added to it without
 * saying so here.
 */
const ALLOWED = new Map([
  [
    "lib/db/queries/training.ts",
    "Resolves the bodyweight for the viewed date through `nearestWeight`. It " +
      "reads `weight_logs` and `profiles.start_weight_kg` and returns one " +
      "number; it does not compute a range and touches no macro column.",
  ],
  [
    "components/training.tsx",
    "Draws the figure, computed from its own optimistic entry and sets. The " +
      "screen it draws on shows no intake total at all — § Progressive " +
      "Disclosure's one question per screen, and here the question is how the " +
      "session went.",
  ],
  [
    "lib/energy.test.ts",
    "The module's own tests.",
  ],
]);

function* walk(directory: string): Generator<string> {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);

    if (entry.isDirectory()) yield* walk(path);
    else if (/\.tsx?$/.test(entry.name)) yield path;
  }
}

/**
 * Comments removed, so this file's own prose — and `energy.ts`'s header, which
 * names `macros.ts` in the paragraph explaining why it must never import it —
 * is not read as an import.
 */
const stripComments = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/.*$/gm, "$1");

const SOURCES = [...walk(SRC)]
  .map((path) => ({ rel: relative(SRC, path), code: stripComments(readFileSync(path, "utf8")) }))
  .filter(({ rel }) => rel !== relative(SRC, THIS_FILE));

const imports = (code: string) => SPECIFIERS.some((pattern) => pattern.test(code));

describe("the estimate is never netted against intake", () => {
  test("no module that sums or reports intake imports it", () => {
    const offenders = SOURCES.filter(
      ({ rel, code }) => FORBIDDEN.includes(rel) && imports(code),
    ).map(({ rel }) => rel);

    expect(offenders).toEqual([]);
  });

  test("every module the ban names still exists", () => {
    // The half that stops the list rotting. A renamed or deleted module would
    // otherwise leave an entry guarding nothing, and the test above would keep
    // passing for the wrong reason.
    const present = new Set(SOURCES.map(({ rel }) => rel));

    expect(FORBIDDEN.filter((rel) => !present.has(rel))).toEqual([]);
  });

  test("only the modules on the allowlist import it at all", () => {
    const importers = SOURCES.filter(({ code }) => imports(code)).map(({ rel }) => rel);

    expect(importers.sort()).toEqual([...ALLOWED.keys()].sort());
  });

  test("the estimate does not reach for a target from its own side", () => {
    const energy = SOURCES.find(({ rel }) => rel === "lib/energy.ts");

    // Two imports, both pure, and neither of them touches a macro. Asserted as
    // the whole list rather than as an absence, so a third import is a decision
    // somebody has to make here rather than one that lands unnoticed.
    const specifiers = [...(energy?.code.matchAll(/from\s+"([^"]+)"/g) ?? [])].map(
      (match) => match[1],
    );

    expect(specifiers.sort()).toEqual(["./date", "./section"]);
  });
});
