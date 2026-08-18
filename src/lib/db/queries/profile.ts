import "server-only";

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

/** What the settings screen renders from. `undefined` when there is no profile. */
export type ProfileSchedule = Pick<Profile, "slotTimes" | "workoutTimes" | "timezone">;

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
  });

  return rows.length > 0;
}
