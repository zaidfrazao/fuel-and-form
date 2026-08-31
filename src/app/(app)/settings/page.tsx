import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { PageMain } from "@/components/page-main";
import { UpLink } from "@/components/up-link";
import { getSession } from "@/lib/auth/session";
import { loadSchedule } from "@/lib/db/queries/profile";
import { PAGE_COLUMN_BASE, PAGE_FRAME_GRID } from "@/lib/frame";
import { FOCUS_RING, HOVER_LINK } from "@/lib/pointer";
import { scheduleFields } from "@/lib/slot-times";
import { cn } from "@/lib/utils";
import { PushForm } from "./push-form";
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
    <PageMain className={cn("gap-7 py-8", PAGE_FRAME_GRID, "xl:grid-rows-1")}>
      {/*
       * The form, and the utilities beside it — § Desktop, amended by FUEL-85,
       * and FUEL-78's half of it.
       *
       * Two different kinds of thing were stacked in one column, and the
       * section names them: slot times, the walk reminder and Save are "a form
       * you fill in and take the measure"; notify, the template link, the plan
       * link and the export are "links you follow and take the aside, each
       * keeping its sentence of explanation".
       *
       * The DOM does not move to do it. The two kinds were already contiguous
       * — the form is the first two children and every link is one of the rest
       * — so the wrappers are drawn around runs that were already runs, and
       * below the cap `contents` dissolves them back into the one flex column
       * the phone has always had.
       *
       * A section index beside a panel was the alternative and § Desktop
       * rejects it by name: "six short groups do not need navigation to reach,
       * and hiding them behind it would be a desktop convention applied for its
       * own sake".
       */}
      <div
        className={cn(PAGE_COLUMN_BASE, "xl:col-start-1 xl:row-start-1 xl:gap-7")}
        data-column="measure"
      >
        <header className="flex flex-col gap-2">
          <UpLink pathname="/settings" />
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
      </div>

      {/*
       * What is not the form. One row, like the measure beside it: this screen
       * has no header band to sit under and no action bar to sit above, so
       * `PAGE_ASIDE_COLUMN`'s row two and its span of two would both be
       * describing a shape that is not here.
       */}
      <div
        className={cn(PAGE_COLUMN_BASE, "xl:col-start-2 xl:row-start-1 xl:gap-7")}
        data-column="aside"
      >
        {/*
         * The walk reminder's push control — FUEL-47, P9's "subscribe from
         * settings".
         *
         * Directly beneath the slot times, and above the template links, because
         * this is the second delivery of the reminder whose TIME is set in the
         * list above it. The links below are about a different subject entirely.
         *
         * ## The key is read here and passed down
         *
         * `NEXT_PUBLIC_VAPID_PUBLIC_KEY` is inlined at build time wherever it is
         * named, so the client component could read it directly. It is read in
         * this server component instead for one reason: absent, there is nothing
         * to subscribe WITH, and the honest thing is for the section not to exist
         * — no heading, no button, no sentence explaining an absence. A client
         * component deciding that for itself would ship the whole control to the
         * browser to render nothing.
         *
         * Not gated on `schedule`, unlike the export below. A subscription needs
         * no profile: it is a row against a user id, and the scheduled job is what
         * needs a timezone — which it checks for itself.
         */}
        {process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY && (
          <PushForm vapidPublicKey={process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY} />
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
            className={`text-body text-text-primary underline decoration-text-tertiary underline-offset-4 ${HOVER_LINK} ${FOCUS_RING}`}
          >
            Weekly template
          </Link>
          <p className="text-slash text-text-secondary">
            What recurs each week, before any swaps. Editing it changes every
            future week; swapping a meal does not.
          </p>

          {/*
           * `Plan`, not `Weekly plan` — FUEL-60. § Navigation's table names this
           * route `Plan`, and the shell and the up-links have called it that
           * since FUEL-58; a third name for it in a link would be the drift that
           * section exists to prevent. The screen's own `<h1>` stays "Weekly
           * plan", which the table allows and the mock's caption for that screen
           * already uses — a heading may say more than the name it maps to.
           *
           * The pairing with `Weekly template` above loses nothing by it. The
           * contrast between the two was never carried by the shared adjective;
           * it is carried by the sentence under each, which says which table the
           * screen writes.
           */}
          <Link
            href="/plan"
            className={`pt-3 text-body text-text-primary underline decoration-text-tertiary underline-offset-4 ${HOVER_LINK} ${FOCUS_RING}`}
          >
            Plan
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
              className={`text-body text-text-primary underline decoration-text-tertiary underline-offset-4 ${HOVER_LINK} ${FOCUS_RING}`}
            >
              Export everything
            </a>
            <p className="text-slash text-text-secondary">
              One dated JSON file holding every weigh-in, session, meal log and
              swap, plus the plan they refer to. Your backup.
            </p>
            {/*
             * The weekly CSV — FUEL-38, the other half of P6.
             *
             * A `Link` and not an `<a>`, unlike the line above it, because this
             * one genuinely navigates: the week has to be chosen before there is
             * a file to download, and `/plan` is where that already happens. The
             * download itself is an anchor on that screen.
             *
             * Named here at all because this is the page a person comes to
             * looking for "export", and an export that exists but is mentioned
             * nowhere they would look is one they will not find.
             *
             * The link sits inside a sentence, so the sentence governs the words
             * around it — but the destination is still named by the table, which
             * is why it reads "open Plan" and not "open the weekly plan".
             */}
            <p className="text-slash text-text-secondary">
              For a check-in, one week as a spreadsheet:{" "}
              <Link
                href="/plan"
                className={`underline decoration-text-tertiary underline-offset-4 ${HOVER_LINK} ${FOCUS_RING}`}
              >
                open Plan
              </Link>{" "}
              and download the week you are looking at.
            </p>
          </section>
        )}
      </div>
    </PageMain>
  );
}
