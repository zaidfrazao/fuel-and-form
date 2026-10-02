import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import type { RecipeIngredient } from "@/lib/db/queries/recipe";
import { ingredientTickId, prepKey, serialisePrep } from "@/lib/prep-ticks";
import { parseMethod, plain } from "@/lib/recipe";
import { seedMeals } from "@/lib/seed/meals";

import { RecipePrep, resetPrepStore } from "./recipe-prep";

/**
 * FUEL-144's prep lists — the acceptance criteria a rendered list can answer.
 *
 * A remount stands in for the reload and the locked phone: the component keeps
 * nothing of its own, so a fresh mount reading the same storage is exactly what
 * a reload is. Tick assertions use `findBy` (memory: optimistic assertions need
 * findBy) even though the write is synchronous — the store notifies React, and
 * React decides when to render.
 */

const CHILLI = seedMeals.find((meal) => meal.key === "beef-mince-chilli")!;
const METHOD = parseMethod(CHILLI.method)!;
const INGREDIENTS: RecipeIngredient[] = (CHILLI.ingredients ?? []).map((row, i) => ({
  id: `row-${i}`,
  name: row.name,
  grams: row.grams ?? null,
  nonScaleMeasure: row.nonScaleMeasure ?? null,
}));

const USER = "11111111-2222-3333-4444-555555555555";
const MEAL = "3f2b8a1e-9c4d-4e5f-8a6b-7c8d9e0f1a2b";
const DATE = "2026-10-02";

const KEY = prepKey(USER, DATE, MEAL);

function mount(props: Partial<Parameters<typeof RecipePrep>[0]> = {}) {
  return render(
    <RecipePrep
      userId={USER}
      mealId={MEAL}
      date={DATE}
      ingredients={INGREDIENTS}
      method={METHOD}
      {...props}
    />,
  );
}

/** A section by its heading, the way a reader finds it. */
const section = (name: string) => {
  const container = screen.getByRole("heading", { level: 2, name }).closest("section");
  if (!container) throw new Error(`no section ${name}`);
  return within(container);
};

const firstIngredient = INGREDIENTS[0]!.name;
const box = (name: string) =>
  screen.getByRole("checkbox", { name: new RegExp(`^${escape(name)}`) }) as HTMLInputElement;
const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

