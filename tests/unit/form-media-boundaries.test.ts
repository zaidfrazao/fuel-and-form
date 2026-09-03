import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Where the form media may and may not be reached from — § P10, FUEL-94.
 *
 * The ticket: "Media is revealed rather than inlined per row, and **never loaded
 * on `/`**." `/` is the screen PRD § P3 measures, with a 1.5s interactive target
 * on 4G, and FUEL-52 owns that number.
 *
 * ## Why a test, when the import is already written correctly
 *
 * Because both ways of breaking it are invisible to everything else in this
 * repository.
 *
 * A static `import { FormMediaSheet } from …` in `training.tsx` would render
 * identically, pass every component test, pass typecheck, pass lint, and produce
 * byte-identical screen baselines — while moving the sheet, its Radix dialog and
 * the media element into `/training`'s first payload. `next/dynamic` is not a
 * hint; deleting it is a silent performance regression with no symptom a unit
 * suite can see.
 *
 * And `/` reaching the sheet at all would be the same failure one screen over.
 *
 * ## What this does NOT assert, said plainly
 *
 * `lib/form-media.ts` itself is reachable from `/`, and that is correct rather
 * than tolerated: `db/schema.ts` imports `MEDIA_KINDS` from it to build a CHECK
 * constraint, so it is in the graph of every page that touches the database. It
 * is a handful of string constants and a pure function, it is on the SERVER, and
 * it pulls in no media. What must not reach a browser on `/` is the component
 * that renders an `<img>` or a `<video>`, which is what is asserted below.
 */

const SRC = path.join(process.cwd(), "src");
const SHEET = path.join(SRC, "components", "form-media-sheet.tsx");

/** `@/x` → `src/x`, resolved through the extensions this project uses. */
function resolveImport(spec: string, fromFile: string): string | null {
  if (!spec.startsWith("@/") && !spec.startsWith(".")) return null;

  const base = spec.startsWith("@/")
    ? path.join(SRC, spec.slice(2))
    : path.resolve(path.dirname(fromFile), spec);

  for (const candidate of [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    path.join(base, "index.ts"),
    path.join(base, "index.tsx"),
  ]) {
    if (existsSync(candidate) && !candidate.endsWith(path.sep)) {
      try {
        if (readFileSync(candidate).length >= 0 && /\.tsx?$/.test(candidate)) return candidate;
      } catch {
        // A directory, not a file. Fall through to the next candidate.
      }
    }
  }

  return null;
}

/**
 * Every module statically reachable from `entry`.
 *
 * STATIC only, and that is the point rather than a limitation: a `dynamic(() =>
 * import(…))` is exactly what this must not follow, because the module it names
 * is in a separate chunk. So the walk reads `import … from "…"` and
 * `export … from "…"` and ignores call-position `import(…)`.
 */
function staticGraph(entry: string): Set<string> {
  const seen = new Set<string>();
  const queue = [entry];

  while (queue.length) {
    const file = queue.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);

    const source = readFileSync(file, "utf8");
    const specs = [
      ...source.matchAll(/^\s*(?:import|export)\b[^;]*?from\s*["']([^"']+)["']/gm),
      // A bare side-effect import, which has no `from`.
      ...source.matchAll(/^\s*import\s*["']([^"']+)["']/gm),
    ].flatMap((m) => (m[1] ? [m[1]] : []));

    for (const spec of specs) {
      const resolved = resolveImport(spec, file);
      if (resolved && !seen.has(resolved)) queue.push(resolved);
    }
  }

  return seen;
}

describe("form media stays out of the screens that must not pay for it", () => {
  it("the sheet exists where this test thinks it does", () => {
    // Or every assertion below passes by looking for a file nobody has.
    expect(existsSync(SHEET)).toBe(true);
  });

  it.each([
    ["/", path.join(SRC, "app", "(app)", "page.tsx")],
    ["/plan", path.join(SRC, "app", "(app)", "plan", "page.tsx")],
  ])("%s does not statically reach the form media sheet", (_route, entry) => {
    expect(existsSync(entry), `${entry} not found — has the route moved?`).toBe(true);

    expect([...staticGraph(entry)].map((f) => path.relative(process.cwd(), f))).not.toContain(
      path.relative(process.cwd(), SHEET),
    );
  });

  /*
   * The regression that would otherwise be silent: `/training` renders the
   * sheet, so it may NAME the module — but only from inside a lazy import.
   */
  it("/training reaches the sheet only through a lazy import", () => {
    const training = path.join(SRC, "components", "training.tsx");
    const source = readFileSync(training, "utf8");

    expect(source).toMatch(
      /dynamic\(\s*\(\)\s*=>\s*import\(\s*["']@\/components\/form-media-sheet["']/,
    );

    // And not also statically, which would put it back in the first payload
    // while leaving the `dynamic` call in place looking correct.
    expect(source).not.toMatch(
      /^\s*import\s[^;]*from\s*["']@\/components\/form-media-sheet["']/m,
    );

    expect([...staticGraph(training)].map((f) => path.relative(process.cwd(), f))).not.toContain(
      path.relative(process.cwd(), SHEET),
    );
  });
});
