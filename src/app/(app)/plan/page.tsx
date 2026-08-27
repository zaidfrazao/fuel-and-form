import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { UpLink } from "@/components/up-link";
import { WeekGrid } from "@/components/week-grid";
import { WeekNav } from "@/components/week-nav";
import { getSession } from "@/lib/auth/session";
import { type CalendarDate, startOfWeek } from "@/lib/date";
import { loadWeek } from "@/lib/db/queries/week";
import type { Meal } from "@/lib/db/schema";
import { weekLabel } from "@/lib/now-display";
import { requestedWeek } from "@/lib/week-param";

/**
 * `/plan` — the weekly grid. PRD § P2, and FUEL-28.
 *
 * Thin, like `/`, `/settings` and `/plan/template`: the fetch is
 * `lib/db/queries/week.ts`, the shaping is `lib/week-grid.ts`, the render is
 * `components/week-grid.tsx`. What happens here is the auth check, the week the
 * URL asks for, and the narrowing.
 *
 * ## Why the week lives in the URL
 *
 * `/` holds its cursor in a COOKIE, and `lib/cursor.ts` argues why: the promise
 * attached to a tap is that the view "is never wrong for longer than one tap",
 * which has to survive the phone being locked, and a view position in a URL
 * could be shared or bookmarked wrong.
 *
 * This is the opposite case and takes the opposite answer. A week is a place
 * rather than a position in today — moving between weeks is navigation, so it
 * should work with the browser's back button, and prev/next as `<Link>`s means
 * the next week is prefetched and the grid needs no client state to move at
 * all. A bookmarked week is a feature here, not a hazard: it names seven
 * specific dates and means the same thing whenever it is opened.
 *
 * ## A bad `?week=` renders this week rather than failing
 *
 * `requestedWeek` decides that, and states why. It lives in `lib/week-param.ts`
 * rather than here because FUEL-38's `/api/export/week` reads the same
 * parameter: the screen and the file it downloads have to agree about which
 * seven days a URL names, and one function is how that is guaranteed.
 *
 * ## The CSV link is an `<a>`, and it carries the week being shown
 *
 * P6's weekly export, FUEL-38. It is here rather than on a screen of its own
 * because the week is already chosen — by the prev/next links above it — and a
 * second picker somewhere else would be a second thing to keep in step with
 * this one. A plain anchor rather than a `<Link>`, for `/settings`' reason: the
 * response carries `Content-Disposition: attachment`, so there is no page to
 * navigate to and the browser's own download is the right mechanism.
 *
 * The `week` is written into the href explicitly, including on the current
 * week, so the link says which seven days it will produce rather than
 * depending on the server resolving "now" to the same week the grid is showing.
 *
 * ## The auth check is here rather than in a layout
 *
 * The reasoning `page.tsx`, `login/page.tsx` and `plan/template/page.tsx` all
 * set out: a check in a layout does not stop nested segments or Server Actions
 * from running, so it belongs next to the data. `loadWeek` is the next line and
 * is scoped to the session's user; the three Server Actions behind the grid
 * resolve the session again for themselves, because they are separately
 * reachable.
 */

export const metadata: Metadata = {
  title: "Weekly plan · Fuel & Form",
  robots: { index: false, follow: false },
};

/**
 * The week being shown, as a file — P6's check-in export.
 *
 * The accessible name names the WEEK rather than saying "download this week",
 * because the visible label is read after a navigation that changed which week
 * "this" refers to, and a control whose name depends on unspoken context is one
 * a screen-reader user has to go and check.
 *
 * Outside the `<nav>` above deliberately: downloading a file is not moving
 * between weeks, and putting it in the landmark would offer it as a third
 * destination to anyone navigating by landmark.
 */
function WeekDownload({ monday }: { monday: CalendarDate }) {
  return (
    <a
      href={`/api/export/week?week=${monday}`}
      aria-label={`Download ${weekLabel(monday)} as CSV`}
      className="text-micro uppercase text-text-secondary underline decoration-text-tertiary underline-offset-4"
    >
      Download this week (CSV)
    </a>
  );
}

/**
 * The meal fields that cross to the browser.
 *
 * `method` and `notes` are the ones deliberately left behind: they are free
 * text a recipe screen renders and this table does not, and a page payload is
 * not the place to ship a kitchen's worth of prose for seven days of meal
 * names. `app/page.tsx` and `plan/template/page.tsx` narrow theirs the same way
 * and for the same reason.
 *
 * The four macros DO cross, unlike the template editor's two, because the swap
 * sheet totals the day against target before a confirm — that preview is the
 * question the sheet exists to answer, and it cannot be computed from kcal and
 * protein alone.
 */
const narrow = (meal: Meal) => ({
  id: meal.id,
  name: meal.name,
  slotType: meal.slotType,
  kcal: meal.kcal,
  proteinG: meal.proteinG,
  fatG: meal.fatG,
  carbG: meal.carbG,
  isArchived: meal.isArchived,
});

