import { ESLint } from "eslint";
import { beforeAll, describe, expect, it } from "vitest";

/**
 * The ESLint rule that forbids raw database handles outside `src/lib/db/`.
 *
 * PRD § Security & Compliance: "Every query is scoped by `user_id` at the
 * data-access layer", and FUEL-7's acceptance criterion is that "no query path
 * exists that bypasses the scope helper". `getDb()` and `getPool()` are the only
 * way to build one, so that rule in eslint.config.mjs is the machine half of the
 * promise — and until this file existed it was the one guard in the repository
 * with nothing checking it.
 *
 * ## Why this is worth a test
 *
 * The rule is one line of configuration whose failure modes are both silent and
 * both were hit while writing FUEL-15:
 *
 *  1. TOO BROAD. Glob `group` patterns are matched with GITIGNORE semantics, so
 *     `@/lib/db` excluded the whole DIRECTORY — blocking `@/lib/db/scope`, the
 *     import the rule's own message tells you to use. Nothing noticed, because
 *     no file in src/ had yet written a scoped query.
 *  2. TOO NARROW. The first regex that fixed (1) ended at `db` or `db/pool`,
 *     which let `@/lib/db/index`, `@/lib/db/pool.ts` and `@/lib/db/` through —
 *     three spellings of exactly the import being forbidden, and all three had
 *     been caught by the glob it replaced.
 *
 * Neither shows up in `npm run lint`: a rule that permits too much reports
 * nothing, and a rule that forbids too much only fires on code nobody has
 * written yet. So both directions are asserted here, by running the real
 * eslint.config.mjs over source strings.
 */

let eslint: ESLint;

beforeAll(async () => {
  // Loads the project's actual flat config from cwd. Testing a copy of the
  // patterns would assert that a regex matches itself.
  eslint = new ESLint({ cwd: process.cwd() });

  // Then lint once and throw the answer away.
  //
  // The constructor does not read the config — ESLint resolves eslint.config.mjs
  // lazily, on the first `lintText`. So without this the whole cost of loading
  // the config, the TypeScript parser and every plugin lands on whichever case
  // happens to run first, and the other 27 are milliseconds. That case was
  // `blocks @/lib/db`, at a little over five seconds under `--coverage` against
  // a 5000ms default: it passed on a fast run and failed on a slow one, and the
  // name in the failure had nothing to do with the reason.
  //
  // Warming up here moves the one-off cost into the hook, where it belongs and
  // where the budget is 10s. Raising `testTimeout` instead would have hidden
  // the asymmetry rather than removed it, and left the next person to add a
  // case wondering why the first one is always the slow one.
  await eslint.lintText('export const warm = 1;\n', {
    filePath: "src/lib/seed/rule-probe.ts",
    warnIgnored: false,
  });
});

/** The rule ids reported for one import, linted as if it were a file in src/. */
async function lintImport(specifier: string, options?: { typeOnly?: boolean }) {
  const code = options?.typeOnly
    ? `import type { Thing } from "${specifier}";\nexport type T = Thing;\n`
    : `import { thing } from "${specifier}";\nexport const t = thing;\n`;

  // A path inside src/ but outside src/lib/db/ — i.e. subject to the rule, and
  // not one of the three auth files named as exemptions.
  const [result] = await eslint.lintText(code, {
    filePath: "src/lib/seed/rule-probe.ts",
    warnIgnored: false,
  });

  return (result?.messages ?? []).map((message) => message.ruleId);
}

const isRestricted = (ruleIds: (string | null)[]) =>
  ruleIds.includes("@typescript-eslint/no-restricted-imports");

/* -------------------------------------------------------------------------- */
/* Too narrow — every spelling of a raw handle must be caught                 */
/* -------------------------------------------------------------------------- */

describe("raw database handles are blocked from src/", () => {
  // Each of these resolves to src/lib/db/index.ts or src/lib/db/pool.ts. A
  // rule that catches the first spelling and misses the rest is not a guard,
  // because reaching for a raw handle deliberately is exactly the case it
  // exists to stop — and `@/lib/db/index` is what an IDE's auto-import offers.
  const forbidden = [
    "@/lib/db",
    "@/lib/db/",
    "@/lib/db/index",
    "@/lib/db/index.ts",
    "@/lib/db/pool",
    "@/lib/db/pool.ts",
    "../../lib/db",
    "../db",
    "../db/pool",
    "./db",

    // Spellings that defeated two earlier denylist attempts. Every one of these
    // is resolved by TypeScript to src/lib/db/index.ts or pool.ts — verified,
    // not assumed — while differing from the obvious form only in punctuation.
    // ESLint matches the specifier string and resolves nothing, so these are
    // what a denylist cannot keep up with and an allowlist does not have to.
    "@/lib/db/index.js", // bundler resolution maps .js onto the .ts source
    "@/lib/db/pool.js",
    "@/lib/db/./index", // dot segment
    "@/lib/db//index", // doubled separator
    "@/lib/db/../db", // normalises back into the directory

    // The queries/ allowance is one segment deep, so nothing may climb out of
    // it. Each of these resolves back onto the raw handle.
    "@/lib/db/queries/../index",
    "@/lib/db/queries/./../pool",
    "@/lib/db/queries", // the directory itself is not a module
  ];

  it.each(forbidden)("blocks %s", async (specifier) => {
    expect(isRestricted(await lintImport(specifier))).toBe(true);
  });
});

/* -------------------------------------------------------------------------- */
/* Too broad — the modules callers are supposed to use must pass              */
/* -------------------------------------------------------------------------- */

describe("the scope layer itself is importable", () => {
  // scope.ts IS the choke point: it holds no connection and takes its executor
  // as an argument, so it cannot query anything on its own. schema.ts is table
  // definitions, and a table object with no executor cannot run a statement —
  // while `scope()` requires those objects as arguments, so forbidding them
  // forbids scoped writes and nothing else.
  // `db/queries/*` is the third exception, and the one an app route depends on:
  // a query module binds `scope(userId, getDb())` and hands back ROWS, never a
  // handle or a builder. Something has to bind that scope for a request, and
  // only src/lib/db/ may hold the getDb() half — so the module that does it has
  // to be importable from outside, or the app cannot read anything at all.
  const allowed = [
    "@/lib/db/scope",
    "@/lib/db/schema",
    "@/lib/db/scope.ts",
    "@/lib/db/schema.js",
    "../db/scope",
    "@/lib/db/queries/today",
    "@/lib/db/queries/today.ts",
    "../db/queries/today",
  ];

  it.each(allowed)("allows %s", async (specifier) => {
    expect(isRestricted(await lintImport(specifier))).toBe(false);
  });

  it("leaves imports that merely resemble the db directory alone", async () => {
    // The allowlist is expressed as "not ending in scope or schema", so it must
    // not over-reach onto unrelated modules. `dbx` is the adjacent-name case a
    // segment-unaware pattern would catch.
    for (const specifier of ["@/lib/seed/plan", "@/lib/dbx", "drizzle-orm/pg-core"]) {
      expect(isRestricted(await lintImport(specifier)), specifier).toBe(false);
    }
  });

  it("allows a type-only import of the handle modules", async () => {
    // `allowTypeImports` is deliberate: `import type` erases at compile time
    // and cannot build a query. Removing it would push files into the exemption
    // list for no safety, and a list that means two things stops meaning either.
    expect(isRestricted(await lintImport("@/lib/db", { typeOnly: true }))).toBe(false);
  });
});
