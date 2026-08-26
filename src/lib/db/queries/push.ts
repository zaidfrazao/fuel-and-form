import "server-only";

import { eq, isNotNull, sql } from "drizzle-orm";

import { type CalendarDate, MINUTES_PER_DAY, todayIn } from "@/lib/date";
import { isReminderDue } from "@/lib/walk-reminder";
import { getDb } from "../index";
import * as schema from "../schema";
import { scope } from "../scope";
import { isWalkUnlogged } from "./walk-reminder";

/**
 * The push subscriptions, and who is owed a notification tonight — FUEL-47,
 * PRD § P9.
 *
 * Two halves with different callers and different rules, in one module because
 * they are one table's whole surface.
 *
 * The first half — `saveSubscription`, `removeSubscription` — runs inside a
 * request, on behalf of somebody who is signed in, and goes through `scope()`
 * like every other write in this directory.
 *
 * The second half — `walksOwedANotification` — runs from a scheduled job. There
 * is no session, no cookie and no requester, and it must read ACROSS users. It
 * is the only such read in the app, and the paragraph below is why that is
 * allowed here and nowhere else.
 *
 * ## The unscoped read, and the boundary that replaces the scope
 *
 * `scope.ts` calls itself "the choke point every user-owned query passes
 * through", and the promise it holds up is that a demo visitor cannot reach the
 * owner's data. A scope needs a user to scope BY, and a cron has none — so the
 * question is what stands in for it.
 *
 * What stands in is that the answer never leaves the server. This function's
 * result is consumed entirely inside `api/cron/walk-reminder/route.ts`: each
 * user's own notification goes to each user's own subscription, and what the
 * route returns to its caller is a count. No row, no name, no endpoint and no
 * user id crosses to any browser. The scope exists to stop one user's data
 * being RENDERED to another; here nothing is rendered to anyone.
 *
 * The route's own gate is what makes that true rather than hoped for — the
 * bearer token in `lib/cron.ts`, in front of a handler that has no other
 * output. A future caller that wanted to render any of this would have to reach
 * for `scope()`, because there is nothing in the shape below that identifies a
 * user to a screen.
 *
 * ## Why the walk check still goes through a scope
 *
 * Having read the subscriptions unscoped, the job then asks "is this user's walk
 * unlogged" — and that question is asked through `scope(userId, ...)`, per user,
 * against `isWalkUnlogged`. Not because a cross-user read would be wrong here
 * too, but because it would be a SECOND unscoped query, sharing none of the
 * argument above: it reads the training template and the logs, which is the
 * owner's actual history, and it would have to join three tables on a `user_id`
 * this file supplied by hand. One statement per subscribed user is a cost this
 * app will never notice — there is one owner — and it keeps the reach of the
 * unscoped read down to the one table that has no other way to be found.
 */

/** One browser to notify, and what the last notification's date was. */
export type PushTarget = {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  lastNotifiedOn: CalendarDate | null;
};

/** A user with an unlogged walk, their zone's today, and their browsers. */
export type WalkOwed = {
  userId: string;
  /** The reminder time, for the sentence. Known well-formed by `isReminderDue`. */
  at: string;
  /** Today in the user's own zone — what the once-a-day cap is counted in. */
  today: CalendarDate;
  targets: PushTarget[];
};

