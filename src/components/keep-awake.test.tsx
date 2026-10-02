import { act, render } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";

import { KeepAwake } from "./keep-awake";

/**
 * The recipe's wake lock — FUEL-145, Brand Guide § Recipe.
 *
 * Mocked the way `rest-timer.test.tsx` mocks it: a `navigator` whose prototype
 * is jsdom's, with a `wakeLock` added. jsdom has none of its own, which is the
 * last describe's starting point rather than something to stub away.
 */

const sentinel = () => ({ released: false, release: vi.fn(async () => {}) });

const stubWakeLock = (request: () => Promise<unknown>) =>
  vi.stubGlobal("navigator", Object.assign(Object.create(navigator), { wakeLock: { request } }));

const granting = (lock: ReturnType<typeof sentinel>) => {
  const request = vi.fn(async () => lock);
  stubWakeLock(request);
  return request;
};

const showTab = async (event: "visibilitychange" | "pageshow") => {
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  await act(async () => {
    (event === "pageshow" ? window : document).dispatchEvent(new Event(event));
  });
};

/** Lets a rejection the code failed to catch reach the process's handler. */
const settle = () => act(() => new Promise((resolve) => setTimeout(resolve, 0)));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("the lock", () => {
  test("is requested when the recipe opens", async () => {
    const request = granting(sentinel());

    render(<KeepAwake />);
    await act(async () => {});

    expect(request).toHaveBeenCalledExactlyOnceWith("screen");
  });

  test("is released when the recipe is left", async () => {
    const lock = sentinel();
    granting(lock);

    const { unmount } = render(<KeepAwake />);
    await act(async () => {});
    expect(lock.release).not.toHaveBeenCalled();

    unmount();

    expect(lock.release).toHaveBeenCalledTimes(1);
  });

  test("draws nothing", () => {
    granting(sentinel());

    const { container } = render(<KeepAwake />);

    // § Recipe: no toggle, no notice. The lock is felt, not seen.
    expect(container.innerHTML).toBe("");
  });
});

describe("coming back to the tab", () => {
  test.each(["visibilitychange", "pageshow"] as const)(
    "re-requests it on %s, because the platform dropped it",
    async (event) => {
      const lock = sentinel();
      const request = granting(lock);

      render(<KeepAwake />);
      await act(async () => {});
      expect(request).toHaveBeenCalledTimes(1);

      // What the platform does on hide: the sentinel stays, marked released,
      // and nothing reacquires it.
      lock.released = true;
      await showTab(event);

      expect(request).toHaveBeenCalledTimes(2);
    },
  );

  test("does not ask while the tab is still hidden", async () => {
    const lock = sentinel();
    const request = granting(lock);

    render(<KeepAwake />);
    await act(async () => {});
    lock.released = true;

    // A request from a hidden document is refused anyway; asking is noise.
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });

    expect(request).toHaveBeenCalledTimes(1);
  });

  test("stops listening once the recipe is left", async () => {
    const lock = sentinel();
    const request = granting(lock);

    const { unmount } = render(<KeepAwake />);
    await act(async () => {});
    unmount();

    await showTab("visibilitychange");
    await showTab("pageshow");

    // A listener left behind would take a lock for a screen that is gone, and
    // nothing would ever release it.
    expect(request).toHaveBeenCalledTimes(1);
  });
});

describe("a grant that arrives after the recipe is left", () => {
  test("is released, not kept", async () => {
    /*
     * memory: await-then-store. Leaving while the platform is still deciding
     * runs cleanup against an empty ref; without `wanted` cleared first, the
     * grant that follows is filed in a ref nothing reads again and the screen
     * never sleeps.
     */
    const lock = sentinel();
    let grant: (value: typeof lock) => void = () => {};
    const request = vi.fn(
      () =>
        new Promise<typeof lock>((resolve) => {
          grant = resolve;
        }),
    );
    stubWakeLock(request);

    const { unmount } = render(<KeepAwake />);
    expect(request).toHaveBeenCalledTimes(1);

    unmount();
    expect(lock.release).not.toHaveBeenCalled();

    await act(async () => {
      grant(lock);
    });

    expect(lock.release).toHaveBeenCalledTimes(1);
  });
});

describe("where there is no lock to be had", () => {
  const unhandled = vi.fn();

  const watchRejections = () => {
    unhandled.mockClear();
    process.on("unhandledRejection", unhandled);
    return () => process.off("unhandledRejection", unhandled);
  };

  test("an absent API is the ordinary screen, with no error", async () => {
    const stop = watchRejections();

    // jsdom's own navigator: no `wakeLock` at all, as in Firefox.
    expect("wakeLock" in navigator).toBe(false);

    const { container, unmount } = render(<KeepAwake />);
    await settle();
    await showTab("visibilitychange");
    unmount();
    await settle();
    stop();

    expect(container.innerHTML).toBe("");
    expect(unhandled).not.toHaveBeenCalled();
  });

  test("a refused request is the ordinary screen, with no error", async () => {
    const stop = watchRejections();
    const request = vi.fn(async () => {
      throw new DOMException("not allowed", "NotAllowedError");
    });
    stubWakeLock(request);

    const { unmount } = render(<KeepAwake />);
    await settle();
    await showTab("pageshow");
    unmount();
    await settle();
    stop();

    // Asked on mount and again on return: a refusal is not remembered as a
    // reason to stop asking, because the next one may be granted.
    expect(request).toHaveBeenCalledTimes(2);
    expect(unhandled).not.toHaveBeenCalled();
  });

  test("a release that rejects is swallowed too", async () => {
    const stop = watchRejections();
    const lock = {
      released: false,
      release: vi.fn(async () => {
        throw new DOMException("gone", "InvalidStateError");
      }),
    };
    granting(lock);

    const { unmount } = render(<KeepAwake />);
    await act(async () => {});
    unmount();
    await settle();
    stop();

    expect(lock.release).toHaveBeenCalledTimes(1);
    expect(unhandled).not.toHaveBeenCalled();
  });
});
