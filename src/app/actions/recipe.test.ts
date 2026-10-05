import { beforeEach, describe, expect, test, vi } from "vitest";

import { blankIngredient, MEAL_FIELD, RECIPE_FIELD, type RecipeDraft } from "@/lib/recipe-edit";

/**
 * The recipe edit's action layer — FUEL-147.
 *
 * Mocked as `settings.test.ts` is: the session, the write and `refresh()` are
 * the request. What is left is the boundary — that a demo session is refused
 * before anything is parsed or written, that the parser runs before the write,
 * that the write is the session's user, and that no path throws. Whether the
 * scoped update refuses another account's meal is `tests/integration/recipe`'s.
 */

const { getSession, saveRecipe, refresh } = vi.hoisted(() => ({
  getSession: vi.fn(),
  saveRecipe: vi.fn(),
  refresh: vi.fn(),
}));

vi.mock("@/lib/auth/session", () => ({ getSession }));
vi.mock("@/lib/db/queries/recipe", () => ({ saveRecipe }));
vi.mock("next/cache", () => ({ refresh }));

const { editRecipe } = await import("./recipe");

const USER = "11111111-2222-3333-4444-555555555555";
const MEAL = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";

const DRAFT: RecipeDraft = {
  name: "Chilli",
  kcal: "612",
  proteinG: "48.5",
  fatG: "14",
  carbG: "62",
  method: "Brown.\nSimmer.",
  notes: "",
  ingredients: [{ ...blankIngredient(), name: "Garlic", grams: "6" }],
};

function form(draft: unknown = DRAFT, mealId: string | null = MEAL): FormData {
  const data = new FormData();

  if (mealId !== null) data.append(MEAL_FIELD, mealId);
  data.append(RECIPE_FIELD, typeof draft === "string" ? draft : JSON.stringify(draft));

  return data;
}

beforeEach(() => {
  vi.clearAllMocks();
  getSession.mockResolvedValue({ userId: USER, kind: "owner" });
  saveRecipe.mockResolvedValue(true);
});

describe("editRecipe", () => {
  test("writes the parsed recipe for the session's user, then refreshes", async () => {
    expect(await editRecipe(undefined, form())).toEqual({ status: "saved", at: expect.any(Number) });

    expect(saveRecipe).toHaveBeenCalledWith(USER, MEAL, {
      meal: {
        name: "Chilli",
        kcal: 612,
        proteinG: 48.5,
        fatG: 14,
        carbG: 62,
        method: "Brown.\nSimmer.",
        notes: null,
      },
      ingredients: [expect.objectContaining({ id: null, name: "Garlic", grams: 6 })],
    });
    expect(refresh).toHaveBeenCalledOnce();
  });

  test("refuses a demo session before reading or writing anything", async () => {
    getSession.mockResolvedValue({ userId: USER, kind: "demo" });

    // A valid submission: what refuses it is the session, not the form.
    expect(await editRecipe(undefined, form())).toEqual({ status: "refused" });
    expect(saveRecipe).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
  });

  test("refuses a demo session even when the form is malformed", async () => {
    getSession.mockResolvedValue({ userId: USER, kind: "demo" });

    // Not "invalid": a demo visitor learns nothing about the parser.
    expect(await editRecipe(undefined, form("{"))).toEqual({ status: "refused" });
  });

  test("fails without a session", async () => {
    getSession.mockResolvedValue(undefined);

    expect(await editRecipe(undefined, form())).toEqual({ status: "failed" });
    expect(saveRecipe).not.toHaveBeenCalled();
  });

  test("returns per-field errors and writes nothing for an invalid recipe", async () => {
    const state = await editRecipe(undefined, form({ ...DRAFT, kcal: "lots" }));

    expect(state).toEqual({ status: "invalid", errors: { kcal: expect.any(String) } });
    expect(saveRecipe).not.toHaveBeenCalled();
  });

  test("refuses a submission that names no meal", async () => {
    expect(await editRecipe(undefined, form(DRAFT, null))).toEqual({ status: "refused" });
    expect(saveRecipe).not.toHaveBeenCalled();
  });

  test("refuses a meal id that is not a uuid before parsing or writing", async () => {
    expect(await editRecipe(undefined, form("{", "not-a-meal"))).toEqual({ status: "refused" });
    expect(saveRecipe).not.toHaveBeenCalled();
  });

  test("refuses a meal the write did not find — another account's, or none", async () => {
    saveRecipe.mockResolvedValue(false);

    expect(await editRecipe(undefined, form())).toEqual({ status: "refused" });
    expect(refresh).not.toHaveBeenCalled();
  });

  test("never throws: a failed write is a state", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    saveRecipe.mockRejectedValue(new Error("connection reset"));

    expect(await editRecipe(undefined, form())).toEqual({ status: "failed" });
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });
});
