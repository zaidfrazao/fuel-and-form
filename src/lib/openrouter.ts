import "server-only";

import {
  ESTIMATE_SCHEMA,
  ESTIMATE_SYSTEM,
  estimatePrompt,
  readEstimate,
  type EstimateInput,
  type MacroEstimate,
} from "./macro-estimate";

/**
 * The one third-party request this app makes — FUEL-148, PRD § Integrations.
 *
 * OpenRouter's chat-completions endpoint, called with `fetch` rather than a
 * client library: one POST, one shape to read, and no dependency that could
 * be pulled into a browser bundle by an import in the wrong file. The guard
 * above makes that a build error regardless.
 *
 * ## Every ending is an outcome, never a throw
 *
 * The action needs a state to render, so a timeout, a non-2xx, an error body
 * on a 200, a refusal, a cut-off answer and an answer that fails `readEstimate`
 * each come back as a named outcome. None of them is turned into the figures
 * already on the form: `silent-swallow-fails-open` is the failure this is
 * written against, because a fallback to the old figures looks exactly like an
 * estimate that agreed with them.
 */

export const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

/** Claude Opus 5.5, as OpenRouter names it. */
export const ESTIMATE_MODEL = "anthropic/claude-opus-5.5";

/**
 * Long enough for adaptive reasoning on a sixty-row recipe, short enough that
 * the sheet is not left saying "Estimating…" for minutes. No retry: the owner
 * can press the button again, and a retry would double the wait first.
 */
export const ESTIMATE_TIMEOUT_MS = 60_000;

export type EstimateOutcome =
  | { kind: "estimated"; estimate: MacroEstimate }
  | { kind: "refused" }
  | { kind: "malformed" }
  | { kind: "failed" };

type Choice = {
  finish_reason?: unknown;
  native_finish_reason?: unknown;
  message?: { content?: unknown; refusal?: unknown };
};

/** The request body. Exported so a test can read what would be sent. */
export function estimateBody(input: EstimateInput) {
  return {
    model: ESTIMATE_MODEL,
    // Reasoning tokens count against this, so it is generous for a short JSON.
    max_tokens: 8_000,
    reasoning: { effort: "medium" },
    provider: {
      // Only providers that honour `response_format`, and none that keep data.
      require_parameters: true,
      data_collection: "deny",
    },
    response_format: {
      type: "json_schema",
      json_schema: { name: "macro_estimate", strict: true, schema: ESTIMATE_SCHEMA },
    },
    messages: [
      { role: "system", content: ESTIMATE_SYSTEM },
      { role: "user", content: estimatePrompt(input) },
    ],
  };
}

export async function requestEstimate(
  input: EstimateInput,
  apiKey: string,
): Promise<EstimateOutcome> {
  let response: Response;

  try {
    response = await fetch(OPENROUTER_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "X-Title": "Fuel & Form",
      },
      body: JSON.stringify(estimateBody(input)),
      signal: AbortSignal.timeout(ESTIMATE_TIMEOUT_MS),
      cache: "no-store",
    });
  } catch (error) {
    // A timeout or a network failure. The error names neither the key nor the body.
    console.error("Macro estimate request did not complete.", (error as Error)?.name);

    return { kind: "failed" };
  }

  let payload: unknown;

  try {
    payload = await response.json();
  } catch {
    console.error("Macro estimate response was not JSON.", response.status);

    return { kind: "failed" };
  }

  const body = (typeof payload === "object" && payload !== null ? payload : {}) as {
    error?: { code?: unknown; message?: unknown };
    choices?: Choice[];
  };

  // OpenRouter can answer 200 with an error object, so the status alone is not enough.
  if (!response.ok || body.error) {
    console.error("Macro estimate was refused by the API.", response.status, body.error?.message);

    return { kind: "failed" };
  }

  const choice = body.choices?.[0];

  if (!choice) return { kind: "malformed" };

  const refusal = choice.message?.refusal;

  if (
    (typeof refusal === "string" && refusal.trim() !== "") ||
    choice.native_finish_reason === "refusal" ||
    choice.finish_reason === "content_filter"
  ) {
    return { kind: "refused" };
  }

  if (choice.finish_reason === "error") return { kind: "failed" };

  // A cut-off answer is half a JSON object: never read it.
  if (choice.finish_reason !== "stop") return { kind: "malformed" };

  const estimate = readEstimate(choice.message?.content);

  return estimate ? { kind: "estimated", estimate } : { kind: "malformed" };
}
