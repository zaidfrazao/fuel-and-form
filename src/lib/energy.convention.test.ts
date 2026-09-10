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
 * ## Where that stopped being enough — FUEL-97
 *
 * The paragraph above was written before the export ticket and it predicted the
 * edit correctly. What it did not settle is what to do when a module has a
 * LEGITIMATE reason to see the figure, which is the position both export
 * builders are in now: the file the assistant opens is supposed to carry the
 * estimate, and § P6 is why the estimate is in the app at all.
 *
 * So this file is no longer one rule. It is a ban over most of the app, a
 * narrower ban over the two modules that had to be let through, and — in
 * `export-energy.test.ts` — an assertion about the artefacts themselves, which
 * is the only place the actual criterion can be checked rather than approximated.
 * The `FORBIDDEN` block below carries the full argument for the move.
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
 * total against `target_kcal`; `csv.ts` and the two query modules are the rest
 * of the path the check-in is built along, which PRD § P10 names by name.
 *
 * ## The two modules that left this list — FUEL-97, and what replaced them
 *
 * `lib/export.ts` and `lib/export-week.ts` were here until the export ticket,
 * which the block above predicted would be "exactly the edit" this file exists
 * to make somebody think about. They moved to `ALLOWED` rather than being
 * routed around, because the alternative is worse in a specific way: the
 * estimate can reach the file through a parameter without either builder ever
 * importing this module, and a guard that a two-line indirection satisfies is a
 * guard that reports CLEAN while the criterion is broken.
 *
 * What moving them costs is real and is stated rather than waved at: those two
 * modules are precisely the ones that hold a burn range and a macro total in
 * the same scope, so they are the modules the criterion is actually about, and
 * they no longer have a module-level guarantee. Three things stand in its place
 * and none of them is this scan:
 *
 *   - the ban still holds for the nine other entries below, including
 *     `csv.ts` and BOTH query modules — deriving the estimate inside the pure
 *     builders rather than in the query layer is what kept the move to two
 *     entries instead of four;
 *   - `EXPORT_MAY_NAME` below narrows what those two are allowed to touch, so
 *     the allowance cannot quietly grow into "the export does its own energy
 *     arithmetic";
 *   - `export-energy.test.ts` asserts the criterion against the ARTEFACTS —
 *     that no arithmetic combination of an intake figure and a burn figure
 *     appears as a cell in the CSV or as a number anywhere in the JSON.
 *
 * That last one is the actual replacement, and it is honestly weaker in one
 * direction and stronger in another. An import ban is universal over the
 * source; a value test proves only what its fixture produces. But it asserts
 * the thing § P10 actually asks for — never combined — where the ban could only
 * assert a proxy for it. Neither alone is the guarantee. The package is.
 */
const FORBIDDEN = [
  "lib/macros.ts",
  "lib/day-summary.ts",
  "lib/week-totals.ts",
  "lib/plan-vs-actual.ts",
  "lib/csv.ts",
  "lib/db/queries/export.ts",
  "lib/db/queries/week-export.ts",
  "components/week-totals.tsx",
  "components/day-complete.tsx",
];

/**
 * Every file allowed to import the estimate, and why each one is.
 *
 * The shape of the list is the argument: the query that resolves the bodyweight,
 * the screen that draws the figure, the two files the estimate is FOR, and the
 * tests that constrain them. Nothing that adds up food is on it, and nothing can
 * be added to it without saying so here.
 *
 * The two export entries are the ones to read sceptically, and `EXPORT_MAY_NAME`
 * below is the second half of each of their justifications.
 */
const ALLOWED = new Map([
  [
    "lib/export.ts",
    "PRD § P6 — the backup. It derives `derived.sessionEnergy` from rows it " +
      "already holds, which is why no query module needed this import: the " +
      "estimate is computed where `planVsActual` is, from `workout_logs`, " +
      "`exercise_sets`, `workout_exercises` and the weigh-ins. The figure lands " +
      "nested under `derived` beside `burnIs`, never beside a table and never " +
      "inside one — the line that file conceded once and does not concede again.",
  ],
  [
    "lib/export-week.ts",
    "PRD § P6 — the check-in the nutrition assistant opens. This is the module " +
      "the criterion is genuinely about, because it renders the meals section's " +
      "measured `kcal` and the training section's modelled burn into one file. " +
      "The burn is two columns of its own, prefixed `est_`, in a different " +
      "section from any macro, and it enters no sum. `export-energy.test.ts` " +
      "checks that against the rendered text rather than against this sentence.",
  ],
  [
    "lib/export-energy.test.ts",
    "The value-level guard that replaced the module-level one for the two " +
      "modules above. It has to name the estimate in order to compute the " +
      "combinations it then proves are absent from both artefacts.",
  ],
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
  ["lib/energy.test.ts", "The module's own tests."],
]);

