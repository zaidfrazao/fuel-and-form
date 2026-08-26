import { type CalendarDate } from "./date";
import { REMINDER_LINK, reminderStatement } from "./walk-reminder";

/**
 * What a walk notification says, and the two decisions the scheduled job makes
 * about each subscription — FUEL-47, PRD § P9, Brand Guide § Tone of Voice.
 *
 * `walk-reminder.ts` is this file's sibling and its model: the banner's copy and
 * its one comparison, with no database and no request in it. This is the same
 * for the layer that runs when the app is CLOSED — the sentence a phone shows on
 * its lock screen, whether a subscription is owed one today, and whether a push
 * service's refusal means the row should be thrown away.
 *
 * Pure, and deliberately NOT `server-only`, for that file's reason turned
 * around. Nothing here can be exercised by running the app: a notification
 * arrives on a device, from a job with no screen, at an hour nobody is watching,
 * and the two predicates below decide silently in both directions. A duplicate
 * notification is a criterion broken with nothing to notice it; a subscription
 * wrongly pruned is a phone that simply stops being reminded, indistinguishable
 * from the platform being unreliable — which P9's own Risks entry says it is.
 * So both are covered here, hermetically, at 100%.
 *
 * ## Nothing here throws
 *
 * `walk-reminder.ts` makes this argument about a value the database holds; this
 * one is about a value a PUSH SERVICE returns. `isSubscriptionGone` is handed a
 * status code by a third party, over a network, from an endpoint this app does
 * not control — and it is called inside a loop whose contract is that one bad
 * subscription does not stop the others being reached.
 */

/**
 * What crosses to the service worker, JSON-encoded.
 *
 * A shape rather than a bare string, because the worker draws two lines and a
 * destination, and a payload it had to parse out of one sentence would put the
 * copy in two places — the half that is written here and the half that is split
 * apart there.
 */
export type WalkNotification = {
  title: string;
  body: string;
  /** Where a tap lands. P9's "deep-links to the walk logging action". */
  url: string;
};

/**
 * The screen the notification opens.
 *
 * `/`, and the same `/` the banner's link points at — `walk-reminder.tsx` sets
 * out why: both `/` and `/training` carry a walk row, and `/` is the one the app
 * opens on and the one the walk's row was designed into. The two layers of P9
 * must not disagree about where "log the walk" is, or the tap teaches one thing
 * and the sentence beneath it another.
 */
export const WALK_NOTIFICATION_URL = "/";

/**
 * The title, and the only string in this feature with nowhere to put a second
 * sentence.
 *
 * A lock screen gives a notification a title and a line, and truncates both. The
 * app's name is what makes an unexpected notification legible at all — a bare
 * "Walk not logged." arriving from nothing identifies neither what asked nor
 * what to do — so the name goes here and the statement goes in the body, which
 * is the division every platform's own notifications use.
 *
 * § Tone of Voice, same as the banner: no exclamation mark, nothing addressed to
 * a person about what they have not done, and no encouragement. "Time for your
 * walk!" is one edit away and forbidden.
 */
const TITLE = "Fuel & Form";

/**
 * The notification for a walk unlogged at `at`.
 *
 * The body is the BANNER's sentence, from `reminderStatement`, plus the banner's
 * link text as a plain clause. Reusing it is the point rather than a saving:
 * P9's two layers say the same thing about the same fact, and a notification
 * that phrased it its own way would be a second voice for one feature — the
 * place where "Walk not logged." quietly becomes "Don't forget your walk!"
 * because the notification was edited and the banner was not.
 *
 * `REMINDER_LINK` is already a full sentence — "Log the walk." — so it is
 * appended rather than wrapped in anything. On a lock screen there is no link to
 * be; the tap is the whole notification, and this is what says so.
 */
export function walkNotification(at: string): WalkNotification {
  return {
    title: TITLE,
    body: `${reminderStatement(at)} ${REMINDER_LINK}`,
    url: WALK_NOTIFICATION_URL,
  };
}

/**
 * Whether this subscription is still owed today's notification.
 *
 * P9 caps delivery at "one notification per day maximum", and this is the whole
 * of that cap. `lastNotifiedOn` is the date a notification last reached this
 * browser, in the profile's own zone; `today` is the same zone's date now.
 *
 * ## Why not equality alone
 *
 * `lastNotifiedOn !== today` would be the obvious spelling and it is wrong in
 * one direction that matters: a stored date in the FUTURE — a profile whose
 * timezone was corrected westward, a row written by a run that read a clock
 * skewed forward — would then be "not today", and the job would send again
 * every evening until the calendar caught up. `<` refuses that: a date not
 * strictly before today is one this browser has already been reached on, or
 * ahead of today, and neither is owed anything.
 *
 * Lexicographic comparison, which is chronological for 'YYYY-MM-DD' — the
 * property `date.ts` relies on throughout and the reason `CalendarDate` is a
 * string rather than a `Date`.
 *
 * Null is the ordinary state of a subscription made this afternoon: nothing has
 * been sent, so there is no date, so it is owed one.
 */
export function shouldNotify(
  lastNotifiedOn: CalendarDate | null,
  today: CalendarDate,
): boolean {
  return lastNotifiedOn === null || lastNotifiedOn < today;
}

/**
 * The two statuses that mean the subscription no longer exists.
 *
 * RFC 8030 gives 404 for an endpoint the push service has never heard of and
 * 410 for one it has expired, and browsers produce both routinely: the user
 * cleared site data, uninstalled the PWA, or the service rotated the endpoint.
 * The row is then permanently undeliverable, and the only correct response is to
 * delete it.
 */
const GONE = new Set([404, 410]);

/**
 * Whether a failed send means the row should be deleted rather than kept.
 *
 * The one place in this feature where being wrong is not merely a notification
 * that does not arrive, and it is wrong in two different ways:
 *
 *   - Too narrow, and a dead endpoint is retried every evening forever. Harmless
 *     to the user and invisible — the log fills with 410s nobody reads, and the
 *     table keeps a row per uninstall.
 *   - Too WIDE, and a live subscription is deleted on one bad night. 500 and 503
 *     are the push service having a problem, 429 is it asking to be left alone,
 *     and each is transient by definition. Treating any of them as gone would
 *     silently unsubscribe a phone that was working an hour ago, with nothing on
 *     any screen to say so and no way back but noticing and re-subscribing by
 *     hand.
 *
 * So the set is exactly the two codes that MEAN gone, and everything else — a
 * timeout with no status at all, a 403 from a rotated VAPID key, a 502 from a
 * proxy — leaves the row alone. A 403 is deliberately in that majority: it means
 * the key pair changed, which is a deployment's mistake rather than the
 * browser's, and deleting every subscription in the table on the evening someone
 * rotates a key is the least recoverable thing this job could do.
 *
 * `undefined` for a rejection that carried no status — a DNS failure, a socket
 * closed mid-request — and it is not gone. Nothing was learned about the
 * subscription; only about the network.
 */
export function isSubscriptionGone(statusCode: number | undefined): boolean {
  return statusCode !== undefined && GONE.has(statusCode);
}
