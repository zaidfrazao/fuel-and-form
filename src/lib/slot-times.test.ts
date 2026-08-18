import { describe, expect, it } from "vitest";

import { parseTimeOfDay } from "./date";
import { mealSlot } from "./db/schema";
import { DEFAULT_SLOT_TIMES, DEFAULT_WORKOUT_TIMES } from "./resolve-now";
import { SLOT_ORDER } from "./resolve-plan";
import {
  EDITABLE_WORKOUT_TYPES,
  parseSlotTimes,
  scheduleFields,
  slotField,
  workoutField,
} from "./slot-times";

/**
 * The settings form's trust boundary — FUEL-21.
 *
 * A Server Action is a public POST, and the column behind it is free-shaped
 * `jsonb` with no CHECK. Everything below is about what must NOT reach that
 * column, because the cost of a bad value is not a bad settings screen: it is
 * `parseTimeOfDay` throwing inside `buildTimeline` on every later render of `/`.
 */

/** A form, from plain fields. Saves a `new FormData()` dance in every test. */
function form(fields: Record<string, string>): FormData {
  const data = new FormData();

  for (const [name, value] of Object.entries(fields)) data.append(name, value);

  return data;
}

const ok = (result: ReturnType<typeof parseSlotTimes>) => {
  if (!result.ok) throw new Error(`Expected a parse, got ${JSON.stringify(result.errors)}`);

  return result.update;
};

