"use client";

import { EstimateReport, type Figures } from "@/components/macro-reassess";
import type { MacroEstimate } from "@/lib/macro-estimate";

/**
 * The proposal as the edit sheet draws it — FUEL-148.
 *
 * From a fixture, never a request: no visual run may spend the key or depend
 * on a model's wording. Client-side only because the report takes its two
 * handlers as functions, which a server page cannot pass; here they do
 * nothing.
 */
export function EstimateSpecimen({
  estimate,
  gap,
  current,
}: {
  estimate: MacroEstimate;
  gap: number | null;
  current: Figures;
}) {
  return (
    <EstimateReport
      estimate={estimate}
      gap={gap}
      current={current}
      onAccept={() => {}}
      onDiscard={() => {}}
    />
  );
}
