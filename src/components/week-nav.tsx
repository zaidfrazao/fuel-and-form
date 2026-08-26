import Link from "next/link";

import { addDays, type CalendarDate } from "@/lib/date";
import { weekLabel } from "@/lib/now-display";

/**
 * Prev, next, and the name of the week between them — the control two screens
 * move a week with.
 *
 * Lifted out of `app/plan/page.tsx` by FUEL-45, which gave `/shopping` the same
 * `?week=` parameter and therefore the same navigator. The reasoning is
 * `week-param.ts`'s one layer up: two screens that have to agree about which
 * seven days a URL names should read the parameter through one function, and by
 * the same argument they should offer the same control for changing it. Two
 * copies would agree until one of them was styled, relabelled, or given a
 * keyboard affordance the other did not get.
 *
 * ## `<Link>`s, so a week is a real destination
 *
 * Not buttons and not client state: back works, the URL can be shared, and Next
 * prefetches the neighbouring weeks. `app/plan/page.tsx` sets out why a week
 * belongs in the URL where `/`'s cursor belongs in a cookie — a week is a place
 * rather than a position in today.
 *
 * ## The chevrons are decorative and the names are the destinations
 *
 * "Previous" alone tells a screen-reader user nothing about where they would
 * land, so each link is named for the week it leads to. § Accessibility asks
 * icon-only controls for a label; these have text, and the arrow beside it is
 * `aria-hidden` because it repeats the direction the label already carries.
 */
export function WeekNav({
  monday,
  /**
   * The route the two links point at — `/plan` or `/shopping`.
   *
   * A required prop rather than one defaulting to `/plan`. A default would make
   * the commonest mistake — adding a third screen and forgetting to say which
   * one it is — silently navigate away from the screen the user is on, which is
   * the one failure here that looks like a working control.
   */
  basePath,
}: {
  monday: CalendarDate;
  basePath: string;
}) {
  const previous = addDays(monday, -7);
  const next = addDays(monday, 7);

  return (
    <nav aria-label="Week" className="flex w-full items-center justify-between gap-3">
      <Link
        href={`${basePath}?week=${previous}`}
        aria-label={`Previous week, ${weekLabel(previous)}`}
        className="text-micro uppercase text-text-secondary underline decoration-text-tertiary underline-offset-4"
      >
        <span aria-hidden="true">&lsaquo; Prev</span>
      </Link>

      {/*
       * The week's own name, between the two controls that move it. Live,
       * because the label changes on navigation while focus stays on the link
       * that moved it — without this a screen-reader user would hear nothing
       * about where they had arrived.
       */}
      <p aria-live="polite" className="text-body tabular-nums text-text-primary">
        {weekLabel(monday)}
      </p>

      <Link
        href={`${basePath}?week=${next}`}
        aria-label={`Next week, ${weekLabel(next)}`}
        className="text-micro uppercase text-text-secondary underline decoration-text-tertiary underline-offset-4"
      >
        <span aria-hidden="true">Next &rsaquo;</span>
      </Link>
    </nav>
  );
}
