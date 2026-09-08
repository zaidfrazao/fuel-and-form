import { type TimeOfDay } from "./date";

/**
 * The walk reminder's copy and the one decision behind it — FUEL-46, PRD § P9,
 * Brand Guide § Tone of Voice.
 *
 * P9 asks for "an evening nudge if the daily walk is unlogged": a banner on
 * every screen after a configured time, gone the moment the walk is logged, and
 * switchable off entirely. This file is the part of that with no database and no
 * request in it — when the time has come, and what the sentence says.
 *
 * Pure, and deliberately NOT `server-only`, for `demo-banner.ts`'s reason: the
 * decision is read from the ROOT LAYOUT, so every branch in it runs on every
 * screen in the app, and a rule that can only be exercised by a running browser
 * is a rule no test can hold still. `lib/db/queries/walk-reminder.ts` is what
 * asks the database the other half of the question.
 *
 * ## Nothing here throws, and that is the whole reason `isReminderDue` is shaped
 * as it is
 *
 * `demo-banner.ts` makes this argument about a value a stranger controls; this
 * one is about a value the DATABASE holds. `profiles.walk_reminder_at` carries a
 * CHECK constraint, so a malformed time should be impossible — but "should be
 * impossible" is exactly the class of value that turns into a 500 on every
 * screen at once when it turns out to be possible after all: a row written
 * before the constraint existed, a hand-edited profile, a constraint dropped by
 * a later migration. `date.ts`'s `parseTimeOfDay` communicates failure by
 * throwing, so it is never reached here with a value this file has not already
 * recognised.
 *
 * The honest answer to a time nobody can read is no banner. A reminder that
 * cannot say when it was set for has nothing to report.
 */

/**
 * When the reminder fires for a profile that has never changed it.
 *
 * The same value the column's SQL default carries, and written twice on purpose
 * — a migration cannot import TypeScript. `schema.test.ts` asserts the two
 * agree, so the copy that drifts is a failing test rather than a settings screen
 * that offers to "restore" a time the database never uses.
 */
export const DEFAULT_WALK_REMINDER_AT: TimeOfDay = "19:00";

/**
 * The names of the walks with no row against them, in the day's own order.
 *
 * Names rather than a count, because the sentence names one of them when one of
 * them is all there is — see `reminderStatement`. A count would answer the
 * plural case and leave the singular one with nothing to say.
 */
export type OutstandingWalks = readonly string[];

/**
 * The banner's words — § Tone of Voice, and the criterion attached to this task:
 * "Copy is factual: 'Walk not logged. Reminder set for 19:00.' — no
 * encouragement."
 *
 * Two sentences and a link, in the shape `demo-banner.ts`'s `BANNER_COPY` uses:
 * the statement, then one thing to do about it. Asserted word for word by its
 * test, because voice erodes one friendly edit at a time and a string nobody
 * checks is where that starts. "You haven't walked today" and "Time for your
 * walk!" are both a sentence away and both forbidden — the first addresses a
 * person about what they have not done, the second is an instruction with an
 * exclamation mark. This one states what is not on the record and when the
 * reminder was set for, which is all the app knows.
 *
 * ## Why the time is in the sentence at all
 *
 * Because the banner appears without being asked for, and the one question a
 * person has about a thing that appeared is why it appeared now. Naming the time
 * answers it and points at the setting that changes it, in four words.
 */
export const REMINDER_LINK = "Log the walk.";

/**
 * The link, agreeing with the sentence in front of it — FUEL-98.
 *
 * "Walks not logged. Log the walk." is a banner that corrects itself halfway
 * through, and it is the kind of small wrongness that makes a reader stop
 * trusting the rest of the sentence. The subject above is singular in exactly
 * one case, so the object is too.
 *
 * `REMINDER_LINK` stays the singular one rather than being replaced by a second
 * literal: § Terminology is a rule about the VERB — "Log", never "Track",
 * "Record" or "Add" — and one constant to pin that against is what its test
 * needs. This adds the plural beside it rather than a second thing to keep in
 * step.
 */
