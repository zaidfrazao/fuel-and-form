import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { PageMain } from "@/components/page-main";
import { WeighIns, type WeighInRow } from "@/components/weigh-ins";
import { getSession } from "@/lib/auth/session";
import { loadWeighIns } from "@/lib/db/queries/weight";
import type { WeightLog } from "@/lib/db/schema";

/**
 * `/weight` — the weigh-in history, and the form that writes it. PRD § P5,
 * FUEL-34.
 *
 * Thin, like `/`, `/plan`, `/training` and `/settings`: the fetch is
 * `lib/db/queries/weight.ts`, the refusals are `lib/weigh-in.ts`, the render is
 * `components/weigh-ins.tsx`. What happens here is the auth check and the
 * narrowing.
 *
 * ## No date in the URL, unlike `/training` and `/plan`
 *
 * Both of those are addressed by a date because they show ONE date — "past
 * sessions are viewable and editable by date" is a criterion about navigation,
 * so the date is a place and belongs where the back button works.
 *
 * This screen shows the whole history at once. There is no date to navigate to,
 * because every date is already on the page; the date input inside the form is
 * an argument to a write, not a route. FUEL-35's chart lands on this same
 * screen and reads the same list, which is the other half of the reason: a
 * per-date route would render a chart of one point.
 *
 * ## The auth check is here rather than in a layout
 *
 * The reasoning every other page in this app sets out: a check in a layout does
 * not stop nested segments or Server Actions from running, so it belongs next to
 * the data. `loadWeighIns` is the next line and is scoped to the session's user;
 * the two Server Actions behind the screen resolve the session again for
 * themselves, because they are separately reachable.
 */

export const metadata: Metadata = {
  title: "Weight · Fuel & Form",
  robots: { index: false, follow: false },
};

/**
 * One weigh-in, narrowed to what the browser is allowed to hold.
 *
 * `id` and `user_id` do not cross, and neither does `created_at`. The same rule
 * `/` , `/plan` and `/training` apply, and here it is more than hygiene: the
 * row's ADDRESS is its date — `weight_logs` is unique on `(user_id, date)` and
 * every write names a date — so an id in the payload would be an identifier the
 * client could hold, send back, and have ignored. A field that looks like it
 * addresses something but does not is worse than one that is absent.
 *
 * `created_at` stays behind because nothing draws it. It says when the row was
 * first written, which on a corrected weigh-in is not when the measurement was
 * taken, and a date beside a date is a question the screen would have to answer.
 */
function narrow(entry: WeightLog): WeighInRow {
  return { date: entry.date, weightKg: entry.weightKg, note: entry.note };
}

export default async function WeightPage() {
  const session = await getSession();

  if (!session) redirect("/login");

  // The clock is read once, here. Everything below takes the instant as an
  // argument — the arrangement every screen in this app keeps, and the reason
  // the date a test asks for is the date it gets.
  const history = await loadWeighIns(session.userId, new Date());

  // No profile row: the user exists but has not been set up, so there is no
  // timezone and therefore no "today" to default the form to or to refuse a
  // future date against. § Tone of Voice asks an empty state to describe what
  // will appear rather than nudge.
  if (!history) {
    return (
      <PageMain className="justify-center gap-2">
        <h1 className="text-title text-text-primary">No weigh-ins yet</h1>
        <p className="text-body text-text-secondary">
          Weigh-ins appear here once a profile exists for this account.
        </p>
      </PageMain>
    );
  }

  return (
    <WeighIns
      today={history.today}
      entries={history.entries.map(narrow)}
      // The two figures FUEL-35's chart rules against. They are body metrics
      // rather than logs, so unlike `narrow` above there is nothing to strip:
      // the whole of each is what the reference line is.
      startWeightKg={history.startWeightKg}
      targetWeightKg={history.targetWeightKg}
      // FUEL-36's goal pace, on the same footing as the two above and for the
      // same reason: it is this user's configuration, not the app's. The
      // trailing rate is measured against it, so a figure written into a
      // component would judge a visitor's demo history against the owner's
      // program.
      goalPaceKgPerWeek={history.goalPaceKgPerWeek}
    />
  );
}
