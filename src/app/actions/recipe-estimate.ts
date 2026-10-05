"use server";

import { getSession } from "@/lib/auth/session";
import { openRouterApiKey } from "@/lib/env";
import { energyGap, parseEstimateRequest, type MacroEstimate } from "@/lib/macro-estimate";
import { requestEstimate } from "@/lib/openrouter";

/**
 * Reassessing a recipe's macros — FUEL-148, PRD § P12 and § Integrations.
 *
 * `recipe.ts`'s contract: a public endpoint, so the session is resolved here,
 * the input is parsed before it is used, and nothing throws. It writes
 * nothing. What it returns is a proposal the sheet shows beside the current
 * figures; only `Save recipe` writes them.
 *
 * ## Owner only, before anything leaves the server
 *
 * The call spends the owner's key. A demo session is refused first — before
 * the draft is parsed and before the key is read — so a visitor who POSTs here
 * directly spends nothing and learns nothing about whether a key is set.
 *
 * ## Every failure is a state the sheet names
 *
 * `declined` is the model refusing, `malformed` an answer that failed the
 * second reading, `failed` the request itself, and `unavailable` a deployment
 * with no key. None of them carries figures: the sheet's fields stay exactly as
 * they were.
 */

export type EstimateState =
  | { status: "estimated"; estimate: MacroEstimate; gap: number | null }
  | { status: "refused" }
  | { status: "empty" }
  | { status: "unavailable" }
  | { status: "declined" }
  | { status: "malformed" }
  | { status: "failed" };

export async function estimateMacros(draft: unknown): Promise<EstimateState> {
  try {
    const session = await getSession();

    if (!session || session.kind !== "owner") return { status: "refused" };

    const input = parseEstimateRequest(draft);

    if (!input) return { status: "empty" };

    const apiKey = openRouterApiKey();

    if (!apiKey) return { status: "unavailable" };

    const outcome = await requestEstimate(input, apiKey);

    switch (outcome.kind) {
      case "estimated":
        return {
          status: "estimated",
          estimate: outcome.estimate,
          gap: energyGap(outcome.estimate),
        };
      case "refused":
        return { status: "declined" };
      case "malformed":
        return { status: "malformed" };
      default:
        return { status: "failed" };
    }
  } catch (error) {
    console.error("Could not estimate the recipe's macros.", (error as Error)?.name);

    return { status: "failed" };
  }
}
