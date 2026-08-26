import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { mealSlot } from "@/lib/db/schema";
import { DEFAULT_SLOT_TIMES, DEFAULT_WORKOUT_TIMES } from "@/lib/resolve-now";
import { DEFAULT_WALK_REMINDER_AT } from "@/lib/walk-reminder";
import {
  EDITABLE_WORKOUT_TYPES,
  REMINDER_FIELD,
  scheduleFields,
  slotField,
  workoutField,
} from "@/lib/slot-times";
import { ROWS, SlotTimesForm } from "./slot-times-form";

/**
 * The settings form — FUEL-21's browser half.
 *
 * The action is mocked for the reason right-now.test.tsx gives about its own:
 * `@/app/actions/settings` is a "use server" module importing the database, a
 * session and `server-only`, none of which resolve in the hermetic jsdom suite.
 * What is under test here is what the browser owns — that every slot has a
 * field, that the submitted names are the ones the parser reads, and that a
 * refusal is shown against the field it belongs to.
 */
const saveSlotTimes = vi.fn();

vi.mock("@/app/actions/settings", () => ({
  saveSlotTimes: (...args: unknown[]) => saveSlotTimes(...args),
}));

beforeEach(() => {
  saveSlotTimes.mockReset();
  saveSlotTimes.mockResolvedValue({ status: "saved", at: 1 });
});

/** A stored schedule, defaulted — the profile row always carries all three. */
const stored = (
  over: Partial<Parameters<typeof scheduleFields>[0]> = {},
): Parameters<typeof scheduleFields>[0] => ({
  slotTimes: {},
  workoutTimes: {},
  walkReminderAt: DEFAULT_WALK_REMINDER_AT,
  ...over,
});

const VALUES = scheduleFields(stored());

const renderForm = (values = VALUES) =>
  render(<SlotTimesForm values={values} timezone="Europe/London" />);

/** A row's input, typed — this suite has no jest-dom, so values are read directly. */
const field = (label: string) => screen.getByLabelText(label) as HTMLInputElement;

/** The FormData the action was called with, once it has been. */
async function submitted(): Promise<FormData> {
  await waitFor(() => expect(saveSlotTimes).toHaveBeenCalled());

  return saveSlotTimes.mock.calls[0]![1] as FormData;
}

describe("the rows", () => {
  it("offers a field for every slot in the schema", () => {
    // Against the enum, so a slot added to the schema without a row here is a
    // failing test rather than a time nobody can edit.
    for (const slot of mealSlot.enumValues) {
      expect(ROWS.map((row) => row.name)).toContain(slotField(slot));
    }
  });

  it("offers a field for every editable workout type", () => {
    for (const type of EDITABLE_WORKOUT_TYPES) {
      expect(ROWS.map((row) => row.name)).toContain(workoutField(type));
    }
  });

  it("offers no field for the walk", () => {
    // A window would make it the active card every evening — resolve-now.ts.
    expect(ROWS.map((row) => row.name)).not.toContain(workoutField("walk"));
  });

  it("gives every row a labelled control", () => {
    renderForm();

    for (const row of ROWS) {
      expect(field(row.label)).toBeInstanceOf(HTMLInputElement);
    }
  });

  it("holds its order while the values change", () => {
    // Sorting by value would slide the row being edited under the cursor.
    const { rerender } = renderForm();
    const order = () => screen.getAllByRole("listitem").map((li) => li.textContent);
    const before = order();

    rerender(
      <SlotTimesForm
        values={{ ...VALUES, [slotField("dinner")]: "00:05" }}
        timezone="Europe/London"
      />,
    );

    expect(order()).toEqual(before);
  });
});

describe("the initial values", () => {
  it("shows the default for a slot that was never configured", () => {
    // Not blank. The default is the time actually in force, and an empty field
    // would invite someone to "fix" a setting that was already right.
    renderForm();

    expect(field("Breakfast").value).toBe(DEFAULT_SLOT_TIMES.breakfast);
    expect(field("Circuit").value).toBe(DEFAULT_WORKOUT_TIMES.circuit);
  });

  it("shows the stored time where there is one", () => {
    renderForm(scheduleFields(stored({ slotTimes: { lunch: "11:45" } })));

    expect(field("Lunch").value).toBe("11:45");
  });

  it("shows a slot cleared to null as blank", () => {
    renderForm(scheduleFields(stored({ slotTimes: { lunch: null } })));

    expect(field("Lunch").value).toBe("");
  });

  it("shows the walk reminder's stored time", () => {
    renderForm(scheduleFields(stored({ walkReminderAt: "20:15" })));

    expect(field("Remind at").value).toBe("20:15");
  });

  it("shows a switched-off reminder as blank", () => {
    // And not as the default, which would put the time back on screen for
    // someone who has just turned the reminder off — and re-save it on the next
    // submit.
    renderForm(scheduleFields(stored({ walkReminderAt: null })));

    expect(field("Remind at").value).toBe("");
  });
});

