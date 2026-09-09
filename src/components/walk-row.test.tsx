import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { appendFix, NOTHING_RECORDED, type Recording } from "@/lib/recording";
import { EARTH_RADIUS_M } from "@/lib/route";
import type { WalkEntryView } from "@/lib/walk";

const logWalk = vi.fn();
const clearWalk = vi.fn();
const saveWalkRecording = vi.fn();
const openWalkRoute = vi.fn();
const nameRoute = vi.fn();

vi.mock("@/app/actions/log-walk", () => ({
  logWalk: (...args: unknown[]) => logWalk(...args),
  clearWalk: (...args: unknown[]) => clearWalk(...args),
  saveWalkRecording: (...args: unknown[]) => saveWalkRecording(...args),
}));

// The logged row mounts the sheet where a route exists (FUEL-102), and the
// sheet fetches on open. Stubbed here so this file stays about the RECORDER:
// `walk-sheet.test.tsx` is where the sheet's own behaviour is asserted.
vi.mock("@/app/actions/walk-route", () => ({
  openWalkRoute: (...args: unknown[]) => openWalkRoute(...args),
  nameRoute: (...args: unknown[]) => nameRoute(...args),
}));

const { WalkRow } = await import("./walk-row");

/**
 * FUEL-101 — recording a walk from the row, and everything that can go wrong.
 *
 * The pure half is `recording.test.ts`; this file is the half that needs a
 * document: the permission, the wake lock, the draft and the four states the
 * row can be in. What it is mostly testing is ABSENCES — a denial that surfaces
 * no error, a transient failure that does not end the walk, a one-tap log that
 * is still there when everything else fails — because those are the criteria,
 * and an absence is what a rewrite quietly removes.
 *
 * ## Not one coordinate literal in this file
 *
 * PRD § P11's rule, and `route.test.ts`'s and `recording.test.ts`'s: positions
 * are written in METRES east and north of an origin of zero and projected. It
 * applies with more force here than there, because this is the file where it
 * would be most natural to paste a real reading off a phone.
 */

const METRES_PER_DEGREE = (Math.PI / 180) * EARTH_RADIUS_M;
const START = 1_700_000_000_000;

/** What `watchPosition` hands its callback, as much of it as this reads. */
type Reading = {
  coords: { latitude: number; longitude: number; accuracy: number };
  timestamp: number;
};

/** A `GeolocationPosition`, `east`/`north` metres from the origin. */
const position = (east: number, north: number, after: number, accuracy = 5): Reading => ({
  coords: {
    latitude: north / METRES_PER_DEGREE,
    longitude: east / METRES_PER_DEGREE,
    accuracy,
  },
  timestamp: START + after,
});

/** The same reading as `recording.ts` takes it — for building a stored draft. */
const asFix = (east: number, north: number, after: number) => ({
  lat: 0,
  lng: east / METRES_PER_DEGREE,
  accuracy: 5,
  at: START + after,
});

const DATE = "2026-08-20" as const;

/** A fresh entry id per test, so one test's draft is never another's. */
let entryId = "";
let watchId = 0;

const watchPosition = vi.fn();
const clearWatch = vi.fn();
const requestLock = vi.fn();

let onFix: (reading: Reading) => void;
let onError: (error: { code: number }) => void;

/** Installs a browser that can record. */
function withGeolocation(): void {
  vi.stubGlobal(
    "navigator",
    Object.assign(Object.create(navigator), {
      geolocation: { watchPosition, clearWatch },
      wakeLock: { request: requestLock },
    }),
  );
}

/**
 * Installs one that cannot.
 *
 * `geolocation` is set to undefined rather than deleted, because `in` walks the
 * prototype chain and this navigator is built on the real one — which is why
 * the component asks whether `watchPosition` is callable rather than whether
 * the key is present. A browser without the API and a browser that has had it
 * disabled are the same case, and only a capability check sees both.
 */
function withoutGeolocation(): void {
  vi.stubGlobal(
    "navigator",
    Object.assign(Object.create(navigator), { geolocation: undefined }),
  );
}

/** Feeds one reading to the running watch. */
const emit = (east: number, north: number, after: number, accuracy = 5) =>
  act(() => {
    onFix(position(east, north, after, accuracy));
  });

/**
 * `count` readings of a believable walk — 100m and 20 seconds apart.
 *
 * Both numbers matter and neither is decoration. 20 seconds is inside
 * `SEGMENT_GAP_S`, so this is one continuous stretch rather than a string of
 * one-point segments; 100m in 20s is 5 m/s, under `MAX_SPEED_MPS`, so every
 * reading is kept. A test that spaced them further apart would be testing the
 * gap rule while believing it was testing the readout.
 */
