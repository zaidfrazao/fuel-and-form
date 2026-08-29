import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { compile } from "tailwindcss";
import { describe, expect, test } from "vitest";

import {
  FOCUS_RING,
  HOVER_FILL,
  HOVER_GROUND,
  HOVER_LIFT,
  HOVER_LINK,
  HOVER_RING,
  POINTER,
} from "./pointer";

/**
 * The pointer states, compiled rather than read.
 *
 * Every other test in this suite can assert that a component renders a class
 * name. None of them can tell you whether that class name *emits any CSS*, and
 * this file exists because both halves of § Desktop's rule fail silently when
 * they fail:
 *
 *   - `HOVER_RING` is an arbitrary value, and a class name Tailwind declines to
 *     generate is not a build error — it is a page that renders with no ring at
 *     all. Nothing downstream of a missing utility can tell you it is missing.
 *   - `@media (hover: hover)` is supplied by Tailwind v4 rather than by
 *     anything in `pointer.ts`, which is the whole of § Desktop's requirement
 *     that "a phone brought in on width alone would answer a tap by leaving
 *     the hover state stuck to the control afterwards". Nothing in this
 *     repository states it, so nothing in this repository would notice it
 *     going away.
 *
 * So the constants are put through the real compiler with the app's real
 * stylesheet, and the emitted CSS is what gets asserted.
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
    const [pkg, ...rest] = id.split("/");
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
async function build(candidates: readonly string[]): Promise<string> {
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

/** A class name as it appears in a selector, with the CSS escapes applied. */
const escapeClass = (candidate: string) =>
  `.${candidate.replace(/[:.[\]()/%]/g, (character) => `\\${character}`)}`;

/**
 * The at-rule preludes wrapping the first rule for `candidate`.
 *
 * Walks the brace structure rather than pattern-matching on the surrounding
 * text, so `@media (hover: hover)` is only reported when the rule is genuinely
 * nested inside it — a string search would also match a media query that had
 * closed several rules earlier, which is exactly the way this assertion would
 * fail open.
 */
function enclosingAtRules(css: string, candidate: string): string[] {
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

/** Everything in `pointer.ts` that a pointer, rather than a keyboard, reaches. */
const POINTER_STATES = {
  HOVER_GROUND,
  HOVER_FILL,
  HOVER_RING,
  HOVER_LINK,
  HOVER_LIFT,
} as const;

/** Each constant split into the individual utilities it is made of. */
const utilities = (value: string) => value.split(" ").filter(Boolean);

describe("every pointer state is scoped to a device with a pointer", () => {
  /*
   * § Desktop: "The trigger is `@media (hover: hover)`, not a width. This is
   * the one rule in § Desktop that is not a breakpoint, and deliberately so."
   *
   * Tailwind v4 supplies it for `hover:` and `group-hover:` alike. v3 did not,
   * and neither does any line in this repository, so this is the assertion that
   * turns the acceptance criterion "hover does not stick after a tap on a touch
   * device" into something that stays true.
   */
  test.each(
    Object.entries(POINTER_STATES).flatMap(([name, value]) =>
      utilities(value).map((utility) => [name, utility] as const),
    ),
  )("%s → %s", async (_name, utility) => {
    const css = await build([utility]);
    expect(enclosingAtRules(css, utility)).toContain("@media (hover: hover)");
  });
});

describe("the states emit the declarations § Desktop specifies", () => {
  test("the first ground is `surface`", async () => {
    const css = await build([HOVER_GROUND]);
    expect(css).toContain("background-color: var(--surface)");
  });

  test("a solid fill goes to that fill at 90%", async () => {
    const css = await build([HOVER_FILL]);
    // Tailwind renders the alpha as a `color-mix` against `transparent`, which
    // composites over the canvas to the mock's opaque `--hover-ink`.
    expect(css).toContain("color-mix(in oklab, var(--ink) 90%, transparent)");
  });

  test("the third case is a 1.5px inset rule in `text-3`", async () => {
    const css = await build([HOVER_RING]);
    expect(css).toContain("inset 0 0 0 1.5px");
    expect(css).toContain("var(--text-tertiary)");
  });

  test("a link darkens its text and brings the underline with it", async () => {
    const css = await build(utilities(HOVER_LINK));
    expect(css).toContain("color: var(--text-primary)");
    expect(css).toContain("text-decoration-color: currentcolor");
  });

  test("every control that is not an `<a href>` gets the cursor", async () => {
    const css = await build([POINTER]);
    expect(css).toContain("cursor: pointer");
  });
});

describe("the assertions above can fail", () => {
  /*
   * The positive control. `expect(css).toContain(…)` against a compiler that
   * emitted every utility it was ever asked for would be green no matter what
   * the constants said, so here is one it must refuse.
   */
  test("a utility that does not exist emits nothing", async () => {
    const css = await build(["hover:bg-not-a-token"]);
    expect(css).not.toContain("bg-not-a-token");
  });

  /*
   * The `@media (hover: hover)` assertions control each other, which is worth
   * saying because neither set is worth much alone. If `enclosingAtRules` ever
   * returned the query unconditionally, every test in the focus-ring block
   * below would fail; if it ever returned nothing, every test in the block at
   * the top would. The two can only both pass by it reading the real nesting.
   */
  test("the underscore in HOVER_RING is a v3 habit, not a v4 requirement", async () => {
    /*
     * Recorded rather than assumed, because `tile.tsx` and `day-ruler.tsx` both
     * carry a comment saying an unescaped space in an arbitrary value "fails
     * *silently* — a missing ring, not a build error", and on Tailwind v4.3.3
     * that is no longer true: the compiler takes the space and escapes it into
     * the selector itself. The underscore form is kept because it is what the
     * rest of this codebase writes and because it survives a JSX formatter, but
     * this is the test that stops the comment from being believed rather than
     * checked. Both forms are asserted to emit the same declaration.
     */
    const spaced = await build([
      "hover:shadow-[inset 0 0 0 1.5px var(--text-tertiary)]",
    ]);
    expect(spaced).toContain("inset 0 0 0 1.5px");
  });
});

describe("the focus ring is not a pointer state", () => {
  /*
   * § Desktop: "Hover is not focus, and neither may be folded into the other …
   * a pointer user gets one of these two states and a keyboard user the other."
   *
   * A `@media (hover: hover)` wrapper around the focus ring would be that fold,
   * and it would take the ring away from every keyboard on a touchscreen —
   * § Accessibility's "never removed", removed on exactly the devices least
   * able to report it. So the ring is asserted to be *outside* the query that
   * every state above is asserted to be inside.
   */
  test.each(utilities(FOCUS_RING).filter((u) => u.startsWith("focus-visible:")))(
    "%s is unconditional",
    async (utility) => {
      const css = await build([utility]);
      expect(enclosingAtRules(css, utility)).not.toContain(
        "@media (hover: hover)",
      );
    },
  );
});
