import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { RestTimer } from "./rest-timer";

/**
 * The rest timer's browser half — FUEL-93, PRD § P10.
 *
 * `lib/rest-timer.test.ts` proves the arithmetic. This file proves the four
 * things that arithmetic cannot: that the component asks the CLOCK rather than
 * the interval, that a value out of `localStorage` cannot break the row, that
 * every completion signal is optional, and that none of it is a modal.
 *
 * ## Why fake timers here rather than a clock the component takes as a prop
 *
 * Because the fault this ticket exists to prevent lives in the gap between the
 * two. A timer that decrements on every tick and a timer that subtracts against
 * a clock behave identically under any test that lets the interval run — which
 * is every test anyone would write by default, and which is why the wrong
 * spelling is the one that ships. The tests below separate them by moving the
 * SYSTEM CLOCK while withholding the ticks, which is what a locked phone does.
 *
 * ## Everything the signals touch is absent in jsdom
 *
 * `navigator.vibrate`, `AudioContext`, `Notification` and
 * `navigator.serviceWorker` are none of them implemented here, and
 * `navigator.wakeLock` is not either. That is the default state of this file
 * and it is deliberate: the "degrades silently" criterion is what every test
 * below runs under unless it installs a stub, so a signal that started throwing
 * on an unsupporting browser would fail the whole file rather than one case.
 */

const NOW = Date.UTC(2026, 8, 2, 18, 30, 0);
const KEY = "fuel:rest-timer";

/** The tick period the component repaints on. */
const TICK = 250;

/**
 * Advances the clock WITHOUT running a single timer — a phone locked in a
 * pocket, where the tab is suspended and the interval does not fire at all.
 *
 * This is the whole apparatus of this file. `vi.advanceTimersByTime` would move
 * the clock and fire every tick along the way, which is the case that cannot
 * tell the two spellings apart.
 */
const sleep = (ms: number) => {
  vi.setSystemTime(Date.now() + ms);
};

/** One repaint, and the 250ms it costs. */
const tick = async () => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(TICK);
  });
};

const reading = () => screen.getByRole("timer").textContent;

/**
 * `fireEvent` rather than `userEvent`, which is what the rest of this suite
 * uses and what would ordinarily be right.
 *
 * `userEvent` schedules its own delays between the pointer events it
 * synthesises, on a clock this file has replaced with a fake one it advances by
 * hand. Its `advanceTimers` option exists for that and does not survive the
 * combination here — the click never resolves and the test times out at five
 * seconds rather than failing. There is nothing under test that needs the full
 * pointer sequence: these are three buttons and a click.
 */
const press = (label: string) => {
  act(() => {
    fireEvent.click(screen.getByRole("button", { name: label }));
  });
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  window.localStorage.clear();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  // Not optional: the blocked-`localStorage` case below spies on
  // `Storage.prototype`, and a spy left behind makes every later test in the
  // file fail inside the store rather than at its own assertion.
  vi.restoreAllMocks();
});

describe("starting and stopping, and nothing else", () => {
  test("offers the presets and no readout until one is tapped", () => {
    render(<RestTimer />);

    // The criterion is "started and stopped by hand; nothing starts it
    // automatically". There is no prop through which a logged set could reach
    // this component — see the render site in `training.tsx` — so the whole of
    // that criterion is the absence asserted here.
    expect(screen.queryByRole("timer")).toBeNull();

    for (const label of ["1:00", "1:30", "2:00"]) {
      expect(screen.getByRole("button", { name: label })).toBeTruthy();
    }
  });

  test("a preset starts the timer at its full duration", async () => {
    render(<RestTimer />);
    press("1:30");

    // `1:30` and not `1:29` — the ceiling, and the number the reader tapped.
    expect(reading()).toBe("1:30");
  });

  test("Stop clears it and gives the presets back", async () => {
    render(<RestTimer />);
    press("1:30");
    press("Stop");

    expect(screen.queryByRole("timer")).toBeNull();
    expect(screen.getByRole("button", { name: "1:30" })).toBeTruthy();
    // Nothing left behind, so a reload does not resurrect a stopped rest.
    expect(window.localStorage.getItem(KEY)).toBeNull();
  });

  test("does not run before a preset is tapped", async () => {
    render(<RestTimer />);

    sleep(600_000);
    await tick();

    expect(screen.queryByRole("timer")).toBeNull();
  });
});

