import { redirect } from "next/navigation";

import { getSession } from "@/lib/auth/session";
import { loadWeekExport } from "@/lib/db/queries/week-export";
import { buildWeekCsv, weekExportFilename } from "@/lib/export-week";
import { requestedWeek } from "@/lib/week-param";

/**
 * `GET /api/export/week?week=YYYY-MM-DD` — one week as a dated CSV. FUEL-38,
 * PRD § P6.
 *
 * Thin, like its JSON sibling and like every page here: the read is
 * `lib/db/queries/week-export.ts`, the document is `lib/export-week.ts`, and
 * what happens in this file is the auth check, the week the URL asks for, the
 * clock, and the headers.
 *
 * ## Why a route handler, and why `api/`
 *
 * `app/api/export/route.ts` argues both at length and neither argument changes
 * for a week's worth of rows: a Server Action can only hand the browser a
 * string, so turning one into a download needs a `Blob`, an object URL and a
 * synthetic click — the least reliable path on iOS Safari, which is half of the
 * ticket's "downloads on both mobile and desktop". A response carrying
 * `Content-Disposition: attachment` is the browser's own mechanism everywhere,
 * and the link that triggers it is an ordinary `<a>`.
 *
 * It also keeps the FILENAME on the server, where the week is already known.
 *
 * The endpoint sits under `api/` beside the JSON one, which leaves `/export`
 * free — the reason that comment gave for putting the first endpoint there.
 * FUEL-38 turned out not to need a screen at all: `/plan` already selects a
 * week, so the download is a link on the page that is showing one, and a second
 * week picker was never built.
 *
 * ## `?week=` is the same parameter `/plan` reads
 *
 * Through `requestedWeek`, the one that page uses, so a URL cannot name one
 * week to the grid and another to the file it downloads. A malformed or
 * repeated value is `null`, which is the current week — never a 500, because
 * this is a query parameter a stranger controls.
 *
 * ## The three headers
 *
 * `text/csv; charset=utf-8` — declared rather than left to be sniffed, and the
 * charset is why `lib/csv.ts` writes no byte-order mark.
 *
 * `Content-Disposition` with the filename in quotes. Every character in it
 * comes from `weekExportFilename`: a fixed stem and a `YYYY-MM-DD` produced by
 * `startOfWeek` from a date `parseCalendarDate` has already validated. No user
 * input reaches this header, so there is no header injection to guard.
 *
 * `Cache-Control: no-store`, for the reason the JSON route states: this is one
 * person's week, returned on the strength of a cookie, from an app behind a
 * CDN. Nothing in the current configuration caches it — reading `cookies()`
 * makes the route dynamic — which is exactly why the header is written down:
 * the protection today is a default, and a future edge configuration that
 * cached by URL would serve one visitor's export to the next.
 */

/**
 * One week, or a refusal.
 *
 * Two refusals, and they are different states rather than one — the same pair
 * the JSON export answers:
 *
 *   - **No session** redirects to `/login`. This URL is reached by clicking a
 *     link in a browser, so an unauthenticated visitor should land on the
 *     sign-in screen rather than on an error they cannot read.
 *   - **No profile row** is 404. The user exists but has never been set up, so
 *     there is no timezone, no week, and nothing to name a file with.
 *     Defensive rather than reachable: `/plan` renders an empty state instead
 *     of the link in that case.
 *
 * The auth check is here rather than in a layout, for the reason every page in
 * this app gives: a check in a layout does not stop a nested segment running,
 * so it belongs next to the data. `loadWeekExport` is the next line and is
 * scoped to the session's own user.
 */
export async function GET(request: Request): Promise<Response> {
  const session = await getSession();

  if (!session) redirect("/login");

  try {
    // `getAll`, not `get`: a repeated parameter is a URL saying two different
    // things, and `requestedWeek` refuses an array rather than picking one of
    // its values. A single value is unwrapped so it reaches the same reading
    // `/plan` gives it, and no parameter at all arrives as an empty array —
    // which is not a string, and so is the current week.
    const values = new URL(request.url).searchParams.getAll("week");
    const week = requestedWeek(values.length === 1 ? values[0] : values);

    // The clock is read ONCE, here, and handed down — so the week a missing
    // `?week=` resolves to and the instant stamped in the file are the same
    // moment rather than two moments a query apart. Nothing below this line
    // reads a clock, which is what the arrangement is for.
    const payload = await loadWeekExport(session.userId, new Date(), week);

    if (!payload) return new Response("Not found", { status: 404 });

    return new Response(buildWeekCsv(payload.input), {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${weekExportFilename(payload.monday)}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    // What a FAILED download looks like is why this block exists. Without it an
    // unreachable database surfaces as the framework's 500 page — which the
    // browser saves, under the name in the header, as a `.csv` file full of
    // HTML. A check-in that is silently an error page is worse than a missing
    // one, and nobody finds out until the file is opened.
    //
    // `redirect()` sits OUTSIDE this block deliberately. It works by throwing,
    // so catching it here would swallow the sign-in redirect and answer 500 to
    // every signed-out visitor.
    console.error("Could not build the weekly export.", error);

    return new Response("Export failed", { status: 500 });
  }
}
