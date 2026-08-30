import Link from "next/link";

import type { DayStatus } from "@/components/dot-grid";
import type { RecentSession } from "@/lib/adherence";
import type { CalendarDate } from "@/lib/date";
import { dayLabel } from "@/lib/now-display";
import { HOVER_GROUND, HOVER_LIFT } from "@/lib/pointer";

/**
 * The dates under the dot grid — FUEL-30, PRD § P3.
 *
 * "Past sessions are viewable and editable by date", and this is the way in.
 * One row per recent session: the day, the workout that was on it, and what was
 * recorded — each a link to that date's own screen.
 *
 * ## Why the grid alone was not enough
 *
 * The criterion asks for past sessions to be reachable from the adherence dot
 * grid, and they are: `dot-grid.tsx` takes an `hrefFor` and stretches a link
 * over each dot. But a dot is 11px on a 240px graphic, so its target is 36×21px
 * with every pixel of the gutters given away — under § Touch Targets' 44×44,
 * and not fixable without redrawing a signature graphic the guide specifies to
 * the pixel.
 *
 * So the grid keeps the glance and this keeps the tap. § Component Patterns →
 * Lists is the shape: rows on the canvas separated by hairlines, no card and no
 * outer rule, 54px minimum. It is also what makes the feature usable without a
 * pointer at all — the dots are `aria-hidden` and out of the tab order, and
 * these rows are the keyboard and screen-reader path to the same dates.
 *
 * ## It shows what happened, in words
 *
 * Every row carries its status as a word — Done, Partial, Skipped, Not recorded
 * — in the same type and the same ink as its neighbours. § The Governing
 * Principle asks for a missed session and a completed one to be rendered with
 * the same visual weight, "only the status label differs", and a list is where
 * that rule is easiest to break: a row of red Skippeds down the right-hand edge
 * would be the grading the whole graphic above it refuses to do.
 *
 * ## Given its rows, like everything else on this screen
 *
 * No fetch, no clock, no state. `lib/adherence.ts` shapes the rows from the same
 * days the dots are drawn from, and `training.tsx` passes them in — so a row and
 * the dot above it cannot disagree about a date.
 */

/** The word for a row's outcome. `walk` never arrives — see `recentSessions`. */
const STATUS_LABEL: Record<DayStatus, string> = {
  done: "Done",
  partial: "Partial",
  skipped: "Skipped",
  walk: "Walk only",
  none: "Not recorded",
};

/**
 * One row.
 *
 * The date being viewed is rendered as a row and NOT as a link, on `DateNav`'s
 * rule: a control that takes you where you already are is a control that does
 * nothing. It stays in the list rather than being dropped, because a list that
 * silently omitted the current date would look like a list with a day missing.
 */
function Row({ session, viewing }: { session: RecentSession; viewing: CalendarDate }) {
  const here = session.date === viewing;

  const content = (
    <>
      <span className="flex min-w-0 flex-col gap-1">
        <span className="truncate text-body text-text-primary">
          {dayLabel(session.date)}
          {here && <span className={`text-text-tertiary ${HOVER_LIFT}`}> · Viewing</span>}
        </span>
        <span className={`truncate text-slash text-text-tertiary ${HOVER_LIFT}`}>
          {session.label}
        </span>
      </span>

      <span className={`shrink-0 text-micro uppercase text-text-secondary ${HOVER_LIFT}`}>
        {STATUS_LABEL[session.status]}
      </span>
    </>
  );

  return (
    <li className="border-b border-border last:border-b-0">
      {here ? (
        <span
          aria-current="page"
          className="flex min-h-[54px] items-center justify-between gap-4 py-3"
        >
          {content}
        </span>
      ) : (
        /*
         * The whole row is the target, which is what gets it to 54px: § Touch
         * Targets is the reason this list exists beside a graphic that cannot
         * reach 44px. The accessible name is the date, the workout and the
         * status in that order — "Mon 17 Aug, Circuit A, Not recorded" — because
         * a row whose name was only its date would tell a screen-reader user
         * nothing the dot grid had not already said.
         */
        <Link
          href={`/training?date=${session.date}`}
          /*
           * A list row, so § Desktop's first ground — and `group`, because
           * the status and the workout name inside it are `text-secondary`
           * and `text-tertiary`, which a `surface` ground would read at
           * 4.26:1 and 1.95:1. `HOVER_LIFT` on each of them is what keeps
           * § Accessibility's 4.5 while the pointer is here.
           *
           * The row that is already being viewed is a `<span>` above and
           * gets none of this: `DateNav`'s rule is that "a control that
           * takes you where you already are is a control that does nothing",
           * and a hover on it would say it was one.
           */
          className={`group flex min-h-[54px] items-center justify-between gap-4 py-3 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none ${HOVER_GROUND}`}
        >
          {content}
        </Link>
      )}
    </li>
  );
}

export function RecentSessions({
  sessions,
  viewing,
}: {
  /** Newest first, from `recentSessions`. Empty is an ordinary state. */
  sessions: readonly RecentSession[];
  /** The date the screen is showing, so its own row is not a link to itself. */
  viewing: CalendarDate;
}) {
  // § Tone of Voice: an empty state describes what will appear rather than
  // nudging. Before the first session there is nothing to go back to, and that
  // is a fact about a new account rather than something to be prompted about.
  if (sessions.length === 0) {
    return (
      <p className="text-body text-text-secondary">
        Sessions appear here once the plan reaches a training day.
      </p>
    );
  }

  return (
    /*
     * Named, because the screen holds three lists — the exercises, this, and
     * the walk under Anytime — and "list, 4 items" tells a screen-reader user
     * which one they have landed in only if it has a name. The § Recent heading
     * above says it once for a sighted reader; this says it to the rotor.
     */
    <ul aria-label="Recent sessions" className="flex flex-col">
      {sessions.map((session, index) => (
        // Keyed by position as well as date. `recentSessions` keeps both rows
        // when a caller's weeks name one date twice — deliberately, so a
        // duplicate is visible rather than silently halved — and a bare date
        // key would make React collide the two and warn.
        <Row key={`${index}-${session.date}`} session={session} viewing={viewing} />
      ))}
    </ul>
  );
}
