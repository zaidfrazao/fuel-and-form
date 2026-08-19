import { beforeEach, describe, expect, test, vi } from "vitest";

import type { Meal } from "@/lib/db/schema";

/**
 * The template's action layer — what a tap on "Save to every Tuesday" is
 * allowed to write, and what it must refuse.
 *
 * The collaborators are mocked because all of them ARE the request: a session
 * cookie, a database connection and the router's refresh. What is left is the
 * part only this file does, and it carries a security argument the swap's does
 * not have to make. A swap derives its date and slot server-side from an item
 * key; this action cannot, because "every Thursday" exists nowhere but in the
 * request. So all three values cross the wire, and all three are checked here —
 * the two guards and the library lookup are the whole of the boundary.
 *
 * The statements themselves are covered against real Postgres in
 * tests/integration/template.test.ts, including the guarantee this file cannot
 * observe: that a template write touches no `day_plan_overrides` row.
 */

const { getSession, loadTemplate, writeTemplateEntry, clearTemplateEntry, refresh } =
  vi.hoisted(() => ({
    getSession: vi.fn(),
    loadTemplate: vi.fn(),
    writeTemplateEntry: vi.fn(),
    clearTemplateEntry: vi.fn(),
    refresh: vi.fn(),
  }));

vi.mock("@/lib/auth/session", () => ({ getSession }));
vi.mock("@/lib/db/queries/template", () => ({
  loadTemplate,
  writeTemplateEntry,
  clearTemplateEntry,
}));
vi.mock("next/cache", () => ({ refresh }));

const { setTemplateMeal, clearTemplateMeal } = await import("./template");

const USER = "11111111-2222-3333-4444-555555555555";
const SESSION = { userId: USER, kind: "owner" as const };

const meal = (id: string, name: string, fields: Partial<Meal> = {}): Meal => ({
  id,
  userId: USER,
  name,
  slotType: "dinner",
  kcal: 700,
  proteinG: 45,
  fatG: 20,
  carbG: 60,
  method: null,
  notes: null,
  isArchived: false,
  ...fields,
});

const CHILLI = meal("meal-chilli", "Chilli con Carne");
const RETIRED = meal("meal-stew", "Beef Stew", { isArchived: true });

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});

  getSession.mockResolvedValue(SESSION);
  loadTemplate.mockResolvedValue({ entries: [], meals: [CHILLI, RETIRED] });
  writeTemplateEntry.mockResolvedValue(undefined);
  clearTemplateEntry.mockResolvedValue(true);
});

describe("setTemplateMeal", () => {
  test("writes the entry for the weekday and slot it was given", async () => {
    await expect(setTemplateMeal(2, "dinner", CHILLI.id)).resolves.toEqual({ ok: true });

    expect(writeTemplateEntry).toHaveBeenCalledWith(USER, {
      dayOfWeek: 2,
      slot: "dinner",
      mealId: CHILLI.id,
    });
  });

  test("re-resolves the screens afterwards", async () => {
    // `/` as well as the editor: a weekday whose template changed is today
    // whenever today is that weekday, and a slot with no override on it is
    // showing the meal this call just replaced.
    await setTemplateMeal(2, "dinner", CHILLI.id);

    expect(refresh).toHaveBeenCalled();
  });

  test("takes the user from the session, never from the caller", async () => {
    // The whole reason this is resolved on this side: a Server Action is a
    // public endpoint, and a userId argument would be one anybody could name.
    await setTemplateMeal(2, "dinner", CHILLI.id);

    expect(writeTemplateEntry).toHaveBeenCalledWith(USER, expect.anything());
  });

  test("refuses without a session, and writes nothing", async () => {
    getSession.mockResolvedValue(null);

    await expect(setTemplateMeal(2, "dinner", CHILLI.id)).resolves.toEqual({ ok: false });
    expect(writeTemplateEntry).not.toHaveBeenCalled();
  });

  test.each([
    ["a weekday past Saturday", 7],
    ["a negative weekday", -1],
    ["a fractional weekday", 2.5],
    ["Infinity", Number.POSITIVE_INFINITY],
  ])("refuses %s before it reaches a statement", async (_case, day) => {
    await expect(setTemplateMeal(day, "dinner", CHILLI.id)).resolves.toEqual({
      ok: false,
    });
    expect(writeTemplateEntry).not.toHaveBeenCalled();
  });

  test("refuses a slot the enum does not have", async () => {
    await expect(setTemplateMeal(2, "brunch", CHILLI.id)).resolves.toEqual({ ok: false });
    expect(writeTemplateEntry).not.toHaveBeenCalled();
  });

  test("does not refresh over a bad weekday or slot", async () => {
    // Unlike the two refusals below. A guard failing says nothing about whether
    // the browser's copy of the data is stale, so re-rendering would cost a
    // round trip to fix nothing.
    await setTemplateMeal(9, "dinner", CHILLI.id);

    expect(refresh).not.toHaveBeenCalled();
  });

  test("refuses a meal that is not in the caller's own library", async () => {
    await expect(setTemplateMeal(2, "dinner", "meal-someone-elses")).resolves.toEqual({
      ok: false,
    });
    expect(writeTemplateEntry).not.toHaveBeenCalled();
  });

  test("refuses an archived meal — retiring one stops it being scheduled", async () => {
    // The write path agreeing with meal-picker.tsx, which already filters
    // archived meals out. A rendering decision is not a rule until it does.
    await expect(setTemplateMeal(2, "dinner", RETIRED.id)).resolves.toEqual({ ok: false });
    expect(writeTemplateEntry).not.toHaveBeenCalled();
  });

  test("reconciles the screen when the library disagrees", async () => {
    // The meal was archived or deleted in another tab. Without a refresh the
    // picker would go on offering it and every retry would fail identically.
    await setTemplateMeal(2, "dinner", RETIRED.id);

    expect(refresh).toHaveBeenCalled();
  });

  test("answers rather than throwing when the write fails", async () => {
    // § Feedback needs a value to render a banner from; a thrown Server Action
    // is a 500 with nothing for the screen to act on.
    writeTemplateEntry.mockRejectedValue(new Error("connection lost"));

    await expect(setTemplateMeal(2, "dinner", CHILLI.id)).resolves.toEqual({ ok: false });
  });
});