describe("the reading is a subtraction, not an accumulation", () => {
  /**
   * The assertion the ticket asks for by name: "a test advances a fake clock
   * past the interval without firing it and asserts the reading is right".
   *
   * Sixty seconds of wall clock pass with the tab suspended, then the screen
   * comes back and repaints ONCE. A timer that counted its own ticks has
   * decremented once and reads `1:29`. This reads what the clock says.
   */
  test("sixty seconds of a suspended tab cost sixty seconds", async () => {
    render(<RestTimer />);
    press("1:30");

    sleep(60_000 - TICK);
    await tick();

    expect(reading()).toBe("0:30");
  });

  test("a rest that ran out unwatched is over the moment it is looked at", async () => {
    render(<RestTimer />);
    press("1:30");

    // Twenty minutes in another app. The interval fired nothing at all.
    sleep(1_200_000 - TICK);
    await tick();

    expect(screen.queryByRole("timer")).toBeNull();
  });

  test("counts down across repaints without drifting", async () => {
    render(<RestTimer />);
    press("1:00");

    for (let elapsed = TICK; elapsed <= 30_000; elapsed += TICK) await tick();

    // Two hundred and forty repaints later, the answer is still the clock's.
    expect(reading()).toBe("0:30");
  });
});

describe("backgrounding and restoring", () => {
  const visibility = (state: "hidden" | "visible") => {
    vi.spyOn(document, "visibilityState", "get").mockReturnValue(state);
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
  };

  test("the reading is right on the frame the tab comes back", async () => {
    render(<RestTimer />);
    press("2:00");

    visibility("hidden");
    sleep(90_000);
    // No tick. `visibilitychange` alone has to produce the correct figure,
    // because the interval may not fire for another minute.
    visibility("visible");

    expect(reading()).toBe("0:30");
  });

  test("a rest that ended while hidden is cleared without signalling", async () => {
    const vibrate = vi.fn();
    vi.stubGlobal("navigator", Object.assign(Object.create(navigator), { vibrate }));

    render(<RestTimer />);
    press("1:00");

    visibility("hidden");
    sleep(120_000);
    visibility("visible");

    expect(screen.queryByRole("timer")).toBeNull();
    /*
     * The one judgement the ticket leaves open, asserted so it stays made. The
     * reason to vibrate is that you are NOT looking at the screen, and
     * `visibilitychange` → visible is the moment you started. A buzz here is a
     * signal about something the reader can already see.
     */
    expect(vibrate).not.toHaveBeenCalled();
  });

  test("pageshow restores it too, for a phone coming back from the bfcache", async () => {
    render(<RestTimer />);
    press("2:00");

    sleep(90_000);
    act(() => {
      window.dispatchEvent(new Event("pageshow"));
    });

    expect(reading()).toBe("0:30");
  });
});

describe("what a reload finds", () => {
  test("restores a timer that is still running", () => {
    window.localStorage.setItem(KEY, String(NOW + 45_000));

    render(<RestTimer />);

    expect(reading()).toBe("0:45");
  });

  test("renders no timer for a corrupt value, and does not throw", () => {
    for (const stored of ["", "soon", "Infinity", "NaN", "-1", "{}"]) {
      window.localStorage.setItem(KEY, stored);

      const { unmount } = render(<RestTimer />);

      expect(screen.queryByRole("timer")).toBeNull();
      expect(screen.getByRole("button", { name: "1:30" })).toBeTruthy();
      unmount();
    }
  });

  test("renders no timer for a rest that ended while the page was closed", () => {
    window.localStorage.setItem(KEY, String(NOW - 1));

    render(<RestTimer />);

    // Also the reaper: nothing sweeps this key on a schedule because a stale
    // value is refused on the next read.
    expect(screen.queryByRole("timer")).toBeNull();
  });

  test("still starts a timer when localStorage throws outright", async () => {
    // A Safari private window, or any browser set to block site data. The
    // criterion is that the screen works; what is lost is the reload.
    const blocked = () => {
      throw new Error("The quota has been exceeded.");
    };

    vi.spyOn(Storage.prototype, "getItem").mockImplementation(blocked);
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(blocked);
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(blocked);

    render(<RestTimer />);
    press("1:30");

    expect(reading()).toBe("1:30");

    sleep(60_000 - TICK);
    await tick();

    expect(reading()).toBe("0:30");
  });

  test("picks up a rest started in another tab", async () => {
    render(<RestTimer />);

    window.localStorage.setItem(KEY, String(NOW + 45_000));
    act(() => {
      window.dispatchEvent(new StorageEvent("storage", { key: KEY }));
    });

    expect(reading()).toBe("0:45");
  });
});

