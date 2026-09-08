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
 * A list rather than a count, because the sentence NAMES them — see below.
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
 * "Morning Walk and Afternoon Walk not logged. Log the walk." is a banner that
 * corrects itself halfway through, and it is the kind of small wrongness that
 * makes a reader stop trusting the rest of the sentence. There are two walks, so
 * there are two forms.
 *
 * `REMINDER_LINK` stays the singular one rather than being replaced by a second
 * literal: § Terminology is a rule about the VERB — "Log", never "Track",
 * "Record" or "Add" — and one constant to pin that against is what its test
 * needs. This adds the plural beside it rather than a second thing to keep in
 * step.
 */
export function reminderLink(names: OutstandingWalks): string {
  return names.length > 1 ? "Log the walks." : REMINDER_LINK;
}

/**
 * "Morning Walk and Afternoon Walk" — the subject of the sentence.
 *
 * Written out rather than reached for through `Intl.ListFormat`, which would
 * make the copy depend on the runtime's locale and ICU build: `dot-grid.tsx`
 * refuses the same API for the same reason, and this string is asserted word for
 * word by a test that must mean the same thing on every machine it runs on.
 *
 * The Oxford comma is deliberate at three and above. There are two walks today
 * and a third is a template edit away, so the branch exists; it is one clause
 * and it is the one that stops "A, B and C" from being written as "A and B and
 * C" the first time someone adds one.
 */
function nameList(names: OutstandingWalks): string {
  if (names.length <= 2) return names.join(" and ");

  return `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}

/**
 * `Morning Walk not logged. Reminder set for 19:00.` — the AC's sentence, given
 * the walks that are outstanding and a time.
 *
 * ## Why the walks are named, and the sentence is no longer a constant
 *
 * It was "Walk not logged." while there was one walk. There are two since
 * FUEL-98, and with the morning one done and the afternoon one not, that
 * sentence is simply FALSE — the app reporting nothing logged about a day with
 * a log in it. § Tone of Voice asks for factual before it asks for anything
 * else, so the sentence says which.
 *
 * The alternative was to keep it generic and let it be true "about the day".
 * That reads as an accusation the record contradicts, and it is exactly the
 * thing the walk reminder must not become: a banner someone learns to ignore
 * because it is sometimes wrong.
 *
 * Singular and plural are one shape rather than two strings — the subject is a
 * list, the predicate never changes. "Morning Walk and Afternoon Walk not
 * logged" is a compound subject taking a plural verb that is not written down,
 * so nothing has to agree with anything.
 *
 * An EMPTY list is not a state this is called in: the caller establishes that
 * something is outstanding before there is a banner at all. It renders as
 * "not logged" with no subject, which is ungrammatical rather than misleading —
 * a caller that reached it has a bug, and a sentence that quietly read well
 * would be a bug nobody saw.
 */
export function reminderStatement(names: OutstandingWalks, at: TimeOfDay): string {
  return `${nameList(names)} not logged. Reminder set for ${at}.`;
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
