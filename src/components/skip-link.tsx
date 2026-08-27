import { MAIN_ID } from "@/components/page-main";

/**
 * The first focusable element in the document — FUEL-61, WCAG 2.4.1 Bypass
 * Blocks.
 *
 * ## What there is to skip, which is not the nav
 *
 * `app/(app)/layout.tsx` argues that the shell is owed no skip link, and about
 * the shell that is still true: it is last in the DOM at every width and is
 * moved to the left of the desktop screen with `lg:order-first`, so a keyboard
 * user meets the content before it and has nothing to tab past.
 *
 * What that argument does not cover is the root layout, which is where this
 * component is mounted. Two bars render above `children` and both carry
 * focusables: the demo banner's repository link and dismiss button, and the walk
 * reminder's "Log the walk." Each is conditional — a demo session, an evening
 * after the reminder time — which is what made the gap easy to miss, and is also
 * why the link is unconditional. A bypass that appears only on the screens that
 * happen to need it is one a user cannot learn to expect.
 *
 * ## Why it sits above the banner rather than in the app layout
 *
 * "First focusable element" is the requirement, not a preference. The demo
 * banner and the walk reminder are rendered by the root layout, above
 * `children`, so anything mounted inside `app/(app)/layout.tsx` is already
 * behind them — a skip link there would be reachable only after tabbing through
 * the two things it exists to skip. The root layout is the only position that
 * satisfies it.
 *
 * That places it on `/login` and `/dev/*` as well, which is correct rather than
 * merely tolerable: every page in the app renders exactly one `<main>`, so
 * `#main` resolves everywhere, and a login form behind a demo banner is a page
 * with something to bypass too.
 *
 * ## Hidden until focused, not hidden from everyone
 *
 * `sr-only` shrinks the link to a 1px clipped box, which keeps it in the tab
 * order and in the accessibility tree while taking it out of the visual design —
 * the app's four other `sr-only` users do the same thing for the same reason.
 * `focus:not-sr-only` reverses all of it the moment the link is reached, because
 * a bypass a sighted keyboard user cannot see is a bypass they cannot use.
 *
 * `focus:` and not `focus-visible:`: the two coincide here, since an element
 * that is 1px and clipped cannot be reached with a pointer, and `focus` is the
 * one that holds if it ever stops being clipped.
 *
 * `absolute` rather than `fixed`, so it scrolls with the top of the page instead
 * of hovering over content the user has scrolled to; it is only ever reached
 * from the top of the document. `z-50` clears the two bars it overlays while
 * focused.
 */
export function SkipLink() {
  return (
    <a
      href={`#${MAIN_ID}`}
      className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:rounded-full focus:border focus:border-border focus:bg-background focus:px-4 focus:py-2 focus:text-body focus:text-text-primary focus:no-underline focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:ring-offset-background"
    >
      {/*
       * § Tone of Voice: plain, and describing the destination rather than the
       * mechanism. "Skip to content" over "Skip navigation" because what is
       * above is a banner and a reminder as often as it is a nav, and the
       * content is the part that is true on every screen.
       */}
      Skip to content
    </a>
  );
}
