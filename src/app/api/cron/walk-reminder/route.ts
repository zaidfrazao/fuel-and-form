import webpush, { WebPushError } from "web-push";

import { isAuthorizedCron } from "@/lib/cron";
import {
  dropSubscription,
  markNotified,
  walksOwedANotification,
} from "@/lib/db/queries/push";
import { cronSecret, vapidKeys } from "@/lib/env";
import { isSubscriptionGone, shouldNotify, walkNotification } from "@/lib/push";

/**
 * `GET /api/cron/walk-reminder` — P9's second layer. FUEL-47.
 *
 * The in-app banner (FUEL-46) tells someone their walk is unlogged while they
 * have the app open. This tells them when they do not. It is the same fact,
 * assembled from the same query, delivered to a device instead of a screen.
 *
 * Thin, like the reaper beside it: who may call it is `lib/cron.ts`, who is owed
 * a notification is `lib/db/queries/push.ts`, what a notification SAYS and which
 * failures kill a subscription are `lib/push.ts`. What happens here is the gate,
 * the loop, and the two writes each send can produce.
 *
 * ## The schedule IS the reminder time, and that is a compromise worth naming
 *
 * `profiles.walk_reminder_at` is a per-user time in a per-user zone. A Vercel
 * cron on a Hobby account runs at most once a day and lands anywhere in a
 * ±59-minute window. Those two cannot both be honoured, and the failure of
 * trying is silent: on any evening the jitter landed before the configured time,
 * the check would say "not yet" and no second run would come — the notification
 * simply never arrives, and nothing anywhere reports it. In winter that is every
 * evening, because 18:00 UTC is 18:00 in London.
 *
 * So the cron expression is the schedule. `vercel.json` sets `0 19 * * *`, which
 * lands 19:00–19:59 GMT and 20:00–20:59 BST — after the 19:00 default in both.
 * The configured time still governs the banner to the minute, still appears in
 * the notification's own sentence, and `null` still switches the whole feature
 * off. What it does not do is set the minute a phone buzzes.
 *
 * A reminder configured LATER than the window therefore gets a banner and no
 * push. That is not a bug to be worked around; it is P9's own degradation
 * clause, and the banner is the layer the PRD calls "always built".
 *
 * On Pro this becomes `0 * * * *`, the `shouldNotify` cap starts doing the work
 * it was written for, and the compromise above disappears without a line of this
 * file changing.
 *
 * ## Why an unset CRON_SECRET is 500 and unset VAPID keys are 200
 *
 * `cronSecret()` throws, exactly as it does for the reaper, and for the reason
 * argued there: a job that has never run must not look like a job being probed.
 * Authentication is not the thing that degrades.
 *
 * Absent VAPID keys are the opposite. P9 requires push to "degrade silently to
 * the banner — no errors surfaced to the user", and a deployment with no keys is
 * the app with one of P9's two layers switched off, which is a state the PRD
 * explicitly anticipates. Throwing would mean a 500 every evening on a
 * deployment where nothing is wrong — noise in the one log the reaper's throw is
 * trying to keep meaningful. `lib/env.ts` makes the same argument beside
 * `vapidKeys`.
 *
 * ## Nothing this route does can fail a person's evening
 *
 * Every send is awaited separately and every failure is swallowed into a
 * counter. One dead subscription must not stop the fourteen behind it, an
 * unreachable push service must not become a 500 that Vercel retries, and none
 * of it reaches a screen — there is no user on the other end of this request at
 * all. The database is the exception: if `walksOwedANotification` throws there
 * is nothing to iterate, and a 500 there is honest, because tomorrow's run does
 * this run's work as well as its own.
 *
 * ## GET, no-store, and a count
 *
 * Vercel issues a GET. `no-store` because a cached "sent 0" served to tomorrow's
 * invocation is a job that silently stopped running while reporting success —
 * the reaper's argument, and it applies to any scheduled route. The body is
 * counts and nothing else: this route reads across users, and its log line is
 * the one place that could turn an unscoped read into a disclosure. There is no
 * endpoint, no user id and no name in what it returns.
 */

