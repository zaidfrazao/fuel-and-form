import { type TimeOfDay } from "./date";
import type { MealSlot } from "./db/schema";
import { SLOT_ORDER } from "./resolve-plan";

/**
 * Settings' side of `profiles.slot_times` and `profiles.workout_times` — what a
 * submitted form means, and what is refused.
 *
 * ## Why this is a module and not a few lines in the action
 *
 * A Server Action is reachable by anyone who can POST to the app, whatever the
 * form on screen offers — the same reading `actions/log.ts` and
 * `login/actions.ts` both start from. So the values arriving here are untrusted
 * strings, and the column they are headed for is free-shaped `jsonb` with no
 * CHECK behind it.
 *
 * That combination is why validation cannot be left to the render. `date.ts`'s
 * `parseTimeOfDay` THROWS on a malformed time, and it is called from
 * `buildTimeline` on every resolution of `/`. A single unvalidated "7am" written
 * to the column would therefore not fail at the settings screen — it would fail
 * afterwards, on the one screen the app exists for, on every request, until
 * someone edited the database by hand. The value is refused here so that it
 * never reaches the row.
 *
 * ## Three states, and blank is the interesting one
 *
 * A slot can hold a time, be ABSENT, or be explicitly `null`. Absent means never
 * configured and takes the default; `null` means deliberately unscheduled and
 * takes no default, which lands the slot in `anytime`. `scheduleFor` is where
 * that distinction is honoured, and this is what produces it: a field left blank
 * is a `null`, not a missing key, because the person clearing it has said
 * something rather than failed to say anything.
 *
 * ## All or nothing
 *
 * One bad field refuses the whole submission. A partial write would leave the
 * profile in a state nobody asked for — some rows moved, some not, and no way
 * to tell from the screen which — and the form has every value in hand to
 * resubmit. The errors are returned per field so the form can mark them.
 */

/** A submitted form, parsed. Times are 'HH:MM'; `null` is a cleared slot. */
export type SlotTimesUpdate = {
  slotTimes: Partial<Record<MealSlot, TimeOfDay | null>>;
  workoutTimes: Record<string, TimeOfDay | null>;
};

/** Field name → what is wrong with it. Empty when the submission is good. */
export type SlotTimeErrors = Record<string, string>;

export type ParseResult =
  | { ok: true; update: SlotTimesUpdate }
  | { ok: false; errors: SlotTimeErrors };

/**
 * The workout types settings offers a time for.
 *
 * `workouts.type` is open text by design (see the note on `workouts` in
 * schema.ts), so this is a list of what the seeded program actually contains
 * rather than a closed vocabulary. A type absent from it keeps whatever time the
 * column already holds — settings does not get to silently drop a window it has
 * no field for.
 *
 * 'walk' is deliberately not here. It is on the template every single day, and
 * `resolve-now.ts` explains what giving it a window would do: it would become
 * the active item every evening, displacing dinner on the five days that also
 * have a real session.
 */
export const EDITABLE_WORKOUT_TYPES = ["circuit", "intervals"] as const;

/** Form field name for a meal slot. Prefixed so the two namespaces cannot collide. */
export const slotField = (slot: MealSlot) => `slot.${slot}`;

/** Form field name for a workout type. */
export const workoutField = (type: string) => `workout.${type}`;

const MALFORMED =
  "Use a 24-hour time like 07:30, or leave it blank for no fixed time.";

/**
 * 'HH:MM' or blank, from one untrusted field.
 *
 * Deliberately a SEPARATE pattern from `date.ts`'s, not a call to
 * `parseTimeOfDay`. That function communicates failure by throwing, and a form
 * with six fields wants six answers rather than the first exception — wrapping
 * it in a try per field would be using an exception as a return value. The two
 * agree on what a time is, and `slot-times.test.ts` pins that agreement by
 * feeding every value this accepts through `parseTimeOfDay`.
 *
 * A non-string is a hand-rolled POST rather than the form — a missing field, or
 * a file upload where a text input should be. Refused, not coerced.
 */
function readTime(value: FormDataEntryValue | null): TimeOfDay | null | undefined {
  if (typeof value !== "string") return undefined;

  // A native `<input type="time">` submits '' when cleared, and trimming means
  // a field holding only spaces reads as cleared too rather than as malformed.
  const trimmed = value.trim();

  if (trimmed === "") return null;

  return /^([01]\d|2[0-3]):([0-5]\d)$/.test(trimmed) ? trimmed : undefined;
}

/**
 * A settings submission, or the reasons it was refused.
 *
 * Absent fields are skipped rather than treated as cleared: a form that posted
 * only the row it changed should not silently unschedule the other five. Only a
 * field that is PRESENT and blank clears a slot.
 */
export function parseSlotTimes(form: FormData): ParseResult {
  const errors: SlotTimeErrors = {};
  const slotTimes: Partial<Record<MealSlot, TimeOfDay | null>> = {};
  const workoutTimes: Record<string, TimeOfDay | null> = {};

  // `SLOT_ORDER` rather than `mealSlot.enumValues`, so this module imports
  // nothing from the schema at runtime — the settings form is a client
  // component and reads `slotField` from here, and pulling Drizzle's pg-core
  // into that bundle to read five strings is what resolve-plan.ts avoids by
  // writing the list out. Its own test pins the list against the enum, so a
  // sixth slot is a failing test there rather than a field missing here.
  for (const slot of SLOT_ORDER) {
    const name = slotField(slot);

    if (!form.has(name)) continue;

    const time = readTime(form.get(name));

    if (time === undefined) errors[name] = MALFORMED;
    else slotTimes[slot] = time;
  }

  for (const type of EDITABLE_WORKOUT_TYPES) {
    const name = workoutField(type);

    if (!form.has(name)) continue;

    const time = readTime(form.get(name));

    if (time === undefined) errors[name] = MALFORMED;
    else workoutTimes[type] = time;
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };

  return { ok: true, update: { slotTimes, workoutTimes } };
}
