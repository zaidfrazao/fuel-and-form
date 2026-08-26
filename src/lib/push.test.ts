import { describe, expect, it } from "vitest";

import {
  isSubscriptionGone,
  shouldNotify,
  WALK_NOTIFICATION_URL,
  walkNotification,
} from "./push";
import { REMINDER_LINK, reminderStatement } from "./walk-reminder";

/**
 * The notification's copy and the job's two decisions — FUEL-47, § P9.
 *
 * `walk-reminder.test.ts` covers the layer a person can SEE go wrong; this
 * covers the layer nobody can. A notification is delivered to a device, by a
 * scheduled job with no screen, at an hour nobody is watching, and every way
 * these three functions can be wrong produces silence or a duplicate rather than
 * an error — on the one feature the PRD rates "historically unreliable" anyway,
 * which is precisely the cover a real bug would hide behind.
 *
 * Three things are asserted that nothing else in the suite can hold still:
 *
 *   - that the notification says what the BANNER says. P9's two layers report
 *     one fact, and the day they disagree is the day someone edited the
 *     notification's wording without the banner in front of them.
 *   - the once-a-day cap, at its boundary and PAST it. Yesterday, today and
 *     tomorrow are three answers, and only two of them are obvious.
 *   - which push-service refusals delete a row. This is the only branch in the
 *     feature that destroys something, and it is fed a number by a third party
 *     over a network.
 */

describe("the notification", () => {
  it("says what the banner says", () => {
    // Not a copy of the sentence written out again here — that would pass
    // whatever the banner said, which is the exact drift this asserts against.
    // It is the banner's own two strings, composed.
    expect(walkNotification("19:00").body).toBe(
      `${reminderStatement("19:00")} ${REMINDER_LINK}`,
    );
  });

  it("reads as the criterion's sentence on a lock screen", () => {
    // The composition above, spelled out once, so a reader of this file can see
    // what actually arrives on a phone without assembling it from two modules.
    // Both assertions are needed: this one would survive `reminderStatement`
    // being inlined, and that one would survive the whole sentence changing.
    expect(walkNotification("19:00").body).toBe(
      "Walk not logged. Reminder set for 19:00. Log the walk.",
    );
  });

  it("names the time it was actually configured for", () => {
    // The banner's criterion, inherited. A notification with 19:00 baked in
    // would be wrong for everyone who moved the setting, and wrong in the one
    // place there is no surrounding screen to correct it.
    expect(walkNotification("06:30").body).toContain("06:30");
  });

  it("carries no encouragement", () => {
    // § Tone of Voice, and the same guard the banner keeps. Asserted on the
    // whole notification rather than the body, because the title is the other
    // half a lock screen shows and it is just as editable.
    const { title, body } = walkNotification("19:00");

    expect(`${title} ${body}`).not.toMatch(/!/);
  });

  it("identifies itself, because nothing around it does", () => {
    // A banner sits inside the app and needs no attribution. A notification
    // arrives on a lock screen beside a dozen others, and one that named
    // neither the app nor the subject is one nobody can act on.
    expect(walkNotification("19:00").title).toBe("Fuel & Form");
  });

  it("deep-links to the screen the banner links to", () => {
    // P9's fourth criterion. Pinned against the constant AND against `/`,
    // because the constant alone would follow the value wherever it was
    // changed to — and `walk-reminder.tsx` argues at length that `/` is the
    // screen the walk's row was designed into.
    expect(walkNotification("19:00").url).toBe(WALK_NOTIFICATION_URL);
    expect(WALK_NOTIFICATION_URL).toBe("/");
  });
});

describe("the once-a-day cap", () => {
  it("sends to a subscription that has never been notified", () => {
    // Null is the ordinary state of a subscription made this afternoon, not a
    // missing value to be defended against.
    expect(shouldNotify(null, "2026-08-26")).toBe(true);
  });

  it("sends when the last notification was yesterday", () => {
    expect(shouldNotify("2026-08-25", "2026-08-26")).toBe(true);
  });

  it("refuses a second notification on the same date", () => {
    // P9's cap, and the branch a manual re-run of the cron takes. The whole
    // criterion is this line.
    expect(shouldNotify("2026-08-26", "2026-08-26")).toBe(false);
  });

  it("refuses a date in the future rather than treating it as 'not today'", () => {
    // The case `!==` would get wrong, and the reason the comparison is `<`.
    // A stored date ahead of today — a timezone corrected westward, a clock
    // skewed forward on the run that wrote it — would otherwise be "not today"
    // every evening until the calendar caught up, and the cap would simply be
    // off for that whole stretch with nothing to say so.
    expect(shouldNotify("2026-08-27", "2026-08-26")).toBe(false);
  });

  it("compares dates chronologically across a month boundary", () => {
    // Lexicographic on 'YYYY-MM-DD' is chronological, which is the property the
    // whole app's date handling rests on. Asserted where a naive comparison
    // would be most likely to differ.
    expect(shouldNotify("2026-08-31", "2026-09-01")).toBe(true);
    expect(shouldNotify("2026-09-01", "2026-08-31")).toBe(false);
  });
});

describe("which refusals delete a subscription", () => {
  it.each([404, 410])("treats %i as gone", (status) => {
    // RFC 8030: the endpoint is unknown, or expired. The browser threw the
    // subscription away — cleared site data, uninstalled the PWA — and the row
    // is permanently undeliverable.
    expect(isSubscriptionGone(status)).toBe(true);
  });

  it.each([429, 500, 502, 503])("keeps the row on a transient %i", (status) => {
    // The direction that matters. Each of these is the push service having a
    // problem or asking to be left alone, and deleting on one would silently
    // unsubscribe a working phone with nothing on any screen to say so.
    expect(isSubscriptionGone(status)).toBe(false);
  });

  it("keeps the row on a 403", () => {
    // Called out separately because it is the one that reads like a rejection
    // of the subscription and is not. 403 means the VAPID key pair no longer
    // matches the one the subscription was created under — a deployment's
    // mistake — and deleting every row in the table on the evening someone
    // rotates a key is the least recoverable thing this job could do.
    expect(isSubscriptionGone(403)).toBe(false);
  });

  it("keeps the row when the failure carried no status at all", () => {
    // A DNS failure, a socket closed mid-request. Nothing was learned about the
    // subscription, only about the network — and this is the branch a `Set.has`
    // on an undefined would otherwise reach.
    expect(isSubscriptionGone(undefined)).toBe(false);
  });

  it("does not treat a 201 as gone", () => {
    // A success never reaches this function, but the guard is worth an
    // assertion: a `GONE` set that grew a success code would prune every
    // subscription it ever reached, on the runs that worked.
    expect(isSubscriptionGone(201)).toBe(false);
  });
});