describe("submitting", () => {
  it("posts every field under the name the parser reads", async () => {
    renderForm();

    await userEvent.click(screen.getByRole("button", { name: "Save times" }));

    const form = await submitted();

    for (const row of ROWS) expect(form.has(row.name)).toBe(true);
  });

  it("posts an edited time", async () => {
    renderForm();

    const dinner = screen.getByLabelText("Dinner");

    await userEvent.clear(dinner);
    await userEvent.type(dinner, "20:15");
    await userEvent.click(screen.getByRole("button", { name: "Save times" }));

    expect((await submitted()).get(slotField("dinner"))).toBe("20:15");
  });

  it("posts the reminder under the name the parser reads", async () => {
    renderForm();

    await userEvent.click(screen.getByRole("button", { name: "Save times" }));

    expect((await submitted()).get(REMINDER_FIELD)).toBe(DEFAULT_WALK_REMINDER_AT);
  });

  it("posts a cleared reminder as blank, which switches it off", async () => {
    // P9's "the reminder can be disabled entirely", from the one control that
    // offers it. Blank here has to reach the action as a present-and-empty
    // field: an omitted one would mean "leave it alone" and the reminder would
    // survive being switched off.
    renderForm();

    await userEvent.clear(field("Remind at"));
    await userEvent.click(screen.getByRole("button", { name: "Save times" }));

    const form = await submitted();

    expect(form.has(REMINDER_FIELD)).toBe(true);
    expect(form.get(REMINDER_FIELD)).toBe("");
  });

  it("posts a cleared field as blank, which the parser reads as unscheduled", async () => {
    renderForm();

    await userEvent.clear(screen.getByLabelText("Snack"));
    await userEvent.click(screen.getByRole("button", { name: "Save times" }));

    expect((await submitted()).get(slotField("snack"))).toBe("");
  });

  it("reports a save without congratulating — § Voice", async () => {
    renderForm();

    await userEvent.click(screen.getByRole("button", { name: "Save times" }));

    expect(await screen.findByText(/Saved\./)).toBeDefined();
  });
});

describe("a refused submission", () => {
  beforeEach(() => {
    saveSlotTimes.mockResolvedValue({
      status: "invalid",
      errors: { [slotField("dinner")]: "Use a 24-hour time like 07:30." },
    });
  });

  it("shows the message against the field it belongs to", async () => {
    renderForm();

    await userEvent.click(screen.getByRole("button", { name: "Save times" }));

    const row = (await screen.findByText(/Use a 24-hour time/)).closest("li");

    expect(within(row!).getByLabelText("Dinner")).toBeDefined();
  });

  it("marks the field invalid and points the description at the message", async () => {
    renderForm();

    await userEvent.click(screen.getByRole("button", { name: "Save times" }));

    await screen.findByText(/Use a 24-hour time/);
    const dinner = field("Dinner");

    expect(dinner.getAttribute("aria-invalid")).toBe("true");

    // The description is followed rather than assumed: `aria-describedby` that
    // names a missing id is the failure worth catching, and it reads as fine.
    const describedBy = dinner.getAttribute("aria-describedby");

    expect(describedBy).not.toBeNull();
    expect(document.getElementById(describedBy!)?.textContent).toMatch(
      /Use a 24-hour time/,
    );
  });

  it("leaves the other fields unmarked", async () => {
    renderForm();

    await userEvent.click(screen.getByRole("button", { name: "Save times" }));
    await screen.findByText(/Use a 24-hour time/);

    expect(field("Lunch").getAttribute("aria-invalid")).toBeNull();
  });

  it("says nothing was saved, so a partial write is not assumed", async () => {
    renderForm();

    await userEvent.click(screen.getByRole("button", { name: "Save times" }));

    expect(await screen.findByText(/Nothing was saved/)).toBeDefined();
  });

  it("keeps the typed values rather than resetting the form", async () => {
    renderForm();

    const dinner = screen.getByLabelText("Dinner");

    await userEvent.clear(dinner);
    await userEvent.type(dinner, "21:00");
    await userEvent.click(screen.getByRole("button", { name: "Save times" }));
    await screen.findByText(/Nothing was saved/);

    expect(field("Dinner").value).toBe("21:00");
  });
});

describe("a failed save", () => {
  it("offers a retry rather than a bare failure", async () => {
    saveSlotTimes.mockResolvedValue({ status: "failed" });
    renderForm();

    await userEvent.click(screen.getByRole("button", { name: "Save times" }));

    expect(await screen.findByText(/Try again/)).toBeDefined();
  });
});

describe("time entry", () => {
  it("sets inputmode on every field — the acceptance criterion", () => {
    renderForm();

    for (const row of ROWS) {
      const input = field(row.label);

      expect(input.type).toBe("time");
      expect(input.getAttribute("inputmode")).toBe("numeric");
    }
  });
});
