/**
 * The box a checklist row draws beside its hidden native checkbox — `/shopping`
 * since FUEL-45, and the recipe's prep lists since FUEL-144.
 *
 * One declaration for both, so the two lists cannot drift into two ticks. It
 * must be the input's NEXT sibling inside a `group` label: every state here is
 * read off the input through `peer-*`, and the hover darkening off the row.
 *
 * `aria-hidden` because the input beside it already carries the state to the
 * accessibility tree, and a second announcement of the same fact is noise.
 *
 * The tick is an SVG path rather than a glyph so it inherits `ink-fg` cleanly
 * at any size and does not depend on a font having a checkmark at the weight
 * this needs.
 *
 * `mt-[2.5px]` is the rest of the label's arithmetic: the box is 18px and the
 * line it belongs beside is 23px, so half the difference centres it on that
 * line rather than hanging it from the top of one.
 */
export function TickMark() {
  return (
    <span
      aria-hidden
      // The tick's own visibility is reached through `[&>svg]`, not through
      // a second `peer-checked:` on the svg itself: `peer-*` compiles to a
      // SIBLING combinator, and the svg is a CHILD of this span rather than
      // a sibling of the input, so `peer-checked:opacity-100` on it would
      // never match and the box would fill with an invisible tick in it.
      className={`mt-[2.5px] flex size-[18px] shrink-0 items-center justify-center rounded-[4px] border border-border [&>svg]:opacity-0 group-hover:border-text-secondary peer-checked:border-ink peer-checked:group-hover:border-ink peer-checked:bg-ink peer-checked:[&>svg]:opacity-100 peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-accent`}
    >
      <svg viewBox="0 0 12 12" className="size-[10px] text-ink-fg">
        <path
          d="M2 6.2 4.6 8.8 10 3.4"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </span>
  );
}
