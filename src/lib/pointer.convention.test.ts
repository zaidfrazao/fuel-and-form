import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, test } from "vitest";

/**
 * One convention, enforced — FUEL-75's fourth acceptance criterion.
 *
 * The Brand Guide gained § Desktop's pointer-states section because the app had
 * arrived at eight `hover:` declarations across five files "a component at a
 * time, each one a local decision nobody could check against anything". Sweeping
 * them into `pointer.ts` fixes that once. This is what stops it happening again:
 * a ninth local decision, written into a component instead of imported, fails
 * here rather than being noticed at some later audit.
 *
 * It is deliberately a scan of the source rather than of the rendered output.
 * A component test can only see the components it renders, and the failure mode
 * this guards against is a *new* file nobody thought to add to a test.
 */

const THIS_FILE = fileURLToPath(import.meta.url);
const SRC = join(dirname(THIS_FILE), "..");

/**
 * Where the states are defined, and where they are asserted.
 *
 * These are the files allowed to write the utilities as literal text: one
 * because it is the definition, the rest because their whole job is to compile
 * and measure them.
 */
const DEFINING = ["lib/pointer.ts"];
const isTest = (path: string) => /\.(test|spec)\.tsx?$/.test(path);

/**
 * The literals a component may still write, and the reason each is not in
 * `pointer.ts`.
 *
 * Every one of them is a *composition* — a state from § Desktop's table applied
 * under a condition only its own component knows — rather than a fourth ground.
 * A constant for each would be a constant with one caller and a name longer
 * than the thing it named.
 */
const ALLOWED = new Map([
  [
    "hover:text-text-primary",
    "A control raising its OWN label, beside HOVER_GROUND: the mock's " +
      "`.railitem:not(.active):hover { color: var(--text) }`. HOVER_LIFT is " +
      "the same move for a child span, which needs `group-hover:` instead.",
  ],
  [
    "hover:bg-destructive/90",
    "§ Desktop's second row for the one control with two rest states — a " +
      "Destructive button inside a confirmation sheet, which is filled and so " +
      "goes to that fill at 90% rather than to `surface`.",
  ],
  [
    "aria-[current=page]:hover:bg-ink/90",
    "The same second row, applied to the `/dev/right-now` case nav's current " +
      "item. The compound outranks the bare `hover:` on specificity, so the " +
      "two do not depend on the order they are written in.",
  ],
  [
    "group-hover:border-text-secondary",
    "The mock's `.cbx:hover { border-color: var(--text-2) }` — the shopping " +
      "row's tick box darkening its edge while the row it sits in takes the " +
      "ground.",
  ],
  [
    "peer-checked:group-hover:border-ink",
    "A ticked box keeping its ink edge under the pointer. A compound rather " +
      "than a reliance on `peer-checked:` outranking `group-hover:`, which it " +
      "does not: Tailwind wraps both variants' arguments in `:where()`, so " +
      "the two compile to equal specificity and only emission order separates " +
      "them. Two `:is()`es settle it on specificity instead.",
  ],
]);

/**
 * Comments removed, so a paragraph explaining a state is not mistaken for one.
 *
 * Several of these files quote the utility they replaced — `button.tsx` names
 * `hover:bg-destructive/10` in the comment recording why it no longer writes
 * it — and a scan that could not tell prose from code would make writing that
 * comment impossible.
 *
 * The line-comment pattern requires the `//` not to be preceded by a colon, so
 * a `https://` inside a string is not read as the start of one.
 */
const stripComments = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/.*$/gm, "$1");

function* walk(directory: string): Generator<string> {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) yield* walk(path);
    else if (/\.tsx?$/.test(entry.name)) yield path;
  }
}

/** Every source file that could carry a class name, with its comments gone. */
const SOURCES = [...walk(SRC)]
  .map((path) => ({ path, rel: relative(SRC, path) }))
  .filter(({ rel }) => !isTest(rel) && !DEFINING.includes(rel))
  .map((file) => ({ ...file, code: stripComments(readFileSync(file.path, "utf8")) }));

/**
 * Class tokens containing `hover:`, with any variant prefix intact.
 *
 * Split on whitespace and on the delimiters a class list can sit inside, so
 * `aria-[current=page]:hover:bg-ink/90` comes back whole rather than as its
 * last segment — the prefix is the part that makes it a composition rather
 * than a second convention.
 */
const hoverTokens = (code: string) =>
  code
    .split(/[\s"'`{}(),;]+/)
    .filter((token) => token.includes("hover:"))
    .map((token) => token.replace(/^\$|[.]$/g, ""));

describe("every hover state comes from pointer.ts", () => {
  const offenders = SOURCES.flatMap(({ rel, code }) =>
    hoverTokens(code)
      .filter((token) => !ALLOWED.has(token))
      .map((token) => `${rel}: ${token}`),
  );

  test("no component writes a state of its own", () => {
    expect(offenders).toEqual([]);
  });

  test.each([...ALLOWED.keys()])("%s is still used", (token) => {
    /*
     * The allowlist is checked in both directions. An entry that stops being
     * used is an exception nobody needs, and leaving it here would quietly
     * widen what the test above permits — the way an allowlist normally rots.
     */
    const users = SOURCES.filter(({ code }) => hoverTokens(code).includes(token));
    expect(users.length).toBeGreaterThan(0);
  });
});

describe("the cursor comes from pointer.ts too", () => {
  /*
   * § Desktop's smallest rule and "the one most often missed, because it is
   * invisible to the keyboard a developer tests with" — and invisible to the
   * visual suite as well, since a screenshot does not photograph a cursor.
   * Nothing else in this repository can catch it, so it is caught here.
   */
  test("no component writes `cursor-pointer` directly", () => {
    const offenders = SOURCES.filter(({ code }) =>
      /\bcursor-pointer\b/.test(code),
    ).map(({ rel }) => rel);
    expect(offenders).toEqual([]);
  });
});

describe("the scan can fail", () => {
  /*
   * The positive control. Both tests above are "expect an empty list", which is
   * exactly the shape that passes when the scan reads nothing at all — an
   * empty `SOURCES`, a comment stripper that ate the file, a tokenizer that
   * returns nothing. So the scan is shown to see real code first.
   */
  test("it reads the source files", () => {
    /*
     * Named rather than counted. A floor like "more than fifty files" guards
     * the same thing but fails on a legitimate reorganisation, and a guard that
     * fails for reasons unrelated to what it guards is one people learn to
     * weaken. Asserting that a file which certainly carries controls is in the
     * scan says the walk reached the real source tree, and stays true however
     * the rest of it is arranged.
     */
    const scanned = SOURCES.map(({ rel }) => rel);

    expect(scanned).toContain(join("components", "ui", "button.tsx"));
    expect(scanned).toContain(join("components", "nav-shell.tsx"));
  });

  test("it finds the allowlisted literals, and would find an unlisted one", () => {
    expect(hoverTokens('className={`px-2 ${HOVER_GROUND} hover:bg-raised`}')).toEqual([
      "hover:bg-raised",
    ]);
    expect(hoverTokens("// a comment about hover:bg-raised")).toEqual([
      "hover:bg-raised",
    ]);
    expect(hoverTokens(stripComments("// a comment about hover:bg-raised"))).toEqual(
      [],
    );
  });
});
