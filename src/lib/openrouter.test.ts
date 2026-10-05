import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import type { EstimateInput } from "./macro-estimate";

/**
 * FUEL-148. The request and every way it can end. `fetch` is stubbed: no test
 * reaches the network, and each ending the PRD names — a refusal, an API
 * error, a timeout, malformed output — is a named outcome, never a throw and
 * never the form's old figures.
 */

vi.mock("server-only", () => ({}));

const { ESTIMATE_MODEL, OPENROUTER_URL, estimateBody, requestEstimate } = await import("./openrouter");

const KEY = "sk-or-v1-test-key";

const INPUT: EstimateInput = {
  name: "Chilli",
  ingredients: [{ name: "Mince", measure: "1 pack", grams: 125 }],
  method: "Brown the mince.",
};

const ANSWER = { kcal: 612, proteinG: 48.5, fatG: 14, carbG: 62, rationale: "USDA.", assumptions: [] };

function reply(body: unknown, status = 200): Response {
  return new Response(typeof body === "string" ? body : JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function completion(choice: Record<string, unknown>) {
  return { choices: [{ finish_reason: "stop", native_finish_reason: "end_turn", ...choice }] };
}

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("estimateBody", () => {
  test("asks Opus 5.5 for the strict schema, from providers that honour it and keep nothing", () => {
    const body = estimateBody(INPUT);

    expect(body.model).toBe(ESTIMATE_MODEL);
    expect(ESTIMATE_MODEL).toBe("anthropic/claude-opus-5.5");
    expect(body.provider).toEqual({ require_parameters: true, data_collection: "deny" });
    expect(body.response_format).toMatchObject({ type: "json_schema", json_schema: { strict: true } });
    expect(body.messages.map((message) => message.role)).toEqual(["system", "user"]);
    expect(body.messages[1]?.content).toContain("- Mince | 1 pack | 125 g");
  });
});

describe("requestEstimate", () => {
  test("posts the body with the key as a bearer token, and a timeout", async () => {
    fetchMock.mockResolvedValue(reply(completion({ message: { content: JSON.stringify(ANSWER) } })));

    await requestEstimate(INPUT, KEY);

    const [url, init] = fetchMock.mock.calls[0]!;

    expect(url).toBe(OPENROUTER_URL);
    expect(init?.method).toBe("POST");
    expect((init?.headers as Record<string, string>).Authorization).toBe(`Bearer ${KEY}`);
    expect(JSON.parse(String(init?.body))).toEqual(estimateBody(INPUT));
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  test("returns the estimate read a second time", async () => {
    fetchMock.mockResolvedValue(
      reply(completion({ message: { content: JSON.stringify({ ...ANSWER, proteinG: 48.46 }) } })),
    );

    expect(await requestEstimate(INPUT, KEY)).toEqual({
      kind: "estimated",
      estimate: { ...ANSWER, proteinG: 48.5 },
    });
  });

  test.each([
    ["a refusal on the message", { message: { content: "", refusal: "I can't help with that." } }],
    ["Anthropic's refusal stop reason", { native_finish_reason: "refusal", message: { content: "" } }],
    ["a content filter", { finish_reason: "content_filter", message: { content: null } }],
  ])("is refused for %s", async (_, choice) => {
    fetchMock.mockResolvedValue(reply(completion(choice)));

    expect(await requestEstimate(INPUT, KEY)).toEqual({ kind: "refused" });
  });

  test("a blank refusal field is not a refusal", async () => {
    fetchMock.mockResolvedValue(
      reply(completion({ message: { content: JSON.stringify(ANSWER), refusal: "  " } })),
    );

    expect((await requestEstimate(INPUT, KEY)).kind).toBe("estimated");
  });

  test("is malformed for any finish but stop, even when the text happens to parse", async () => {
    // A cut-off answer can end on a closing brace: the finish reason is what says
    // it was cut, so a parse that succeeds is not evidence it was complete.
    fetchMock.mockResolvedValue(
      reply(completion({ finish_reason: "length", message: { content: JSON.stringify(ANSWER) } })),
    );

    expect(await requestEstimate(INPUT, KEY)).toEqual({ kind: "malformed" });
  });

  test.each([
    ["a cut-off answer", completion({ finish_reason: "length", message: { content: '{"kcal":6' } })],
    ["an answer that fails the second reading", completion({ message: { content: JSON.stringify({ ...ANSWER, kcal: -5 }) } })],
    ["an answer that is not JSON", completion({ message: { content: "About 600 kcal." } })],
    ["no choices", { choices: [] }],
    ["no choices at all", {}],
  ])("is malformed for %s", async (_, body) => {
    fetchMock.mockResolvedValue(reply(body));

    expect(await requestEstimate(INPUT, KEY)).toEqual({ kind: "malformed" });
  });

  test.each([
    ["a 401", reply({ error: { code: 401, message: "No auth credentials found" } }, 401)],
    ["a 429", reply({ error: { code: 429, message: "Rate limit exceeded" } }, 429)],
    ["a 502", reply({ error: { code: 502, message: "Provider error" } }, 502)],
    ["an error on a 200", reply({ error: { code: 500, message: "Upstream failed" } })],
    ["an error finish", reply(completion({ finish_reason: "error", message: { content: "" } }))],
    ["a body that is not JSON", reply("<html>Bad gateway</html>", 502)],
    ["a JSON null body", reply("null", 502)],
  ])("fails for %s", async (_, response) => {
    fetchMock.mockResolvedValue(response);

    expect(await requestEstimate(INPUT, KEY)).toEqual({ kind: "failed" });
  });

  test.each([
    ["a timeout", new DOMException("The operation was aborted due to timeout", "TimeoutError")],
    ["a network failure", new TypeError("fetch failed")],
  ])("fails, without throwing, for %s", async (_, error) => {
    fetchMock.mockRejectedValue(error);

    expect(await requestEstimate(INPUT, KEY)).toEqual({ kind: "failed" });
  });

  test("never writes the key into a log line", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    fetchMock.mockResolvedValueOnce(reply({ error: { code: 401, message: "Bad key" } }, 401));
    await requestEstimate(INPUT, KEY);
    fetchMock.mockRejectedValueOnce(new TypeError("fetch failed"));
    await requestEstimate(INPUT, KEY);
    fetchMock.mockResolvedValueOnce(reply("not json", 500));
    await requestEstimate(INPUT, KEY);

    expect(error).toHaveBeenCalledTimes(3);
    expect(JSON.stringify(error.mock.calls)).not.toContain(KEY);
  });
});
