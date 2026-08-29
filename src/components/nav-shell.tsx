import Link from "next/link";
import type { ReactNode } from "react";

import { DESTINATIONS, type DestinationId, resolveActive } from "@/lib/nav";
import { HOVER_FILL, HOVER_GROUND, HOVER_LINK } from "@/lib/pointer";
import { cn } from "@/lib/utils";

/**
 * The navigation shell — Brand Guide § Navigation.
 *
 * A centred pill below 1024px, a left sidebar at and above it, carrying the four
 * destinations FUEL-56 named. Specified since the brand guide was written and
 * never built: `right-now.tsx` has been carrying "a text link rather than the
 * § Navigation pill, which does not exist yet" since FUEL-21.
 *
 * ## Transcribed, not designed
 *
 * `docs/BRAND_GUIDE.html` already renders this component on five of its screens
 * — markup at lines 569, 707, 778, 852 and 921, CSS in the `tab bar (pill)`
 * block at 258. § Document History holds the mock as the source of truth for
 * appearance, so the geometry here is transcription: 1px border, 4px padding,
 * 2px gap, 46×40px inactive items, and an active item that goes `width: auto`
 * with 13px/15px padding and a 7px gap. Five divergences from it are deliberate
 * and each is argued where it happens — the fourth destination, the landmark's
 * element, `role="img"`, the hit area, and the inactive item's colour.
 *
 * ## The inactive colour is `text-secondary`, not the mock's `text-3`
 *
 * The mock paints an inactive `.tabitem` in `var(--text-3)`, which is
 * `text-tertiary` here. Measured against the canvas it is 2.19:1 in light and
 * 2.72:1 in dark — under § Accessibility's 4.5:1 for text and under even the
 * 3:1 it sets for "every control, tick, dot and hairline that carries meaning".
 * These are controls, and in the sidebar they are also text.
 *
 * § Accessibility settles it rather than leaving it to taste: "Where restraint
 * and contrast conflict, contrast wins and the hairline gets darker."
 * `text-secondary` is the next step up and clears the text bar in both modes —
 * 4.80:1 light, 7.80:1 dark. The mock is the source of truth for appearance;
 * it is not a source of truth for contrast, and it was drawn without a sidebar,
 * so it never had to carry these labels as text at all.
 *
 * The foot link on `/` uses `text-tertiary` on the same canvas and has the same
 * problem. FUEL-58 removed the three beside it, so this is now one link rather
 * than four, but it is still older than this component and still outside both
 * tasks — worth its own rather than a silent fix here.
 *
 * ## The fourth destination is Training, not More
 *
 * The mock's four are Now · Plan · Weight · More. FUEL-56 replaced More with
 * Training and wrote the result into § Navigation as a route table, which is the
 * `.md` overriding the mock rather than disagreeing with it. So three of these
 * marks are transcribed and Training's is new — see `NAV_ICON`.
 *
 * ## No transition
 *
 * The active item reflows when it gains its label, and nothing animates while it
 * does. § Animation & Motion lists "tab switches" under **Does not**, alongside
 * logging confirmation and list rendering. That also disposes of the
 * `prefers-reduced-motion` question this component would otherwise owe an
 * answer: there is no motion to reduce, which § Signature Graphics calls the
 * cheapest way to honour the rule.
 *
 * ## Where it sits, and the bar it does not cover
 *
 * `.tabbar` is `margin-top: auto` in the mock — normal flow, not `fixed` and not
 * `sticky` — and the mock's own screens stack it *after* the action bar. This
 * component was built that way, and FUEL-65 changed it: below `lg` the shell is
 * now `sticky bottom-0`. § Navigation carries the override and the reasoning;
 * what matters here is that the mock's `margin-top: auto` is no longer the live
 * rule, so it is not restored as a fidelity fix.
 *
 * The measurement that forced it, at 375×667: the shell sat at the very end of
 * the document on every route, so reaching it meant scrolling 525px on `/`,
 * 1373px on `/training` and 3636px on `/weight` — and on `/` the sticky action
 * bar occupied the exact strip a tab bar would, so the screen showed a pinned
 * bar and no navigation at all. A shell that far down is not navigation; it is
 * a footer.
 *
 * The collision that the old arrangement resolved is real and comes back, so it
 * is re-resolved rather than dropped. `/`'s and `/training`'s `sticky bottom-0`
 * action bars stick to `--nav-shell-h` instead of to 0, which is this shell's
 * own height, declared once in globals.css. Staying `sticky` rather than
 * `fixed` is what keeps the rest of FUEL-58's arrangement intact: the shell is
 * still in flow, still the last child of the page column, and still reserves its
 * own space, so no page needs padding to keep its final line clear of it.
 */
