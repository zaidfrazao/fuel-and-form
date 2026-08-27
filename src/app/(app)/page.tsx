import { redirect } from "next/navigation";

import { PageMain } from "@/components/page-main";
import { RightNow } from "@/components/right-now";
import { getSession } from "@/lib/auth/session";
import { readCursor } from "@/lib/cursor-cookie";
import { dayLog } from "@/lib/day-summary";
import { loadToday } from "@/lib/db/queries/today";
import { walkEntries, walkWorkoutIds } from "@/lib/walk";

/**
 * `/` — the "Right Now" view. PRD § P1.
 *
 * Deliberately thin. The fetch is `lib/db/queries/today.ts`, the render is
 * `components/right-now.tsx`, and this file is the wire between them plus the
 * one thing neither of them can do: read the request. What arithmetic there is
 * belongs to `lib/day-summary.ts`; what happens here is choosing which of the
 * fetched fields the browser is allowed to see.
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
      <PageMain className="justify-center gap-2">
        <h1 className="text-title text-text-primary">No plan yet</h1>
        <p className="text-body text-text-secondary">
          Today&rsquo;s meals and sessions appear here once a profile and a weekly plan
          exist for this account.
        </p>
      </PageMain>
    );
  }

  const { view, profile } = today;

  return (
    <RightNow
      view={view}
      exercises={today.exercises}
      // The day's log, turned into lines here rather than in the browser: the
      // rows carry a note, an instant and a set of ids, and the summary shows a
      // name and a status. What crosses is the answer.
      entries={dayLog(
        [...view.timeline, ...view.anytime],
        today.logs,
        // Which lines belong to the walk's own row rather than to the action
        // bar — the same set `actions/log.ts` narrows the undo stack with, so
        // the control offered here and the row taken back there agree.
        walkWorkoutIds(view.anytime),
      )}
      // What is recorded against each of today's walks, by template entry —
      // FUEL-29. The duration is the only field a row draws: the status is
      // always 'done' (a walk that did not happen has no row), and the id, the
      // instant and the note stay on the server like every other log's do.
      walks={walkEntries(view.anytime, today.logs.workouts)}
      // The four target figures, named one at a time rather than by handing over
      // the profile row. Everything else on it is a body metric — height, start
      // and target weight, goal pace — and this screen shows none of them, so
      // none of them belong in a payload the browser can read.
      target={{
        targetKcal: profile.targetKcal,
        targetProteinG: profile.targetProteinG,
        targetFatG: profile.targetFatG,
        targetCarbG: profile.targetCarbG,
      }}
      // The swap's candidates, column by column rather than as rows (FUEL-23).
      // `method` and `notes` are free text that only meal detail shows, and
      // there is no reason for a recipe's method to sit in the page payload of
      // a screen that never renders it. What crosses is what the picker draws
      // and what the preview totals.
      //
      // WHEN `meals.is_untracked` LANDS (PRD Open Question 4), add it to BOTH
      // narrowings below. `totalMacros` skips untracked meals, so a column
      // dropped here would make the sheet's preview count a meal the day's
      // real totals exclude — and the two would disagree by exactly that meal,
      // silently, with no type error to catch it. `MacroBearing` declares the
      // field optional precisely so this compiles either way, which is what
      // makes the omission invisible.
      meals={today.meals.map((meal) => ({
        id: meal.id,
        name: meal.name,
        slotType: meal.slotType,
        kcal: meal.kcal,
        proteinG: meal.proteinG,
        fatG: meal.fatG,
        carbG: meal.carbG,
        isArchived: meal.isArchived,
      }))}
      // What the template plans today — the "before" every swap note is
      // measured against, and what a revert puts back. Narrowed the same way,
      // and to the same shape the preview uses, so the two halves of a delta
      // are the same kind of thing.
      //
      // The name is here because a revert renders optimistically: the card has
      // to show the meal coming back on the frame the control is tapped, and
      // it cannot name a meal whose name never crossed. The recipe's method and
      // notes still do not.
      templatePlan={today.templatePlan.map((item) => ({
        slot: item.slot,
        meal: {
          id: item.meal.id,
          name: item.meal.name,
          kcal: item.meal.kcal,
          proteinG: item.meal.proteinG,
          fatG: item.meal.fatG,
          carbG: item.meal.carbG,
        },
      }))}
    />
  );
}
