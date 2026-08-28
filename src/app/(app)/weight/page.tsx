import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { PageMain } from "@/components/page-main";
import { WeighIns } from "@/components/weigh-ins";
import { getSession } from "@/lib/auth/session";
import { loadWeighIns } from "@/lib/db/queries/weight";
import { RECENT_WEIGH_INS, narrowWeighIn } from "@/lib/weigh-in";

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
 * FUEL-84 bounded how much of it is LISTED without changing that. Every date is
 * still on the page — the chart draws each one and tables it for § Accessibility
 * — and what is paged is the rows underneath, which is a quantity of screen
 * rather than a place to be at.
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

  /*
   * Two narrowings of one fetch — FUEL-84, and the place the screen is bounded.
   *
   * `readings` is every weigh-in as a date and a weight, because every one of
   * them is DRAWN: the chart plots them and § Accessibility obliges it to carry
   * "an adjacent data table", which is a row per reading. Cutting this to a
   * window would cut the chart to a window with it.
   *
   * `entries` is the newest `RECENT_WEIGH_INS` of the same rows, and the only
   * ones that carry a `note`. The list is the one thing that renders a note, the
   * list is what was unbounded — 58 rows and 4333px on the demo account, with no
   * ceiling — and a note is `MAX_NOTE_LENGTH`, five hundred characters, against
   * a reading's thirty-odd bytes. So the payload keeps what is rendered and
   * drops what is not, and `actions/weight.ts` hands over the rest a page at a
   * time when the reader asks for it.
   *
   * Both come off one `loadWeighIns`, not two queries. `queries/weight.ts`
   * argues the round trips: a second statement for the same rows on Neon's HTTP
   * driver buys nothing that slicing an array in hand does.
   */
  const readings = history.entries.map((entry) => ({
    date: entry.date,
    weightKg: entry.weightKg,
  }));

  return (
    <WeighIns
      today={history.today}
      entries={history.entries.slice(0, RECENT_WEIGH_INS).map(narrowWeighIn)}
      readings={readings}
      // The two figures FUEL-35's chart rules against. They are body metrics
      // rather than logs, so unlike `narrowWeighIn` there is nothing to strip:
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
