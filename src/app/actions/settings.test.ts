import { beforeEach, describe, expect, test, vi } from "vitest";

import { TARGET_FIELD, targetFields, type ProfileTargets } from "@/lib/profile-targets";
import { demoProfile } from "@/lib/seed/persona";

/**
 * The targets' action layer — FUEL-136.
 *
 * Mocked the way `weight.test.ts` is: the session, the database and `refresh()`
 * are the request, so what is left is the boundary — that the parser runs
 * BEFORE the write, that the write is the session's user and nobody named in
 * the form, and that no path throws. What the statement does to the row, and
 * when `targets_changed_on` moves, is `tests/integration/profile.test.ts`'s.
 */

const { getSession, saveSchedule, saveTargets, refresh } = vi.hoisted(() => ({
  getSession: vi.fn(),
  saveSchedule: vi.fn(),
  saveTargets: vi.fn(),
  refresh: vi.fn(),
}));

vi.mock("@/lib/auth/session", () => ({ getSession }));
vi.mock("@/lib/db/queries/profile", () => ({ saveSchedule, saveTargets }));
vi.mock("next/cache", () => ({ refresh }));

const { saveProfileTargets } = await import("./settings");

const USER = "11111111-2222-3333-4444-555555555555";

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

function form(fields: Record<string, string>): FormData {
  const data = new FormData();

  for (const [name, value] of Object.entries(fields)) data.append(name, value);

  return data;
}

beforeEach(() => {
  vi.clearAllMocks();
  getSession.mockResolvedValue({ userId: USER, kind: "owner" });
  saveTargets.mockResolvedValue(true);
});

describe("saveProfileTargets", () => {
  test("writes the parsed values for the session's user, then refreshes", async () => {
    const state = await saveProfileTargets(undefined, form(targetFields(SAM)));

    expect(state).toEqual({ status: "saved", at: expect.any(Number) });
    expect(saveTargets).toHaveBeenCalledWith(USER, SAM);
    expect(refresh).toHaveBeenCalledOnce();
  });

  test("ignores a user id in the form — the session names the row", async () => {
    await saveProfileTargets(undefined, form({ ...targetFields(SAM), userId: "someone-else" }));

    expect(saveTargets).toHaveBeenCalledWith(USER, SAM);
  });

  test("refuses an invalid field before anything is written", async () => {
    const state = await saveProfileTargets(
      undefined,
      form({ ...targetFields(SAM), [TARGET_FIELD.kcal]: "lots" }),
    );

    expect(state).toEqual({
      status: "invalid",
      errors: { [TARGET_FIELD.kcal]: expect.any(String) },
    });
    expect(saveTargets).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
  });

  test("accepts a zone from the runtime's own list", async () => {
    const state = await saveProfileTargets(
      undefined,
      form({ ...targetFields(SAM), [TARGET_FIELD.timezone]: "America/New_York" }),
    );

    expect(state?.status).toBe("saved");
    expect(saveTargets).toHaveBeenCalledWith(USER, { ...SAM, timezone: "America/New_York" });
  });

  test("fails without a session, and writes nothing", async () => {
    getSession.mockResolvedValue(null);

    expect(await saveProfileTargets(undefined, form(targetFields(SAM)))).toEqual({
      status: "failed",
    });
    expect(saveTargets).not.toHaveBeenCalled();
  });

  test("fails without a profile row, and does not refresh", async () => {
    saveTargets.mockResolvedValue(false);

    expect(await saveProfileTargets(undefined, form(targetFields(SAM)))).toEqual({
      status: "failed",
    });
    expect(refresh).not.toHaveBeenCalled();
  });

  test("returns a failure rather than throwing when the write does", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    saveTargets.mockRejectedValue(new Error("connection reset"));

    expect(await saveProfileTargets(undefined, form(targetFields(SAM)))).toEqual({
      status: "failed",
    });
    expect(error).toHaveBeenCalled();

    error.mockRestore();
  });
});
