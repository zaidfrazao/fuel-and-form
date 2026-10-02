import { afterEach, describe, expect, test, vi } from "vitest";

import { hold, release } from "./wake-lock";

/**
 * The shared lock's own guards — the parts every caller relies on and none of
 * their suites can isolate. Each caller's file tests its lifecycle; this one
 * tests what happens when the platform's answers arrive out of step with it.
 */

type Fake = { released: boolean; release: () => Promise<void> };

const fake = (): Fake => {
  const s: Fake = {
    released: false,
    release: async () => {
      s.released = true;
    },
  };
  return s;
};

/** A platform that answers only when told to, in the order it was asked. */
const deferred = () => {
  const pending: ((sentinel: Fake) => void)[] = [];
  vi.stubGlobal(
    "navigator",
    Object.assign(Object.create(navigator), {
      wakeLock: { request: () => new Promise<Fake>((resolve) => pending.push(resolve)) },
    }),
  );
  return pending;
};

const refs = () => ({
  ref: { current: null as WakeLockSentinel | null },
  wanted: { current: true },
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("two requests in flight at once", () => {
  test("keep the first grant and let the second go", async () => {
    // A return that fires `visibilitychange` and `pageshow` together, or React's
    // development double-mount: both calls ask before either is answered.
    const pending = deferred();
    const { ref, wanted } = refs();

    const asked = [hold(ref, wanted), hold(ref, wanted)];
    const [first, second] = [fake(), fake()];
    pending[0](first);
    pending[1](second);
    await Promise.all(asked);

    expect(ref.current).toBe(first);
    expect(first.released).toBe(false);
    expect(second.released).toBe(true);
  });

  test("leave nothing held once the caller lets go", async () => {
    const pending = deferred();
    const { ref, wanted } = refs();

    const asked = [hold(ref, wanted), hold(ref, wanted)];
    const grants = [fake(), fake()];
    grants.forEach((sentinel, i) => pending[i](sentinel));
    await Promise.all(asked);

    wanted.current = false;
    release(ref);

    // Before the guard, the first of these stayed `false` for good: held by a
    // ref that had been overwritten, so no release could ever reach it.
    expect(grants.map((s) => s.released)).toEqual([true, true]);
  });

  test("still replace a lock the platform dropped", async () => {
    // The guard must not refuse the case re-requesting exists for: a stored
    // sentinel the platform has released is not a lock, and is replaced.
    const pending = deferred();
    const { ref, wanted } = refs();

    const dropped = fake();
    dropped.released = true;
    ref.current = dropped as unknown as WakeLockSentinel;

    const asked = hold(ref, wanted);
    const fresh = fake();
    pending[0](fresh);
    await asked;

    expect(ref.current).toBe(fresh);
    expect(fresh.released).toBe(false);
  });
});