/**
 * Vercel's ceiling on a Hobby function, claimed explicitly — the reaper's line
 * and its reasoning.
 *
 * The sends are sequential, and a push service that is merely slow can take
 * seconds per request. Sixty seconds is far more than this app's subscriptions
 * can spend — there is one owner — but the ceiling is claimed rather than left
 * to the default, so a run that IS cut short is cut short by a number written
 * down here rather than by a platform setting nobody looked at.
 */
export const maxDuration = 60;

/** What a run of the reminder did. Counts only — see the doc comment. */
type Sending = {
  /** Notifications delivered. */
  sent: number;
  /** Subscriptions skipped because this browser was already reached today. */
  capped: number;
  /** Rows deleted because the push service reported them gone. */
  pruned: number;
  /** Sends that failed transiently. The row was kept and will be retried. */
  failed: number;
};

export async function GET(request: Request): Promise<Response> {
  // The environment before the header, exactly as the reaper does it, so a
  // deployment with no secret throws instead of comparing against nothing.
  const secret = cronSecret();

  if (!isAuthorizedCron(request.headers.get("authorization"), secret)) {
    // No body, no header naming what was wrong, nothing logged. A probe learns
    // only that it failed.
    return new Response("Unauthorized", { status: 401 });
  }

  const keys = vapidKeys();

  if (!keys) {
    // Reported, because this is the one line that distinguishes "push is not
    // configured" from "push is configured and nothing was owed" — and those
    // look identical from outside. Info rather than error: it is a supported
    // state, not a fault.
    console.info("Walk reminder push is not configured; no VAPID keys. Skipping.");

    return Response.json(
      { sent: 0, capped: 0, pruned: 0, failed: 0 },
      { status: 200, headers: { "Cache-Control": "no-store" } },
    );
  }

  webpush.setVapidDetails(keys.subject, keys.publicKey, keys.privateKey);

  const owed = await walksOwedANotification(new Date());

  const counts: Sending = { sent: 0, capped: 0, pruned: 0, failed: 0 };

  for (const user of owed) {
    // Built once per user rather than once per device: the sentence is about the
    // walk, not about the browser, so two phones get the same words.
    const payload = JSON.stringify(walkNotification(user.at));

    for (const target of user.targets) {
      // P9's "one notification per day maximum", counted in the user's own zone
      // — see `shouldNotify`, which also refuses a stored date in the future.
      if (!shouldNotify(target.lastNotifiedOn, user.today)) {
        counts.capped += 1;
        continue;
      }

      try {
        await webpush.sendNotification(
          { endpoint: target.endpoint, keys: { p256dh: target.p256dh, auth: target.auth } },
          payload,
        );

        // Written AFTER the send resolves, so a failure leaves the date alone
        // and tomorrow's run tries again. The other order would cap a browser
        // for the day on the strength of a request that never arrived.
        await markNotified(target.id, user.today);

        counts.sent += 1;
      } catch (error) {
        // `WebPushError` is the only shape carrying a status; anything else — a
        // socket closed, a DNS failure, a `markNotified` that could not reach
        // the database — has none, and `isSubscriptionGone` treats that as not
        // gone. Nothing was learned about the subscription, only about the
        // network.
        const status = error instanceof WebPushError ? error.statusCode : undefined;

        if (isSubscriptionGone(status)) {
          await dropSubscription(target.id);
          counts.pruned += 1;
          continue;
        }

        // Logged without the endpoint. It is a credential, this route's whole
        // caution is about reading across users, and a log line is the easiest
        // place for one to end up somewhere it was never meant to be. The status
        // is what anyone debugging actually needs.
        console.error("Could not send a walk reminder.", { status });
        counts.failed += 1;
      }
    }
  }

  // Reported rather than merely returned, on the reaper's reasoning: this is a
  // route with no human on the other end, so its log line IS its user interface.
  // `sent: 0` on an evening with subscribers is the signal that something is
  // wrong, and there is no screen anywhere that would show it.
  console.info("Sent walk reminders.", counts);

  return Response.json(counts, {
    status: 200,
    headers: { "Cache-Control": "no-store" },
  });
}