const walked = (count: number) => {
  for (let index = 0; index < count; index += 1) emit(index * 100, 0, index * 20_000);
};

/**
 * The row under test. `entry` is the walk's logged figures — FUEL-102 widened
 * it, and the default here is the one-tap walk: minutes, no distance, no trace.
 * A case that wants the sheet's affordance asks for `hasRoute` explicitly.
 */
const row = (entry: Partial<WalkEntryView> | null = null) => (
  <ul>
    <WalkRow
      date={DATE}
      entryId={entryId}
      name="Morning Walk"
      entry={
        entry && {
          durationMin: null,
          distanceM: null,
          steps: null,
          stepsSource: null,
          hasRoute: false,
          ...entry,
        }
      }
    />
  </ul>
);

beforeEach(() => {
  entryId = `entry-${Math.random().toString(36).slice(2)}`;
  watchId += 1;

  logWalk.mockReset().mockResolvedValue({ ok: true });
  clearWalk.mockReset().mockResolvedValue({ ok: true });
  saveWalkRecording.mockReset().mockResolvedValue({ ok: true });

  watchPosition.mockReset().mockImplementation((success, error) => {
    onFix = success;
    onError = error;

    return watchId;
  });
  clearWatch.mockReset();
  requestLock
    .mockReset()
    .mockResolvedValue({ released: false, release: vi.fn().mockResolvedValue(undefined) });

  window.localStorage.clear();
  withGeolocation();
});

afterEach(() => {
  // Unmount BEFORE the stubs come off. The recording effect's cleanup clears
  // the watch, and restoring the real navigator first would have it reach for a
  // `geolocation` that is no longer there — a failure in the teardown that
  // reads as a failure in the component.
  cleanup();
  vi.unstubAllGlobals();
});

