import { act, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import type { Recipe } from "@/lib/db/queries/recipe";
import { draftOf } from "@/lib/recipe-edit";
import { seedMeals } from "@/lib/seed/meals";

/**
 * `/recipe/[mealId]` — FUEL-143.
 *
 * The query is mocked, so what this file can prove is the page's own logic:
 * no session redirects, no recipe 404s, and a recipe renders in kitchen order
 * with its empty states said in words. Whether another account's meal ever
 * comes back as "no recipe" is `tests/integration/recipe.test.ts`'s question.
 */

const { redirect, notFound, getSession, loadRecipe } = vi.hoisted(() => ({
  // Both throw, as the real ones do — a mock that only recorded the call would
  // let the page render on with no session, or with no recipe.
  redirect: vi.fn((path: string) => {
    throw new Error(`NEXT_REDIRECT:${path}`);
  }),
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
  getSession: vi.fn(),
  loadRecipe: vi.fn(),
}));

vi.mock("next/navigation", () => ({ redirect, notFound }));
vi.mock("@/lib/auth/session", () => ({ getSession }));
// FUEL-148: the edit sheet's Reassess macros imports it, and its modules are server-only.
vi.mock("@/app/actions/recipe-estimate", () => ({ estimateMacros: vi.fn() }));
/** A draft for a mocked recipe: its rows, with no shop reading. */
function draftFromRecipe(recipe: Recipe) {
  return draftOf(
    recipe.meal,
    recipe.ingredients.map((row) => ({
      ...row,
      shopName: null,
      shopQty: null,
      shopUnit: null,
      category: null,
      pantry: false,
    })),
  );
}

/*
 * The owner's read is `loadEditableRecipe` since FUEL-147, which is
 * `loadRecipe`'s rows plus a draft. Mocked through `loadRecipe`, so every
 * test that stubs or asserts on that mock still describes the page's one read.
 */
vi.mock("@/lib/db/queries/recipe", () => ({
  loadRecipe,
  loadEditableRecipe: async (userId: string, mealId: string) => {
    const recipe = await loadRecipe(userId, mealId);

    return recipe && { recipe, draft: draftFromRecipe(recipe) };
  },
}));

const { default: RecipePage } = await import("./page");

const SESSION = { userId: "11111111-2222-3333-4444-555555555555", kind: "owner" as const };
const MEAL_ID = "3f2b8a1e-9c4d-4e5f-8a6b-7c8d9e0f1a2b";

/** A recipe built from the seed, so the screen is tested on real text. */
function fromSeed(key: string): Recipe {
  const seed = seedMeals.find((meal) => meal.key === key);
  if (!seed) throw new Error(`no seeded meal ${key}`);

  return {
    meal: {
      id: MEAL_ID,
      name: seed.name,
      slotType: seed.slotType,
      kcal: seed.kcal,
      proteinG: seed.proteinG,
      fatG: seed.fatG,
      carbG: seed.carbG,
      method: seed.method ?? null,
      notes: seed.notes ?? null,
    },
    ingredients: (seed.ingredients ?? []).map((row, i) => ({
      id: `ingredient-${i}`,
      name: row.name,
      grams: row.grams ?? null,
      nonScaleMeasure: row.nonScaleMeasure ?? null,
    })),
  };
}

const CHILLI = fromSeed("beef-mince-chilli");

const page = async (params: Record<string, string> = {}, mealId = MEAL_ID) =>
  render(
    await RecipePage({
      params: Promise.resolve({ mealId }),
      searchParams: Promise.resolve(params),
    }),
  );

const section = (name: string) => {
  const heading = screen.getByRole("heading", { level: 2, name });
  const container = heading.closest("section");
  if (!container) throw new Error(`no section for ${name}`);
  return within(container);
};

beforeEach(() => {
  vi.clearAllMocks();
  getSession.mockResolvedValue(SESSION);
  loadRecipe.mockResolvedValue(CHILLI);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the boundaries", () => {
  test("no session goes to /login before anything is read", async () => {
    getSession.mockResolvedValue(null);

    await expect(page()).rejects.toThrow("NEXT_REDIRECT:/login");
    expect(loadRecipe).not.toHaveBeenCalled();
  });

  test("no recipe is a 404", async () => {
    loadRecipe.mockResolvedValue(undefined);

    await expect(page()).rejects.toThrow("NEXT_NOT_FOUND");
  });

  test("the meal is read as the session's user, by the address's id", async () => {
    await page();

    expect(loadRecipe).toHaveBeenCalledWith(SESSION.userId, MEAL_ID);
  });
});

describe("a recipe, in kitchen order", () => {
  test("the meal's name is the screen's only h1", async () => {
    await page();

    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Lean Beef Mince Chilli");
  });

  test("the sections come in the order the meal is made", async () => {
    await page();

    expect(screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent)).toEqual([
      "Ingredients",
      "Method",
      "Notes",
    ]);
  });

  test("the tile counts the recipe rather than repeating its figures", async () => {
    await page();

    expect(screen.getByText("16 ingredients · 10 steps")).toBeTruthy();
  });

  test("the four figures are the meal's, per serving", async () => {
    await page();

    expect(screen.getByText("355")).toBeTruthy();
    expect(screen.getByText("41 g")).toBeTruthy();
    expect(screen.getByText("1 serving")).toBeTruthy();
  });

  test("ingredients print the kitchen's measure, in recipe order", async () => {
    await page();

    const rows = section("Ingredients").getAllByRole("listitem");
    expect(rows).toHaveLength(16);
    expect(rows[0]?.textContent).toBe("Beef mince, 5% fatabout the size of your fist150 g");
    expect(rows[1]?.textContent).toBe("Onion1/2 small, diced");
  });

  test("the steps are an ordered list of ten, and the variant is not one of them", async () => {
    await page();

    const method = section("Method");
    const steps = method.getAllByRole("listitem");

    expect(method.getByRole("list").tagName).toBe("OL");
    expect(steps).toHaveLength(10);
    expect(steps[0]?.textContent).toMatch(/^1Start the rice first\./);
    expect(steps.some((step) => step.textContent?.includes("Baked potato"))).toBe(false);

    // The variant is there, under the steps, with its lead in bold.
    const lead = method.getByText("Baked potato instead of rice:");
    expect(lead.tagName).toBe("STRONG");
  });

  test("the steak's heat guide is a table above step 1", async () => {
    loadRecipe.mockResolvedValue(fromSeed("steak-chips-peppercorn"));
    await page();

    const method = section("Method");
    const table = method.getByRole("table");

    expect(within(table).getAllByRole("columnheader").map((th) => th.textContent)).toEqual([
      "Stage",
      "Heat",
    ]);
    expect(within(table).getAllByRole("row")).toHaveLength(5);
    expect(method.getByRole("heading", { level: 3, name: "Heat guide" })).toBeTruthy();
    expect(method.queryByRole("heading", { name: "Steps" })).toBeNull();
    expect(method.getAllByRole("listitem")).toHaveLength(9);

    // The table precedes the list in document order.
    const list = method.getByRole("list");
    expect(table.compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  test("markup the parser does not honour is printed, never parsed into the DOM", async () => {
    loadRecipe.mockResolvedValue({
      ...CHILLI,
      meal: { ...CHILLI.meal, method: '<img src=x onerror="alert(1)">Stir.', notes: null },
    });
    await page();

    expect(document.querySelector("img")).toBeNull();
    expect(screen.getByText('<img src=x onerror="alert(1)">Stir.')).toBeTruthy();
  });
});

describe("empty, quietly", () => {
  test("no method says so, and draws no list", async () => {
    loadRecipe.mockResolvedValue({ ...CHILLI, meal: { ...CHILLI.meal, method: null } });
    await page();

    const method = section("Method");
    expect(method.getByText("No method recorded.")).toBeTruthy();
    expect(method.queryByRole("list")).toBeNull();
    expect(screen.getByText("16 ingredients")).toBeTruthy();
  });

  test("a whitespace-only method is no method", async () => {
    loadRecipe.mockResolvedValue({ ...CHILLI, meal: { ...CHILLI.meal, method: " \n\n " } });
    await page();

    expect(section("Method").getByText("No method recorded.")).toBeTruthy();
  });

  test("no ingredients says so, and draws no list", async () => {
    loadRecipe.mockResolvedValue({ ...CHILLI, ingredients: [] });
    await page();

    const ingredients = section("Ingredients");
    expect(ingredients.getByText("No ingredients recorded.")).toBeTruthy();
    expect(ingredients.queryByRole("list")).toBeNull();
    expect(screen.getByText("10 steps")).toBeTruthy();
  });

  test("no notes is no Notes section at all", async () => {
    loadRecipe.mockResolvedValue({ ...CHILLI, meal: { ...CHILLI.meal, notes: null } });
    await page();

    expect(screen.queryByRole("heading", { name: "Notes" })).toBeNull();
  });

  test("a meal with nothing but its macros has no slash line on its tile", async () => {
    loadRecipe.mockResolvedValue({
      ...CHILLI,
      meal: { ...CHILLI.meal, method: null, notes: null },
      ingredients: [],
    });
    await page();

    expect(screen.queryByText(/\d+ (ingredient|step)/)).toBeNull();
  });
});

describe("the up-link", () => {
  const upLink = () => screen.getByRole("link", { name: "Back to Plan" });

  test("goes up to the plan", async () => {
    await page();

    expect(upLink().getAttribute("href")).toBe("/plan");
  });

  test("returns to the week the plan's date falls in", async () => {
    // A Wednesday; its week starts on the Monday before.
    await page({ date: "2026-03-11" });

    expect(upLink().getAttribute("href")).toBe("/plan?week=2026-03-09");
  });

  test("a date that is not a date is dropped, not an error", async () => {
    await page({ date: "tuesday" });

    expect(upLink().getAttribute("href")).toBe("/plan");
  });
});

describe("the screen stays on", () => {
  /*
   * FUEL-145. The lock's lifecycle is `keep-awake.test.tsx`'s; what this proves
   * is that the route takes it at all — a `KeepAwake` dropped from the page
   * would leave every one of those tests green.
   */
  test("a wake lock is requested when the recipe opens", async () => {
    const request = vi.fn(async () => ({ released: false, release: vi.fn(async () => {}) }));

    vi.stubGlobal(
      "navigator",
      Object.assign(Object.create(navigator), { wakeLock: { request } }),
    );

    await page();
    await act(async () => {});

    expect(request).toHaveBeenCalledWith("screen");
  });
});

describe("editing, for the owner only", () => {
  /*
   * FUEL-147. The action refuses a demo session on its own terms
   * (`actions/recipe.test.ts`); this is the other half of the criterion — no
   * control is rendered for one at all, not a disabled one.
   */
  test("the owner is offered Edit on the up-link's row", async () => {
    await page();

    const edit = screen.getByRole("button", { name: "Edit" });
    expect(edit.parentElement?.contains(screen.getByRole("link", { name: "Back to Plan" }))).toBe(true);
  });

  test("a demo session is offered no Edit control", async () => {
    getSession.mockResolvedValue({ ...SESSION, kind: "demo" });

    await page();

    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Lean Beef Mince Chilli");
    expect(screen.queryByRole("button", { name: "Edit" })).toBeNull();
  });

  test("a demo session's meal is still read as its own user", async () => {
    getSession.mockResolvedValue({ ...SESSION, kind: "demo" });

    await page();

    expect(loadRecipe).toHaveBeenCalledWith(SESSION.userId, MEAL_ID);
  });
});