/**
 * Records this browser as reachable, or updates the row already there.
 *
 * An upsert rather than an insert, because `pushManager.subscribe()` is
 * idempotent in the browser: it hands back the SAME endpoint every time it is
 * called for a given browser and application server key. So a second tap, a
 * reinstall or a page reloaded mid-flow arrives here with an endpoint that is
 * already stored, and an insert would either throw on the unique index or — with
 * the index removed — grow a duplicate that delivers a second notification for
 * the same day.
 *
 * The keys ARE overwritten, because they can rotate underneath a stable
 * endpoint, and a row holding last week's `p256dh` is one every send will fail
 * to encrypt for — with no status on the failure, so it looks like the network.
 *
 * ## `last_notified_on` is deliberately LEFT ALONE
 *
 * The first draft reset it to null here, reasoning that re-subscribing is an act
 * by somebody sitting in front of the app and the evening it happens should be
 * one the phone is still reached on. That is wrong, and it breaks P9's "one
 * notification per day maximum" through a door ordinary use opens.
 *
 * `pushManager.subscribe()` returns the SAME endpoint for a browser and
 * application server key, so this upsert lands on an existing row whenever a
 * subscription is made twice without being deleted in between — a second tab, a
 * page reloaded mid-flow, or permission revoked in site settings and granted
 * again, which leaves the row in place while `getSubscription()` reports none.
 * That last one is precisely the flow this task asks to be checked by hand.
 * Resetting the date there means a phone already notified at seven is notified
 * again at eight, which is the one outcome the criterion names.
 *
 * Leaving it is also the honest reading of the column: it records that a
 * notification REACHED this browser today, and re-subscribing does not unsend
 * it. Turning the control off and on again does clear the cap — but that deletes
 * the row and inserts a new one, which is a different statement and a deliberate
 * act rather than a side effect of one.
 *
 * `tests/integration/push.test.ts` holds this against a real Postgres, because
 * `ON CONFLICT` is a statement and no mock can answer for it.
 */
export async function saveSubscription(
  userId: string,
  subscription: { endpoint: string; p256dh: string; auth: string },
): Promise<void> {
  await scope(userId, getDb()).upsert(
    schema.pushSubscriptions,
    [subscription],
    {
      target: [schema.pushSubscriptions.endpoint],
      set: { p256dh: subscription.p256dh, auth: subscription.auth },
    },
  );
}

/**
 * Forgets a browser.
 *
 * Scoped, so naming somebody else's endpoint deletes nothing — which matters
 * more here than it reads. The endpoint is the only handle a caller has on a
 * subscription, and it is a value another user's browser could plausibly know
 * (it is theirs). Without the scope, "unsubscribe" would be an unauthenticated
 * way to silence any device whose endpoint you had.
 */
export async function removeSubscription(userId: string, endpoint: string): Promise<void> {
  await scope(userId, getDb()).delete(
    schema.pushSubscriptions,
    eq(schema.pushSubscriptions.endpoint, endpoint),
  );
}

/**
 * Records that this browser has now been reached today.
 *
 * Unscoped for the same reason the read is, and addressed by primary key: the id
 * came from a row this module itself just returned, so there is no caller-
 * supplied value in it at all.
 */
export async function markNotified(id: string, on: CalendarDate): Promise<void> {
  await getDb()
    .update(schema.pushSubscriptions)
    .set({ lastNotifiedOn: on })
    .where(eq(schema.pushSubscriptions.id, id));
}

/**
 * Deletes a subscription the push service says no longer exists.
 *
 * By id, like `markNotified`, and unscoped for the same reason. `isSubscriptionGone`
 * in `lib/push.ts` is what decides this is called at all, and it argues at length
 * about how narrow the set of statuses has to be.
 */
export async function dropSubscription(id: string): Promise<void> {
  await getDb().delete(schema.pushSubscriptions).where(eq(schema.pushSubscriptions.id, id));
}

