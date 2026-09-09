import { getSession } from "@/lib/auth/session";
import { loadTraining } from "@/lib/db/queries/training";
import { type CalendarDate, parseCalendarDate } from "@/lib/date";

/**
 * Resolving a walk from what a browser sent — shared by every walk action.
 *
 * A plain module rather than a second `"use server"` file, and that is the
 * reason it exists here rather than being exported from `log-walk.ts`: every
 * export of a `"use server"` module becomes a callable endpoint, so exporting
 * this from there would publish a function that hands back a `userId` to
 * anyone who can POST. It is imported by the actions instead.
 *
 * FUEL-102 is what made it shared. `log-walk.ts` wrote it for the three write
 * actions and `walk-route.ts` needs exactly the same five refusals; a second
 * copy would be two places for one rule to drift, and the rule is an
 * authorisation check.
 */

/**
 * The walk a template entry names on a date, for the caller's own user.
 *
 * `undefined` for no session, no profile row, a malformed date, an entry the
 * date does not hold, and — the one refusal this has that `training.ts` does not
 * — an entry that resolves to a SESSION. One answer for all five.
 *
 * That last refusal is the mirror image of the one `actions/training.ts` makes,
 * and both exist for the same reason: a row written against an item the screen
 * renders differently is a row no control on that screen can edit or take back.
 * A session recorded through here would be filed 'done' with no note and no way
 * to correct it to partial from the walk's row.
 *
 * The date is parsed before anything is fetched, on `plan.ts`'s reasoning: a
 * refusal that costs a query is a refusal that can be used to make the database
 * work.
 */
export async function resolveWalk(
  date: CalendarDate,
  entryId: string,
): Promise<{ userId: string; workoutId: string } | undefined> {
  const session = await getSession();

  if (!session) return undefined;

  parseCalendarDate(date);

  const training = await loadTraining(session.userId, date, new Date());

  // A date before `program_start_date`, and one the template does not cover,
  // both resolve to no sessions — so both are refused here without a check of
  // their own: there is no entry to match, so nothing matches.
  const resolved = training?.day.sessions.find(
    (item) => item.entryId === entryId && item.kind === "walk",
  );

  return resolved && { userId: session.userId, workoutId: resolved.workout.id };
}