export function NavShell({
  /**
   * The path to resolve the active destination from.
   *
   * A prop rather than a `usePathname()` call inside, for three reasons. It
   * keeps the component renderable on the server, so the shell is in the first
   * HTML rather than appearing after hydration. It lets the specimen show all
   * five active states on one page, which a component reading the real URL
   * cannot do. And it leaves FUEL-58 free to decide where the pathname comes
   * from — Next 16 makes `usePathname` suspend under `cacheComponents`, which
   * is not enabled here today but would turn an invisible choice into a build
   * failure if it ever were.
   */
  pathname,
  className,
}: {
  pathname: string;
  className?: string;
}) {
  const active = resolveActive(pathname);

  return (
    /*
     * `aria-label="Primary"`, verbatim from the mock, which labels all five of
     * its `<nav>`s that way.
     *
     * The label had to distinguish this from the two landmarks already in the
     * app, and it does: both of those are paginators — `<nav aria-label="Date">`
     * in training.tsx and `<nav aria-label="Week">` in week-nav.tsx. Until now a
     * screen-reader user jumping by landmark found a week stepper and nothing
     * that moved between sections.
     */
    <nav
      aria-label="Primary"
      className={cn(
        // 12px above, 24px below, per the mock — with the bottom inset folded
        // into the padding rather than added to it, so the 24px still applies on
        // a device with no notch. The shell owns this because it is the last
        // thing in the column; see the header.
        "mt-auto flex justify-center pt-3 pb-[max(1.5rem,env(safe-area-inset-bottom))]",
        /*
         * Pinned to the bottom of the viewport — FUEL-65. `sticky` and not
         * `fixed`: sticky stays in flow, so the shell still reserves its own
         * space at the end of the column and no page owes it compensating
         * padding to keep its last line clear. `mt-auto` above still puts it at
         * the bottom of a short page; this only adds holding it there on a long
         * one.
         *
         * `bg-background` because content now passes underneath it, where
         * before nothing did. `z-20` puts it over the action bars, which is the
         * safe direction to fail: the bars carry their own offset off
         * `--nav-shell-h` and so never reach it, but if that offset were ever
         * wrong the shell covering a bar is recoverable by scrolling, while a
         * bar covering the app's only navigation is not.
         *
         * `max-lg:`, rather than a `lg:static` that undoes it. The layout hands
         * this component `lg:sticky lg:top-0` for the sidebar, and both sets
         * would land on the same element — leaving a sticky box holding a
         * `top-0` and a `bottom-0` at once, resolved by whichever class the
         * merge happened to keep. Below the breakpoint only, there is nothing
         * to resolve.
         */
        "max-lg:sticky max-lg:bottom-0 max-lg:z-20 max-lg:bg-background",
        // As a sidebar the pill's centring, its auto top margin and its bottom
        // inset are all wrong: it is a column at the top left, and nothing is
        // below it to keep clear of the home indicator.
        "lg:mt-0 lg:block lg:pt-0 lg:pb-0",
        className,
      )}
    >
      {/*
       * One `<nav>` whose contents reflow, rather than a pill and a sidebar
       * rendered separately and toggled with `hidden`/`lg:block`.
       *
       * Two copies would put two "Primary" landmarks in the document. CSS would
       * hide one from the accessibility tree at any given width so a real user
       * would hear one — but jsdom applies no CSS, so every test would see both
       * and `getByRole("navigation", { name: "Primary" })` would throw on the
       * duplicate. A structure that is only correct once a stylesheet has loaded
       * is one the tests cannot check.
       */}
      <ul
        className={cn(
          "flex items-center gap-[2px] rounded-full border border-border p-1",
          // The sidebar keeps none of the pill: no border to draw a capsule
          // around a column, no centring, and the items go full width so their
          // active fill reads as a row rather than a floating lozenge.
          "lg:flex-col lg:items-stretch lg:gap-1 lg:rounded-none lg:border-0 lg:p-0",
        )}
      >
        {DESTINATIONS.map((destination) => {
          const isActive = destination.id === active;

          return (
            <li key={destination.id}>
              <Link
                href={destination.href}
                /*
                 * The name every one of these carries, active or not.
                 *
                 * § Navigation: "The `aria-label` is the label, so the four
                 * names above are the only names these destinations have
                 * anywhere." Putting it on all four rather than only the
                 * icon-only ones keeps the accessible name identical across
                 * both breakpoints and both states — the label below is shown
                 * and hidden by CSS, and a name that came from it would
                 * disappear from the accessibility tree exactly when the text
                 * is `display: none`. That is the bug the mock's own
                 * `aria-label` exists to avoid.
                 *
                 * It matches the visible text wherever there is any, so WCAG
                 * 2.5.3 Label in Name is satisfied rather than worked around.
                 */
                aria-label={destination.label}
                /*
                 * "You are here" — the first time this app makes that claim
                 * about primary navigation. Before this, `aria-current` appeared
                 * only on a dot-grid day and a weigh-in row.
                 *
                 * Load-bearing, not decorative: the active item's visual tell is
                 * that it gains an `ink` fill and its label, and neither of
                 * those reaches a screen reader on its own — the fill is colour
                 * and the label is a change of name, which is announced as a
                 * different item rather than as the current one.
                 *
                 * On a level-2 route this marks the parent: `/shopping` lights
                 * Plan and Plan is what carries `aria-current`. That is the
                 * section the user is in, and `lib/nav.ts` holds the table that
                 * decides it. The alternative — marking only exact matches —
                 * would leave `/shopping`, `/plan/template` and `/settings` with
                 * a visually active item that announces nothing.
                 */
                aria-current={isActive ? "page" : undefined}
                className={cn(
                  "relative flex h-10 items-center justify-center gap-[7px] rounded-full",
                  // § Accessibility: "2px `accent` ring, 2px offset, on every
                  // interactive element in both modes. Never removed." `ring` is
                  // `accent`, per globals.css.
                  "outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                  /*
                   * The hit area, which is larger than the box.
                   *
                   * § Navigation fixes the inactive item at 46×40px and
                   * § Touch Targets sets a 44×44px minimum, so the height fails
                   * by 4px and the width does not. Rather than break one rule to
                   * keep the other, the visual box stays 40px and an invisible
                   * 2px is added top and bottom to reach 44. It extends into the
                   * pill's own 4px padding, so the pill does not grow and
                   * nothing outside it is captured.
                   *
                   * Not needed on the sidebar, where the items are 44px tall
                   * outright and stacked — there the overlay would spill into
                   * the gap and each item would steal 2px of its neighbour.
                   */
                  "after:absolute after:inset-x-0 after:-top-0.5 after:-bottom-0.5 after:content-[''] lg:after:hidden",
                  // A row in a column, left-aligned, and tall enough on its own.
                  "lg:h-11 lg:w-full lg:justify-start lg:px-[13px]",
                  /*
                   * The pointer — Brand Guide § Desktop, "Pointer states".
                   *
                   * The reason that section exists: "the rail is the first
                   * control in this app that a pointer is the only way to use,
                   * and it is currently the one control that answers a mouse
                   * with nothing at all."
                   *
                   * Both states come straight off the table, keyed to what each
                   * one rests as rather than to what it is — an inactive item
                   * rests as nothing and gains `surface`, the active item is an
                   * `ink` fill and goes to that fill at 90%. The inactive item
                   * also raises its label to `text-primary`, which is the mock's
                   * own `.railitem:not(.active):hover { color: var(--text) }`
                   * and is load-bearing rather than decorative: `text-secondary`
                   * measures 4.26:1 on `surface` against § Accessibility's 4.5,
                   * and 15.52:1 once lifted.
                   *
                   * This is also what covers the mobile pill, and § Desktop says
                   * why the table is written to the drawing for exactly this
                   * reason: "a hybrid laptop below 1024px has a pointer and the
                   * pill, so 'desktop rules apply above 1024px' would have left
                   * the app's most-used control unhovered on a real device."
                   * The classes are unconditional; Tailwind gates them on
                   * `@media (hover: hover)`, which asks the device rather than
                   * the width.
                   */
                  isActive
                    ? `w-auto bg-ink pr-[15px] pl-[13px] text-ink-fg ${HOVER_FILL}`
                    : // `text-secondary`, not the mock's `text-3` — see the header.
                      `w-[46px] text-text-secondary ${HOVER_GROUND} hover:text-text-primary`,
                )}
              >
                <NavIcon id={destination.id} />
                <span
                  className={cn(
                    /*
                     * 12.5px/600 with -0.01em tracking, from the mock's `.lab`.
                     *
                     * `text-slash` is the 12.5px step on the Brand Guide's
                     * scale, so the size is the token rather than an arbitrary
                     * value — and it is in `rem`, which § Accessibility requires
                     * for Dynamic Type. Weight and tracking are overridden
                     * because Slash is 500/0em: this is the one place the scale
                     * and the mock disagree, and the mock wins on appearance.
                     */
                    "text-slash font-semibold tracking-[-0.01em]",
                    // Hidden while inactive on the pill — that is what makes an
                    // inactive item icon-only — and always shown in the sidebar,
                    // which has the width for four labels and reads as a list
                    // without them only as a column of unexplained marks.
                    isActive ? "inline" : "hidden lg:inline",
                  )}
                >
                  {destination.label}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>

      {/*
       * The sidebar's foot — § Navigation: "On desktop the sidebar has a foot,
       * and Settings sits there under a rule."
       *
       * Desktop only, and that asymmetry is the decision rather than an
       * oversight. Settings gave up its slot because "a slot is earned by how
       * often you come back to a screen", and on the phone it keeps the text
       * link at the foot of `/` that `right-now.tsx` renders in all three of its
       * states — day-complete included, or the phone's only route to Settings
       * would vanish every evening. The
       * sidebar has room the pill does not, so the same link can sit here
       * without making the four into five.
       *
       * No `aria-current` even when the user is on `/settings`. The destination
       * is what this landmark reports, and `lib/nav.ts` parents `/settings` to
       * `/` — so Now carries the mark and this link does not. Two elements
       * claiming to be the current page in one landmark is worse than the small
       * imprecision of the one that does.
       *
       * The register — 12.5px tertiary underlined — is the one the Settings link
       * at the foot of `/` already uses, so this reads as the same kind of thing
       * rather than as a fifth destination that lost its icon. That link was one
       * of four when this was written; FUEL-58 retired the other three into the
       * shell, and it is the only one left.
       */}
      <div className="hidden lg:mt-4 lg:block lg:border-t lg:border-border lg:pt-4">
        <Link
          href="/settings"
          /*
           * `/`'s foot links set this register in `text-tertiary`. The text
           * colour is raised to `text-secondary` here for the contrast reason in
           * the header, and the underline is left in `text-tertiary` so the two
           * still read as the same kind of link.
           */
          className={cn(
            "text-slash text-text-secondary underline decoration-text-tertiary underline-offset-4 outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
            // The mock draws this one by name — `.railfoot a:hover` takes the
            // same colour change as `.lnk:hover`, which is what HOVER_LINK is.
            HOVER_LINK,
          )}
        >
          Settings
        </Link>
      </div>
    </nav>
  );
}

/**
 * The four marks.
 *
 * A sprite of its own rather than an addition to `components/motifs.tsx`: that
 * one is drawn on a 48 viewBox at 1.6 stroke and is entirely food — bowl, cup,
 * roll, pot, plate, bar, egg, walk — with nothing that would serve as a
 * destination. These are the mock's tab icons, on a 24 viewBox at 1.5, and they
 * are checked before anything is added rather than after.
 *
 * Now, Plan and Weight are transcribed path-for-path from `BRAND_GUIDE.html`.
 * Training is new, because the mock's fourth slot is More — three dots, for a
 * destination FUEL-56 removed. It is drawn as a dumbbell to the same
 * conventions: two plates, two collars and the bar between them, in one path so
 * it stays as compact as the three it sits beside. A dumbbell rather than an
 * activity line, which at 20px would be a second chart mark next to Weight's.
 */
const NAV_ICON: Record<DestinationId, ReactNode> = {
  now: (
    <>
      <circle cx={12} cy={12} r={9} />
      <path d="M12 7v5l3.5 2" />
    </>
  ),
  plan: (
    <>
      <rect x={3.5} y={4.5} width={17} height={16} rx={2.5} />
      <path d="M3.5 9.5h17M9 4v-2M15 4v-2" />
    </>
  ),
  training: <path d="M7 8v8M17 8v8M4 10v4M20 10v4M7 12h10" />,
  weight: (
    <>
      <path d="M3.5 16.5l5-5 3.5 3.5 8.5-8.5" />
      <path d="M16 6.5h4.5V11" />
    </>
  ),
};

/**
 * Always decorative — `aria-hidden`, with the link's `aria-label` carrying the
 * name.
 *
 * § Deliberately Absent opens with "icons that repeat their own label", which is
 * the rule this component looked most likely to break, since its active item
 * shows a mark and its name together. It does not break it, for the reason
 * `Motif` gives in the same situation: the rule is about what gets announced. An
 * icon inside a labelled link adds nothing to the accessibility tree, so nothing
 * is repeated. And the arrangement is not merely permitted but required —
 * § Accessibility: "Icon-only tabs carry an `aria-label`; the active tab shows
 * its label as text."
 */
function NavIcon({ id }: { id: DestinationId }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-5 w-5 shrink-0"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {NAV_ICON[id]}
    </svg>
  );
}
