"use client";

import { useActionState, useState } from "react";

import { saveProfileTargets, type TargetsState } from "@/app/actions/settings";
import { ACTION_BAR_PRIMARY } from "@/components/action-bar";
import { Button } from "@/components/ui/button";
import { TARGET_FIELD } from "@/lib/profile-targets";
import { cn } from "@/lib/utils";

/**
 * The targets, the weights, the pace, the height and the zone — FUEL-136,
 * PRD § P7's "or entered in the app".
 *
 * `slot-times-form.tsx`'s list, for its reasons: rows on the canvas, a hairline
 * between them, no card. A client component only for `useActionState`; what is
 * valid is `profile-targets.ts`, behind the action.
 *
 * ## A second form, with its own Save
 *
 * The slot-times form keeps the reminder behind its Save because it is the same
 * question asked of the same day. These are a different question — what the day
 * is MEASURED against — and they fail differently: a mistyped slot time must not
 * refuse a correctly typed kcal target, with the error a screen away from the
 * field being looked at. The two buttons name what they save, so neither reads
 * as the whole screen's.
 *
 * ## `id="targets"`
 *
 * FUEL-54's recalibration prompt links to `/settings#targets`. The id is on the
 * form rather than a heading so the jump lands on the first group.
 */

type Row = {
  name: string;
  label: string;
  meta: string;
  unit?: string;
  /** `decimal` for fields that accept a separator, `numeric` for whole numbers. */
  inputMode: "decimal" | "numeric";
};

/**
 * The groups, in the order a recalibration reads them: the daily figures that
 * change most often first, the program's shape next, and the two things set
 * once last.
 *
 * `Calories` / `Protein` / `Fat` / `Carbs` are `macro-grid.tsx`'s labels, so the
 * form and the figures it drives cannot use two words for one number. `Target
 * weight` and not "goal weight": § Terminology, "Target, not Goal".
 */
export const GROUPS: { heading: string; meta: string; rows: Row[] }[] = [
  {
    heading: "Daily targets",
    meta: "what Now and Plan measure each day against",
    rows: [
      { name: TARGET_FIELD.kcal, label: "Calories", meta: "per day", unit: "kcal", inputMode: "numeric" },
      { name: TARGET_FIELD.protein, label: "Protein", meta: "per day", unit: "g", inputMode: "decimal" },
      { name: TARGET_FIELD.fat, label: "Fat", meta: "per day", unit: "g", inputMode: "decimal" },
      { name: TARGET_FIELD.carb, label: "Carbs", meta: "per day", unit: "g", inputMode: "decimal" },
    ],
  },
  {
    heading: "Weight",
    meta: "the journey Weight charts and measures",
    rows: [
      { name: TARGET_FIELD.startWeight, label: "Start weight", meta: "where the program began", unit: "kg", inputMode: "decimal" },
      { name: TARGET_FIELD.goalWeight, label: "Target weight", meta: "where it ends", unit: "kg", inputMode: "decimal" },
      { name: TARGET_FIELD.pace, label: "Pace", meta: "kg lost per week", unit: "kg/wk", inputMode: "decimal" },
    ],
  },
  {
    heading: "Height",
    meta: "for the walk's step estimate",
    rows: [
      { name: TARGET_FIELD.height, label: "Height", meta: "standing", unit: "cm", inputMode: "numeric" },
    ],
  },
];

const FIELD =
  "h-11 rounded-md border border-border bg-surface px-3 text-body text-text-primary outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background aria-invalid:border-destructive";

function ErrorLine({ name, error }: { name: string; error: string | undefined }) {
  if (!error) return null;

  // `role="alert"` so the refusal is heard rather than found.
  return (
    <span id={`${name}-error`} role="alert" className="text-slash text-error">
      {error}
    </span>
  );
}