describe("the completion signals", () => {
  /** Runs a 60-second rest out, with one tick landing on the far side of it. */
  const runOut = async () => {
    press("1:00");
    sleep(60_000 - TICK);
    await tick();
  };

  test("vibrates, and clears the row", async () => {
    const vibrate = vi.fn();
    vi.stubGlobal("navigator", Object.assign(Object.create(navigator), { vibrate }));

    render(<RestTimer />);
    await runOut();

    expect(vibrate).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("timer")).toBeNull();
  });

  test("sounds a tone through a context primed by the start tap", async () => {
    const oscillator = {
      frequency: { value: 0 },
      connect: vi.fn(),
      start: vi.fn(),
      stop: vi.fn(),
    };
    const gain = {
      gain: {
        setValueAtTime: vi.fn(),
        linearRampToValueAtTime: vi.fn(),
      },
      connect: vi.fn(),
    };
    const context = {
      currentTime: 0,
      destination: {},
      createOscillator: vi.fn(() => oscillator),
      createGain: vi.fn(() => gain),
      resume: vi.fn(async () => {}),
      close: vi.fn(async () => {}),
    };
    const constructed = vi.fn();

    oscillator.connect.mockReturnValue(gain);
    // A `function` and not an arrow, because the component calls it with `new`
    // — which an arrow refuses. A constructor that returns an object yields
    // that object, which is how the stub stands in for the real context.
    vi.stubGlobal(
      "AudioContext",
      function AudioContextStub() {
        constructed();
        return context;
      },
    );

    render(<RestTimer />);
    press("1:00");

    /*
     * The context is built on the TAP and not when the rest runs out. That
     * ordering is the whole of why a sound arrives at all on a phone: mobile
     * browsers refuse to start audio outside a user gesture, and a context
     * first constructed sixty seconds later is a context that is suspended.
     */
    expect(constructed).toHaveBeenCalledTimes(1);
    expect(oscillator.start).not.toHaveBeenCalled();

    sleep(60_000 - TICK);
    await tick();

    expect(oscillator.start).toHaveBeenCalledTimes(1);
    expect(oscillator.stop).toHaveBeenCalledTimes(1);
  });

  test("shows a notification on a grant it never asks for", async () => {
    const showNotification = vi.fn();
    const requestPermission = vi.fn();

    vi.stubGlobal("Notification", { permission: "granted", requestPermission });
    vi.stubGlobal(
      "navigator",
      Object.assign(Object.create(navigator), {
        serviceWorker: { ready: Promise.resolve({ showNotification }) },
      }),
    );

    render(<RestTimer />);
    await runOut();
    // The notification is awaited inside the tick's callback rather than by it.
    await act(async () => {});

    expect(showNotification).toHaveBeenCalledWith("Fuel & Form", {
      body: "Rest over.",
      tag: "fuel-rest-timer",
    });

    /*
     * The criterion: "never double-prompts against P9's existing notification
     * permission". P9 mints its grant through `pushManager.subscribe()` in
     * settings, which is a control that says what it is for. A rest timer
     * raising a permission dialog mid-session — from a tap that meant "ninety
     * seconds" — would be the app asking at the worst moment it could.
     */
    expect(requestPermission).not.toHaveBeenCalled();
  });

  test("says nothing at all when the permission was never granted", async () => {
    const showNotification = vi.fn();
    const requestPermission = vi.fn();

    vi.stubGlobal("Notification", { permission: "default", requestPermission });
    vi.stubGlobal(
      "navigator",
      Object.assign(Object.create(navigator), {
        serviceWorker: { ready: Promise.resolve({ showNotification }) },
      }),
    );

    render(<RestTimer />);
    await runOut();
    await act(async () => {});

    expect(showNotification).not.toHaveBeenCalled();
    expect(requestPermission).not.toHaveBeenCalled();
  });

  test("one signal refusing does not cost the others", async () => {
    const vibrate = vi.fn(() => {
      throw new Error("Vibration is disabled.");
    });
    const showNotification = vi.fn();

    vi.stubGlobal("Notification", { permission: "granted" });
    vi.stubGlobal(
      "navigator",
      Object.assign(Object.create(navigator), {
        vibrate,
        serviceWorker: { ready: Promise.resolve({ showNotification }) },
      }),
    );

    render(<RestTimer />);
    await runOut();
    await act(async () => {});

    // Each is wrapped alone, which is the reason they are three functions
    // rather than one try block.
    expect(vibrate).toHaveBeenCalled();
    expect(showNotification).toHaveBeenCalled();
    expect(screen.queryByRole("timer")).toBeNull();
  });

  test("completes silently on a browser that offers none of them", async () => {
    // jsdom's own state, which is this file's default — see the header.
    render(<RestTimer />);
    await runOut();

    expect(screen.queryByRole("timer")).toBeNull();
  });
});

