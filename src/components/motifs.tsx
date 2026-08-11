import type { ReactNode, SVGProps } from "react";

import { cn } from "@/lib/utils";

/**
 * The line motifs — Brand Guide § Materials.
 *
 * Eight marks cover the entire library: bowl, cup, roll, pot, plate, bar, egg,
 * walk. No photography to shoot, licence, or ship.
 *
 * The path data is transcribed verbatim from the sprite in
 * `docs/BRAND_GUIDE.html`, which the guide names as the source of truth for
 * appearance. Nothing here is redrawn.
 *
 * The mock ships them as one `<symbol>` sprite referenced by `<use href="#m-…">`.
 * That is rejected here: `<use>` resolves against a sprite that has to be mounted
 * exactly once, somewhere else in the tree, which makes every motif depend on a
 * global side effect and on render order. A motif that silently renders blank
 * because a layout changed is a worse failure than the few hundred bytes this
 * costs. A record of path sets has no such coupling and tree-shakes per route.
 *
 * The stroke spec — fill none, `currentColor`, 1.6px, round caps and joins — is
 * written once on the wrapping `<g>` rather than on each of the twenty paths, so
 * it is one edit to change and one place to get wrong. `currentColor` is what
 * lets a single set work on ink and on stone in both modes.
 */

export const MOTIF_NAMES = [
  "bowl",
  "cup",
  "roll",
  "pot",
  "plate",
  "bar",
  "egg",
  "walk",
] as const;

export type MotifName = (typeof MOTIF_NAMES)[number];

/**
 * Each entry is the body of one 48×48 mark. Elements rather than raw `d` strings
 * because three of the eight use `<circle>` and `<rect>` — flattening those to
 * paths would mean redrawing them, and the mock is the thing that was approved.
 */
const MOTIF: Record<MotifName, ReactNode> = {
  bowl: (
    <>
      <path d="M7 22h34v1c0 9-7.6 16-17 16S7 32 7 23v-1Z" />
      <path d="M13 22c2.6-3.4 6.4-5 11-5s8.4 1.6 11 5" />
      <path d="M19 8c-1.8 2.2-1.8 4 0 6M27 6c-1.8 2.4-1.8 4.6 0 7" />
    </>
  ),
  cup: (
    <>
      <path d="M11 19h21v10a8 8 0 0 1-8 8h-5a8 8 0 0 1-8-8V19Z" />
      <path d="M32 22h3.5a4.5 4.5 0 0 1 0 9H32" />
      <path d="M7 41h32" />
      <path d="M18 8c-1.8 2.2-1.8 4 0 6M26 6c-1.8 2.4-1.8 4.6 0 7" />
    </>
  ),
  roll: (
    <>
      <path d="M6 29c0-7.2 8-12 18-12s18 4.8 18 12c0 5.4-8 9-18 9S6 34.4 6 29Z" />
      <path d="M16 24.5l3.5 5M23 23.5l3.5 5M30 24.5l3.5 5" />
    </>
  ),
  pot: (
    <>
      <path d="M12 22h24v10a6 6 0 0 1-6 6H18a6 6 0 0 1-6-6V22Z" />
      <path d="M8 22h32M12 27H8M36 27h4" />
      <path d="M19 10c-1.8 2.2-1.8 4 0 6M27 8c-1.8 2.4-1.8 4.6 0 7" />
    </>
  ),
  plate: (
    <>
      <circle cx="24" cy="24" r="16" />
      <circle cx="24" cy="24" r="10.5" />
      <path d="M18.5 26.5c1.6-2.6 3.4-3.9 5.5-3.9s3.9 1.3 5.5 3.9" />
    </>
  ),
  bar: (
    <>
      <rect x="6" y="17" width="36" height="14" rx="3.5" />
      <path d="M16 17l-4 14M25 17l-4 14M34 17l-4 14" />
    </>
  ),
  egg: (
    <>
      <path d="M11 30c0-6.6 3.6-13 8-13s8 6.4 8 13a8 8 0 0 1-16 0Z" />
      <circle cx="19" cy="29" r="3.4" />
      <path d="M28 33c0-4.4 2.6-8 6-8s6 3.6 6 8a6 6 0 0 1-12 0Z" />
    </>
  ),
  walk: (
    <>
      <path d="M9 34c7 0 7-9 14-9s7-9 14-9" />
      <circle cx="9" cy="34" r="2" />
      <circle cx="37" cy="16" r="2" />
    </>
  ),
};

export function Motif({
  name,
  title,
  className,
  ...props
}: {
  name: MotifName;
  /**
   * Names the mark for assistive technology, which also opts it into the
   * accessibility tree.
   *
   * Omitted by default, and that is the common case: on a tile the motif sits
   * directly beneath the meal's name, so announcing it would repeat a label the
   * user has already heard. Brand Guide § Deliberately Absent opens with "icons
   * that repeat their own label".
   */
  title?: string;
} & Omit<SVGProps<SVGSVGElement>, "title">) {
  return (
    <svg
      viewBox="0 0 48 48"
      // Sized by the caller. Tiles draw them at 46px; the default keeps a bare
      // <Motif /> from collapsing to nothing.
      className={cn("h-12 w-12", className)}
      role={title ? "img" : undefined}
      aria-hidden={title ? undefined : true}
      focusable="false"
      {...props}
    >
      {title && <title>{title}</title>}
      <g
        fill="none"
        stroke="currentColor"
        strokeWidth={1.6}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {MOTIF[name]}
      </g>
    </svg>
  );
}