beforeEach(() => {
  window.localStorage.clear();
  resetPrepStore();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("every row ticks", () => {
  test("one checkbox per ingredient and per step, and none for the prose", () => {
    mount();

    expect(section("Ingredients").getAllByRole("checkbox")).toHaveLength(INGREDIENTS.length);
    expect(section("Method").getAllByRole("checkbox")).toHaveLength(METHOD.steps.length);

    // The chilli's baked-potato variant is prose after the steps, not a step.
    expect(METHOD.after.length).toBeGreaterThan(0);
    expect(screen.getAllByRole("checkbox")).toHaveLength(INGREDIENTS.length + METHOD.steps.length);
  });

  test("a step's checkbox is named by its text, not its number", () => {
    mount();

    const first = section("Method").getAllByRole("checkbox")[0]!;
    expect(first.closest("label")?.textContent).toMatch(/^1/);
    // The number is aria-hidden, so the name starts at the step itself.
    const text = plain(METHOD.steps[0]!);
    expect(section("Method").getByRole("checkbox", { name: text })).toBe(first);
  });

  test("each row is a 44px target with a pointer", () => {
    mount();

    for (const input of screen.getAllByRole("checkbox")) {
      const label = input.closest("label")!;
      expect(label.className).toMatch(/min-h-\[(44|46)px\]/);
      expect(label.className).toContain("cursor-pointer");
    }
  });
});

describe("n of m", () => {
  test("each list counts itself", async () => {
    mount();

    expect(section("Ingredients").getByText(`0 of ${INGREDIENTS.length}`)).toBeTruthy();
    expect(section("Method").getByText(`0 of ${METHOD.steps.length}`)).toBeTruthy();

    const steps = section("Method").getAllByRole("checkbox");
    await userEvent.click(box(firstIngredient));
    await userEvent.click(steps[0]!);
    await userEvent.click(steps[2]!);

    expect(await section("Ingredients").findByText(`1 of ${INGREDIENTS.length}`)).toBeTruthy();
    expect(await section("Method").findByText(`2 of ${METHOD.steps.length}`)).toBeTruthy();
  });

  test("the count is not in the heading's name, and not a live region", () => {
    mount();

    const count = section("Ingredients").getByText(`0 of ${INGREDIENTS.length}`);
    expect(count.closest("h2")).toBeNull();
    expect(count.closest("[aria-live]")).toBeNull();
  });

  test("an empty list has no count", () => {
    mount({ ingredients: [], method: null });

    expect(screen.queryByText(/ of /)).toBeNull();
    expect(screen.getByText("No ingredients recorded.")).toBeTruthy();
    expect(screen.getByText("No method recorded.")).toBeTruthy();
  });
});

describe("a tick is kept", () => {
  test("survives a reload", async () => {
    mount();
    await userEvent.click(box(firstIngredient));
    await screen.findByText(`1 of ${INGREDIENTS.length}`);

    cleanup();
    mount();

    expect(box(firstIngredient).checked).toBe(true);
    expect(window.localStorage.getItem(KEY)).toContain(ingredientTickId("row-0"));
  });

  test("a different date starts empty", async () => {
    mount();
    await userEvent.click(box(firstIngredient));
    await screen.findByText(`1 of ${INGREDIENTS.length}`);

    cleanup();
    mount({ date: "2026-10-03" });

    expect(box(firstIngredient).checked).toBe(false);
  });

  test("a different meal starts empty", async () => {
    mount();
    await userEvent.click(box(firstIngredient));
    await screen.findByText(`1 of ${INGREDIENTS.length}`);

    cleanup();
    mount({ mealId: "00000000-0000-4000-8000-000000000000" });

    expect(box(firstIngredient).checked).toBe(false);
  });

  test("another user on the same phone starts empty", async () => {
    mount();
    await userEvent.click(box(firstIngredient));
    await screen.findByText(`1 of ${INGREDIENTS.length}`);

    cleanup();
    mount({ userId: "99999999-2222-3333-4444-555555555555" });

    expect(box(firstIngredient).checked).toBe(false);
  });

  test("unticking removes the key rather than storing an empty list", async () => {
    mount();
    await userEvent.click(box(firstIngredient));
    await screen.findByText(`1 of ${INGREDIENTS.length}`);
    await userEvent.click(box(firstIngredient));

    expect(await screen.findByText(`0 of ${INGREDIENTS.length}`)).toBeTruthy();
    expect(window.localStorage.getItem(KEY)).toBeNull();
  });
});

describe("Clear", () => {
  test("is absent with nothing to clear", () => {
    mount();
    expect(screen.queryByRole("button", { name: "Clear ticks" })).toBeNull();
  });

  test("resets both lists and hands focus to the first box", async () => {
    mount();
    await userEvent.click(box(firstIngredient));
    await userEvent.click(section("Method").getAllByRole("checkbox")[0]!);

    await userEvent.click(await screen.findByRole("button", { name: "Clear ticks" }));

    expect(await section("Ingredients").findByText(`0 of ${INGREDIENTS.length}`)).toBeTruthy();
    expect(section("Method").getByText(`0 of ${METHOD.steps.length}`)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Clear ticks" })).toBeNull();
    expect(window.localStorage.getItem(KEY)).toBeNull();
    expect(document.activeElement).toBe(box(firstIngredient));
  });

  test("is a 44px target with a pointer", async () => {
    mount();
    await userEvent.click(box(firstIngredient));

    const clear = await screen.findByRole("button", { name: "Clear ticks" });
    expect(clear.className).toContain("min-h-11");
    expect(clear.className).toContain("cursor-pointer");
  });
});

describe("storage is untrusted", () => {
  test.each([
    ["garbage", "}{not json"],
    ["the wrong shape", '{"ticked":"row-0"}'],
    ["ids from another recipe", JSON.stringify({ ticked: ["i:elsewhere", "s:0:00000000"] })],
  ])("%s renders as no ticks", (_, value) => {
    window.localStorage.setItem(KEY, value);
    mount();

    expect(screen.getAllByRole("checkbox").every((input) => !(input as HTMLInputElement).checked)).toBe(true);
    expect(section("Ingredients").getByText(`0 of ${INGREDIENTS.length}`)).toBeTruthy();
  });

  test("a hand-edited value keeps the ticks it can still name", () => {
    window.localStorage.setItem(
      KEY,
      JSON.stringify({ ticked: [ingredientTickId("row-0"), 7, "i:nope"] }),
    );
    mount();

    expect(box(firstIngredient).checked).toBe(true);
    expect(section("Ingredients").getByText(`1 of ${INGREDIENTS.length}`)).toBeTruthy();
  });

  test("storage that throws still ticks for the session", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });

    mount();
    await userEvent.click(box(firstIngredient));

    expect(await screen.findByText(`1 of ${INGREDIENTS.length}`)).toBeTruthy();
    expect(box(firstIngredient).checked).toBe(true);
  });

  test("a refused write is not shadowed by an older stored value", async () => {
    window.localStorage.setItem(KEY, serialisePrep(new Set([ingredientTickId("row-0")]))!);
    mount();
    expect(box(firstIngredient).checked).toBe(true);

    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    await userEvent.click(box(firstIngredient));

    expect(await screen.findByText(`0 of ${INGREDIENTS.length}`)).toBeTruthy();
    expect(box(firstIngredient).checked).toBe(false);
  });
});

describe("no date is the library's view", () => {
  test("ticks work, and nothing reaches storage", async () => {
    mount({ date: null });
    await userEvent.click(box(firstIngredient));

    expect(await screen.findByText(`1 of ${INGREDIENTS.length}`)).toBeTruthy();
    expect(window.localStorage.length).toBe(0);
  });

  test("a reload starts clean", async () => {
    mount({ date: null });
    await userEvent.click(box(firstIngredient));
    await screen.findByText(`1 of ${INGREDIENTS.length}`);

    cleanup();
    resetPrepStore(); // a reload is a fresh module, and its memory with it
    mount({ date: null });

    expect(box(firstIngredient).checked).toBe(false);
  });

  test("never lends its ticks to a dated view of the same meal", async () => {
    mount({ date: null });
    await userEvent.click(box(firstIngredient));
    await screen.findByText(`1 of ${INGREDIENTS.length}`);

    cleanup();
    mount();

    expect(box(firstIngredient).checked).toBe(false);
  });
});

describe("pruning", () => {
  test("drops prep keys more than a week old, and nothing else", () => {
    vi.useFakeTimers({ now: new Date("2026-10-02T12:00:00Z"), toFake: ["Date"] });

    const old = prepKey(USER, "2026-09-01", MEAL);
    const recent = prepKey(USER, "2026-09-30", MEAL);
    window.localStorage.setItem(old, '{"ticked":[]}');
    window.localStorage.setItem(recent, '{"ticked":[]}');
    window.localStorage.setItem("fuel:training-session:2026-09-01", "1");

    mount();
    vi.useRealTimers();

    expect(window.localStorage.getItem(old)).toBeNull();
    expect(window.localStorage.getItem(recent)).not.toBeNull();
    expect(window.localStorage.getItem("fuel:training-session:2026-09-01")).toBe("1");
  });
});
