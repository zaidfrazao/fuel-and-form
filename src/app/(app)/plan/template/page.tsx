import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { getSession } from "@/lib/auth/session";
import { loadTemplate } from "@/lib/db/queries/template";
import { TemplateEditor } from "./template-editor";

/**
 * `/plan/template` — the recurring week, editable. PRD § P2's "editing the
 * template itself is a separate, explicit action".
 *
 * Thin, like `/` and `/settings`: the fetch is `lib/db/queries/template.ts`,
 * the render is the editor beside this file, and the shaping is
 * `lib/template-plan.ts`. What happens here is the auth check, the narrowing,
 * and the sentence that says what this screen changes.
 *
 * ## The route is the first of the three defences
 *
 * A template edit is the widest write in the app — one row that decides every
 * future occurrence of a weekday — and the acceptance criterion asks that it be
 * "reachable but distinct from swapping, and never triggered accidentally".
 * Being its own route under `/plan` rather than a mode of the swap sheet is
 * what makes "distinct" structural: no control on `/` navigates here, and no
 * control here writes a dated override. The editor's own doc covers the other
 * two defences, which are about what a tap does once you have arrived.
 *
 * ## The auth check is here rather than in a layout
 *
 * The reasoning `page.tsx` and `login/page.tsx` both set out: a check in a
 * layout does not stop nested segments or Server Actions from running, so it
 * belongs next to the data. `loadTemplate` is the next line and is scoped to
 * the session's user. The two Server Actions behind the editor resolve the
 * session again for themselves, because they are separately reachable.
 */

export const metadata: Metadata = {
  title: "Weekly template · Fuel & Form",
  robots: { index: false, follow: false },
};

export default async function TemplatePage() {
  const session = await getSession();

  if (!session) redirect("/login");

  const { entries, meals } = await loadTemplate(session.userId);

  return (
    <main className="mx-auto flex w-full min-w-0 flex-1 max-w-[640px] flex-col gap-7 px-[22px] py-8 md:px-7">
      <header className="flex flex-col gap-2">
        <Link
          href="/settings"
          className="text-label text-text-secondary underline decoration-text-tertiary underline-offset-4"
        >
          Settings
        </Link>
        <h1 className="text-title text-text-primary">Weekly template</h1>
        {/*
         * The blast radius, in words, before anything is tapped. § Tone of
         * Voice asks copy to name what happens; what happens here is unbounded
         * in time, which is precisely the thing a screen should not leave to be
         * inferred from a button.
         *
         * The second sentence is the half people get wrong. An edit does not
         * reach a date that already carries an override — resolution consults
         * `day_plan_overrides` first — so a Tuesday that was swapped keeps its
         * swap, and the change shows up on the Tuesday after.
         */}
        <p className="text-body text-text-secondary">
          What recurs each week. Changes apply to every future week — a date you
          have already swapped keeps its swap until you revert it.
        </p>
      </header>

      {/* No meals: nothing can be planned yet, and § Tone of Voice asks an empty
          state to describe what will appear rather than nudge. Rendering the
          editor would give seven days of rows that open a picker with nothing
          in it. */}
      {meals.length > 0 ? (
        <TemplateEditor
          // Narrowed the way `app/page.tsx` narrows its own payload: `method`
          // and `notes` are free text that only meal detail shows, and there is
          // no reason for a recipe's method to sit in the page payload of a
          // screen that never renders it. What crosses is what the rows draw
          // and what the picker's tiles need.
          //
          // WHEN `meals.is_untracked` LANDS (PRD Open Question 4) it does not
          // belong here: this screen totals nothing. The narrowing that must
          // change is `app/page.tsx`'s.
          meals={meals.map((meal) => ({
            id: meal.id,
            name: meal.name,
            slotType: meal.slotType,
            kcal: meal.kcal,
            proteinG: meal.proteinG,
            isArchived: meal.isArchived,
          }))}
          // The template rows, minus the ownership column the scope already
          // guaranteed. `sortOrder` and `id` cross because the shaping breaks a
          // duplicate the same way the resolver does, and it can only do that
          // if it can see what the resolver sees.
          entries={entries.map((entry) => ({
            id: entry.id,
            dayOfWeek: entry.dayOfWeek,
            slot: entry.slot,
            mealId: entry.mealId,
            sortOrder: entry.sortOrder,
          }))}
        />
      ) : (
        <p className="text-body text-text-secondary">
          The weekly template appears here once there are meals in the library to
          plan with.
        </p>
      )}
    </main>
  );
}
