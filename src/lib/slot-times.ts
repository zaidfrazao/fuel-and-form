import { type TimeOfDay } from "./date";
import type { MealSlot } from "./db/schema";
import { DEFAULT_SLOT_TIMES, DEFAULT_WORKOUT_TIMES } from "./resolve-now";
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
  /**
   * The walk reminder — FUEL-46. `null` switches it off, and ABSENT means the
   * form did not carry the field, so the stored value is left alone.
   *
   * Optional for the same reason a slot key is skipped when its field is
   * missing: a caller that posted only what it renders should not silently
   * change a setting it never showed. It is a column rather than a key in
   * either bag above, and `schema.ts` gives the reason — a time under
   * `workout_times.walk` would be a scheduling WINDOW, which is the one thing
   * the walk must not have.
   */
  walkReminderAt?: TimeOfDay | null;
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

/**
 * Form field name for the walk reminder — FUEL-46.
 *
 * A constant rather than a function, because there is one reminder and not one
 * per anything. Prefixed like the other two so the three namespaces cannot
 * collide: `reminder.walk` is not a slot called 'walk' and not a workout type
 * called 'walk', and the parse below would refuse to confuse them anyway.
 */
export const REMINDER_FIELD = "reminder.walk";

const MALFORMED =
  "Use a 24-hour time like 07:30, or leave it blank for no fixed time.";

/**
 * The same refusal for the reminder, in the reminder's own terms.
 *
 * Blank means something different here — no reminder at all, rather than no
 * fixed time for an item that still happens — so the sentence that explains
 * blank has to differ too. § Tone of Voice: name what happened, and say what the
 * field does, rather than reuse a message that is nearly right.
 */
const REMINDER_MALFORMED =
  "Use a 24-hour time like 19:00, or leave it blank for no reminder.";

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

  // The walk reminder — FUEL-46. Read by the same `readTime` as everything
  // above, so 'HH:MM' and blank are the only two things it accepts here too.
  //
  // What differs is what BLANK means. A cleared slot is "deliberately
  // unscheduled" and lands that meal in `anytime`; a cleared reminder is P9's
  // "the reminder can be disabled entirely" — the banner never appears. Same
  // `null`, two settings, and the difference lives in the columns they are
  // written to rather than in this parse.
  const update: SlotTimesUpdate = { slotTimes, workoutTimes };

  if (form.has(REMINDER_FIELD)) {
    const time = readTime(form.get(REMINDER_FIELD));

    if (time === undefined) errors[REMINDER_FIELD] = REMINDER_MALFORMED;
    else update.walkReminderAt = time;
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };

  return { ok: true, update };
}

/**
 * What the form's fields should start out holding.
 *
 * The three stored states collapse into two rendered ones, and the mapping is
 * the whole point of this function: a slot never configured shows its DEFAULT,
 * because that is the time actually in force and a blank field would claim
 * otherwise; a slot cleared to `null` shows blank, because that is what it now
 * means. Reading the stored value alone would render the first case as blank and
 * invite someone to "fix" a setting that was already correct.
 *
 * One consequence, and it is intended: saving the form writes every field it
 * renders, so times that were implicit defaults become explicit rows. After the
 * first save the profile says what it means, and a later change to
 * `DEFAULT_SLOT_TIMES` stops silently moving this user's day.
 */
export function scheduleFields(stored: {
  slotTimes: Partial<Record<MealSlot, TimeOfDay | null>>;
  workoutTimes: Record<string, TimeOfDay | null>;
  /** `profiles.walk_reminder_at` as stored. `null` is a reminder switched off. */
  walkReminderAt: TimeOfDay | null;
}): Record<string, string> {
  const fields: Record<string, string> = {};

  for (const slot of SLOT_ORDER) {
    fields[slotField(slot)] = (slot in stored.slotTimes
      ? stored.slotTimes[slot]
      : DEFAULT_SLOT_TIMES[slot]) ?? "";
  }

  for (const type of EDITABLE_WORKOUT_TYPES) {
    fields[workoutField(type)] = (type in stored.workoutTimes
      ? stored.workoutTimes[type]
      : DEFAULT_WORKOUT_TIMES[type]) ?? "";
  }

  // No default to fall back to, unlike the two loops above: the reminder is a
  // COLUMN with a default of its own, so what is stored is already what is in
  // force. `null` renders blank, which is what a switched-off reminder is.
  fields[REMINDER_FIELD] = stored.walkReminderAt ?? "";

  return fields;
}
