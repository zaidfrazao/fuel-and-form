import "server-only";

import { todayIn } from "@/lib/date";
import { type ProfileTargets, targetsChanged } from "@/lib/profile-targets";
import type { SlotTimesUpdate } from "@/lib/slot-times";
import { getDb } from "../index";
import * as schema from "../schema";
import type { Profile } from "../schema";
import { scope } from "../scope";

/**
 * The profile's schedule — settings' read and its one write (FUEL-21).
 *
 * In `queries/` for the reason today.ts sets out: `getDb()` hands back an
 * unscoped handle, the eslint rule confines it to `src/lib/db/`, and a module
 * here runs scoped statements and returns ROWS. The task named
 * `lib/db/profile.ts`; that path is outside the category the rule lets `app/`
 * import, so the file is here instead.
 *
 * Both statements go through `scope()`, so `user_id` is in the WHERE clause
 * without the caller naming it. A demo visitor editing settings therefore
 * rewrites their own profile or none — never the owner's — and the update
 * returns no rows rather than a 403, which is the same non-answer scope.ts
 * gives everywhere else.
 */

/**
 * What the settings screen renders from. `undefined` when there is no profile.
 *
 * `walkReminderAt` joins the two time bags here rather than getting a load of
 * its own (FUEL-46): settings edits all three in one form and saves them in one
 * statement, and a second query for one column would be a second round trip for
 * a screen that already has the row in hand.
 */
export type ProfileSchedule = Pick<
  Profile,
  "slotTimes" | "workoutTimes" | "timezone" | "walkReminderAt"
>;

/**
 * This user's configured times.
 *
 * `undefined` means no profile row, which is an ordinary state rather than an
 * error — a user exists before the seed script sets it up. The caller renders
 * the same empty state `/` does rather than inventing a profile to edit.
 */
export async function loadSchedule(userId: string): Promise<ProfileSchedule | undefined> {
  const s = scope(userId, getDb());

  const profile = await s.selectOne(schema.profiles);

  if (!profile) return undefined;

  return {
    slotTimes: profile.slotTimes,
    workoutTimes: profile.workoutTimes,
    timezone: profile.timezone,
    walkReminderAt: profile.walkReminderAt,
  };
}

/** What `/settings` renders from — both forms, from one read (FUEL-136). */
export type ProfileSettings = {
  schedule: ProfileSchedule;
  targets: ProfileTargets;
};

/**
 * The schedule and the targets together.
 *
 * One `selectOne` for both forms, on `walkReminderAt`'s reasoning above: the
 * screen already has the row in hand, and a second load for the other half of
 * it would be a second round trip to read the same row. `loadSchedule` stays
 * for the callers that want only the times.
 */
export async function loadSettings(userId: string): Promise<ProfileSettings | undefined> {
  const s = scope(userId, getDb());

  const profile = await s.selectOne(schema.profiles);

  if (!profile) return undefined;

  return {
    schedule: {
      slotTimes: profile.slotTimes,
      workoutTimes: profile.workoutTimes,
      timezone: profile.timezone,
      walkReminderAt: profile.walkReminderAt,
    },
    targets: {
      targetKcal: profile.targetKcal,
      targetProteinG: profile.targetProteinG,
      targetFatG: profile.targetFatG,
      targetCarbG: profile.targetCarbG,
      startWeightKg: profile.startWeightKg,
      targetWeightKg: profile.targetWeightKg,
      goalPaceKgPerWeek: profile.goalPaceKgPerWeek,
      heightCm: profile.heightCm,
      timezone: profile.timezone,
    },
  };
}

/**
 * Writes the submitted times, merged over what is already stored.
 *
 * ## Merged rather than replaced, and why that is not a lost update
 *
 * The form posts the fields it renders, and `parseSlotTimes` skips the ones it
 * does not. Replacing the column wholesale would therefore make any field the
 * form stops rendering — a slot behind a feature flag, a workout type added to
 * the schema before settings grows a row for it — silently vanish from the
 * profile on the next save. Merging keeps the column's contents a superset of
 * what any one form knows about.
 *
 * The merge is read-then-write rather than a `jsonb_set`, which is a race if
 * two settings screens save at once. It is accepted here: this is a single-user
 * app editing a single-row-per-user table from one screen, and the losing write
 * is a settings save the person made themselves seconds earlier. The alternative
 * costs a round trip and a lock on every save to protect against a tab someone
 * would have to open deliberately.
 *
 * `false` means no row was updated, which for a primary-key-scoped table means
 * the profile does not exist. The caller reports a failure rather than creating
 * one: a profile carries height, weight and macro targets that settings has no
 * values for, and inventing them to satisfy a time change would be worse than
 * refusing.
 */
export async function saveSchedule(
  userId: string,
  update: SlotTimesUpdate,
): Promise<boolean> {
  const s = scope(userId, getDb());

  const profile = await s.selectOne(schema.profiles);

  if (!profile) return false;

  const rows = await s.update(schema.profiles, {
    slotTimes: { ...profile.slotTimes, ...update.slotTimes },
    workoutTimes: { ...profile.workoutTimes, ...update.workoutTimes },
    // A column, so there is nothing to merge — but the same rule applies for
    // the same reason: a submission that did not carry the field leaves the
    // stored value alone.
    //
    // `=== undefined` and NOT `??`, which is the whole point. `null` is a value
    // here — P9's "the reminder can be disabled entirely" — so a nullish
    // fallback would read a deliberate clear as an absent field and write the
    // old time straight back. The reminder would then be un-switch-off-able
    // from the one screen that offers to switch it off, and the form would show
    // the time it had just been told to remove.
    walkReminderAt:
      update.walkReminderAt === undefined
        ? profile.walkReminderAt
        : update.walkReminderAt,
  });

  return rows.length > 0;
}

/**
 * Writes the targets, the weights, the pace, the height and the zone —
 * FUEL-136's one write.
 *
 * Replaced rather than merged, unlike the schedule: these are scalar columns,
 * every one of them is on the form, and `parseProfileTargets` refuses a
 * submission missing any. There is nothing a form could know less about.
 *
 * ## `targets_changed_on` moves only when a target does
 *
 * Read-then-write for that reason alone — the comparison needs the old values.
 * A save that changes only the height, or re-saves what was there, leaves the
 * date where it was: a week is not judged by a different number because the
 * form was submitted. The date is today in the zone being SAVED, since that is
 * the zone every later week is dated in.
 *
 * `false` means no profile row, for `saveSchedule`'s reason: settings does not
 * invent the slot times and the program start a profile also needs.
 */
export async function saveTargets(
  userId: string,
  update: ProfileTargets,
  now: Date = new Date(),
): Promise<boolean> {
  const s = scope(userId, getDb());

  const profile = await s.selectOne(schema.profiles);

  if (!profile) return false;

  const rows = await s.update(schema.profiles, {
    ...update,
    targetsChangedOn: targetsChanged(profile, update)
      ? todayIn(update.timezone, now)
      : profile.targetsChangedOn,
  });

  return rows.length > 0;
}
