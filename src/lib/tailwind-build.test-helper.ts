import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { compile } from "tailwindcss";
import { expect } from "vitest";

/**
 * The app's own stylesheet, compiled — the harness `pointer.test.ts` built and
 * `frame.css.test.ts` needed second (FUEL-77).
 *
 * Every other test in this suite can assert that a component renders a class
 * name. None of them can tell you whether that class name *emits any CSS*, and
 * both of its callers exist because their half of § Desktop fails silently:
 *
 *   - A class name Tailwind declines to generate is not a build error. It is a
 *     page that renders with no ring at all, or a two-column composition that
 *     never arrives, and nothing downstream of a missing utility can report it.
 *   - The at-rule a utility is wrapped in is supplied by Tailwind rather than
 *     by anything in `src/`. `@media (hover: hover)` comes free with `hover:`;
 *     the width in `xl:`'s media query comes from a `--breakpoint-xl` that, if
 *     it is ever deleted, is replaced by a default 8px away rather than by
 *     nothing. A deletion that changes a number is invisible to every test that
 *     reads class names.
 *
 * Extracted rather than copied. The `@import` resolver below is thirty lines of
 * knowing how a CSS bundler follows a bare specifier, and two divergent copies
 * of it would be two answers to a question with one right one — which is the
 * fault `globals.css` states at length about the frame's own numbers.
 *
 * Named `.test-helper.ts` so vitest's `src/**\/*.{test,spec}.{ts,tsx}` does not
 * collect it as a suite: it contains no tests, and a file of helpers reported as
 * an empty suite is a failure in most runners' default configuration.
 */

const THIS_FILE = fileURLToPath(import.meta.url);
const SRC = join(dirname(THIS_FILE), "..");
const ROOT = join(SRC, "..");
const NODE_MODULES = join(ROOT, "node_modules");

/**
 * Resolve an `@import` the way the bundler does.
 *
 * Bare specifiers land in `node_modules`, and a package that ships its CSS
 * under `dist` is followed there — `shadcn/tailwind.css` is the one that does,
 * and globals.css imports it.
 */
function resolveStylesheet(id: string, base: string): string {
  if (id.startsWith(".")) return resolve(base, id);
  if (id === "tailwindcss") return join(NODE_MODULES, "tailwindcss/index.css");
  if (id.endsWith(".css")) {
    const direct = join(NODE_MODULES, id);
    if (existsSync(direct)) return direct;
    const [pkg = id, ...rest] = id.split("/");
    const dist = join(NODE_MODULES, pkg, "dist", rest.join("/"));
    if (existsSync(dist)) return dist;
    return direct;
  }
  // A bare package specifier: the entry a CSS bundler follows is `style`,
  // then `main`. `tw-animate-css` is the one globals.css imports this way.
  const manifest = join(NODE_MODULES, id, "package.json");
  if (existsSync(manifest)) {
    const pkg = JSON.parse(readFileSync(manifest, "utf8")) as {
      style?: string;
      main?: string;
      exports?: { "."?: { style?: string } };
    };
    const entry = pkg.exports?.["."]?.style ?? pkg.style ?? pkg.main;
    if (entry) return join(NODE_MODULES, id, entry);
  }
  return join(NODE_MODULES, `${id}.css`);
}

/**
 * The app's own stylesheet, compiled against a list of candidate classes.
 *
 * `globals.css` rather than a bare `@import "tailwindcss"`, so the tokens these
 * utilities reference are the real ones and a renamed token shows up here as a
 * `var(--…)` that no longer exists.
 */
export async function build(candidates: readonly string[]): Promise<string> {
  const entry = join(SRC, "app/globals.css");
  const compiled = await compile(readFileSync(entry, "utf8"), {
    base: dirname(entry),
    loadStylesheet: async (id: string, base: string) => {
      const path = resolveStylesheet(id, base);
      return { path, base: dirname(path), content: readFileSync(path, "utf8") };
    },
    // globals.css declares no `@plugin`, so nothing should ask for a module. If
    // one is ever added, this throws rather than quietly compiling without it.
    loadModule: async (id: string) => {
      throw new Error(`unexpected @plugin/@config: ${id}`);
    },
  });
  return compiled.build([...candidates]);
}

/**
 * A class name as it appears in a selector, with the CSS escapes applied.
 *
 * The comma is in the set because `minmax(0,1fr)` puts one in a class name, and
 * a missing escape here reports the utility as *not emitted* — which is the
 * failure this helper exists to detect, arriving as a false positive.
 */
export const escapeClass = (candidate: string) =>
  `.${candidate.replace(/[:.[\]()/%,]/g, (character) => `\\${character}`)}`;

/**
 * The at-rule preludes wrapping the first rule for `candidate`.
 *
 * Walks the brace structure rather than pattern-matching on the surrounding
 * text, so an at-rule is only reported when the rule is genuinely nested inside
 * it — a string search would also match a media query that had closed several
 * rules earlier, which is exactly the way this assertion would fail open.
 */
export function enclosingAtRules(css: string, candidate: string): string[] {
  const index = css.indexOf(escapeClass(candidate));
  expect(index, `no rule emitted for ${candidate}`).toBeGreaterThan(-1);

  const stack: string[] = [];
  let preludeStart = 0;
  for (let i = 0; i < index; i += 1) {
    const character = css[i];
    if (character === "{") {
      stack.push(css.slice(preludeStart, i).trim());
      preludeStart = i + 1;
    } else if (character === "}") {
      stack.pop();
      preludeStart = i + 1;
    } else if (character === ";") {
      preludeStart = i + 1;
    }
  }
  return stack.filter((prelude) => prelude.startsWith("@"));
}

/** Each class-string constant split into the individual utilities it is made of. */
export const utilities = (value: string) => value.split(" ").filter(Boolean);
