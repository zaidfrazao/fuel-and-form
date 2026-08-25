import { isAuthorizedCron } from "@/lib/cron";
import { reapExpiredDemos } from "@/lib/db/queries/demo";
import { cronSecret } from "@/lib/env";

/**
 * `GET /api/cron/reap-demos` — the scheduled cleanup. FUEL-42, PRD § P7.
 *
 * Thin, like every route and page in this app: the decision about who may call
 * it is `lib/cron.ts`, the statement is `lib/db/queries/demo.ts`, and what
 * happens here is the header, the clock, and the status code.
 *
 * P7 requires that "expired demo sessions are deleted by a scheduled job", and
 * the Risks table names the thing it mitigates — "demo sessions accumulate and
 * exhaust the free tier". Every visitor to the public URL creates an account and
 * roughly two hundred rows; without this route they are permanent.
 *
 * ## Why the route is public and the check is a bearer token
 *
 * Vercel Cron invokes an ordinary HTTPS route. There is no private network, no
 * platform identity to check, and `x-vercel-cron` is a header rather than a
 * credential — anyone willing to send it would satisfy a check that read it. So
 * the gate is `CRON_SECRET`, compared in constant time, and the path being
 * published in `vercel.json` in a public repository changes nothing about who
 * can act on it.
 *
 * ## Why an unset secret is 500 and a wrong one is 401
 *
 * They are different failures and they need different people to notice.
 *
 * A wrong token is someone else's problem: answer 401, say nothing else, log
 * nothing. A route that deletes rows should not narrate its own gate, and a
 * probe should learn only that it failed.
 *
 * An ABSENT `CRON_SECRET` is the operator's problem, and answering 401 to it
 * would be the worst available outcome: the scheduler would be turned away by
 * its own deployment, every day, looking exactly like the probes. Nothing would
 * report it, and the symptom — rows accumulating — is precisely what this route
 * exists to prevent, surfacing weeks later with no obvious cause. `cronSecret()`
 * throws instead, which puts the variable's name in the platform's log the first
 * time the schedule fires.
 *
 * ## GET, because that is what a cron sends
 *
 * Vercel issues a GET. A route handler is not cached by default in this version
 * — and `no-store` is set on the response regardless, because a cached "deleted
 * 0" served to tomorrow's invocation would be a job that silently stopped
 * running while continuing to report success.
 *
 * ## The cadence, and what it costs
 *
 * `vercel.json` schedules this daily. That is not a preference: Hobby accounts
 * are limited to cron expressions that run at most once a day, and a sub-daily
 * expression fails at DEPLOY time rather than at runtime. Timing is ±59 minutes.
 *
 * So an expired session's rows can survive up to about twenty-five hours past
 * their expiry. That is harmless, and it is worth writing down why rather than
 * rediscovering it: `resolveSession` refuses an expired row on sight, so a
 * lingering account is unreachable by anyone including the visitor who created
 * it; and `decideProvisioning` counts only sessions whose expiry is still in the
 * future, so a backlog cannot fill the concurrency cap and lock out new
 * visitors. What lingers is disk, bounded by a day of provisioning.
 *
 * On Pro this becomes `0 * * * *` and nothing here changes.
 */

/**
 * Vercel's ceiling on a Hobby function, claimed explicitly.
 *
 * The reaper deletes in batches and commits each one, so a run that is cut off
 * has still done most of its work and the next run continues — but a job that is
 * cut off every time is one that never catches up. Sixty seconds is far more
 * than `REAP_LIMITS` can spend, so the two together mean the batching bound is
 * what stops a run, not the platform.
 */
export const maxDuration = 60;

export async function GET(request: Request): Promise<Response> {
  // Reads the environment BEFORE the header, so a deployment with no secret
  // configured throws instead of comparing against nothing. `isAuthorizedCron`
  // refuses an empty secret as well; this is the loud half of that pair.
  const secret = cronSecret();

  if (!isAuthorizedCron(request.headers.get("authorization"), secret)) {
    // No body worth reading, no header naming what was wrong, and nothing
    // logged. A caller who cannot present the token learns only that.
    return new Response("Unauthorized", { status: 401 });
  }

  try {
    const reaped = await reapExpiredDemos(new Date());

    // Reported rather than merely returned. This is the one route in the app
    // with no human on the other end, so its log line IS its user interface —
    // and `complete: false` is the only signal that a day's provisioning has
    // outgrown a single run's budget.
    console.info("Reaped expired demo sessions.", reaped);

    return Response.json(reaped, {
      status: 200,
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    // The shape the export routes use: name the failure for whoever runs the
    // app, and tell the caller only that it failed. A failed run needs no
    // recovery of its own — the rows it did not delete are still expired, and
    // tomorrow's run does this run's work as well as its own.
    console.error("Could not reap expired demo sessions.", error);

    return new Response("Reaping failed", { status: 500 });
  }
}