describe("clearTemplateMeal", () => {
  test("clears the cell it was given", async () => {
    await expect(clearTemplateMeal(6, "lunch")).resolves.toEqual({ ok: true });

    expect(clearTemplateEntry).toHaveBeenCalledWith(USER, {
      dayOfWeek: 6,
      slot: "lunch",
    });
    expect(refresh).toHaveBeenCalled();
  });

  test("is ok when the cell was already empty — the screen was behind", async () => {
    clearTemplateEntry.mockResolvedValue(false);

    await expect(clearTemplateMeal(6, "lunch")).resolves.toEqual({ ok: true });
  });

  test("refuses without a session", async () => {
    getSession.mockResolvedValue(null);

    await expect(clearTemplateMeal(6, "lunch")).resolves.toEqual({ ok: false });
    expect(clearTemplateEntry).not.toHaveBeenCalled();
  });

  test.each([
    ["a weekday past Saturday", 7, "lunch"],
    ["a slot the enum does not have", 6, "brunch"],
  ])("refuses %s", async (_case, day, slot) => {
    await expect(clearTemplateMeal(day as number, slot as string)).resolves.toEqual({
      ok: false,
    });
    expect(clearTemplateEntry).not.toHaveBeenCalled();
  });

  test("answers rather than throwing when the delete fails", async () => {
    clearTemplateEntry.mockRejectedValue(new Error("connection lost"));

    await expect(clearTemplateMeal(6, "lunch")).resolves.toEqual({ ok: false });
  });
});

describe("the two flows cannot reach each other's table", () => {
  /**
   * Read from disk rather than imported, because what is asserted is what the
   * file may NAME — an import that exists is the failure, so it cannot be
   * observed by importing.
   *
   * Resolved from `process.cwd()` on tests/unit/scope-import-rule.test.ts's
   * pattern: `import.meta.url` is not a file URL under jsdom.
   */
  const read = async (file: string) => {
    const [{ readFileSync }, { join }] = await Promise.all([
      import("node:fs"),
      import("node:path"),
    ]);

    return readFileSync(join(process.cwd(), "src/app/actions", file), "utf8");
  };

  test("the template action never writes an override", async () => {
    // The machine-checkable half of "editing the template is never triggered
    // accidentally". The screen's defences — a different route, different copy,
    // an explicit confirm — are all things a future edit could weaken. This is
    // not: the module graph does not connect the two.
    const source = await read("template.ts");

    expect(source).not.toContain("from \"@/lib/db/queries/swap\"");
    expect(source).not.toContain("dayPlanOverrides");
  });

  test("the swap action never writes the template", async () => {
    const source = await read("swap.ts");

    expect(source).not.toContain("from \"@/lib/db/queries/template\"");
    expect(source).not.toContain("planTemplateEntries");
  });
});