export default async function PlanPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const session = await getSession();

  if (!session) redirect("/login");

  const { week } = await searchParams;

  // The clock is read once, here. Everything below takes the instant as an
  // argument — the same arrangement `app/page.tsx` keeps for `/`, and the
  // reason the week a test asks for is the week it gets.
  const plan = await loadWeek(session.userId, new Date(), requestedWeek(week));

  // No profile row: the user exists but has not been set up, so there is no
  // timezone and therefore no week to be in. § Tone of Voice asks an empty
  // state to describe what will appear rather than nudge.
  if (!plan) {
    return (
      <main className="mx-auto flex w-full min-w-0 flex-1 max-w-[640px] flex-col justify-center gap-2 px-[22px] md:px-7">
        <h1 className="text-title text-text-primary">No plan yet</h1>
        <p className="text-body text-text-secondary">
          The weekly plan appears here once a profile and a weekly template exist
          for this account.
        </p>
      </main>
    );
  }

  // Whether the grid is showing some week other than the one containing today.
  // `startOfWeek` decides, rather than a comparison against the seven dates, so
  // this and `loadWeek` cannot come to different conclusions about where a week
  // begins.
  const elsewhere = startOfWeek(plan.today) !== plan.monday;

  return (
    // 1024px, not 640px — § Spacing: "max content width: 640px single-column;
    // 1024px for the week grid".
    <main className="mx-auto flex w-full min-w-0 flex-1 max-w-[1024px] flex-col gap-7 px-[22px] py-8 md:px-7">
      <header className="flex flex-col gap-2">
        {/*
         * No `week` — the parent is `/`, which takes no `searchParams` and has
         * no week to be on. The grid's own `?week=` is carried by `WeekNav`
         * below and by the "Back to this week" reset at the foot.
         */}
        <UpLink pathname="/plan" />
        <h1 className="text-title text-text-primary">Weekly plan</h1>
        {/*
         * What a tap on this screen does, before anything is tapped — the
         * mirror of the sentence `/plan/template` opens with, and the same
         * § Tone of Voice reasoning. The two screens write different tables and
         * the difference is the whole of P2, so each says which one it is.
         */}
        <p className="text-body text-text-secondary">
          What you are eating this week. Changing a meal here affects that date
          only — the weekly template is unchanged.
        </p>
      </header>

      <div className="flex flex-col items-center gap-2">
        <WeekNav monday={plan.monday} basePath="/plan" />
        <WeekDownload monday={plan.monday} />
      </div>

      {/* No meals: nothing can be planned, and the grid would open a picker with
          nothing in it. § Tone of Voice again — describe what will appear. */}
      {plan.meals.length > 0 ? (
        <WeekGrid
          today={plan.today}
          // Narrowed as `app/page.tsx` and `plan/template/page.tsx` narrow
          // theirs: `method` and `notes` are free text this screen never
          // renders, and there is no reason for a recipe's method to sit in the
          // page payload of a table showing meal names. What crosses is what
          // the cells draw, what the picker's tiles need, and the four macros
          // the swap preview totals.
          days={plan.days.map((day) => ({
            date: day.date,
            meals: day.meals.map(({ slot, meal, source, entryId }) => ({
              slot,
              source,
              entryId,
              meal: narrow(meal),
            })),
          }))}
          templateDays={plan.templateDays.map((day) => ({
            date: day.date,
            meals: day.meals.map(({ slot, meal, source, entryId }) => ({
              slot,
              source,
              entryId,
              meal: narrow(meal),
            })),
          }))}
          meals={plan.meals.map(narrow)}
          target={{
            targetKcal: plan.profile.targetKcal,
            targetProteinG: plan.profile.targetProteinG,
            targetFatG: plan.profile.targetFatG,
            targetCarbG: plan.profile.targetCarbG,
          }}
        />
      ) : (
        <p className="text-body text-text-secondary">
          The weekly plan appears here once there are meals in the library to
          plan with.
        </p>
      )}

      {elsewhere && (
        <p className="text-slash text-text-secondary">
          <Link href="/plan" className="underline decoration-text-tertiary underline-offset-4">
            Back to this week
          </Link>
        </p>
      )}

      <div className="flex flex-col gap-2">
        {/*
         * Carries the week being shown, so the list is for the seven days on
         * screen rather than for whichever week the server resolves "now" to.
         * The download link above takes the same care, and for the same reason.
         */}
        <Link
          href={`/shopping?week=${plan.monday}`}
          className="text-micro uppercase text-text-secondary underline decoration-text-tertiary underline-offset-4"
        >
          Shopping list for this week
        </Link>

        <Link
          href="/plan/template"
          className="text-micro uppercase text-text-secondary underline decoration-text-tertiary underline-offset-4"
        >
          Edit the weekly template
        </Link>
      </div>
    </main>
  );
}