/**
 * Every user with a subscribed browser and an unlogged walk, at `now`.
 *
 * ## What is checked, and what deliberately is not
 *
 * Checked: the reminder is not switched off (`walk_reminder_at is not null`),
 * the user has at least one subscription, and today's walk has no row. Those are
 * P9's own conditions for the banner, minus one.
 *
 * The one left out is the TIME. `isReminderDue` compares the configured time
 * against the user's current minute-of-day, and the banner is right to do that —
 * it is rendered on a request, whenever the request happens. A scheduled job is
 * not: on a Hobby account Vercel permits one run a day and jitters it by up to
 * fifty-nine minutes, so the run's own clock is a range rather than a moment.
 * Comparing against it would mean the notification silently never fires whenever
 * the jitter landed early — worst in winter, when 18:00 UTC is 18:00 in London
 * and a 19:00 reminder is an hour away.
 *
 * So the CRON EXPRESSION is the push schedule, and `vercel.json` places it after
 * the default reminder time in both British zones. The configured time still
 * governs the banner exactly, and still switches push off entirely when it is
 * null. What it does not do is set the minute a notification arrives — see the
 * route, which says the same thing to whoever reads it there first.
 *
 * `isReminderDue` is still used, on a minute-of-day of `MINUTES_PER_DAY`: not to
 * ask whether the evening has come, but because it is the one place that decides
 * what a well-formed `walk_reminder_at` is, and its narrowing is what lets `at`
 * cross into the notification's sentence without an assertion. A malformed value
 * that the CHECK constraint should make impossible is skipped here exactly as it
 * is skipped by the banner — no notification, rather than a throw inside a job
 * that has fourteen other subscriptions to reach.
 *
 * ## One statement, then one per subscribed user
 *
 * The join finds the candidates in a single read. The walk check is then per
 * user, through a scope, for the reason the module header gives. With one owner
 * and a phone that is one statement and then one more.
 */
export async function walksOwedANotification(now: Date): Promise<WalkOwed[]> {
  const db = getDb();

  const rows = await db
    .select({
      userId: schema.profiles.userId,
      timezone: schema.profiles.timezone,
      walkReminderAt: schema.profiles.walkReminderAt,
      programStartDate: schema.profiles.programStartDate,
      id: schema.pushSubscriptions.id,
      endpoint: schema.pushSubscriptions.endpoint,
      p256dh: schema.pushSubscriptions.p256dh,
      auth: schema.pushSubscriptions.auth,
      lastNotifiedOn: schema.pushSubscriptions.lastNotifiedOn,
    })
    .from(schema.pushSubscriptions)
    // An inner join: a subscription whose user has no profile has no timezone,
    // so there is no "today" to cap against and no reminder time to print. The
    // banner treats a missing profile as "no banner"; this is the same answer.
    .innerJoin(schema.profiles, eq(schema.profiles.userId, schema.pushSubscriptions.userId))
    .where(isNotNull(schema.profiles.walkReminderAt))
    .orderBy(sql`${schema.pushSubscriptions.createdAt}`);

  // Grouped in memory rather than by a second query. The set is one row per
  // subscribed browser in the whole database — a handful, by construction — and
  // grouping here keeps the statement above a plain join that anyone can read.
  const byUser = new Map<string, WalkOwed & { programStartDate: CalendarDate }>();

  for (const row of rows) {
    // The time is not compared against the clock — see above — but it is still
    // the thing that decides whether the stored value is one this app can print.
    // `MINUTES_PER_DAY` is past every valid time, so the only branch that can
    // refuse here is the malformed one.
    if (!isReminderDue(row.walkReminderAt, MINUTES_PER_DAY)) continue;

    const target: PushTarget = {
      id: row.id,
      endpoint: row.endpoint,
      p256dh: row.p256dh,
      auth: row.auth,
      lastNotifiedOn: row.lastNotifiedOn,
    };

    const existing = byUser.get(row.userId);

    if (existing) {
      existing.targets.push(target);
      continue;
    }

    byUser.set(row.userId, {
      userId: row.userId,
      at: row.walkReminderAt,
      today: todayIn(row.timezone, now),
      programStartDate: row.programStartDate,
      targets: [target],
    });
  }

  const owed: WalkOwed[] = [];

  for (const candidate of byUser.values()) {
    const { programStartDate, ...rest } = candidate;

    const unlogged = await isWalkUnlogged(
      scope(candidate.userId, db),
      candidate.today,
      programStartDate,
    );

    if (unlogged) owed.push(rest);
  }

  return owed;
}
