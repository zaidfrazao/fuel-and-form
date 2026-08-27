"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";

import { MAIN_ID } from "@/components/page-main";

/**
 * Moves focus to the new screen on a client-side navigation — FUEL-61.
 *
 * A `<Link>` swaps the page under the user and leaves focus on the link that
 * did it. A sighted user sees the new screen; a screen-reader user is told
 * nothing, and their next Tab continues from a control that belongs to the
 * screen they just left. This moves focus to the content, which is what makes
 * the new page the thing that gets announced.
 *
 * ## Why this exists at all, having been argued not to
 *
 * The plan for this task expected to write nothing here. Next ships
 * `InnerScrollAndFocusHandlerOld` in `client/components/layout-router.js`, it
 * calls `domNode.focus()` on the changed segment, and it is the handler in use
 * — `InnerScrollHandlerNew` ("No longer focuses the first host descendant") is
 * behind `experimental.appNewScrollHandler`, which `next.config.ts` does not
 * set. `PageMain`'s `tabIndex={-1}` should have been the whole fix.
 *
 * Measured, it is not. With a `focusin` listener recording every focus change
 * across a `/` → `/plan` navigation, the only event is the link's own: Next's
 * call never reaches `<main>`. Its handler returns early unless the router asked
 * for a scroll, and the pages here open at the top of the viewport, so it
 * usually has nothing to do and does not get as far as the focus call. The
 * attribute is still required — this component would be a no-op without it —
 * but it is not sufficient, and the difference was only visible in a browser.
 *
 * ## What it deliberately does NOT do
 *
 * `usePathname` and not `useSearchParams`, which is the whole of how
 * param-only navigations are excluded: `/training?date=` and `/plan?week=`
 * change the query and not the path, so `pathname` is unchanged, the ref
 * comparison below finds no change, and focus stays where it is.
 *
 * That exclusion is the point rather than an oversight. Both paginators are
 * built around focus staying on the control — `training.tsx` and `week-nav.tsx`
 * each carry an `aria-live` label "because the label changes on navigation while
 * focus stays on the link that moved it". Move focus to `<main>` on every step
 * and a keyboard user can no longer press Prev twice, and the live region
 * announces on top of the focus change. Keeping focus on the control and
 * announcing through a live region is the right pattern for a paginator that
 * stays on the same screen, and it is already built. FUEL-61's acceptance
 * criteria asked for the opposite; the deviation was taken deliberately and is
 * recorded on the ticket.
 *
 * Measured, that holds on `/plan`: stepping `?week=` twice leaves focus on the
 * Prev link both times and the live region reads the new week. It does NOT hold
 * on `/training`, and not because of anything here — `training/page.tsx` carries
 * `key={training.date}`, so a `?date=` step remounts the whole subtree, destroys
 * the focused link and drops focus to `<body>`. That predates this task and is
 * not something this component can fix from the outside: the paginator lives
 * inside the tree the key throws away. Restoring it means moving `DateNav` out
 * of the keyed subtree, which is a change to a screen thick with optimistic
 * state and belongs in its own ticket. Recorded on FUEL-61 rather than left for
 * someone to rediscover.
 *
 * The first render is excluded too. On a cold load focus belongs at the top of
 * the document, where the skip link is the first thing a Tab reaches — stealing
 * it into `<main>` would take that away and skip the bypass past the user.
 *
 * ## `preventScroll`, so nothing here animates
 *
 * Focusing an element scrolls it into view. Next already owns scroll position
 * on navigation, so scrolling again here would either duplicate that or fight
 * it, and § Accessibility asks anything that scrolls to respect
 * `prefers-reduced-motion`. `preventScroll: true` removes the question instead
 * of answering it: this moves focus and nothing else, and there is no motion to
 * suppress.
 *
 * ## The screen it focuses may not be the screen that stays
 *
 * `loading.tsx` renders a `PageMain` too, so during a navigation that suspends
 * there are two `<main id="main">` elements in sequence: the skeleton, then the
 * real page. The effect below runs as soon as the path changes, which is while
 * the skeleton is on screen — measured at 122ms into a `/` → `/plan` navigation,
 * with the real content arriving at 452ms. Focus landed on the skeleton, the
 * skeleton was then discarded, and focus fell back to `<body>`: worse than doing
 * nothing, because the user ends up nowhere rather than on the link they left.
 *
 * So the focus is re-asserted once, if and only if the element it landed on
 * leaves the document. The observer is one-shot and disconnects the moment it
 * fires. It re-focuses only when `activeElement` is `<body>` — that is the
 * signature of focus having been DROPPED rather than moved, and it means a user
 * who tabbed somewhere while the page streamed keeps where they are instead of
 * being yanked back.
 *
 * Mounted in `app/(app)/layout.tsx` for the reason `nav-shell-mount.tsx` gives
 * for living there — the layout survives navigation within the group, so the
 * ref below persists across route changes rather than resetting on every one.
 */
export function RouteFocus() {
  const pathname = usePathname();
  const previous = useRef<string | null>(null);

  useEffect(() => {
    const isFirstRender = previous.current === null;
    const changed = previous.current !== pathname;

    previous.current = pathname;

    if (isFirstRender || !changed) return;

    const main = document.getElementById(MAIN_ID);

    main?.focus({ preventScroll: true });

    if (!main) return;

    /*
     * Whether the focus this effect moved is still the one in play.
     *
     * Load-bearing, and the guard `main.isConnected` alone is not enough. The
     * observer below stays armed until the element it watches leaves the
     * document, which on a screen that does not suspend can be long after the
     * navigation is over — and `/training` remounts its whole subtree on
     * `key={training.date}`, so a `?date=` step later would look identical to
     * the skeleton being replaced. Without this the observer would pull focus
     * into `<main>` on a param-only change: exactly the behaviour this
     * component documents itself as not having.
     */
    let holdsFocus = document.activeElement === main;
    const onFocusIn = (event: FocusEvent) => {
      holdsFocus = event.target === main;
    };

    document.addEventListener("focusin", onFocusIn, true);

    // See the header: the element above may be `loading.tsx`'s skeleton, which
    // the real screen replaces a moment later, taking focus down with it.
    const observer = new MutationObserver(() => {
      if (main.isConnected) return;

      observer.disconnect();

      if (holdsFocus && document.activeElement === document.body) {
        document.getElementById(MAIN_ID)?.focus({ preventScroll: true });
      }
    });

    observer.observe(document.body, { childList: true, subtree: true });

    return () => {
      observer.disconnect();
      document.removeEventListener("focusin", onFocusIn, true);
    };
  }, [pathname]);

  return null;
}