describe("the wake lock", () => {
  const sentinel = () => ({ released: false, release: vi.fn(async () => {}) });

  const stubWakeLock = (lock: ReturnType<typeof sentinel>) => {
    const request = vi.fn(async () => lock);

    vi.stubGlobal(
      "navigator",
      Object.assign(Object.create(navigator), { wakeLock: { request } }),
    );

    return request;
  };

  test("is held while a rest runs and released when it stops", async () => {
    const lock = sentinel();
    const request = stubWakeLock(lock);

    render(<RestTimer />);
    press("1:30");
    await act(async () => {});

    expect(request).toHaveBeenCalledWith("screen");

    press("Stop");

    // Released the instant the reason for it is over. A lock held past that is
    // a battery cost with nothing on screen to explain it.
    expect(lock.release).toHaveBeenCalledTimes(1);
  });

  test("is not taken before a rest is started", () => {
    const request = stubWakeLock(sentinel());

    render(<RestTimer />);

    expect(request).not.toHaveBeenCalled();
  });

  test("is re-requested when the tab comes back, because the platform drops it", async () => {
    const lock = sentinel();
    const request = stubWakeLock(lock);

    render(<RestTimer />);
    press("2:00");
    await act(async () => {});
    expect(request).toHaveBeenCalledTimes(1);

    // What the platform actually does: the sentinel survives, marked released,
    // and nothing reacquires it. A guard that only checked the ref for null
    // would make this a no-op in the one case it was written for.
    lock.released = true;

    vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });

    expect(request).toHaveBeenCalledTimes(2);
  });

  test("is released when the screen is left mid-rest", async () => {
    const lock = sentinel();

    stubWakeLock(lock);

    const { unmount } = render(<RestTimer />);
    press("2:00");
    await act(async () => {});

    unmount();

    expect(lock.release).toHaveBeenCalledTimes(1);
  });
});

describe("what it is not", () => {
  test("is not a modal, so the page behind it stays reachable", async () => {
    render(
      <main>
        <p>The exercise list</p>
        <RestTimer />
      </main>,
    );
    press("1:30");

    /*
     * § Progressive Disclosure rules modals out, and this is the assertion that
     * would actually catch one. A dialog with `aria-modal` hides the rest of the
     * document from the accessibility tree — which is exactly what makes
     * `getByRole` queries fail elsewhere in this suite while a sheet is open —
     * so a timer that had become one would take the page with it while still
     * looking correct in a screenshot.
     */
    expect(screen.getByRole("main")).toBeTruthy();
    expect(screen.getByText("The exercise list")).toBeTruthy();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(reading()).toBe("1:30");
  });
});
