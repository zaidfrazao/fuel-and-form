import Link from "next/link";

import { getSession } from "@/lib/auth/session";
import { loadWalkReminder } from "@/lib/db/queries/walk-reminder";
import { REMINDER_LINK, reminderStatement } from "@/lib/walk-reminder";

/**
 * The evening walk reminder — FUEL-46, PRD § P9, Brand Guide § Tone of Voice.
 *
 * P9's first criterion: a banner "on every screen after the reminder time when
 * the walk is unlogged". Every screen is why this is rendered from the root
 * layout rather than from the seven pages that would each have to remember it —
 * the same placement `demo-banner.tsx` argues for, and it sits directly beneath
 * that banner when a demo session has both.
 *
 * ## Why there is no dismiss button
 *
 * Because the criterion is "dismisses on log", and that is a different thing
 * from dismissible. The banner reports one fact — today's walk has no row — and
 * the way to make it go is to log the walk, which is one tap on `/` or
 * `/training`. `logWalk` already calls `refresh()`, which re-renders this
 * layout, so the banner is gone on the render that follows the tap with nothing
 * here having to know that happened.
 *
 * A dismiss control would have to answer a question P9 does not ask: dismissed
 * until when? For the evening leaves the walk unlogged with the app silent about
 * it; for a minute is a snooze nobody asked for; for the session is a cookie
 * whose stale value outlives the day it was about. The absence is the design —
 * § Deliberately Absent — and it is also what keeps this a server component with
 * no state, no cookie and no client bundle at all.
 *
 * ## Decided on the server, like the demo banner
 *
 * So the banner is in the first paint or absent from it. Rendering it always and
 * hiding it in an effect would flash a nag at everyone who has already walked.
 *
 * ## What it costs
 *
 * One scoped `select` on `profiles` per request while the reminder is off or the
 * evening has not come, and three in the hour or two when it has —
 * `queries/walk-reminder.ts` sets out the staging that keeps it to that.
 * `getSession` is memoised by React for the length of a render pass, so this and
 * the page beneath it share one lookup rather than making two. On `/login` there
 * is no session, so nothing is queried at all.
 */
export async function WalkReminder() {
  const session = await getSession();

  if (!session) return null;

  /*
   * The clock, read here.
   *
   * `app/page.tsx` says `new Date()` "appears once in the whole of P1, and it is
   * this line", and that is still true of the page. A layout is a render root of
   * its own — nothing hands it the page's instant — so this is the second such
   * line in the app, and it is deliberately the only thing in this component
   * that is not an argument. Everything below takes it: the query, the zone
   * arithmetic and the comparison in `isReminderDue` are all reproducible from
   * it, which is what makes 18:59-against-19:00 a case a test can hold still.
   */
  const reminder = await loadWalkReminder(session.userId, new Date());

  if (!reminder) return null;

  return (
    // `aside`, like the demo banner, and for the same reason: this is tangential
    // to whatever page it sits above, and the landmark lets a screen-reader user
    // skip it once per screen rather than hear it before every one.
    <aside aria-label="Walk reminder" className="border-b border-border">
      <div className="mx-auto flex w-full max-w-[640px] items-center justify-between gap-3 px-[22px] py-1.5 md:px-7">
        {/*
         * The canvas, a hairline, and `/ `-scale secondary text — the same
         * material as the demo banner and for the reasons set out there.
         * § Color Palette reserves `accent` for "now" and `surface` for stone
         * tiles and the chart's plot area, so a tinted strip is not available
         * however conventional it would be. A reminder that shouted would be
         * competing with the one dominant card `/` exists to show, which is the
         * screen it is most often seen above.
         */}
        <p className="text-slash text-text-secondary">
          {reminderStatement(reminder.at)}{" "}
          {/*
           * To `/`, always, and not to `/training`.
           *
           * Both screens carry a walk row. `/` is the one the app opens on and
           * the one the walk's row was designed into — `walk.ts` calls it "the
           * walk's own row" — so it is where a tap on this sentence should land
           * from any of the other six screens. From `/` itself the link is a
           * no-op navigation to the page already open, which is harmless: the
           * row it points at is a few centimetres below it.
           */}
          <Link
            className="text-text-primary underline decoration-text-tertiary underline-offset-4"
            href="/"
          >
            {REMINDER_LINK}
          </Link>
        </p>
      </div>
    </aside>
  );
}
