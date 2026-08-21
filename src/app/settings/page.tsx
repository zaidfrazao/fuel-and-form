import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { getSession } from "@/lib/auth/session";
import { loadSchedule } from "@/lib/db/queries/profile";
import { scheduleFields } from "@/lib/slot-times";
import { SlotTimesForm } from "./slot-times-form";

/**
 * `/settings` — the slot times, editable. PRD § P1's last acceptance criterion.
 *
 * Thin, like `/`: the fetch is `lib/db/queries/profile.ts`, the render is the
 * form beside this file, and the mapping from stored values to field values is
 * `scheduleFields`. What happens here is the auth check and the wiring.
 *
 * ## The auth check is here rather than in a layout
 *
 * The reasoning `page.tsx` and `login/page.tsx` both set out: a check in a
 * layout does not stop nested segments or Server Actions from running, so it
 * belongs next to the data. `loadSchedule` is the next line, and it is scoped to
 * the session's user. The Server Action behind the form resolves the session
 * again for itself, because it is separately reachable.
 */

export const metadata: Metadata = {
  title: "Settings · Fuel & Form",
  robots: { index: false, follow: false },
};

export default async function SettingsPage() {
  const session = await getSession();

  if (!session) redirect("/login");

  const schedule = await loadSchedule(session.userId);

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[640px] flex-col gap-7 px-[22px] py-8 md:px-7">
      <header className="flex flex-col gap-2">
        <Link href="/" className="text-label text-text-secondary underline decoration-text-tertiary underline-offset-4">
          Right Now
        </Link>
        <h1 className="text-title text-text-primary">Settings</h1>
      </header>

      {/* No profile row: the same ordinary state `/` renders, and for the same
          reason — a user exists before the seed script sets one up. § Tone of
          Voice asks an empty state to describe what will appear. Settings
          cannot create one: a profile carries height, weight and macro targets
          it has no values for. */}
      {schedule ? (
        <SlotTimesForm values={scheduleFields(schedule)} timezone={schedule.timezone} />
      ) : (
        <p className="text-body text-text-secondary">
          Slot times appear here once a profile exists for this account.
        </p>
      )}

      {/*
       * The way to the template editor — FUEL-25's "reachable but distinct from
       * swapping".
       *
       * Here rather than on `/`, and that is the whole point. `/`'s bottom third
       * is the swap flow: Log eaten, Swap, Skip, and the sheet they open write
       * dated overrides. A link to the screen that rewrites every future week,
       * sitting among them, would put the two decisions one mis-tap apart —
       * which is the thing the criterion rules out.
       *
       * Settings is where the app already keeps the things that are true until
       * changed, which is exactly what a template is. It costs one extra tap,
       * and § Navigation's two-level depth allows it.
       *
       * FUEL-28's weekly grid now has one, below. From a grid the distinction
       * is visible — a cell is a date, the template is not — in a way it is not
       * from a single card, so the two sit together here with a sentence each
       * saying which table they write.
       */}
      <section className="flex flex-col gap-2 border-t border-border pt-5">
        <Link
          href="/plan/template"
          className="text-body text-text-primary underline decoration-text-tertiary underline-offset-4"
        >
          Weekly template
        </Link>
        <p className="text-slash text-text-secondary">
          What recurs each week, before any swaps. Editing it changes every
          future week; swapping a meal does not.
        </p>

        <Link
          href="/plan"
          className="pt-3 text-body text-text-primary underline decoration-text-tertiary underline-offset-4"
        >
          Weekly plan
        </Link>
        <p className="text-slash text-text-secondary">
          The seven days as they are actually planned, week by week. Changing a
          meal there affects that date only.
        </p>
      </section>

      {/*
       * The export — FUEL-37, P6.
       *
       * A plain anchor rather than a `next/link`, and that is the point. `Link`
       * intercepts the click and navigates the router, which for a response
       * carrying `Content-Disposition: attachment` is the wrong verb entirely:
       * there is no page to navigate to. A bare `<a>` lets the browser do what
       * it already knows how to do with an attachment, on every platform, with
       * no JavaScript involved.
       *
       * `download` is deliberately NOT set. The attribute would let the browser
       * name the file from the URL's last segment — "export" — while the server
       * is already naming it `fuel-form-<date>.json` in the header. The header
       * wins in every current browser, but two sources for one filename is one
       * more than can be right, and the server's is the one with the user's own
       * date in it.
       *
       * Inside the profile gate, because the route answers 404 without one: no
       * timezone, so no date to name a file with. A link that reliably fails is
       * worse than no link.
       */}
      {schedule && (
        <section className="flex flex-col gap-2 border-t border-border pt-5">
          <a
            href="/api/export"
            className="text-body text-text-primary underline decoration-text-tertiary underline-offset-4"
          >
            Export everything
          </a>
          <p className="text-slash text-text-secondary">
            One dated JSON file holding every weigh-in, session, meal log and
            swap, plus the plan they refer to. Your backup, and the file your
            check-in reads.
          </p>
        </section>
      )}
    </main>
  );
}
