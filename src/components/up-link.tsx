import Link from "next/link";

import { HOVER_LINK } from "@/lib/pointer";

import type { CalendarDate } from "@/lib/date";
import { resolveParent } from "@/lib/nav";

/**
 * The way up — Brand Guide § Navigation, "Parent links and cross-links".
 *
 * One component for the four screens that open with a link above their `<h1>`.
 * Before FUEL-59 there were four of them and no shared one, which is the order
 * those facts happened in: `/plan/template` pointed at `/settings`, a screen
 * that links to it rather than one it belongs to; two of the four rendered a
 * class that emits no CSS; the same destination was spelled "Right Now" on one
 * screen and "Right now" on another; and none of the four said which way it
 * went.
 *
 * ## The parent is not a prop
 *
 * `pathname` in, parent out — `lib/nav.ts` answers, and a caller cannot name a
 * different one. An `href`/`label` pair would have been the smaller component
 * and would have kept the bug: four call sites asserting a parent is exactly
 * what produced four different answers, and § Navigation gives each route one.
 * "A screen has one parent link and it goes up — the one in the table, and the
 * only one that may be rendered as an up-link."
 *
 * `pathname` is passed rather than read from `usePathname()`, which is the
 * reasoning `nav-shell.tsx` records for its own prop and applies twice as hard
 * here: the hook would make all four pages client components, and Next 16 makes
 * it suspend under `cacheComponents`. Every caller is a page that knows its own
 * route as a literal, so the hook would buy nothing.
 *
 * ## Direction is a glyph, not a wording
 *
 * § Navigation: a cross-link "must never be styled as an up-link, because a
 * second thing that looks like a way back is a second parent in everything but
 * name." Two screens carry both — `/plan` links sideways to `/shopping` and to
 * the template in the same register this renders in — so the up-link needs a
 * mark those do not have, and a label alone is not one. `&lsaquo;` before the
 * name, `week-nav.tsx`'s glyph and idiom exactly: decorative, `aria-hidden`,
 * with the direction spoken by the link's own name instead.
 *
 * It also has to stay distinct from the "Back to this week" links at the foot of
 * `/plan` and `/shopping`, which reset `?week=` rather than move up a level.
 * Those keep their own register, sit at the bottom rather than above the `<h1>`,
 * carry no glyph, and appear only when the week on screen is not the current
 * one — where this is always present.
 *
 * ## Micro, because it is an eyebrow
 *
 * § Typography gives Micro as "Labels, section eyebrows, status", and a line
 * above an `<h1>` is an eyebrow. Two of the four already used it; the other two
 * used `text-label`, which is not on the six-level scale and has no token in
 * `globals.css`, so it emitted nothing and those two rendered at body size. The
 * gap between them looked like a decision and was an accident.
 *
 * `text-label` and `text-caption` are dead in seven more places outside this
 * component's business. Left alone here on purpose — fixing them in this diff
 * would bury the one behavioural change in a sweep.
 */
export function UpLink({
  /**
   * The route this screen IS — not the one it links to.
   *
   * A literal at every call site. The alternative, defaulting it from somewhere,
   * would give a screen that forgot to pass one a silently wrong parent, which
   * is the failure this component exists to remove.
   */
  pathname,
  /**
   * The week on screen, when the parent is addressed by one.
   *
   * `/shopping` is the only caller that passes it today, and it must: its parent
   * is `/plan`, both are addressed by `?week=`, and going up from the week of
   * the 24th to the week the server calls "now" would be a different week's plan
   * behind a link that claims to be the way back.
   *
   * `/plan` and `/settings` pass nothing, and that is not an oversight to be
   * corrected later — their parent is `/`, which takes no `searchParams` at all.
   * There is no week to carry there because `/` has no week.
   */
  week,
}: {
  pathname: string;
  week?: CalendarDate;
}) {
  const parent = resolveParent(pathname);

  /*
   * Level 1, `/login`, `/dev/*`, or a route nobody added to the table. Nothing
   * to render, and no `{cond && ...}` at the call sites for the same reason the
   * parent is not a prop: the component owns the question.
   */
  if (!parent) return null;

  return (
    <Link
      href={week ? `${parent.href}?week=${week}` : parent.href}
      /*
       * "Back to Plan", not "Plan". The glyph is the sighted reader's cue and
       * this is everyone else's — a bare destination name announces identically
       * to the cross-link two screens carry pointing the other way.
       *
       * WCAG 2.5.3 Label in Name holds: the visible word is inside the
       * accessible name rather than replaced by it.
       */
      aria-label={`Back to ${parent.label}`}
      /*
       * § Accessibility: "2px `accent` ring, 2px offset, on every interactive
       * element in both modes. Never removed." `ring` is `accent`, per
       * globals.css — the string is `nav-shell.tsx`'s, character for character.
       *
       * None of the four links this replaces declared one, so all four fell
       * back to the browser's default `outline: auto 1px` — a hairline in the
       * UA's colour rather than the app's, and one that does not clear the 3:1
       * the same section sets for anything carrying meaning. Fixed here because
       * this is now the one place the up-link is styled; the other links that
       * share the omission are named below.
       *
       * Settled by FUEL-75 rather than still outstanding: `week-nav.tsx`'s
       * prev/next and the "Back to this week" resets were in the same position,
       * and a sweep that gave them a hover could not leave them without the
       * ring — § Desktop: "a control drawn with only the hover leaves the
       * keyboard with nothing." They import `FOCUS_RING`, which is this string.
       */
      className={`text-micro uppercase text-text-secondary underline decoration-text-tertiary underline-offset-4 outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background ${HOVER_LINK}`}
    >
      {/*
       * Hidden whole, as `week-nav.tsx` hides its own.
       *
       * The glyph has to be hidden or it is announced — "single left-pointing
       * angle quotation mark", or a pause, depending on the reader. Wrapping
       * the NAME in the same span is not doing accessibility work: `aria-label`
       * on the anchor already wins the name computation outright, so the text
       * inside is never consulted either way. It is here so the markup matches
       * the paginator's, which is the only other place in the app that puts a
       * glyph beside a name.
       *
       * The text stays in the DOM regardless, so WCAG 2.5.3 still has a visible
       * word to compare against — see the `aria-label` above.
       */}
      <span aria-hidden="true">&lsaquo; {parent.label}</span>
    </Link>
  );
}
