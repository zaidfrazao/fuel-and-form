import { beforeEach, describe, expect, test, vi } from "vitest";

import { blankIngredient, type RecipeDraft } from "@/lib/recipe-edit";

/**
 * The reassessment's action layer — FUEL-148.
 *
 * The session, the key and the request are mocked. What is left is the
 * boundary: a demo session is refused before the draft is parsed or the key
 * read — so nothing leaves the server for it — and every outcome of the
 * request becomes a state the sheet can name, with no path that throws.
 */

const { getSession, openRouterApiKey, requestEstimate } = vi.hoisted(() => ({
  getSession: vi.fn(),
  openRouterApiKey: vi.fn(),
  requestEstimate: vi.fn(),
}));

vi.mock("@/lib/auth/session", () => ({ getSession }));
vi.mock("@/lib/env", () => ({ openRouterApiKey }));
vi.mock("@/lib/openrouter", () => ({ requestEstimate }));

const { estimateMacros } = await import("./recipe-estimate");

const DRAFT: RecipeDraft = {
  name: "Chilli",
  kcal: "612",
  proteinG: "48.5",
  fatG: "14",
  carbG: "62",
  method: "Brown.",
  notes: "",
  ingredients: [{ ...blankIngredient(), name: "Mince", grams: "125" }],
};

const ESTIMATE = { kcal: 640, proteinG: 50, fatG: 15, carbG: 65, rationale: "USDA.", assumptions: [] };

beforeEach(() => {
  vi.clearAllMocks();
  getSession.mockResolvedValue({ userId: "u", kind: "owner" });
  openRouterApiKey.mockReturnValue("sk-or-v1-test");
  requestEstimate.mockResolvedValue({ kind: "estimated", estimate: ESTIMATE });
});

describe("estimateMacros", () => {
  test("sends the owner's draft with the key and returns the proposal", async () => {
    expect(await estimateMacros(JSON.stringify(DRAFT))).toEqual({
      status: "estimated",
      estimate: ESTIMATE,
      // 4 × 50 + 4 × 65 + 9 × 15 = 595; 640 is 45 over, inside a tenth.
      gap: null,
    });

    expect(requestEstimate).toHaveBeenCalledWith(
      { name: "Chilli", ingredients: [{ name: "Mince", measure: null, grams: 125 }], method: "Brown." },
      "sk-or-v1-test",
    );
  });

  test("carries the energy gap when the figures disagree", async () => {
    requestEstimate.mockResolvedValue({ kind: "estimated", estimate: { ...ESTIMATE, kcal: 900 } });

    expect(await estimateMacros(JSON.stringify(DRAFT))).toMatchObject({ status: "estimated", gap: 305 });
  });

  test.each([
    ["a demo session", { userId: "d", kind: "demo" }],
    ["no session", null],
  ])("refuses %s before the draft is read or the key touched", async (_, session) => {
    getSession.mockResolvedValue(session);

    expect(await estimateMacros(JSON.stringify(DRAFT))).toEqual({ status: "refused" });
    expect(openRouterApiKey).not.toHaveBeenCalled();
    expect(requestEstimate).not.toHaveBeenCalled();
  });

  test("asks nothing for a draft with nothing to estimate", async () => {
    expect(await estimateMacros(JSON.stringify({ ...DRAFT, ingredients: [] }))).toEqual({ status: "empty" });
    expect(await estimateMacros(42)).toEqual({ status: "empty" });
    expect(requestEstimate).not.toHaveBeenCalled();
  });

  test("is unavailable without a key, and sends nothing", async () => {
    openRouterApiKey.mockReturnValue(null);

    expect(await estimateMacros(JSON.stringify(DRAFT))).toEqual({ status: "unavailable" });
    expect(requestEstimate).not.toHaveBeenCalled();
  });

  test.each([
    ["refused", "declined"],
    ["malformed", "malformed"],
    ["failed", "failed"],
  ])("names a %s request as %s, with no figures", async (kind, status) => {
    requestEstimate.mockResolvedValue({ kind });

    expect(await estimateMacros(JSON.stringify(DRAFT))).toEqual({ status });
  });

  test("never throws: a session lookup that does is a failure", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    getSession.mockRejectedValue(new Error("database down"));

    expect(await estimateMacros(JSON.stringify(DRAFT))).toEqual({ status: "failed" });
  });
});
