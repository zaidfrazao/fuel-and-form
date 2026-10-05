"use client";

import { useRef, useState, useTransition } from "react";

import { estimateMacros, type EstimateState } from "@/app/actions/recipe-estimate";
import { Button } from "@/components/ui/button";
import { signed } from "@/lib/format";
import { deltaOf, estimateKey, type MacroEstimate } from "@/lib/macro-estimate";
import { FOCUS_RING, HOVER_LINK, POINTER } from "@/lib/pointer";
import type { RecipeDraft } from "@/lib/recipe-edit";
import { cn } from "@/lib/utils";

/**
 * `Reassess macros` — FUEL-148, PRD § P12, Brand Guide § Recipe, *Reassessing
 * the macros*.
 *
 * Sits in the edit sheet's *Per serving* group, under the four fields it
 * proposes values for. It never writes them: `Accept` hands the figures to the
 * sheet's own state, where they are as editable as anything typed, and only
 * `Save recipe` stores them. `Discard` drops the proposal and nothing else.
 *
 * ## A proposal for the recipe on the form, and no other
 *
 * The estimate is kept with `estimateKey` of the draft it was asked for. Once
 * the name, an ingredient or the method changes, the key no longer matches and
 * the proposal is withdrawn with one line saying why — it was made for a list
 * that is no longer on the form. The four figures are not part of the key:
 * typing over Calories is exactly what the comparison is there to help with.
 */

/** The four figures as the sheet holds them: text, as typed. */
export type Figures = { kcal: string; proteinG: string; fatG: string; carbG: string };

const TEXT_BUTTON = cn(
  "min-h-11 text-body text-text-secondary underline decoration-text-tertiary underline-offset-4 disabled:pointer-events-none disabled:opacity-50",
  FOCUS_RING,
  HOVER_LINK,
  POINTER,
);

/** What each failure says. Every one ends by saying the form was not touched. */
export const ESTIMATE_MESSAGE: Record<Exclude<EstimateState["status"], "estimated">, string> = {
  refused: "Only the owner can reassess a recipe.",
  empty: "Add a name and at least one ingredient to estimate.",
  unavailable: "Couldn't estimate — reassessment isn't set up here. Nothing was changed.",
  declined: "Couldn't estimate — the model declined this recipe. Nothing was changed.",
  malformed: "Couldn't estimate — the answer couldn't be read. Nothing was changed. Try again.",
  failed: "Couldn't estimate — the request failed. Nothing was changed. Try again.",
};

export function MacroReassess({
  draft,
  onAccept,
}: {
  draft: RecipeDraft;
  onAccept: (figures: Figures) => void;
}) {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<{ key: string; state: EstimateState } | null>(null);
  const button = useRef<HTMLButtonElement>(null);

  const key = estimateKey(draft);
  const stale = result !== null && result.key !== key;
  const state = result && !stale ? result.state : null;

  function reassess() {
    const askedFor = key;
    const payload = JSON.stringify(draft);

    startTransition(async () => {
      let next: EstimateState;

      try {
        next = await estimateMacros(payload);
      } catch {
        // The action never throws; the network to it can.
        next = { status: "failed" };
      }

      setResult({ key: askedFor, state: next });
    });
  }

  function close() {
    setResult(null);
    button.current?.focus();
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex">
        <button
          ref={button}
          type="button"
          onClick={reassess}
          disabled={pending}
          className={TEXT_BUTTON}
        >
          {pending ? "Estimating…" : "Reassess macros"}
        </button>
      </div>

      <p aria-live="polite" className="text-slash text-text-secondary empty:hidden">
        {pending
          ? null
          : stale && result.state.status === "estimated"
            ? "The recipe changed since that estimate. Reassess again."
            : state && state.status !== "estimated"
              ? ESTIMATE_MESSAGE[state.status]
              : state?.status === "estimated"
                ? "Estimate ready — compare it below."
                : null}
      </p>

      {state?.status === "estimated" && !pending && (
        <EstimateReport
          estimate={state.estimate}
          gap={state.gap}
          current={draft}
          onAccept={() => {
            const { kcal, proteinG, fatG, carbG } = state.estimate;

            onAccept({
              kcal: String(kcal),
              proteinG: String(proteinG),
              fatG: String(fatG),
              carbG: String(carbG),
            });
            close();
          }}
          onDiscard={close}
        />
      )}
    </div>
  );
}

const ROWS = [
  ["kcal", "Calories", "kcal"],
  ["proteinG", "Protein", "g"],
  ["fatG", "Fat", "g"],
  ["carbG", "Carbs", "g"],
] as const;

/**
 * The proposal beside the form's figures. Exported for `/dev/recipe`, which
 * photographs it from a fixture rather than a request.
 */
export function EstimateReport({
  estimate,
  gap,
  current,
  onAccept,
  onDiscard,
}: {
  estimate: MacroEstimate;
  gap: number | null;
  current: Figures;
  onAccept: () => void;
  onDiscard: () => void;
}) {
  return (
    <section aria-label="Proposed macros" className="flex flex-col gap-[14px]">
      <table className="w-full border-collapse text-left tabular-nums">
        <thead>
          <tr>
            <th scope="col" className="pb-1 pr-3 text-micro font-normal uppercase text-text-secondary">
              <span className="sr-only">Figure</span>
            </th>
            {["Now", "Proposed", "Change"].map((heading) => (
              <th
                key={heading}
                scope="col"
                className="pb-1 pl-3 text-right text-micro font-normal uppercase text-text-secondary"
              >
                {heading}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {ROWS.map(([name, label, unit]) => {
            const now = current[name].trim();
            const delta = deltaOf(now, estimate[name]);

            return (
              <tr key={name} className="border-t border-border">
                <th scope="row" className="py-[11.5px] pr-3 text-left text-body font-normal text-text-primary">
                  {label} <span className="text-slash text-text-secondary">{unit}</span>
                </th>
                <td className="py-[11.5px] pl-3 text-right text-body text-text-secondary">
                  {now || "—"}
                </td>
                <td className="py-[11.5px] pl-3 text-right text-body font-medium text-text-primary">
                  {estimate[name]}
                </td>
                <td className="py-[11.5px] pl-3 text-right text-body text-text-primary">
                  {delta === null ? "—" : signed(delta)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {gap !== null && (
        <p className="text-body text-text-primary">
          The proposed calories are {signed(gap)} kcal from 4 × protein + 4 × carbs + 9 × fat.
          Check both before accepting.
        </p>
      )}

      <p className="text-body text-text-secondary">{estimate.rationale}</p>

      {estimate.assumptions.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <h3 className="text-micro uppercase text-text-secondary">Assumed</h3>
          <ul className="flex flex-col gap-1">
            {estimate.assumptions.map((line, i) => (
              <li key={i} className="text-body text-text-secondary">
                {line}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex items-center gap-4">
        <Button type="button" variant="secondary" onClick={onAccept}>
          Accept
        </Button>
        <button type="button" onClick={onDiscard} className={TEXT_BUTTON}>
          Discard
        </button>
      </div>
    </section>
  );
}
