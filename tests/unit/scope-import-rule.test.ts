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

beforeAll(() => {
  // Loads the project's actual flat config from cwd. Testing a copy of the
  // patterns would assert that a regex matches itself.
  eslint = new ESLint({ cwd: process.cwd() });
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
  const allowed = ["@/lib/db/scope", "@/lib/db/schema"];

  it.each(allowed)("allows %s", async (specifier) => {
    expect(isRestricted(await lintImport(specifier))).toBe(false);
  });

  it("allows a type-only import of the handle modules", async () => {
    // `allowTypeImports` is deliberate: `import type` erases at compile time
    // and cannot build a query. Removing it would push files into the exemption
    // list for no safety, and a list that means two things stops meaning either.
    expect(isRestricted(await lintImport("@/lib/db", { typeOnly: true }))).toBe(false);
  });
});