/**
 * What the two export builders may touch, now that they may touch anything.
 *
 * The narrower half of their justification above. Both need the same three
 * names and no others: `sessionEnergy` to ask the question, `nearestWeight` to
 * price a past session at the bodyweight it actually happened at, and
 * `EnergyRange` to type the answer. Everything else this module exports is a
 * COEFFICIENT — `MET_BANDS`, `SUPPORT_BAND`, `SECONDS_PER_REP`, `REST_SECONDS`,
 * `MAX_WIDTH_RATIO`, `KCAL_STEP` — and a file that names one of those is a file
 * doing energy arithmetic of its own rather than reporting the answer.
 *
 * That distinction is the whole reason this list exists rather than the
 * allowlist entry alone. "The export may see the estimate" and "the export may
 * compute an estimate" are different permissions, and the second one is where a
 * figure starts being adjusted before it is printed — rounded to the same step
 * as a macro total, widened, or scaled against something. This is the line
 * between them, and it is a `toEqual` rather than prose.
 *
 * `EnergyInput` is deliberately absent: both builders construct that object
 * structurally, and a module that has to NAME the input type is usually one
 * building the call somewhere other than at the point it reports the answer.
 */
const EXPORT_MAY_NAME = ["EnergyRange", "nearestWeight", "sessionEnergy"];

/** The two modules `EXPORT_MAY_NAME` constrains. */
const EXPORT_BUILDERS = ["lib/export.ts", "lib/export-week.ts"];

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
  ...readFileSync(join(SRC, "lib/energy.ts"), "utf8").matchAll(
    /export\s+(?:const|function|type)\s+([A-Za-z_][A-Za-z0-9_]*)/g,
  ),
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
    const importers = SOURCES.filter(({ code }) => imports(code)).map(
      ({ rel }) => rel,
    );

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
    const launderers = SOURCES.filter(({ code }) => reexports(code)).map(
      ({ rel }) => rel,
    );

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

  test("the export builders name the answer and never the coefficients", () => {
    /*
     * The narrowed ban, and the one that has to hold now that the broad one
     * does not. See `EXPORT_MAY_NAME`.
     *
     * Asserted per module rather than over the pair, so a failure names the file
     * — and derived from `EXPORTED`, so a coefficient added to `energy.ts`
     * tomorrow is forbidden here today without anybody editing this test.
     */
    const named = EXPORT_BUILDERS.map((rel) => {
      const source = SOURCES.find((file) => file.rel === rel);

      // A missing module would otherwise pass this test by naming nothing,
      // which is the way an allowlist entry rots into a guard over nothing.
      expect(
        source,
        `${rel} is on the allowlist but does not exist`,
      ).toBeDefined();

      return [
        rel,
        EXPORTED.filter((name) =>
          new RegExp(`\\b${name}\\b`).test(source?.identifiers ?? ""),
        ).sort(),
      ];
    });

    expect(named).toEqual(
      EXPORT_BUILDERS.map((rel) => [rel, [...EXPORT_MAY_NAME].sort()]),
    );
  });

  test("the estimate does not reach for a target from its own side", () => {
    const energy = SOURCES.find(({ rel }) => rel === "lib/energy.ts");

    /*
     * Three imports, all pure, and none of them touches a macro. Asserted as
     * the whole list rather than as an absence, so a fourth import is a
     * decision somebody has to make here rather than one that lands unnoticed.
     *
     * `./resolve-training` is the third and it arrived with FUEL-104, which is
     * the ticket that gave the walk its own estimate. It is here for exactly
     * one export, `WALK_TYPE`, and the alternative was spelling `"walk"` in
     * `energy.ts` as a literal — which is the second spelling that constant
     * exists to prevent, in a file that now branches on it.
     *
     * Two things make it safe rather than merely convenient. It carries no
     * macro, no target and no intake figure of any kind, so the property this
     * whole file guards — that the estimate never reaches for something to net
     * itself against — is untouched by it. And it does not cost `energy.ts` its
     * purity: `lib/walk.ts` already takes `WALK_TYPE` from the same module for
     * the same reason, and its module comment records that this is what lets a
     * CLIENT component import it "without dragging pg-core into the browser
     * bundle". `components/training.tsx` imports both, so that property was
     * already load-bearing before this import existed.
     *
     * What would NOT be acceptable is this growing into a general dependency
     * on the resolver. One constant, named here.
     */
    const specifiers = [
      ...(energy?.code.matchAll(/from\s+"([^"]+)"/g) ?? []),
    ].map((match) => match[1]);

    expect(specifiers.sort()).toEqual([
      "./date",
      "./resolve-training",
      "./section",
    ]);
  });
});
