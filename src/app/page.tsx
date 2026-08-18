import { redirect } from "next/navigation";

import { RightNow } from "@/components/right-now";
import { getSession } from "@/lib/auth/session";
import { readCursor } from "@/lib/cursor-cookie";
import { loadToday } from "@/lib/db/queries/today";
import { logCount } from "@/lib/log-intent";

/**
 * `/` — the "Right Now" view. PRD § P1.
 *
 * Deliberately eight lines of logic. The fetch is `lib/db/queries/today.ts`, the render is
 * `components/right-now.tsx`, and this file is the wire between them plus the
 * one thing neither of them can do: read the request.
 *
 * ## Why the clock is read here
 *
 * `new Date()` appears once in the whole of P1, and it is this line. Everything
 * below takes the instant as an argument — `loadToday`, `resolveNow`, the
 * ruler's `now` — precisely so that the answer is reproducible everywhere else.
 * The request is the only thing that genuinely knows what time it is.
 *
 * ## No spinner, by construction
 *
 * The page reads cookies, so it renders per request; there is no client fetch
 * on the way to the first paint and nothing to spin over. `loading.tsx` covers
 * the streaming gap with a skeleton matching this layout — Brand Guide §
 * Feedback: "no spinner on `/` ever".
 *
 * ## The auth check is here rather than in a layout
 *
 * `login/page.tsx` explains the reasoning from the other side: a check in a
 * layout does not stop nested segments or Server Actions from running, so it
 * belongs next to the data. This is next to the data — `loadToday` is the first
 * thing after it, and every read inside it is scoped to the session's user.
 */
export default async function Home() {
  const session = await getSession();

  if (!session) redirect("/login");

  // The manual advance so far. A cookie rather than client state, because the
  // guarantee attached to a tap is that the view "is never wrong for longer than
  // one tap" — which has to survive the phone being locked. `resolveNow` ignores
  // one set on another date, so nothing here has to decide whether it is stale.
  const today = await loadToday(session.userId, new Date(), await readCursor());

  // No profile row: the user exists but has not been set up, so there is no
  // timezone and therefore no day to resolve. An ordinary state before the seed
  // script has run, and § Tone of Voice asks an empty state to describe what
  // will appear rather than nudge.
  if (!today) {
    return (
      <main className="mx-auto flex min-h-dvh w-full max-w-[640px] flex-col justify-center gap-2 px-[22px] md:px-7">
        <h1 className="text-title text-text-primary">No plan yet</h1>
        <p className="text-body text-text-secondary">
          Today&rsquo;s meals and sessions appear here once a profile and a weekly plan
          exist for this account.
        </p>
      </main>
    );
  }

  return (
    <RightNow
      view={today.view}
      exercises={today.exercises}
      logged={logCount(today.logs)}
    />
  );
}
