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

/**
 * Every import specifier in a file, however it is spelled.
 *
 * `from` covers the ordinary and the type-only import, `import(` the dynamic
 * one, and `require(` a CommonJS call — none present in `src/` today, and all
 * three cheap to cover rather than to discover later.
 *
 * All three quote characters, and that is not hypothetical tidiness: this file
 * matched only double quotes until an external review pointed at it, and
 * `eslint.config.mjs` enforces NO quote style, so a single-quoted import is
 * legal here and would have walked past the import test. It happened to trip
 * the identifier test below, which is an accidental backstop rather than a
 * guard — a `import type { Band }` under a name nothing else uses would not
 * have tripped anything.
 */
const SPECIFIER = /(?:from|import|require)\s*\(?\s*["'`]([^"'`]+)["'`]/g;

/**
 * Whether one specifier names this module — ANY spelling of it.
 *
 * Not a list of the two forms the app happens to use today. The first version of
 * this file matched `"@/lib/energy"` and `"./energy"` literally, and it was
 * wrong in the one way that mattered: `lib/db/queries/export.ts` is two
 * directories down, so it reaches this module as `"../../energy"` and sailed
 * through a scan that was supposedly guarding it. That file is named in
 * `FORBIDDEN` below AND is the file FUEL-97 will edit, so the hole was directly
 * under the thing the test exists to protect.
 *
 * It was found by planting the relative spelling rather than the aliased one —
 * a guard is only proven by a plant that looks like the code that will
 * eventually break it, and the first plant did not.
 *
 * So the test is on the resolved TAIL of the path instead: anything ending in a
 * segment called `energy`, with or without an extension. That is deliberately
 * broader than "this module" — a future `lib/foo/energy.ts` would trip it too,
 * which is a false positive somebody has to come here and think about rather
 * than a false negative nobody ever sees.
 */
const namesEnergy = (specifier: string) =>
  /(^|\/)energy(\.tsx?)?$/.test(specifier.replace(/^@\/|^\.{1,2}\//, "/"));

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
    // Not just `.ts`/`.tsx`. The repository already uses `.mts` at its root, so
    // a module written under `src/` in one is a shape this scan has to see
    // rather than a shape it can assume away — the same mistake, twice removed,
    // as matching two literal import spellings.
    else if (/\.(m|c)?[jt]sx?$/.test(entry.name)) yield path;
  }
}

/**
 * Comments removed, so this file's own prose — and `energy.ts`'s header, which
 * names `macros.ts` in the paragraph explaining why it must never import it —
 * is not read as an import.
 */
const stripComments = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/.*$/gm, "$1");

/**
 * String literals blanked, for the identifier scan below and for nothing else.
 *
 * `stripComments` does not touch them, so a FORBIDDEN module that merely
 * contained the text `"sessionEnergy"` — an error message, a label, a snapshot —
 * would fail a test about netting it. That is a false positive that teaches the
 * next reader to edit the test rather than respect the constraint, which is how
 * a guard like this one actually dies.
 *
 * Only the identifier scan gets this. The import and re-export scans need the
 * specifiers, which ARE string literals.
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
  [...code.matchAll(SPECIFIER)].some((match) => namesEnergy(match[1]!));

/** A re-export — `export ... from "..."` — which is how a ban gets laundered. */
const REEXPORT = /export\s[^;]*?\sfrom\s+["'`]([^"'`]+)["'`]/g;

const reexports = (code: string) =>
  [...code.matchAll(REEXPORT)].some((match) => namesEnergy(match[1]!));

/**
 * Everything `energy.ts` exports, read off the module itself.
 *
 * Derived rather than listed, so a new export is covered the moment it is
 * written. See the identifier test below for what this is for.
 */
const EXPORTED = [
  ...(readFileSync(join(SRC, "lib/energy.ts"), "utf8").matchAll(
    /export\s+(?:const|function|type)\s+([A-Za-z_][A-Za-z0-9_]*)/g,
  )),
].map((match) => match[1]!);

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

  test("nothing re-exports it, which is how a ban gets laundered", () => {
    /*
     * The second hole this file had, found by planting it.
     *
     * `queries/training.ts` is on the allowlist — it must be, it resolves the
     * bodyweight — so it is the natural launderer: one `export { sessionEnergy }
     * from "@/lib/energy"` there and `queries/export.ts` reaches the estimate
     * through `./training`, importing nothing this scan was looking at. Both
     * files pass every other test here while the criterion is broken.
     *
     * A re-export is also a plausible ACCIDENT rather than only a dodge, which
     * is what makes it worth a rule: tidying a query module by widening what it
     * exposes is an ordinary thing to do.
     */
    const launderers = SOURCES.filter(({ code }) => reexports(code)).map(({ rel }) => rel);

    expect(launderers).toEqual([]);
  });

  test("no module that sums intake so much as names one of its exports", () => {
    /*
     * The value-level half, and the reason it exists rather than trusting the
     * import check alone: an import can be renamed at the boundary, and a
     * `FORBIDDEN` module that has the figure under another name is still netting
     * it. To USE the estimate a module has to name something this one exports.
     *
     * Derived from `energy.ts`'s own export list, so it widens by itself.
     *
     * Honest about its limit: a value deliberately re-exported under a new name
     * from a module that is NOT `export ... from` — `export const burn =
     * sessionEnergy` — defeats both halves. No source scan closes that, and this
     * file is not trying to. It exists to stop the edit somebody makes without
     * thinking, which is the one PRD § P10 is actually exposed to.
     */
    const offenders = SOURCES.filter(
      ({ rel, identifiers }) =>
        FORBIDDEN.includes(rel) &&
        EXPORTED.some((name) => new RegExp(`\\b${name}\\b`).test(identifiers)),
    ).map(({ rel }) => rel);

    expect(EXPORTED).toContain("sessionEnergy");
    expect(offenders).toEqual([]);
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
