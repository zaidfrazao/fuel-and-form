import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { type ProfileTargets, TARGET_FIELD, targetFields } from "@/lib/profile-targets";
import { demoProfile } from "@/lib/seed/persona";
import { GROUPS, TargetsForm } from "./targets-form";

/**
 * The targets form — FUEL-136's browser half.
 *
 * The action is mocked for `slot-times-form.test.tsx`'s reason. What is under
 * test is what the browser owns: that every field the parser reads has a
 * control, that the submitted names are those fields, that a refusal lands on
 * the field it belongs to and keeps what was typed, and that FUEL-54 has an
 * anchor to link to. The persona's figures only.
 */
const { saveProfileTargets } = vi.hoisted(() => ({ saveProfileTargets: vi.fn() }));

vi.mock("@/app/actions/settings", () => ({ saveProfileTargets }));

const persona = demoProfile(new Date("2026-06-17T12:00:00Z"));

const SAM: ProfileTargets = {
  targetKcal: persona.targetKcal,
  targetProteinG: persona.targetProteinG,
  targetFatG: persona.targetFatG,
  targetCarbG: persona.targetCarbG,
  startWeightKg: persona.startWeightKg,
  targetWeightKg: persona.targetWeightKg,
  goalPaceKgPerWeek: persona.goalPaceKgPerWeek,
  heightCm: persona.heightCm,
  timezone: persona.timezone,
};

const ZONES = ["America/New_York", "Europe/London", "UTC"];

const renderForm = () =>
  render(<TargetsForm values={targetFields(SAM)} timezones={ZONES} />);

const input = (label: string) => screen.getByLabelText(label) as HTMLInputElement;

async function submitted(): Promise<FormData> {
  await waitFor(() => expect(saveProfileTargets).toHaveBeenCalled());

  return saveProfileTargets.mock.calls[0]![1] as FormData;
}

beforeEach(() => {
  saveProfileTargets.mockReset();
  saveProfileTargets.mockResolvedValue({ status: "saved", at: 1 });
});

describe("the fields", () => {
  it("offers a control for every field the parser reads", () => {
    const { container } = renderForm();

    for (const name of Object.values(TARGET_FIELD)) {
      expect(container.querySelector(`[name="${name}"]`), name).not.toBeNull();
    }
  });

  it("names the macros as the macro grid does, and the weight as a target", () => {
    const labels = GROUPS.flatMap((group) => group.rows.map((row) => row.label));

    expect(labels).toEqual(
      expect.arrayContaining(["Calories", "Protein", "Fat", "Carbs", "Target weight"]),
    );
    // § Terminology: "Target, not Goal".
    expect(labels.some((label) => /goal/i.test(label))).toBe(false);
  });

  it("shows the stored values", () => {
    renderForm();

    expect(input("Calories").value).toBe(String(SAM.targetKcal));
    expect(input("Target weight").value).toBe(String(SAM.targetWeightKg));
    expect((screen.getByLabelText("Timezone") as HTMLSelectElement).value).toBe(SAM.timezone);
  });

  it("offers every zone it was given, and only those", () => {
    renderForm();

    const options = Array.from(
      (screen.getByLabelText("Timezone") as HTMLSelectElement).options,
      (option) => option.value,
    );

    expect(options).toEqual(ZONES);
  });

  it("asks for a decimal keypad, not a number input, where a comma is allowed", () => {
    renderForm();

    expect(input("Target weight").type).toBe("text");
    expect(input("Target weight").inputMode).toBe("decimal");
    expect(input("Height").inputMode).toBe("numeric");
  });

  it("carries the anchor FUEL-54's prompt links to", () => {
    const { container } = renderForm();

    expect(container.querySelector("form#targets")).not.toBeNull();
  });
});

describe("saving", () => {
  it("submits what was typed under the parser's field names", async () => {
    const user = userEvent.setup();
    renderForm();

    await user.clear(input("Target weight"));
    await user.type(input("Target weight"), "70,5");
    await user.selectOptions(screen.getByLabelText("Timezone"), "UTC");
    await user.click(screen.getByRole("button", { name: "Save targets" }));

    const data = await submitted();

    expect(data.get(TARGET_FIELD.goalWeight)).toBe("70,5");
    expect(data.get(TARGET_FIELD.timezone)).toBe("UTC");
    expect(data.get(TARGET_FIELD.kcal)).toBe(String(SAM.targetKcal));
  });

  it("confirms a save inline", async () => {
    const user = userEvent.setup();
    renderForm();

    await user.click(screen.getByRole("button", { name: "Save targets" }));

    expect(await screen.findByText(/^Saved\./)).toBeTruthy();
  });

  it("shows a refusal against its field, and keeps what was typed", async () => {
    saveProfileTargets.mockResolvedValue({
      status: "invalid",
      errors: { [TARGET_FIELD.height]: "Enter a whole number of cm." },
    });
    const user = userEvent.setup();
    renderForm();

    await user.clear(input("Height"));
    await user.type(input("Height"), "tall");
    await user.click(screen.getByRole("button", { name: "Save targets" }));

    const alert = await screen.findByRole("alert");

    expect(alert.textContent).toBe("Enter a whole number of cm.");
    expect(input("Height").getAttribute("aria-invalid")).toBe("true");
    expect(input("Height").getAttribute("aria-describedby")).toBe(alert.id);
    expect(input("Height").value).toBe("tall");
    expect(await screen.findByText(/^Nothing was saved/)).toBeTruthy();
  });
});