export function reminderLink(names: OutstandingWalks): string {
  return names.length === 1 ? REMINDER_LINK : "Log the walks.";
}

/**
 * `Afternoon Walk not logged. Reminder set for 19:00.` — the AC's sentence,
 * given the walks that are outstanding and a time.
 *
 * ## It names a walk only when naming one says something
 *
 * There is one walk outstanding, or there is more than one, and the two want
 * different sentences.
 *
 * With MORE THAN ONE outstanding, no name is more informative than the plural:
 * the reader has more than one walk to go and take, and listing which is a
 * longer way to say so. "Walks not logged." is the whole of what they can act
 * on.
 *
 * With exactly ONE, the plural would be the failure this ticket is about.
 * "Walk not logged." was the sentence while there was one walk; with the
 * morning one done and the afternoon one not, it is simply FALSE — the app
 * reporting nothing logged about a day that has a log in it. § Tone of Voice
 * asks for factual before it asks for anything else, so this is where the name
 * goes, and it is the one case where the name is the news.
 *
 * ## Why not name them in both cases
 *
 * It was written that way first and the copy was too long to live in the band it
 * is drawn in. "Morning Walk and Afternoon Walk not logged. Reminder set for
 * 19:00. Log the walks." is about 82 characters, which wraps to two lines in the
 * 331px measure a 375px screen leaves — and Brand Guide § Desktop counts this
 * band by name in the arithmetic that gives `/` its 354px window. A reminder
 * that cost the screen a line to say something the plural already said would be
 * spending the one measurement that document makes.
 *
 * An EMPTY list is not a state this is called in: the caller establishes that
 * something is outstanding before there is a banner at all. It renders as
 * "Walks not logged", which is ungrammatical about nothing rather than
 * misleading — a caller that reached it has a bug, and a sentence that quietly
 * read well would be a bug nobody saw.
 */
export function reminderStatement(names: OutstandingWalks, at: TimeOfDay): string {
  const subject = names.length === 1 ? names[0] : "Walks";

  return `${subject} not logged. Reminder set for ${at}.`;
}

/**
 * The stored value's shape, checked here rather than trusted.
 *
 * A separate pattern from `date.ts`'s, on `slot-times.ts`'s reasoning and with
 * the same safeguard: the two agree about what a time is, and this module's test
 * pins that agreement by feeding every value this accepts through
 * `parseTimeOfDay`. Reusing the parser directly would mean catching an exception
 * to express "no banner", which is an exception used as a return value.
 */
const TIME_OF_DAY = /^([01]\d|2[0-3]):([0-5]\d)$/;

/**
 * Whether the reminder has come round, in the day the caller is already in.
 *
 * `null` — the reminder switched off — is `false` before anything else is
 * considered, which is P9's "the reminder can be disabled entirely" in one line.
 * There is no separate "enabled" flag to disagree with it.
 *
 * ## Why the caller supplies the minutes
 *
 * The comparison is against the user's OWN clock, not the server's, and the zone
 * lives on the profile — so `minutesOfDayIn(profile.timezone, now)` is the
 * caller's to compute and this function's to be given. It is the same discipline
 * `resolve-now.ts` keeps for the same reason: a module that read the clock
 * itself would be a module whose answer no test could fix in place, on exactly
 * the boundary — 18:59 against 19:00, and midnight — where being wrong is
 * invisible.
 *
 * Inclusive at the reminder time: 19:00 is when it was set for, so 19:00 is when
 * it appears. Nothing ends the window before midnight, because the caller's
 * `minutesOfDay` is already the count within the user's own day — the reminder
 * is about TODAY's walk, and at 00:01 the day it is about is a different day
 * whose walk has all of it left to be logged in.
 */
export function isReminderDue(
  at: TimeOfDay | null,
  minutesOfDay: number,
): at is TimeOfDay {
  if (at === null || !TIME_OF_DAY.test(at)) return false;

  const [hours, minutes] = at.split(":");

  return minutesOfDay >= Number(hours) * 60 + Number(minutes);
}
