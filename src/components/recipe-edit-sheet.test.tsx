import { act, cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import type { RecipeEditState } from "@/app/actions/recipe";
import type { EstimateState } from "@/app/actions/recipe-estimate";
import { parseMethod } from "@/lib/recipe";
import { blankIngredient, RECIPE_FIELD, type RecipeDraft } from "@/lib/recipe-edit";
import { seedMeals } from "@/lib/seed/meals";

import { RecipeEditor } from "./recipe-edit-sheet";
import { RecipePrep } from "./recipe-prep";

/**
 * The recipe edit sheet — FUEL-147.
 *
 * The action is mocked: what it refuses is `actions/recipe.test.ts`'s, and
 * what the write does is the integration suite's. What is left is what the
 * sheet sends, what it shows while it waits, and that its preview is the
 * screen's own reading of the method.
 */

const { editRecipe, estimateMacros } = vi.hoisted(() => ({
  editRecipe: vi.fn(),
  estimateMacros: vi.fn(),
}));

vi.mock("@/app/actions/recipe", () => ({ editRecipe }));
vi.mock("@/app/actions/recipe-estimate", () => ({ estimateMacros }));

const MEAL = "3f2b8a1e-9c4d-4e5f-8a6b-7c8d9e0f1a2b";
const GARLIC = "aaaaaaaa-bbbb-4ccc-8ddd-000000000001";
const BEANS = "aaaaaaaa-bbbb-4ccc-8ddd-000000000002";

const DRAFT: RecipeDraft = {
  name: "Chilli",
  kcal: "612",
  proteinG: "48.5",
  fatG: "14",
  carbG: "62",
  method: "Brown the mince.\nAdd the beans.\n\nJars keep 4 days.",
  notes: "Freezes well.",
  ingredients: [
    { ...blankIngredient(), id: GARLIC, name: "Garlic", grams: "6", category: "produce" },
    { ...blankIngredient(), id: BEANS, name: "Beans", nonScaleMeasure: "1 tin" },
  ],
};

async function open(draft: RecipeDraft = DRAFT) {
  const user = userEvent.setup();
  render(<RecipeEditor mealId={MEAL} slot="Dinner" draft={draft} />);
  await user.click(screen.getByRole("button", { name: "Edit" }));
  const sheet = within(await screen.findByRole("dialog", { name: "Edit recipe" }));
  return { user, sheet };
}

/** The draft the last submission carried. */
function submitted(): { mealId: unknown; draft: RecipeDraft } {
  const form = editRecipe.mock.lastCall?.[1] as FormData | undefined;
  if (!form) throw new Error("nothing was submitted");
  return {
    mealId: form.get("mealId"),
    draft: JSON.parse(String(form.get(RECIPE_FIELD))) as RecipeDraft,
  };
}

/** A held answer, released by the test — memory: optimistic state needs a held promise. */
function hold() {
  let release: (state: RecipeEditState) => void = () => {};
  editRecipe.mockReturnValue(new Promise<RecipeEditState>((resolve) => (release = resolve)));
  return (state: RecipeEditState) => act(async () => release(state));
}

const names = (sheet: Pick<typeof screen, "getAllByRole">) =>
  sheet.getAllByRole("textbox", { name: "Name" }).map((input) => (input as HTMLInputElement).value);

beforeEach(() => {
  vi.clearAllMocks();
  editRecipe.mockResolvedValue({ status: "saved", at: 1 });
});

afterEach(cleanup);

describe("opening", () => {
  test("the sheet opens on the stored recipe, every field filled", async () => {
    const { sheet } = await open();

    expect(names(sheet)).toEqual(["Chilli", "Garlic", "Beans"]);
    expect((sheet.getByRole("textbox", { name: /^Calories/ }) as HTMLInputElement).value).toBe("612");
    expect((sheet.getByRole("textbox", { name: "Method" }) as HTMLTextAreaElement).value).toBe(DRAFT.method);
    expect((sheet.getByRole("textbox", { name: "Notes" }) as HTMLTextAreaElement).value).toBe(DRAFT.notes);
    expect((sheet.getAllByRole("combobox", { name: "Aisle" })[0] as HTMLSelectElement).value).toBe("produce");
  });

  test("a dismissed draft is discarded: reopening starts from the stored recipe", async () => {
    const { user, sheet } = await open();

    await user.clear(sheet.getAllByRole("textbox", { name: "Name" })[0]!);
    await user.type(sheet.getAllByRole("textbox", { name: "Name" })[0]!, "Something else");
    await user.keyboard("{Escape}");
    await user.click(await screen.findByRole("button", { name: "Edit" }));

    const reopened = within(await screen.findByRole("dialog", { name: "Edit recipe" }));
    expect(names(reopened)[0]).toBe("Chilli");
    expect(editRecipe).not.toHaveBeenCalled();
  });
});

describe("the method preview", () => {
  const stepsOf = (container: HTMLElement) =>
    [...container.querySelectorAll("ol > li")].map((li) => li.textContent?.trim());

  test.each(seedMeals.filter((meal) => meal.method).map((meal) => [meal.key, meal.method!]))(
    "numbers %s's steps exactly as the recipe screen does",
    async (_, method) => {
      const { sheet } = await open({ ...DRAFT, method, ingredients: [] });
      const preview = sheet.getByRole("region", { name: "Method preview" });

      const { container } = render(
        <RecipePrep userId="u" mealId={MEAL} date={null} ingredients={[]} method={parseMethod(method)} />,
      );

      // The screen's step text carries the number column too, hidden from the
      // tree but not from `textContent` — in both, the same way.
      expect(stepsOf(preview)).toEqual(stepsOf(container));
      expect(stepsOf(preview).length).toBe(parseMethod(method)!.steps.length);
    },
  );

  test("follows the textarea as it is typed", async () => {
    const { user, sheet } = await open({ ...DRAFT, method: "" });
    const preview = sheet.getByRole("region", { name: "Method preview" });

    expect(within(preview).getByText("No method recorded.")).toBeTruthy();

    await user.type(sheet.getByRole("textbox", { name: "Method" }), "Chop.{Enter}Fry.{Enter}{Enter}Serve hot.");

    expect(within(preview).getAllByRole("listitem").map((li) => li.textContent)).toEqual(["1Chop.", "2Fry."]);
    expect(within(preview).getByText("Serve hot.")).toBeTruthy();
  });
});

describe("the ingredient list", () => {
  test("moves, removes and adds rows, and sends them in the order shown with their ids", async () => {
    const { user, sheet } = await open();

    await user.click(sheet.getByRole("button", { name: "Move Beans up" }));
    expect(names(sheet)).toEqual(["Chilli", "Beans", "Garlic"]);
    // Focus follows the row it moved; Move up is now disabled, so it is Down.
    expect(document.activeElement).toBe(sheet.getByRole("button", { name: "Move Beans down" }));

    await user.click(sheet.getByRole("button", { name: "Remove Garlic" }));
    await user.click(sheet.getByRole("button", { name: "Add ingredient" }));

    // A new row's name takes focus, so typing names it.
    await user.keyboard("Cumin");
    await user.click(sheet.getByRole("button", { name: "Save recipe" }));

    const { mealId, draft } = submitted();
    expect(mealId).toBe(MEAL);
    expect(draft.ingredients.map((row) => [row.id, row.name])).toEqual([
      [BEANS, "Beans"],
      [null, "Cumin"],
    ]);
  });

  test("removing the last row says so and puts focus on Add", async () => {
    const { user, sheet } = await open({ ...DRAFT, ingredients: [DRAFT.ingredients[0]!] });

    await user.click(sheet.getByRole("button", { name: "Remove Garlic" }));

    expect(sheet.getByText("No ingredients recorded.")).toBeTruthy();
    expect(document.activeElement).toBe(sheet.getByRole("button", { name: "Add ingredient" }));
  });

  test("an unnamed row's buttons name its place", async () => {
    const { user, sheet } = await open();

    await user.click(sheet.getByRole("button", { name: "Add ingredient" }));

    expect(sheet.getByRole("button", { name: "Remove ingredient 3" })).toBeTruthy();
  });
});

describe("saving", () => {
  test("says it is saving while the action runs, then closes", async () => {
    const release = hold();
    const { user, sheet } = await open();

    await user.click(sheet.getByRole("button", { name: "Save recipe" }));

    expect(await sheet.findByRole("button", { name: "Saving…" })).toHaveProperty("disabled", true);

    await release({ status: "saved", at: 2 });

    expect(screen.queryByRole("dialog")).toBeNull();
  });

  test("a refusal keeps the sheet open, with each reason under its field", async () => {
    editRecipe.mockResolvedValue({
      status: "invalid",
      errors: { kcal: "A whole number from 0 to 5000.", "ingredients.1.grams": "Blank, or from 0.1 to 9999.9g." },
    });
    const { user, sheet } = await open();

    await user.click(sheet.getByRole("button", { name: "Save recipe" }));

    const kcal = await sheet.findByRole("textbox", { name: /^Calories/ });
    expect(kcal.getAttribute("aria-invalid")).toBe("true");
    expect(document.getElementById(kcal.getAttribute("aria-describedby")!)?.textContent).toBe(
      "A whole number from 0 to 5000.",
    );

    const beansWeight = sheet.getAllByRole("textbox", { name: /^Weight/ })[1]!;
    expect(beansWeight.getAttribute("aria-invalid")).toBe("true");
    expect(sheet.getByText("Nothing was saved — check the fields above.")).toBeTruthy();
  });

  test.each([
    [{ status: "refused" } as const, "This recipe can't be edited."],
    [{ status: "failed" } as const, "Could not save. Try again."],
  ])("says %o in the footer and stays open", async (state, message) => {
    editRecipe.mockResolvedValue(state);
    const { user, sheet } = await open();

    await user.click(sheet.getByRole("button", { name: "Save recipe" }));

    expect(await sheet.findByText(message)).toBeTruthy();
    expect(screen.getByRole("dialog")).toBeTruthy();
  });
});

describe("focus", () => {
  test("opens on the sheet, not on a selected name, and Tab reaches the name", async () => {
    const { user, sheet } = await open();

    expect(document.activeElement).toBe(screen.getByRole("dialog"));

    await user.tab();
    expect(document.activeElement).toBe(sheet.getAllByRole("textbox", { name: "Name" })[0]);
  });

  test("closing gives focus back to Edit", async () => {
    const { user } = await open();

    await user.keyboard("{Escape}");

    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Edit" }));
  });
});

describe("reassessing the macros (FUEL-148)", () => {
  const ESTIMATE = {
    kcal: 640,
    proteinG: 45.2,
    fatG: 14,
    carbG: 70,
    rationale: "USDA figures; the beans drained.",
    assumptions: ["Beans: 1 tin at 240 g drained"],
  };

  /** A held estimate, released by the test. */
  function holdEstimate() {
    let release: (state: EstimateState) => void = () => {};
    estimateMacros.mockReturnValue(new Promise<EstimateState>((resolve) => (release = resolve)));
    return (state: EstimateState) => act(async () => release(state));
  }

  const figure = (sheet: Pick<typeof screen, "getByRole">, name: RegExp) =>
    (sheet.getByRole("textbox", { name }) as HTMLInputElement).value;

  const figures = (sheet: Pick<typeof screen, "getByRole">) =>
    [/^Calories/, /^Protein/, /^Fat/, /^Carbs/].map((name) => figure(sheet, name));

  async function estimated(state: EstimateState = { status: "estimated", estimate: ESTIMATE, gap: null }) {
    const opened = await open();
    const release = holdEstimate();

    await opened.user.click(opened.sheet.getByRole("button", { name: "Reassess macros" }));
    expect(await opened.sheet.findByRole("button", { name: "Estimating…" })).toBeTruthy();
    await release(state);

    return opened;
  }

  test("sends the draft as it stands, unsaved edits included", async () => {
    const { user, sheet } = await open();
    estimateMacros.mockResolvedValue({ status: "estimated", estimate: ESTIMATE, gap: null });

    await user.type(sheet.getAllByRole("textbox", { name: /^Weight/ })[1]!, "240");
    await user.click(sheet.getByRole("button", { name: "Reassess macros" }));

    const sent = JSON.parse(String(estimateMacros.mock.lastCall?.[0])) as RecipeDraft;
    expect(sent.ingredients[1]).toMatchObject({ name: "Beans", grams: "240" });
    expect(editRecipe).not.toHaveBeenCalled();
  });

  test("shows current against proposed, with the difference, the rationale and the assumptions", async () => {
    const { sheet } = await estimated();
    const report = within(await sheet.findByRole("region", { name: "Proposed macros" }));

    const rows = report.getAllByRole("row").slice(1).map((row) =>
      within(row).getAllByRole("cell").map((cell) => cell.textContent),
    );

    expect(rows).toEqual([
      ["612", "640", "+28"],
      ["48.5", "45.2", "−3.3"],
      ["14", "14", "0"],
      ["62", "70", "+8"],
    ]);
    expect(report.getByText("USDA figures; the beans drained.")).toBeTruthy();
    expect(report.getByText("Beans: 1 tin at 240 g drained")).toBeTruthy();
    expect(report.queryByText(/4 × protein/)).toBeNull();
  });

  test("flags a calorie figure that disagrees with its macros, without correcting it", async () => {
    const { sheet } = await estimated({ status: "estimated", estimate: ESTIMATE, gap: -90 });

    expect(await sheet.findByText(/proposed calories are −90 kcal from 4 × protein/)).toBeTruthy();
    expect(within(sheet.getByRole("region", { name: "Proposed macros" })).getAllByRole("row")[1]!.textContent).toContain("640");
  });

  test("Accept fills the four fields, still editable, and saves nothing", async () => {
    const { user, sheet } = await estimated();

    await user.click(await sheet.findByRole("button", { name: "Accept" }));

    expect(figures(sheet)).toEqual(["640", "45.2", "14", "70"]);
    expect(sheet.queryByRole("region", { name: "Proposed macros" })).toBeNull();
    expect(editRecipe).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(sheet.getByRole("button", { name: "Reassess macros" }));

    await user.clear(sheet.getByRole("textbox", { name: /^Calories/ }));
    await user.type(sheet.getByRole("textbox", { name: /^Calories/ }), "650");
    await user.click(sheet.getByRole("button", { name: "Save recipe" }));

    expect(submitted().draft).toMatchObject({ kcal: "650", proteinG: "45.2", fatG: "14", carbG: "70" });
  });

  test("Discard changes nothing", async () => {
    const { user, sheet } = await estimated();

    await user.click(await sheet.findByRole("button", { name: "Discard" }));

    expect(figures(sheet)).toEqual(["612", "48.5", "14", "62"]);
    expect(sheet.queryByRole("region", { name: "Proposed macros" })).toBeNull();
    expect(editRecipe).not.toHaveBeenCalled();
  });

  test("an edit to the ingredients withdraws the estimate, and says why", async () => {
    const { user, sheet } = await estimated();
    await sheet.findByRole("region", { name: "Proposed macros" });

    await user.type(sheet.getAllByRole("textbox", { name: /^Weight/ })[1]!, "1");

    expect(sheet.queryByRole("region", { name: "Proposed macros" })).toBeNull();
    expect(sheet.getByText("The recipe changed since that estimate. Reassess again.")).toBeTruthy();
  });

  test("typing over a figure keeps the estimate: that is what it is compared against", async () => {
    const { user, sheet } = await estimated();
    await sheet.findByRole("region", { name: "Proposed macros" });

    await user.clear(sheet.getByRole("textbox", { name: /^Calories/ }));
    await user.type(sheet.getByRole("textbox", { name: /^Calories/ }), "600");

    const row = within(sheet.getByRole("region", { name: "Proposed macros" })).getAllByRole("row")[1]!;
    expect(within(row).getAllByRole("cell").map((cell) => cell.textContent)).toEqual(["600", "640", "+40"]);
  });

  test.each([
    ["declined", "Couldn't estimate — the model declined this recipe. Nothing was changed."],
    ["malformed", "Couldn't estimate — the answer couldn't be read. Nothing was changed. Try again."],
    ["failed", "Couldn't estimate — the request failed. Nothing was changed. Try again."],
    ["unavailable", "Couldn't estimate — reassessment isn't set up here. Nothing was changed."],
    ["refused", "Only the owner can reassess a recipe."],
    ["empty", "Add a name and at least one ingredient to estimate."],
  ] as const)("a %s estimate says so and leaves the form untouched", async (status, message) => {
    const { sheet } = await estimated({ status });

    expect(await sheet.findByText(message)).toBeTruthy();
    expect(figures(sheet)).toEqual(["612", "48.5", "14", "62"]);
    expect(sheet.queryByRole("region", { name: "Proposed macros" })).toBeNull();
  });

  test("a request that never reaches the action is a failure, not a crash", async () => {
    const { user, sheet } = await open();
    estimateMacros.mockRejectedValue(new TypeError("Failed to fetch"));

    await user.click(sheet.getByRole("button", { name: "Reassess macros" }));

    expect(await sheet.findByText(/the request failed/)).toBeTruthy();
    expect(figures(sheet)).toEqual(["612", "48.5", "14", "62"]);
  });

  test("a blank figure on the form has no difference to show", async () => {
    const { user, sheet } = await open({ ...DRAFT, kcal: "" });
    estimateMacros.mockResolvedValue({ status: "estimated", estimate: ESTIMATE, gap: null });

    await user.click(sheet.getByRole("button", { name: "Reassess macros" }));

    const row = within(await sheet.findByRole("region", { name: "Proposed macros" })).getAllByRole("row")[1]!;
    expect(within(row).getAllByRole("cell").map((cell) => cell.textContent)).toEqual(["—", "640", "—"]);
  });
});
