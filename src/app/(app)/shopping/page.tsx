import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { PageMain } from "@/components/page-main";
import { ShoppingListView } from "@/components/shopping-list-view";
import { UpLink } from "@/components/up-link";
import { WeekNav } from "@/components/week-nav";
import { getSession } from "@/lib/auth/session";
import { startOfWeek } from "@/lib/date";
import { loadShoppingWeek } from "@/lib/db/queries/shopping";
import { PAGE_FRAME_SPAN, PAGE_PROSE } from "@/lib/frame";
import { FOCUS_RING, HOVER_LINK } from "@/lib/pointer";
import { cn } from "@/lib/utils";
import { requestedWeek } from "@/lib/week-param";

/**
 * `/shopping` — the week's shopping list. PRD § P8, and FUEL-45.
 *
 * Thin, like every other screen here: the fetch is
 * `lib/db/queries/shopping.ts`, the arithmetic is `lib/shopping-list.ts`, the
 * wording is `lib/shopping-text.ts`, the render is
 * `components/shopping-list-view.tsx`. What happens in this file is the auth
 * check, the week the URL asks for, and the two empty states.
 *
 * ## The week lives in the URL, and it is the same parameter `/plan` reads
 *
 * `requestedWeek` decides what `?week=` means, for the reason it exists at all:
 * three things now read that parameter — the grid, the CSV export and this —
 * and they have to agree about which seven days a URL names. A shopping list
 * for a week other than the one the plan was just being read on would be a
 * quiet, plausible wrong answer.
 *
 * `WeekNav` is shared with `/plan` for the same reason one layer up: the two
 * screens move between weeks with one control rather than two that currently
 * match.
 *
 * ## Nothing is narrowed on the way to the browser
 *
 * `/plan` narrows its meals before sending them, because a page payload is no
 * place for seven days of recipe method. Here there is nothing to narrow:
 * `shoppingList` has already collapsed the ingredient rows into the lines the
 * screen draws, and every field of a `ShoppingLine` is rendered or is the key a
 * tick hangs off. The aggregation IS the narrowing.
 *
 * ## The auth check is here rather than in a layout
 *
 * The reasoning every other page in this app sets out: a check in a layout does
 * not stop nested segments or Server Actions from running, so it belongs next
 * to the data. `loadShoppingWeek` is the next line and is scoped to the
 * session's user; `setChecked` resolves the session again for itself, because
 * it is separately reachable.
 */

export const metadata: Metadata = {
  title: "Shopping list · Fuel & Form",
  robots: { index: false, follow: false },
};

export default async function ShoppingPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const session = await getSession();

  if (!session) redirect("/login");

  const { week } = await searchParams;

  // The clock is read once, here. Everything below takes the instant as an
  // argument — the arrangement every screen in this app keeps, and the reason
  // the week a test asks for is the week it gets.
  const list = await loadShoppingWeek(session.userId, new Date(), requestedWeek(week));

  // No profile row: the user exists but has not been set up, so there is no
  // timezone and therefore no week to shop for. § Tone of Voice asks an empty
  // state to describe what will appear rather than nudge.
  if (!list) {
    return (
      <PageMain className="justify-center gap-2">
        <h1 className="text-title text-text-primary">No shopping list yet</h1>
        <p className="text-body text-text-secondary">
          The week’s ingredients appear here once a profile and a weekly template
          exist for this account.
        </p>
      </PageMain>
    );
  }

  // Whether the list being shown is for some week other than the current one.
  // `startOfWeek` decides, rather than a comparison against seven dates, so this
  // and `loadShoppingWeek` cannot come to different conclusions about where a
  // week begins.
  const elsewhere = startOfWeek(list.today) !== list.monday;

  return (
    /*
     * The frame's span, and the prose held back from it — § Desktop, amended
     * by FUEL-85.
     *
     * This used to read "640px, not 1024px", citing § Spacing's "max content
     * width: 640px single-column; 1024px for the week grid" on the grounds that
     * "this is a single column of rows, not a grid". The premise stopped being
     * true with the amendment: the 640 "binds prose, and only prose", and a
     * list of grouped items may now flow into columns. So the page takes the
     * width and each block of prose on it says, for itself, that it does not
     * want any.
     */
    <PageMain className={cn("gap-7 py-8", PAGE_FRAME_SPAN)}>
      <header className={cn("flex flex-col gap-2", PAGE_PROSE)}>
        {/*
         * The week travels up. Both this screen and `/plan` are addressed by
         * `?week=`, so an up-link without it would leave the week of the 24th
         * and arrive at whichever week the server resolves "now" to — a
         * different week's plan, behind the link that claims to be the way
         * back. The download link and the shopping cross-link on `/plan` take
         * the same care, for the same reason.
         */}
        <UpLink pathname="/shopping" week={list.monday} />
        <h1 className="text-title text-text-primary">Shopping list</h1>
        {/*
         * What the list IS, before anything is read — the same § Tone of Voice
         * move `/plan` and `/plan/template` each open with. The sentence that
         * matters is the second one: the list follows the plan's swaps, which is
         * the whole reason it is generated rather than written.
         */}
        <p className="text-body text-text-secondary">
          Everything this week’s meals need, combined. Swapping a meal on the
          plan changes what appears here; what you have ticked off stays ticked.
        </p>
      </header>

      {/*
       * With the header, not with the list. § Desktop gives the header band a
       * screen's "own time graphic" and `/training`'s paginator is the example
       * — but this ticket's ruling for this screen is narrower and is the one
       * that governs: "the header stays on the measure... **Only the list takes
       * the width.**" A week paginator centred across 968px of shopping list is
       * a control that has left the thing it belongs to.
       */}
      <div className={cn("flex flex-col items-center gap-2", PAGE_PROSE)}>
        <WeekNav monday={list.monday} basePath="/shopping" />
      </div>

      {list.groups.length > 0 ? (
        <ShoppingListView week={list.monday} groups={list.groups} checked={list.checked} />
      ) : (
        /*
         * A week with nothing planned, or one before the program starts. § Tone
         * of Voice again: say what will appear. Not "Nothing to buy!", which
         * reads as an achievement rather than as an unplanned week.
         */
        <p className={cn("text-body text-text-secondary", PAGE_PROSE)}>
          Nothing is planned for this week yet. Ingredients appear here once the
          week has meals on it.
        </p>
      )}

      {elsewhere && (
        <p className={cn("text-slash text-text-secondary", PAGE_PROSE)}>
          <Link
            href="/shopping"
            className={`underline decoration-text-tertiary underline-offset-4 ${HOVER_LINK} ${FOCUS_RING}`}
          >
            Back to this week
          </Link>
        </p>
      )}
    </PageMain>
  );
}
