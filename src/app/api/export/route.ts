import { redirect } from "next/navigation";

import { getSession } from "@/lib/auth/session";
import { loadExport } from "@/lib/db/queries/export";
import { buildExport, exportFilename } from "@/lib/export";

/**
 * `GET /api/export` — the whole account as a dated JSON file. FUEL-37, PRD § P6.
 *
 * Thin, like every page in this app: the read is `lib/db/queries/export.ts`,
 * the document is `lib/export.ts`, and what happens here is the auth check, the
 * clock, and the headers.
 *
 * ## Why this is a route handler and not the Server Action the ticket names
 *
 * FUEL-37 puts the location at `app/actions/export.ts`. It is a route handler
 * instead, and the deciding criterion is the ticket's own: "downloads directly
 * on both mobile and desktop browsers".
 *
 * A Server Action can only hand the browser a STRING. Turning that into a file
 * means the client building a `Blob`, minting an object URL, and clicking a
 * synthetic anchor — which needs JavaScript, copies the whole document a second
 * time in memory, and is the least reliable download path on iOS Safari, the
 * half of "mobile and desktop" most likely to fail. A response carrying
 * `Content-Disposition: attachment` is the browser's own download mechanism on
 * every platform, and the link that triggers it is an ordinary `<a>`.
 *
 * It also puts the FILENAME on the server, which matters more than it sounds.
 * P6 wants the name dated, and the only correct date is today in the user's own
 * zone — `todayIn(profile.timezone)`, the rule `resolve-now.ts`, `today.ts` and
 * every screen here keep. A client naming the file would read the browser's
 * clock, and a backup dated tomorrow is a backup filed in the wrong place.
 *
 * A knowing deviation from the ticket, recorded here rather than left to be
 * rediscovered — the same treatment FUEL-35 gave drawing its own chart instead
 * of taking the PRD's Recharts row.
 *
 * ## Why `api/` rather than `/export`
 *
 * A route handler and a page cannot occupy one segment. P6's other half —
 * FUEL-38's weekly CSV, with a week to choose — may well want `/export` to be a
 * screen. Spending that URL on a machine endpoint now would be a decision made
 * by accident, so the endpoint sits under `api/` and the human-facing route
 * stays free.
 *
 * ## The two headers that are not obvious
 *
 * `Cache-Control: no-store` because this response is one person's entire
 * history, returned on the strength of a cookie, from an app deployed behind a
 * CDN. Nothing in the current configuration caches it — GET route handlers are
 * uncached by default in this version of Next, and reading `cookies()` makes
 * the route dynamic regardless. That is exactly why the header is written down:
 * the protection today is a default and an implementation detail, and a future
 * edge configuration that cached by URL would serve one visitor's export to the
 * next. An explicit `no-store` is a decision rather than a coincidence.
 *
 * `Content-Disposition` carries the filename in quotes. Every character in it
 * comes from `exportFilename` — a fixed stem and a `YYYY-MM-DD` from
 * `todayIn`, which is built from the date's own parts — so there is no path by
 * which user input reaches this header and no header injection to guard.
 */

/**
 * The whole account, or a refusal.
 *
 * Two refusals, and they are different states rather than one:
 *
 *   - **No session** redirects to `/login`, which is what every page in this
 *     app answers and the right answer here because this URL is reached by
 *     clicking a link in a browser rather than by a fetch. An unauthenticated
 *     visitor lands on the sign-in screen, not on a JSON error they cannot read.
 *   - **No profile row** is 404. The user exists but has never been set up, so
 *     there is no timezone, no date, and nothing to name a file with. Defensive
 *     rather than reachable: `/settings` only offers the link once a profile
 *     exists.
 *
 * The auth check is here rather than in a layout, for the reason every page in
 * this app states: a check in a layout does not stop a nested segment running,
 * so it belongs next to the data. `loadExport` is the next line and is scoped
 * to the session's own user.
 */
export async function GET(): Promise<Response> {
  const session = await getSession();

  if (!session) redirect("/login");

  try {
    // The clock is read ONCE, here, and handed to both readers of it — so the
    // date naming the file and the instant stamped inside it are the same
    // moment rather than two moments a query apart. Nothing below this line
    // reads a clock, which is what the arrangement is for.
    const now = new Date();
    const payload = await loadExport(session.userId, now);

    if (!payload) return new Response("Not found", { status: 404 });

    const document = buildExport({
      account: payload.account,
      exportedAt: now,
      tables: payload.tables,
    });

    // Two-space indent: this file is something a person opens, and P6's second
    // reader is a nutrition assistant rather than a program. The cost is bytes
    // on a document measured in tens of kilobytes.
    const body = JSON.stringify(document, null, 2);

    return new Response(body, {
      status: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="${exportFilename(payload.today)}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    // The shape every Server Action in this app already uses: name the failure
    // for whoever runs it, and tell the caller only that it failed.
    //
    // It matters more here than in an action, because of what a FAILED download
    // looks like. Without this, an unreachable database surfaces as the
    // framework's own 500 page — which the browser will happily save, under the
    // name in the header, as a file called `fuel-form-<date>.json` containing
    // HTML. A backup that is silently an error page is worse than no backup,
    // and the person who needs it will not find out until a restore.
    //
    // `redirect()` deliberately sits OUTSIDE this block. It works by throwing,
    // so catching it here would swallow the sign-in redirect and answer 500 to
    // every signed-out visitor. Keeping it above the `try` is why this needs no
    // rethrow helper and no import from Next's internals.
    console.error("Could not build the export.", error);

    return new Response("Export failed", { status: 500 });
  }
}
