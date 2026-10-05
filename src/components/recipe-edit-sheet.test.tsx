import { act, cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import type { RecipeEditState } from "@/app/actions/recipe";
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

const { editRecipe } = vi.hoisted(() => ({ editRecipe: vi.fn() }));

vi.mock("@/app/actions/recipe", () => ({ editRecipe }));

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

const names = (sheet: ReturnType<typeof within>) =>
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