describe("what the row offers before anything is recorded", () => {
  test("offers the one tap and the recording, in that order", async () => {
    render(row());

    const buttons = screen.getAllByRole("button");

    expect(buttons[0]?.textContent).toBe("Log walk");
    expect(buttons[1]?.textContent).toBe("Record");
  });

  test("states what recording needs and what it costs, before it starts", () => {
    // FUEL-101's criterion — "The battery cost is stated in the interface
    // before recording starts" — and § P11's, that the foreground-only limit is
    // stated where recording is offered and not only in the document.
    render(row());

    expect(screen.getByText(/screen on, app open/i)).toBeTruthy();
    expect(screen.getByText(/uses battery/i)).toBeTruthy();
  });

  test("offers no recording at all where the browser cannot, and says nothing about it", () => {
    withoutGeolocation();
    render(row());

    expect(screen.getByRole("button", { name: "Log walk" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Record" })).toBeNull();
    // No disabled control and no explanation — § P11's "no errors surfaced".
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByText(/uses battery/i)).toBeNull();
  });

  test("still logs in one tap, which is the criterion that does not bend", async () => {
    render(row());

    await userEvent.click(screen.getByRole("button", { name: "Log walk" }));

    await waitFor(() =>
      expect(logWalk).toHaveBeenCalledWith({ date: DATE, entryId, durationMin: null }),
    );
    expect(saveWalkRecording).not.toHaveBeenCalled();
  });
});

describe("the logged walk's figures — FUEL-102, FUEL-103", () => {
  test("reads in the order § The Route Trace writes the line", () => {
    // The guide spells this line out: `/ 3.2 km · 34 min · ~4,300 steps`. The
    // ORDER is the assertion — one regex over the whole line rather than three
    // presence checks, because three of those pass on any arrangement.
    render(row({ durationMin: 34, distanceM: 3200, steps: 4500, stepsSource: "estimated" }));

    expect(screen.getByText(/3\.2 km · 34 min · ~4,500 steps/)).toBeTruthy();
  });

  test("a walk with no step figure draws none, rather than a zero", () => {
    // § P11's "absent rather than zeroed". A one-tap walk, a walk logged
    // before P11, and a walk whose owner has no plausible height all land
    // here, and the line is the two figures it does have.
    render(row({ durationMin: 34, distanceM: 3200 }));

    expect(screen.getByText(/3\.2 km · 34 min$/)).toBeTruthy();
    expect(screen.queryByText(/steps/)).toBeNull();
  });

  test("a counted figure takes no tilde", () => {
    /*
     * The seam doing visible work — FUEL-103. Nothing in the app writes
     * `device`, so this state is planted here exactly as the integration
     * suite plants its row: the branch would otherwise ship unmeasured, and a
     * real count from FUEL-105 would arrive drawn as a guess.
     */
    render(row({ durationMin: 34, distanceM: 3200, steps: 4317, stepsSource: "device" }));

    expect(screen.getByText(/3\.2 km · 34 min · 4,317 steps/)).toBeTruthy();
    expect(screen.queryByText(/~/)).toBeNull();
  });

  test("the step figure alone is enough of a line to draw", () => {
    // The parts are filtered independently, so a walk that measured a distance
    // and no duration still reads. Nothing is drawn only when there is nothing
    // at all — "an empty Slash line would be a `/` with nothing after it".
    render(row({ distanceM: 3200, steps: 4500, stepsSource: "estimated" }));

    expect(screen.getByText(/3\.2 km · ~4,500 steps/)).toBeTruthy();
  });
});

describe("recording", () => {
  test("asks for the position on the tap, and not before it", async () => {
    // § P11: the permission is requested "on the tap that starts a recording
    // rather than on page load, so the prompt arrives with a reason".
    render(row());

    expect(watchPosition).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole("button", { name: "Record" }));

    expect(watchPosition).toHaveBeenCalledTimes(1);
    expect(watchPosition.mock.calls[0]?.[2]).toMatchObject({ enableHighAccuracy: true });
  });

  test("unwinds cleanly when starting the watch throws", async () => {
    // A capability check is not a promise that the call succeeds: an insecure
    // context or an embedded webview can refuse at the call itself. Without the
    // guard this leaves the one state a user cannot escape — a row showing
    // "Stop", no watch running, and the screen held awake.
    watchPosition.mockImplementation(() => {
      throw new Error("Geolocation is not available in this context.");
    });

    render(row());

    await userEvent.click(screen.getByRole("button", { name: "Record" }));

    expect(screen.getByRole("button", { name: "Log walk" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Stop" })).toBeNull();
    // Silent, like every other refusal on this row.
    expect(screen.queryByRole("alert")).toBeNull();

    const sentinel = await requestLock.mock.results[0]?.value;

    await waitFor(() => expect(sentinel.release).toHaveBeenCalled());
  });

  test("takes the wake lock while it runs and gives it back on Stop", async () => {
    render(row());

    await userEvent.click(screen.getByRole("button", { name: "Record" }));
    await waitFor(() => expect(requestLock).toHaveBeenCalledWith("screen"));

    const sentinel = await requestLock.mock.results[0]?.value;

    emit(0, 0, 0);
    emit(100, 0, 60_000);

    await userEvent.click(screen.getByRole("button", { name: "Stop" }));

    expect(clearWatch).toHaveBeenCalledWith(watchId);
    await waitFor(() => expect(sentinel.release).toHaveBeenCalled());
  });

  test("gives the watch and the screen back when the row leaves mid-walk", async () => {
    // Navigating away while recording. The effect's cleanup is the only thing
    // that runs, so it has to do both: a watch left running keeps the receiver
    // on for the life of the tab, and a lock left held is a screen that never
    // sleeps with nothing on it to explain why.
    render(row());

    await userEvent.click(screen.getByRole("button", { name: "Record" }));
    await waitFor(() => expect(requestLock).toHaveBeenCalledTimes(1));

    const sentinel = await requestLock.mock.results[0]?.value;

    walked(3);
    cleanup();

    expect(clearWatch).toHaveBeenCalledWith(watchId);
    await waitFor(() => expect(sentinel.release).toHaveBeenCalled());
  });

  test("re-takes the lock the platform dropped when the tab was hidden", async () => {
    // The platform releases it on hide and does not give it back. Without this
    // the second half of every walk runs with the screen free to sleep, and
    // nothing on screen changes to say so.
    render(row());

    await userEvent.click(screen.getByRole("button", { name: "Record" }));
    await waitFor(() => expect(requestLock).toHaveBeenCalledTimes(1));

    // What the platform actually does when the tab hides: the sentinel is left
    // behind and marked released. `hold` checks `released` rather than the ref
    // alone precisely so the re-request is not a no-op here.
    const dropped = await requestLock.mock.results[0]?.value;

    dropped.released = true;

    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });

    await waitFor(() => expect(requestLock).toHaveBeenCalledTimes(2));
  });

  test("reads out what it has actually seen", async () => {
    render(row());

    await userEvent.click(screen.getByRole("button", { name: "Record" }));

    expect(screen.getByText(/finding your position/i)).toBeTruthy();

    walked(7);

    // 0.6 km in two minutes — both figures off the recording rather than off a
    // clock, so the readout and what gets saved are the same numbers.
    expect(screen.getByText(/0\.6 km · 2:00/)).toBeTruthy();
  });

  test("saves the geometry and nothing else", async () => {
    render(row());

    await userEvent.click(screen.getByRole("button", { name: "Record" }));
    walked(7);
    await userEvent.click(screen.getByRole("button", { name: "Stop" }));

    await waitFor(() => expect(saveWalkRecording).toHaveBeenCalled());

    const sent = saveWalkRecording.mock.calls[0]?.[0];

    expect(sent).toMatchObject({ date: DATE, entryId });
    // No distance and no duration crossing the wire — both are derivable, and a
    // number that can disagree with the shape it describes is a number a forged
    // body would send instead.
    expect(Object.keys(sent)).toEqual(["date", "entryId", "track"]);
    expect(sent.track).toHaveLength(1);
  });

  test("sends every fix it kept, rather than thinning on the way out", async () => {
    /*
     * The bug this pins, found by recording a walk in a browser and reading the
     * row back. `simplifyToCap` applies its 2m base epsilon whether or not the
     * track is over the cap, so calling it unconditionally thinned EVERY walk —
     * and because the server re-derives the tolerance from what it receives, an
     * already-thinned track stored `simplified_tolerance_m` NULL: "nothing was
     * dropped", about a trace that had been. Distance is measured on what
     * arrives too, and RDP cuts corners, so a real walk's figure would have
     * read low in a number that reaches the export and the energy range.
     *
     * Seven collinear fixes are the sharpest version of it: RDP reduces them to
     * two, so a thinning send is the difference between 7 and 2 and nothing
     * subtler is needed to catch it.
     */
    render(row());

    await userEvent.click(screen.getByRole("button", { name: "Record" }));
    walked(7);
    await userEvent.click(screen.getByRole("button", { name: "Stop" }));

    await waitFor(() => expect(saveWalkRecording).toHaveBeenCalled());

    const sent = saveWalkRecording.mock.calls[0]?.[0];

    expect(sent.track[0]).toHaveLength(7);
  });

  test("logs the walk plainly when the receiver never settled", async () => {
    // Granted, watched, and every reading too coarse to use. That is a walk
    // with no route — "a complete walk with fewer figures, never a partial
    // one" — so it takes the row a tap would have produced.
    render(row());

    await userEvent.click(screen.getByRole("button", { name: "Record" }));
    emit(0, 0, 0, 5000);
    emit(50, 0, 60_000, 5000);
    await userEvent.click(screen.getByRole("button", { name: "Stop" }));

    await waitFor(() => expect(logWalk).toHaveBeenCalled());
    expect(saveWalkRecording).not.toHaveBeenCalled();
  });
});

describe("refusal, and the failures that are not refusals", () => {
  test("a denied permission returns the row to rest and surfaces no error", async () => {
    // § P11, and § P9's push before it: "a denial is a normal state, not an
    // error". The walk logs as it does today.
    render(row());

    await userEvent.click(screen.getByRole("button", { name: "Record" }));

    act(() => {
      onError({ code: 1 });
    });

    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByRole("button", { name: "Log walk" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Stop" })).toBeNull();
    expect(clearWatch).toHaveBeenCalledWith(watchId);
  });

  test("a lost fix does not end the walk", async () => {
    // POSITION_UNAVAILABLE is a tunnel, not a refusal. A recorder that stopped
    // on it would end the walk under the first bridge.
    render(row());

    await userEvent.click(screen.getByRole("button", { name: "Record" }));
    emit(0, 0, 0);

    act(() => {
      onError({ code: 2 });
    });

    expect(screen.getByRole("button", { name: "Stop" })).toBeTruthy();
    expect(clearWatch).not.toHaveBeenCalled();
  });

  test("keeps what was recorded when the permission is withdrawn mid-walk", async () => {
    render(row());

    await userEvent.click(screen.getByRole("button", { name: "Record" }));
    walked(7);

    act(() => {
      onError({ code: 1 });
    });

    // Nothing is lost silently: the walk that was recorded is offered back.
    expect(screen.getByText(/a recording was interrupted/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Save it" })).toBeTruthy();
  });
});

describe("an interrupted recording", () => {
  /** A draft as the recorder would have left it in storage. */
  const stored = (): Recording =>
    Array.from({ length: 7 }, (_value, index) => asFix(index * 100, 0, index * 20_000)).reduce(
      appendFix,
      NOTHING_RECORDED,
    );

  const seed = () =>
    window.localStorage.setItem(
      `fuel:walk-recording:${DATE}:${entryId}`,
      JSON.stringify(stored()),
    );

  test("is offered back on the first paint, with a way to keep it or drop it", () => {
    seed();
    render(row());

    expect(screen.getByText(/A recording was interrupted · 0\.6 km · 2:00/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Resume" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Save it" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Discard" })).toBeTruthy();
  });

  test("resumes on the same walk rather than starting a second one", async () => {
    seed();
    render(row());

    await userEvent.click(screen.getByRole("button", { name: "Resume" }));

    // The readout carries the recovered walk, so the resumed recording is the
    // same one — not an empty recorder that has forgotten the first half.
    expect(screen.getByText(/0\.6 km · 2:00/)).toBeTruthy();

    emit(700, 0, 140_000);

    expect(screen.getByText(/0\.7 km · 2:20/)).toBeTruthy();
  });

  test("is cleared from storage when it is saved", async () => {
    seed();
    render(row());

    await userEvent.click(screen.getByRole("button", { name: "Save it" }));

    await waitFor(() => expect(saveWalkRecording).toHaveBeenCalled());
    await waitFor(() =>
      expect(window.localStorage.getItem(`fuel:walk-recording:${DATE}:${entryId}`)).toBeNull(),
    );
  });

  test("is cleared from storage when it is discarded", async () => {
    seed();
    render(row());

    await userEvent.click(screen.getByRole("button", { name: "Discard" }));

    expect(window.localStorage.getItem(`fuel:walk-recording:${DATE}:${entryId}`)).toBeNull();
    expect(screen.queryByText(/a recording was interrupted/i)).toBeNull();
  });

  test("survives a refused save, and Try again retries the SAVE", async () => {
    // The bug this pins: retrying a recording as a plain log would write the
    // walk correctly and throw the route away — the silent loss this whole
    // ticket is written against, arriving through the control offered to
    // prevent it.
    seed();
    saveWalkRecording.mockResolvedValue({ ok: false });
    render(row());

    await userEvent.click(screen.getByRole("button", { name: "Save it" }));

    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toContain("Couldn’t save that."),
    );
    expect(window.localStorage.getItem(`fuel:walk-recording:${DATE}:${entryId}`)).not.toBeNull();

    saveWalkRecording.mockResolvedValue({ ok: true });
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));

    await waitFor(() => expect(saveWalkRecording).toHaveBeenCalledTimes(2));
    expect(logWalk).not.toHaveBeenCalled();
  });

  test("survives leaving the screen mid-walk and coming back", async () => {
    /*
     * Navigating `/` -> `/training` unmounts this row, which ends the watch —
     * expected, the platform only records in the foreground. What must NOT
     * happen is the walk vanishing: the draft is on disk, and coming back has
     * to offer it.
     *
     * The bug this pins is in the draft STORE rather than in storage. The
     * module-level cache is read once per key and lives as long as the tab, so
     * a per-fix write that touched only `localStorage` left the cache holding
     * the `null` it read on first mount — and the row came back offering
     * "Record", with a perfectly good recording sitting in storage that only a
     * full page reload would ever surface. Silently lost, which is the one
     * thing this ticket is written against.
     */
    render(row());

    await userEvent.click(screen.getByRole("button", { name: "Record" }));
    walked(7);

    // Leaving the screen. The draft is already written; nothing else runs.
    cleanup();

    render(row());

    expect(screen.getByText(/A recording was interrupted · 0\.6 km · 2:00/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Resume" })).toBeTruthy();
  });

  test("is not offered for a draft that did not come from the recorder", () => {
    window.localStorage.setItem(
      `fuel:walk-recording:${DATE}:${entryId}`,
      '{"segments":"walked"}',
    );

    render(row());

    expect(screen.queryByText(/a recording was interrupted/i)).toBeNull();
    expect(screen.getByRole("button", { name: "Record" })).toBeTruthy();
  });
});

describe("a storage that refuses", () => {
  test("records anyway, and only the recovery is lost", async () => {
    // It throws outright in a private window and with site data blocked. The
    // recording is in memory; storage is a mirror of it.
    const setItem = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(() => {
        throw new Error("The operation is insecure.");
      });

    render(row());

    await userEvent.click(screen.getByRole("button", { name: "Record" }));
    walked(7);

    expect(screen.getByText(/0\.6 km · 2:00/)).toBeTruthy();

    await userEvent.click(screen.getByRole("button", { name: "Stop" }));

    await waitFor(() => expect(saveWalkRecording).toHaveBeenCalled());

    setItem.mockRestore();
  });
});