describe("parseSlotTimes", () => {
  it("reads a time for every meal slot", () => {
    const update = ok(
      parseSlotTimes(
        form({
          [slotField("extra")]: "06:00",
          [slotField("breakfast")]: "07:30",
          [slotField("snack")]: "10:30",
          [slotField("lunch")]: "12:30",
          [slotField("dinner")]: "18:30",
        }),
      ),
    );

    expect(update.slotTimes).toEqual({
      extra: "06:00",
      breakfast: "07:30",
      snack: "10:30",
      lunch: "12:30",
      dinner: "18:30",
    });
  });

  it("reads a time for every editable workout type", () => {
    const update = ok(
      parseSlotTimes(
        form({
          [workoutField("circuit")]: "06:30",
          [workoutField("intervals")]: "06:30",
        }),
      ),
    );

    expect(update.workoutTimes).toEqual({ circuit: "06:30", intervals: "06:30" });
  });

  it("reads a blank field as cleared, not as missing", () => {
    // The distinction `scheduleFor` acts on: `null` is "deliberately
    // unscheduled" and takes no default, where an absent key takes one.
    const update = ok(parseSlotTimes(form({ [slotField("lunch")]: "" })));

    expect(update.slotTimes).toEqual({ lunch: null });
  });

  it("reads a whitespace-only field as cleared rather than malformed", () => {
    const update = ok(parseSlotTimes(form({ [slotField("lunch")]: "   " })));

    expect(update.slotTimes.lunch).toBeNull();
  });

  it("skips a field the form did not submit", () => {
    // A form posting only the row it changed must not silently unschedule the
    // other five. Only a field that is PRESENT and blank clears a slot.
    const update = ok(parseSlotTimes(form({ [slotField("lunch")]: "12:30" })));

    expect(update.slotTimes).toEqual({ lunch: "12:30" });
    expect(update.slotTimes).not.toHaveProperty("dinner");
  });

  it("accepts an empty form as a no-op", () => {
    const update = ok(parseSlotTimes(form({})));

    expect(update).toEqual({ slotTimes: {}, workoutTimes: {} });
  });

  it.each([
    ["7am", "words"],
    ["7:30", "an unpadded hour"],
    ["24:00", "an hour past the end of the day"],
    ["23:60", "a minute past the end of the hour"],
    ["07:30:00", "seconds"],
    ["-1:00", "a negative hour"],
    ["07;30", "the wrong separator"],
    ["١٢:٣٠", "non-ASCII digits"],
  ])("refuses %s — %s", (value) => {
    const result = parseSlotTimes(form({ [slotField("lunch")]: value }));

    expect(result.ok).toBe(false);
  });

  it("refuses a non-string field, which is a hand-rolled POST", () => {
    const data = new FormData();

    data.append(slotField("lunch"), new File([], "lunch.txt"));

    expect(parseSlotTimes(data).ok).toBe(false);
  });

  it("refuses the whole submission when one field is bad", () => {
    // All or nothing. A partial write would move some rows and not others, with
    // nothing on screen saying which.
    const result = parseSlotTimes(
      form({ [slotField("lunch")]: "12:30", [slotField("dinner")]: "half six" }),
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(Object.keys(result.errors)).toEqual([slotField("dinner")]);
  });

  it("names every bad field, not just the first", () => {
    const result = parseSlotTimes(
      form({ [slotField("lunch")]: "noon", [workoutField("circuit")]: "dawn" }),
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(Object.keys(result.errors).sort()).toEqual(
      [slotField("lunch"), workoutField("circuit")].sort(),
    );
  });

  it("validates workout fields as strictly as slot fields", () => {
    // Asserted separately because the two loops are separate code. A relaxed
    // workout branch would be just as fatal on `/` as a relaxed slot one.
    expect(parseSlotTimes(form({ [workoutField("intervals")]: "6:30" })).ok).toBe(false);
  });

  it("ignores a workout type settings does not offer", () => {
    // `workouts.type` is open text, so a POST can name anything. A type with no
    // field must not be writable through the form that has no field for it —
    // and 'walk' is the one that matters: a window would make it the active
    // card every evening.
    const update = ok(parseSlotTimes(form({ [workoutField("walk")]: "10:00" })));

    expect(update.workoutTimes).not.toHaveProperty("walk");
  });
});

describe("the field vocabulary", () => {
  it("offers a field for every slot in the schema", () => {
    // Against the enum rather than restated, so a sixth slot is a failing test
    // here rather than a row settings silently cannot edit.
    expect([...SLOT_ORDER].sort()).toEqual([...mealSlot.enumValues].sort());
  });

  it("keeps the two namespaces from colliding", () => {
    const names = [
      ...SLOT_ORDER.map(slotField),
      ...EDITABLE_WORKOUT_TYPES.map(workoutField),
    ];

    expect(new Set(names).size).toBe(names.length);
  });

  it("leaves the walk out of the editable types", () => {
    expect(EDITABLE_WORKOUT_TYPES).not.toContain("walk");
  });

  it("accepts only times the rest of the app can parse", () => {
    // The two patterns are written out separately — see the note on `readTime`
    // — so this is what stops them drifting: everything this module accepts is
    // fed through the parser that `/` actually calls.
    const fields = Object.fromEntries(SLOT_ORDER.map((slot) => [slotField(slot), "23:59"]));
    const update = ok(parseSlotTimes(form({ ...fields, [slotField("extra")]: "00:00" })));

    for (const time of Object.values(update.slotTimes)) {
      expect(() => parseTimeOfDay(time!)).not.toThrow();
    }
  });
});

describe("scheduleFields", () => {
  it("shows the default for a slot that was never configured", () => {
    // The time actually in force. A blank field would say the slot has no
    // window, which is a different setting and a false one.
    const fields = scheduleFields({ slotTimes: {}, workoutTimes: {} });

    expect(fields[slotField("breakfast")]).toBe(DEFAULT_SLOT_TIMES.breakfast);
    expect(fields[workoutField("circuit")]).toBe(DEFAULT_WORKOUT_TIMES.circuit);
  });

  it("prefers a stored time over the default", () => {
    const fields = scheduleFields({ slotTimes: { lunch: "11:45" }, workoutTimes: {} });

    expect(fields[slotField("lunch")]).toBe("11:45");
  });

  it("renders a slot cleared to null as blank, not as its default", () => {
    // The case the whole three-state distinction exists for. Falling back to
    // the default here would make a cleared slot un-clearable: it would come
    // back on the next render and be re-saved on the next submit.
    const fields = scheduleFields({ slotTimes: { lunch: null }, workoutTimes: {} });

    expect(fields[slotField("lunch")]).toBe("");
  });

  it("renders a workout type cleared to null as blank", () => {
    const fields = scheduleFields({ slotTimes: {}, workoutTimes: { circuit: null } });

    expect(fields[workoutField("circuit")]).toBe("");
    expect(fields[workoutField("intervals")]).toBe(DEFAULT_WORKOUT_TIMES.intervals);
  });

  it("gives a field to every slot and every editable workout type", () => {
    const fields = scheduleFields({ slotTimes: {}, workoutTimes: {} });

    expect(Object.keys(fields).sort()).toEqual(
      [...SLOT_ORDER.map(slotField), ...EDITABLE_WORKOUT_TYPES.map(workoutField)].sort(),
    );
  });

  it("round-trips through the parser unchanged", () => {
    // Rendering the form and saving it without touching anything must not
    // change the schedule. The two functions are each other's inverse over the
    // values the form holds, and this is what says so.
    const stored = {
      slotTimes: { lunch: "11:45", snack: null },
      workoutTimes: { circuit: "06:00" },
    };
    const fields = scheduleFields(stored);
    const update = ok(parseSlotTimes(form(fields)));

    expect(update.slotTimes.lunch).toBe("11:45");
    expect(update.slotTimes.snack).toBeNull();
    expect(update.workoutTimes.circuit).toBe("06:00");
    // The slots that were on their defaults come back as explicit times rather
    // than as absent keys — the intended consequence noted on `scheduleFields`.
    expect(update.slotTimes.dinner).toBe(DEFAULT_SLOT_TIMES.dinner);
  });
});
