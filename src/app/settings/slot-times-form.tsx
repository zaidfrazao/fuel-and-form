"use client";

import { useActionState, useState } from "react";

import { Button } from "@/components/ui/button";
import { slotLabel } from "@/lib/now-display";
import { slotField, workoutField } from "@/lib/slot-times";
import { saveSlotTimes, type SettingsState } from "../actions/settings";

/**
 * The slot times, as a grouped list — Brand Guide § Component Patterns → Lists.
 *
 * "Rows on the canvas, separated by hairlines. No card, no fill, no outer rule.
 * 54px minimum." So the list is a bare `<ul>` with a top hairline per row rather
 * than a bordered box, and nothing here has a background: the canvas shows
 * through, which is what makes it a list and not a card.
 *
 * A client component only because `useActionState` needs one. Nothing here
 * decides whether a time is valid — that is `slot-times.ts`, behind the action,
 * where a hand-rolled POST also has to pass.
 *
 * ## Why the rows are in this order
 *
 * The order of the day, and FIXED. Sorting by the current values would reshuffle
 * the list while someone was typing in it — the row you are editing sliding
 * under the cursor as you change the hour, which is the one moment a settings
 * list must hold still.
 */

/**
 * A row's subject, and the `/ ` metadata beneath it — § Slash Metadata.
 *
 * The labels come from `slotLabel` rather than being written again here, so
 * settings and the Right Now card cannot end up with two words for breakfast.
 * The metadata is what the label alone does not say: `Extra` is the coffee, and
 * the two session types are what the A/B rotation alternates between.
 */
export const ROWS: { name: string; label: string; meta: string }[] = [
  { name: slotField("extra"), label: slotLabel("extra"), meta: "Coffee and MCT oil" },
  { name: workoutField("circuit"), label: "Circuit", meta: "Circuit A and B" },
  { name: workoutField("intervals"), label: "Intervals", meta: "Skipping and core" },
  { name: slotField("breakfast"), label: slotLabel("breakfast"), meta: "Morning routine" },
  { name: slotField("snack"), label: slotLabel("snack"), meta: "Around the walk" },
  { name: slotField("lunch"), label: slotLabel("lunch"), meta: "Lunch break" },
  { name: slotField("dinner"), label: slotLabel("dinner"), meta: "Evening" },
];

export function SlotTimesForm({
  values,
  timezone,
}: {
  /** Field name → 'HH:MM', or '' for a slot with no fixed time. */
  values: Record<string, string>;
  timezone: string;
}) {
  const [state, action, pending] = useActionState<SettingsState, FormData>(
    saveSlotTimes,
    undefined,
  );

  /*
   * Controlled, and that is load-bearing rather than a style choice.
   *
   * React RESETS an uncontrolled form once its action returns. For a refused
   * submission that means the times someone just typed are replaced by the ones
   * they were trying to change — the screen tells them to check the times above
   * while silently discarding them, so the correction is a retype of all seven
   * rows. Holding the values in state survives the reset, and the message then
   * refers to something still on screen.
   *
   * Seeded from the prop rather than synced to it. After a save the server's
   * values and these are the same values, and re-seeding on every render would
   * fight whatever is being typed.
   */
  const [times, setTimes] = useState(values);

  const errors = state?.status === "invalid" ? state.errors : {};

  return (
    <form action={action} className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h2 className="text-label text-text-secondary">Slot times</h2>
        <p className="text-caption text-text-tertiary">
          / {timezone} · clear a time to log that item whenever
        </p>
      </div>

      <ul className="flex flex-col">
        {ROWS.map(({ name, label, meta }) => {
          const error = errors[name];

          return (
            <li
              key={name}
              className="flex min-h-[54px] items-center justify-between gap-4 border-t border-border py-2 first:border-t-0"
            >
              <div className="flex flex-col">
                <label htmlFor={name} className="text-body text-text-primary">
                  {label}
                </label>
                <span className="text-caption text-text-tertiary">/ {meta}</span>

                {error ? (
                  // `role="alert"` so the refusal is heard rather than found.
                  <span id={`${name}-error`} role="alert" className="text-caption text-error">
                    {error}
                  </span>
                ) : null}
              </div>

              <input
                id={name}
                name={name}
                type="time"
                // The acceptance criterion's `inputmode`. `type="time"` gives
                // the native picker — a wheel on iOS, a spinner elsewhere — and
                // `inputMode` is what a browser without one falls back to: a
                // numeric keypad rather than a full keyboard for a field that
                // only ever holds digits and a colon.
                inputMode="numeric"
                value={times[name] ?? ""}
                onChange={(event) =>
                  setTimes((current) => ({ ...current, [name]: event.target.value }))
                }
                aria-invalid={error ? true : undefined}
                aria-describedby={error ? `${name}-error` : undefined}
                className="h-11 shrink-0 rounded-md border border-border bg-surface px-3 text-body tabular-nums text-text-primary outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background aria-invalid:border-destructive"
              />
            </li>
          );
        })}
      </ul>

      <div className="flex flex-col gap-2">
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Save times"}
        </Button>

        {/* Brand Guide § Feedback: inline, at the point of action, never a
            modal. § Voice reports rather than congratulates — "Saved." and not
            "Nice one!". `aria-live` rather than `role="alert"` for the success
            case, which is confirmation and should not interrupt. */}
        <p aria-live="polite" className="min-h-5 text-caption text-text-secondary">
          {state?.status === "saved" ? "Saved. The Right Now view uses these times now." : null}
          {state?.status === "invalid" ? "Nothing was saved — check the times above." : null}
          {state?.status === "failed" ? "Could not save. Try again." : null}
        </p>
      </div>
    </form>
  );
}
