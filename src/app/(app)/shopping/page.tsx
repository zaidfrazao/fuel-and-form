import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { ShoppingListView } from "@/components/shopping-list-view";
import { WeekNav } from "@/components/week-nav";
import { getSession } from "@/lib/auth/session";
import { startOfWeek } from "@/lib/date";
import { loadShoppingWeek } from "@/lib/db/queries/shopping";
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
      <main className="mx-auto flex w-full min-w-0 flex-1 max-w-[640px] flex-col justify-center gap-2 px-[22px] md:px-7">
        <h1 className="text-title text-text-primary">No shopping list yet</h1>
        <p className="text-body text-text-secondary">
          The week’s ingredients appear here once a profile and a weekly template
          exist for this account.
        </p>
      </main>
    );
  }

  // Whether the list being shown is for some week other than the current one.
  // `startOfWeek` decides, rather than a comparison against seven dates, so this
  // and `loadShoppingWeek` cannot come to different conclusions about where a
  // week begins.
  const elsewhere = startOfWeek(list.today) !== list.monday;

  return (
    // 640px, not 1024px — § Spacing: "max content width: 640px single-column;
    // 1024px for the week grid". This is a single column of rows, not a grid.
    <main className="mx-auto flex w-full min-w-0 flex-1 max-w-[640px] flex-col gap-7 px-[22px] py-8 md:px-7">
      <header className="flex flex-col gap-2">
        <Link
          href={`/plan?week=${list.monday}`}
          className="text-micro uppercase text-text-secondary underline decoration-text-tertiary underline-offset-4"
        >
          Weekly plan
        </Link>
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

      <div className="flex flex-col items-center gap-2">
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
        <p className="text-body text-text-secondary">
          Nothing is planned for this week yet. Ingredients appear here once the
          week has meals on it.
        </p>
      )}

      {elsewhere && (
        <p className="text-slash text-text-secondary">
          <Link
            href="/shopping"
            className="underline decoration-text-tertiary underline-offset-4"
          >
            Back to this week
          </Link>
        </p>
      )}
    </main>
  );
}