export function TargetsForm({
  values,
  timezones,
}: {
  /** Field name → the stored value as text. */
  values: Record<string, string>;
  /** Computed on the server — see `timezoneOptions`. */
  timezones: string[];
}) {
  const [state, action, pending] = useActionState<TargetsState, FormData>(
    saveProfileTargets,
    undefined,
  );

  // Controlled for `slot-times-form.tsx`'s reason: React resets an uncontrolled
  // form when its action returns, and a refusal would then discard what was
  // typed while the message pointed at it.
  const [fields, setFields] = useState(values);

  const errors = state?.status === "invalid" ? state.errors : {};
  const set = (name: string, value: string) =>
    setFields((current) => ({ ...current, [name]: value }));

  const zone = TARGET_FIELD.timezone;

  return (
    <form id="targets" action={action} className="flex flex-col gap-6 border-t border-border pt-5">
      {GROUPS.map(({ heading, meta, rows }, index) => (
        <div
          key={heading}
          className={cn("flex flex-col gap-4", index > 0 && "border-t border-border pt-5")}
        >
          <div className="flex flex-col gap-1">
            <h2 className="text-micro uppercase text-text-secondary">{heading}</h2>
            <p className="text-slash text-text-tertiary">/ {meta}</p>
          </div>

          <ul className="flex flex-col">
            {rows.map((row) => {
              const error = errors[row.name];

              return (
                <li
                  key={row.name}
                  className="flex min-h-[54px] items-center justify-between gap-4 border-t border-border py-2 first:border-t-0"
                >
                  <div className="flex min-w-0 flex-col">
                    <label htmlFor={row.name} className="text-body text-text-primary">
                      {row.label}
                    </label>
                    <span className="text-slash text-text-tertiary">/ {row.meta}</span>
                    <ErrorLine name={row.name} error={error} />
                  </div>

                  <span className="flex shrink-0 items-center gap-2">
                    <input
                      id={row.name}
                      name={row.name}
                      // Text, not `type="number"`, for `weigh-ins.tsx`'s reason:
                      // a number input holding "76,5" reports an empty string on
                      // a full-stop locale, and the comma the parser accepts
                      // would be lost before it got there.
                      type="text"
                      inputMode={row.inputMode}
                      autoComplete="off"
                      maxLength={7}
                      value={fields[row.name] ?? ""}
                      onChange={(event) => set(row.name, event.target.value)}
                      aria-invalid={error ? true : undefined}
                      aria-describedby={error ? `${row.name}-error` : undefined}
                      className={cn(FIELD, "w-24 text-right tabular-nums")}
                    />
                    {/* A fixed width, so every box in the list shares a right
                        edge whatever its unit is. */}
                    <span className="w-12 text-slash text-text-tertiary">{row.unit}</span>
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      ))}

      {/*
       * The zone. Its own group because it answers neither "what is the day
       * measured against" nor anything about a body: it is which dates a
       * reading, a log and a week fall on. The slot-times caption above names
       * it read-only, and this is where it is changed.
       */}
      <div className="flex flex-col gap-4 border-t border-border pt-5">
        <div className="flex flex-col gap-1">
          <h2 className="text-micro uppercase text-text-secondary">Timezone</h2>
          <p className="text-slash text-text-tertiary">
            / where the day starts — every date and slot time is in this zone
          </p>
        </div>

        <div className="flex flex-col gap-2">
          <label htmlFor={zone} className="sr-only">
            Timezone
          </label>
          <select
            id={zone}
            name={zone}
            value={fields[zone] ?? ""}
            onChange={(event) => set(zone, event.target.value)}
            aria-invalid={errors[zone] ? true : undefined}
            aria-describedby={errors[zone] ? `${zone}-error` : undefined}
            className={cn(FIELD, "w-full min-w-0")}
          >
            {timezones.map((name) => (
              <option key={name} value={name}>
                {name.replaceAll("_", " ")}
              </option>
            ))}
          </select>
          <ErrorLine name={zone} error={errors[zone]} />
        </div>
      </div>

      <div className="flex flex-col gap-2">
        {/* § Buttons, FUEL-85 — `slot-times-form.tsx`'s Save, and the same
            constant, for the same reason. */}
        <Button type="submit" disabled={pending} className={cn(ACTION_BAR_PRIMARY, "xl:self-start")}>
          {pending ? "Saving…" : "Save targets"}
        </Button>

        <p aria-live="polite" className="min-h-5 text-slash text-text-secondary">
          {state?.status === "saved" ? "Saved. Now, Plan and Weight use these figures now." : null}
          {state?.status === "invalid" ? "Nothing was saved — check the fields above." : null}
          {state?.status === "failed" ? "Could not save. Try again." : null}
        </p>
      </div>
    </form>
  );
}
