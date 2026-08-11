import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from "react";

import { SlashMeta } from "@/components/kv-grid";
import { Motif, type MotifName } from "@/components/motifs";
import { cn } from "@/lib/utils";

/**
 * The tile — Brand Guide § Component Patterns.
 *
 * Flat, radius 14, either `ink` or `surface`. Name at top, a single line motif
 * centred, `/ ` metadata at the bottom. Used in the meal picker and on meal
 * detail. Geometry transcribed from `docs/BRAND_GUIDE.html`: 12px/13px padding,
 * 8px internal gap, 132px minimum height, a 46px motif.
 *
 * There is no card component in this design — § Implementation Notes has the
 * shadcn `Card` stripped to a bare layout primitive precisely so that tiles and
 * hairline-separated lists are the only two ways content sits on the canvas.
 */

export type TileMaterial = "ink" | "surface";

type TileOwnProps = {
  name: ReactNode;
  motif: MotifName;
  /** Rendered at the foot, prefixed with the slash mark — `591 kcal · P 62`. */
  meta?: ReactNode;
  /** `surface` is the stone tile; `ink` is the one that carries the eye. */
  material?: TileMaterial;
  /**
   * Drawn as a 1.5px `accent` inset ring — never as a fill, so an ink tile stays
   * ink and a stone tile stays stone. It is also the screen's one umber element,
   * which is the whole of Brand Guide § Accent: umber says "here".
   */
  selected?: boolean;
  className?: string;
};

/**
 * `button` when the tile is pickable, `div` when it is only being shown — the
 * meal picker needs the former and meal detail the latter, and a `div` with a
 * click handler is neither focusable nor announced.
 *
 * No handler is declared inside this file, so it carries no `"use client"` and
 * can be rendered from a server component; a client parent that imports it gets
 * it bundled as its own and can pass `onClick` normally.
 *
 * The union is what checks the *callsite* — `disabled` on a `div` tile is a type
 * error, and that is the property worth having. Inside the component, pulling
 * `as` out of the props separates it from the rest, so TypeScript can no longer
 * correlate the two halves and the spread needs one assertion per branch. The
 * assertion is narrowing a union whose discriminant has already been read, so it
 * asserts nothing the type system does not already know.
 */
type TileProps =
  | (TileOwnProps & { as?: "div" } & Omit<
        HTMLAttributes<HTMLDivElement>,
        keyof TileOwnProps
      >)
  | (TileOwnProps & { as: "button" } & Omit<
        ButtonHTMLAttributes<HTMLButtonElement>,
        keyof TileOwnProps
      >);

const MATERIAL: Record<TileMaterial, string> = {
  ink: "bg-ink text-ink-fg",
  surface: "bg-surface text-text-primary",
};

export function Tile({
  name,
  motif,
  meta,
  material = "surface",
  selected,
  className,
  as = "div",
  ...rest
}: TileProps) {
  const content = (
    <>
      <span className="text-[0.9375rem] leading-[1.2] font-semibold tracking-[-0.018em]">
        {name}
      </span>
      {/* `flex-1` with the motif centred inside it, so tiles of differing name
          lengths still line their marks up across a row. */}
      <span className="grid flex-1 place-items-center">
        <Motif name={motif} className="h-[46px] w-[46px]" />
      </span>
      {meta !== undefined && <SlashMeta subdued>{meta}</SlashMeta>}
    </>
  );

  const classes = cn(
    "flex min-h-[132px] flex-col gap-2 rounded-lg px-[13px] py-3 text-left",
    MATERIAL[material],
    // Brand Guide § Accessibility — 2px accent ring at 2px offset on every
    // interactive element, in both modes, never removed. Only `focus-visible`,
    // so a pointer tap does not leave a ring behind it.
    //
    // `outline`, where theme-toggle.tsx uses Tailwind's `ring-*`. Not a stylistic
    // difference: `ring` is implemented as a box-shadow, and the selection ring
    // below is an inline box-shadow that would replace it outright — a selected
    // tile would take focus and show nothing at all. An outline is a separate
    // property, so the two coexist and the ring never goes missing on the one
    // tile most likely to be focused.
    as === "button" &&
      "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
    className,
  );

  // Inline rather than a Tailwind arbitrary value. `shadow-[inset_0_0_0_1.5px_…]`
  // needs every space underscore-escaped and fails *silently* when it is not —
  // a missing ring, not a build error. day-ruler.tsx made the same call for the
  // hatch, and for the same reason. `var(--accent)` keeps the hex in the token
  // layer, which `globals.tokens.test.ts` enforces.
  const ring = selected
    ? { boxShadow: "inset 0 0 0 1.5px var(--accent)" }
    : undefined;

  if (as === "button") {
    return (
      <button
        type="button"
        // `aria-pressed` rather than `aria-selected`: the latter is only valid
        // inside a listbox, grid or tablist, and a tile is a standalone toggle.
        aria-pressed={selected}
        className={classes}
        style={ring}
        {...(rest as ButtonHTMLAttributes<HTMLButtonElement>)}
      >
        {content}
      </button>
    );
  }

  return (
    <div
      className={classes}
      style={ring}
      {...(rest as HTMLAttributes<HTMLDivElement>)}
    >
      {content}
    </div>
  );
}
