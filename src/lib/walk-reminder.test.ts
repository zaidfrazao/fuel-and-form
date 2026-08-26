import { describe, expect, it } from "vitest";

import { MINUTES_PER_DAY, parseTimeOfDay } from "./date";
import {
  DEFAULT_WALK_REMINDER_AT,
  isReminderDue,
  REMINDER_LINK,
  reminderStatement,
} from "./walk-reminder";

/**
 * The walk reminder's copy and its one decision — FUEL-46, § P9.
 *
 * Three things are asserted here that nothing else in the suite can hold still,
 * and they are `demo-banner.test.ts`'s three for the same reasons:
 *
 *   - the SENTENCE, character for character. The task's own criterion writes it
 *     out — "Walk not logged. Reminder set for 19:00." — and pairs it with what
 *     it must not become. A reminder is the single most tempting string in the
 *     app to make encouraging, and voice erodes one friendly edit at a time.
 *   - the BOUNDARY, which a running app exercises for about a second a day.
 *     18:59 against 19:00 is the whole feature, and an off-by-one there is a
 *     banner that appears a minute early or a minute late — invisible either
 *     way, because nobody is watching the clock when it happens.
 *   - that a stored value this file does not recognise can never throw. It is
 *     read from the root layout, so a throw is a 500 on every screen at once.
 */

/** 'HH:MM' → minutes since midnight, the way the caller computes it. */
const at = (time: string) => parseTimeOfDay(time);

describe("the copy", () => {
  it("is the criterion's sentence, exactly", () => {
    expect(reminderStatement("19:00")).toBe("Walk not logged. Reminder set for 19:00.");
  });

  it("names the time it was actually configured for", () => {
    // Not a hard-coded 19:00 in the sentence. The one question a banner that
    // appeared unbidden raises is why it appeared now, and a fixed time in the
    // copy would answer it wrongly for anyone who changed the setting.
    expect(reminderStatement("06:45")).toBe("Walk not logged. Reminder set for 06:45.");
  });

  it("neither encourages nor addresses the reader", () => {
    // § Content Guidelines' Don't list, applied to the two failure modes this
    // string has: an exclamation mark, and second person about something not
    // done. "You haven't walked today" is a sentence away and is forbidden —
    // § Tone of Voice: no person for facts.
    const copy = `${reminderStatement(DEFAULT_WALK_REMINDER_AT)} ${REMINDER_LINK}`;

    expect(copy).not.toMatch(/!/);
    expect(copy).not.toMatch(/\b(you|your|let's|don't forget|time to)\b/i);
  });

  it("uses the user's own vocabulary for the action", () => {
    // § Terminology: "Log", not "Track", "Record" or "Add".
    expect(REMINDER_LINK).toBe("Log the walk.");
  });

  it("defaults to a time that is an evening", () => {
    // P9 is "an evening nudge", and the default is what almost every profile
    // will carry. A default of 06:00 would be a different feature.
    expect(parseTimeOfDay(DEFAULT_WALK_REMINDER_AT)).toBeGreaterThanOrEqual(at("17:00"));
    expect(parseTimeOfDay(DEFAULT_WALK_REMINDER_AT)).toBeLessThan(MINUTES_PER_DAY);
  });
});

describe("isReminderDue", () => {
  it("is false all day when the reminder is switched off", () => {
    // P9's "the reminder can be disabled entirely", and the whole of it. There
    // is no second flag that could disagree with this one.
    expect(isReminderDue(null, at("00:00"))).toBe(false);
    expect(isReminderDue(null, at("19:00"))).toBe(false);
    expect(isReminderDue(null, MINUTES_PER_DAY - 1)).toBe(false);
  });

  it("is false a minute before the reminder time", () => {
    expect(isReminderDue("19:00", at("18:59"))).toBe(false);
  });

  it("is true at the reminder time itself", () => {
    // Inclusive. A reminder set for 19:00 that first appears at 19:01 is a
    // reminder set for 19:01, and the sentence would then be telling the reader
    // something untrue about their own setting.
    expect(isReminderDue("19:00", at("19:00"))).toBe(true);
  });

  it("stays true for the rest of the day", () => {
    expect(isReminderDue("19:00", at("19:01"))).toBe(true);
    expect(isReminderDue("19:00", MINUTES_PER_DAY - 1)).toBe(true);
  });

  it("is false again after midnight, because the day is the caller's", () => {
    // 00:01 is a new day in the user's zone — `minutesOfDayIn` says so — and
    // the walk it is about has all of that day left to be logged in. Nothing
    // here has to know about the rollover; being given minutes-of-day rather
    // than an instant is what makes that true.
    expect(isReminderDue("19:00", at("00:01"))).toBe(false);
  });

  it("compares the hour and the minute, not the string", () => {
    // "09:30" > "19:00" lexically for no minute of the day. A string comparison
    // here would be right for most of the evening and wrong every morning.
    expect(isReminderDue("09:30", at("10:00"))).toBe(true);
    expect(isReminderDue("09:30", at("09:29"))).toBe(false);
  });

  it("handles a reminder at midnight and one at the last minute of the day", () => {
    expect(isReminderDue("00:00", at("00:00"))).toBe(true);
    expect(isReminderDue("23:59", at("23:58"))).toBe(false);
    expect(isReminderDue("23:59", at("23:59"))).toBe(true);
  });

  it.each([
    ["7pm", "the format a person would type"],
    ["19:00:00", "what a Postgres `time` column would have read back as"],
    ["25:00", "an hour that does not exist"],
    ["19:60", "a minute that does not exist"],
    [" 19:00", "a value with whitespace the CHECK would have refused"],
    ["", "an empty string"],
  ])("shows no banner for a stored value it cannot read: %s", (stored) => {
    // The column carries a CHECK, so none of these should be reachable — which
    // is exactly why they are here. A row written before the constraint, a
    // hand-edited profile, or a constraint dropped by a later migration would
    // each land one of these in front of a function called from the ROOT
    // LAYOUT. No banner is the honest answer; a throw would be every screen in
    // the app returning a 500 at once.
    expect(() => isReminderDue(stored, at("20:00"))).not.toThrow();
    expect(isReminderDue(stored, at("20:00"))).toBe(false);
  });

  it("accepts exactly what date.ts calls a time", () => {
    // The safeguard slot-times.ts keeps for its own separate pattern: the two
    // definitions agree, and this is what says so. Every minute of the day,
    // formatted, must be readable by both.
    for (let minutes = 0; minutes < MINUTES_PER_DAY; minutes += 1) {
      const time = `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(
        minutes % 60,
      ).padStart(2, "0")}`;

      expect(() => parseTimeOfDay(time)).not.toThrow();
      expect(isReminderDue(time, minutes)).toBe(true);
    }
  });
});
