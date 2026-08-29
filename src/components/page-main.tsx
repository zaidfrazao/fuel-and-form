import type { ReactNode } from "react";

import { FRAME_MEASURE } from "@/lib/frame";
import { cn } from "@/lib/utils";

/**
 * The id every page's `<main>` carries — FUEL-61.
 *
 * Exported rather than written twice: `skip-link.tsx` needs the same string in
 * its `href`, and a skip link pointing at an id that no longer exists fails
 * silently. One constant, two readers.
 */
export const MAIN_ID = "main";

/**
 * Every screen's content column — Brand Guide § Navigation, § Accessibility.
 *
 * Thirteen `<main>` elements across the app repeated the same six classes and
 * differed in four. This owns the six, takes the four, and adds the two
 * attributes FUEL-61 needs on all of them at once.
 *
 * ## Why `<main>` is programmatically focusable
 *
 * `tabIndex={-1}` makes this focusable by script without adding it to the tab
 * order, and two separate things need that.
 *
 * The skip link is the obvious one: `href="#main"` moves the browser's *scroll*
 * to the target on its own, but focus only follows to an element that can hold
 * it. Without this attribute a skip link scrolls the page and leaves focus on
 * the link, so the next Tab returns to the second item of the chrome the user
 * just asked to skip — the failure that makes a skip link look implemented and
 * do nothing.
 *
 * The second is route changes, and it is the reason this file adds no client
 * code. Next already focuses the changed segment's first host element on every
 * client-side navigation — `InnerScrollAndFocusHandlerOld` in
 * `next/dist/client/components/layout-router.js` calls `domNode.focus()`, and it
 * is the handler in use here because `InnerScrollHandlerNew` ("No longer focuses
 * the first host descendant") is gated behind `experimental.appNewScrollHandler`,
 * which `next.config.ts` does not set. That call has been running all along and
 * doing nothing, because `.focus()` on an element with no `tabIndex` is a no-op.
 * This attribute is the whole of what was missing; a `useEffect` that focused
 * main on navigation would be a second implementation of a thing the framework
 * already does.
 *
 * Checked in the runtime rather than the docs, which cover scroll restoration
 * and say nothing about focus. If that flag is ever turned on, the new handler
 * stops focusing anything and this becomes a real gap — the effect would have to
 * be written then, and this paragraph is the note that says so.
 *
 * ## Why the focus ring is suppressed here and nowhere else
 *
 * § Accessibility: "2px `accent` ring, 2px offset, on every interactive element
 * in both modes. Never removed." That rule is about interactive elements, and a
 * content column is not one — it takes focus only because something else moved
 * it here, and a ring drawn around the entire screen reads as the page having
 * been clicked rather than as a place a user can act. Every control inside keeps
 * its own ring, which is where the rule is doing its work.
 *
 * `outline-none` and not `focus:outline-none`: modern browsers paint the UA
 * outline through `:focus-visible`, which programmatic focus on a `-1` element
 * does not match, so on most of them this suppresses nothing. It is here for the
 * ones where it does.
 *
 * ## The layout classes are not decoration
 *
 * Since FUEL-58 the layout owns the viewport height and a page fills what is
 * left, so `flex w-full min-w-0 flex-1` is load-bearing on all three counts: a
 * main that is not `flex-1` ends above the fold and takes `/`'s and
 * `/training`'s sticky action bars up with it, and one that is not `min-w-0`
 * refuses to shrink below its content — which pushed `/plan`'s 1023px week grid
 * 248px off the right of the screen at exactly 1024px. Both failures are silent
 * and both were paid for once already. Routed through here they cannot be
 * omitted by a page that forgets them.
 *
 * ## The column is the frame's, not this file's — FUEL-70
 *
 * `FRAME_MEASURE` is where the 640px went, and it carries two things rather than
 * one: the width, and — at `lg` and above — the column of Brand Guide § Desktop's
 * grid that the width belongs to. The same constant is worn by the demo banner's
 * inner box and the walk reminder's, which is the whole of how three elements in
 * two different layouts arrive at one centre. Below `lg` it is the `mx-auto` and
 * the `max-w` this component always had, unchanged.
 *
 * Still the default rather than a per-screen decision, and still overridable:
 * `/plan` widens it to 1024px for the week grid and spans it across the aside to
 * get there, and is the only screen that does either. `cn` resolves the conflict
 * in the caller's favour — a plain string join would leave both max-widths
 * standing and let source order decide.
 */
export function PageMain({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <main
      id={MAIN_ID}
      tabIndex={-1}
      className={cn(
        FRAME_MEASURE,
        "flex min-w-0 flex-1 flex-col px-[22px] outline-none md:px-7",
        className,
      )}
    >
      {children}
    </main>
  );
}
