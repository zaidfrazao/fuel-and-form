import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { EARTH_RADIUS_M, type Track, type TrackPoint } from "@/lib/route";
import type { WalkRouteView } from "@/lib/db/queries/route";

const nameRoute = vi.fn();

vi.mock("@/app/actions/walk-route", () => ({
  nameRoute: (...args: unknown[]) => nameRoute(...args),
}));

// A type cannot be pulled out of a dynamic import's destructuring, so it
// comes in statically; only the component needs the mock applied first.
import type { RouteLoad } from "./walk-sheet";

const { WalkSheet } = await import("./walk-sheet");

/**
 * FUEL-102 — the walk's sheet: the trace, the figures, the name and the way out.
 *
 * Tracks are built from metre offsets and never from coordinate literals, which
 * `route-trace.test.ts` sets out at length: a fixture full of plausible
 * positions is the exact leak PRD § P11's rules and `check-no-metrics.sh` exist
 * to prevent, sitting in the repository that made them necessary.
 */
const METRES_PER_DEGREE = (Math.PI / 180) * EARTH_RADIUS_M;
const TEST_LATITUDE = 51;
const COS_TEST_LATITUDE = Math.cos((TEST_LATITUDE * Math.PI) / 180);

const at = (east: number, north: number, t = 0): TrackPoint => ({
  lat: TEST_LATITUDE + north / METRES_PER_DEGREE,
  lng: east / (METRES_PER_DEGREE * COS_TEST_LATITUDE),
  t,
});

/** A 2km circuit that comes back to where it started. */
const LOOP: Track = [
  [
    at(0, 0, 0),
    at(600, 300, 600),
    at(900, -200, 1200),
    at(300, -400, 1700),
    at(0, 60, 2040),
  ],
];

/** Two stretches with six minutes of nothing between them. */
const GAPPED: Track = [
  [at(0, 0, 0), at(2000, 0, 1200)],
  [at(3000, 0, 1560), at(5800, 0, 3660)],
];

const DATE = "2026-09-09" as const;

const loaded = (route: Partial<WalkRouteView> = {}): RouteLoad => ({
  state: "loaded",
  route: { points: LOOP, name: null, suggestion: null, ...route },
});

/** Whether the environment reports a touch pointer, for the map hand-off. */
let coarse = false;

function sheet(load: RouteLoad = loaded(), figures: Record<string, unknown> = {}) {
  return (
    <WalkSheet
      open
      onOpenChange={() => {}}
      date={DATE}
      entryId="entry-2"
      name="Morning Walk"
      durationMin={34}
      distanceM={3200}
      steps={4500}
      stepsSource="estimated"
      load={load}
      onRetry={() => {}}
      onNamed={() => {}}
      {...figures}
    />
  );
}

beforeEach(() => {
  coarse = false;
  nameRoute.mockReset().mockResolvedValue({ ok: true });

  // jsdom has no `matchMedia`. The pointer is what decides whether the `geo:`
  // link is drawn at all, so it is stubbed rather than left undefined — and it
  // defaults to FINE, which is the desktop case the criterion is about.
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: query.includes("pointer: coarse") ? coarse : false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("the trace", () => {
  test("draws one polyline per segment and never a chord across a gap", () => {
    render(sheet(loaded({ points: GAPPED })));

    const graphic = screen.getByRole("img");
    const lines = graphic.querySelectorAll("polyline");

    expect(lines).toHaveLength(2);

    for (const line of lines) {
      // § Data Display: the geometry scales and the ink does not.
      expect(line.getAttribute("vector-effect")).toBe("non-scaling-stroke");
      expect(line.getAttribute("fill")).toBe("none");
      expect(line.getAttribute("stroke-width")).toBe("2");
    }
  });

  test("carries the summary § The Route Trace specifies, as its accessible name", () => {
    render(sheet());

    expect(screen.getByRole("img").getAttribute("aria-label")).toBe(
      "Morning Walk, 3.2 km in 34 minutes, a loop, recorded in one segment.",
    );
  });

  /**
   * § The Route Trace's ruling: the data table for a route is not the
   * coordinates, because that "would write the trace into the accessibility
   * tree, which is the one surface PRD § P11's storage rules do not otherwise
   * reach".
   */
  test("writes no coordinate into the accessibility tree", () => {
    render(sheet());

    const label = screen.getByRole("img").getAttribute("aria-label") ?? "";

    expect(label).not.toMatch(/-?\d+\.\d{4,}/);

    for (const point of LOOP.flat()) {
      expect(label).not.toContain(String(point.lat));
    }
  });

  test("names a gap in words, because the drawing says nothing about it", () => {
    render(sheet(loaded({ points: GAPPED })));

    expect(screen.getByText(/2 segments · 6 min not recorded/)).toBeDefined();
  });

  test("says nothing at all about an ordinary unbroken walk", () => {
    render(sheet());

    expect(screen.queryByText(/segment/)).toBeNull();
  });

  test("draws no graphic and no plate while it is still loading", () => {
    render(sheet({ state: "loading" }));

    expect(screen.queryByRole("img")).toBeNull();
    expect(screen.getByText(/Loading the route/)).toBeDefined();
  });

  test("names what happened when the route cannot be read", async () => {
    const retry = vi.fn();

    render(
      <WalkSheet
        open
        onOpenChange={() => {}}
        date={DATE}
        entryId="entry-2"
        name="Morning Walk"
        durationMin={34}
        distanceM={3200}
        steps={4500}
        stepsSource="estimated"
        load={{ state: "failed" }}
        onRetry={retry}
        onNamed={() => {}}
      />,
    );

    expect(screen.getByRole("alert").textContent).toContain("Couldn’t load the route.");

    await userEvent.click(screen.getByRole("button", { name: "Try again" }));

    expect(retry).toHaveBeenCalledOnce();
  });
});

describe("the figures", () => {
  test("are the walk's own, which is the data table this graphic gets", () => {
    render(sheet());

    // Queried by TEXT rather than by the `term` role: a `dt` takes no
    // accessible name, so `getByRole("term", { name })` is an always-null query.
    for (const shown of [
      "Distance",
      "3.2 km",
      "Duration",
      "34 min",
      "Pace",
      "10:38 /km",
      "Steps",
      "~4,500",
      "Estimated",
    ]) {
      expect(screen.getByText(shown)).toBeDefined();
    }
  });

  test("drop what the walk does not have rather than drawing an empty column", () => {
    render(sheet(loaded(), { distanceM: null }));

    expect(screen.queryByText("Distance")).toBeNull();
    // No distance means no pace either — it is derived from both.
    expect(screen.queryByText("Pace")).toBeNull();
    expect(screen.getByText("Duration")).toBeDefined();
  });

  test("are in the order § The Route Trace lists them", () => {
    /*
     * "Distance, duration, pace, the step estimate and its source, and the
     * route's name when it has one." The order is the assertion — six presence
     * checks pass on any arrangement, and the guide names a sequence.
     */
    // `document` rather than the render's `container`: a sheet is a PORTAL, so
    // the container it returns is empty and every query here goes through
    // `screen` for the same reason.
    render(sheet(loaded({ name: "The river loop" })));

    expect([...document.querySelectorAll("dt")].map((dt) => dt.textContent)).toEqual([
      "Distance",
      "Duration",
      "Pace",
      "Steps",
      "Route",
    ]);
  });

  test("say the step figure is an estimate, in a word and not only a tilde", () => {
    // § P11 asks for the figure to be "labelled as an estimate in the copy",
    // and this is the surface with room for the word. The row's `~` is a
    // convention a reader has to already know; § Accessibility's data table is
    // exactly where that should not be the only signal.
    render(sheet());

    expect(screen.getByText("~4,500")).toBeDefined();
    expect(screen.getByText("Estimated")).toBeDefined();
  });

  test("a walk with no step figure shows no Steps row at all", () => {
    // The pair moves together, so this is the one-tap walk, the pre-P11 walk
    // and the implausible-height profile in a single state.
    render(sheet(loaded(), { steps: null, stepsSource: null }));

    expect(screen.queryByText("Steps")).toBeNull();
    expect(screen.queryByText("Estimated")).toBeNull();
  });

  test("a counted figure says so, and takes no tilde", () => {
    // Planted, for `walk-row.test.tsx`'s reason: nothing writes `device` yet,
    // so the branch would ship unmeasured and a real count would arrive
    // labelled as a guess.
    render(sheet(loaded(), { steps: 4317, stepsSource: "device" }));

    expect(screen.getByText("4,317")).toBeDefined();
    expect(screen.getByText("Counted")).toBeDefined();
  });

  test("show the route's name once it has one", () => {
    render(sheet(loaded({ name: "The river loop" })));

    expect(screen.getByText("Route")).toBeDefined();
    expect(screen.getByText("The river loop")).toBeDefined();
  });
});

describe("naming a route", () => {
  test("offers a matching name and does not apply it", () => {
    const onNamed = vi.fn();

    render(
      sheet(loaded({ suggestion: { name: "The river loop", metresApart: 42 } }), {
        onNamed,
      }),
    );

    // Offered, with the evidence beside it.
    expect(screen.getByText(/Looks like The river loop · started 42m from it/)).toBeDefined();

    // And nothing has been written. This is the criterion: "a later matching
    // walk OFFERS that name and never applies it silently".
    expect(nameRoute).not.toHaveBeenCalled();
    expect(onNamed).not.toHaveBeenCalled();
    expect(screen.queryByText("Route")).toBeNull();
  });

  test("writes the offered name only when it is accepted", async () => {
    const onNamed = vi.fn();

    render(
      sheet(loaded({ suggestion: { name: "The river loop", metresApart: 42 } }), {
        onNamed,
      }),
    );

    await userEvent.click(screen.getByRole("button", { name: "Use this name" }));

    await waitFor(() =>
      expect(nameRoute).toHaveBeenCalledWith({
        date: DATE,
        entryId: "entry-2",
        name: "The river loop",
      }),
    );

    expect(onNamed).toHaveBeenCalledWith("The river loop");
  });

  test("takes a name of its own, past the offer", async () => {
    render(sheet(loaded({ suggestion: { name: "The river loop", metresApart: 42 } })));

    await userEvent.click(screen.getByRole("button", { name: "Name it something else" }));
    await userEvent.type(screen.getByLabelText("Name this route"), "The long way");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(nameRoute).toHaveBeenCalledWith({
        date: DATE,
        entryId: "entry-2",
        name: "The long way",
      }),
    );
  });

  test("holds the field to the length the column will accept", async () => {
    render(sheet());

    await userEvent.click(screen.getByRole("button", { name: "Name this route" }));

    // The bound is `MAX_ROUTE_NAME`, worn rather than restated — one
    // declaration read by the schema, the action and this field.
    expect(screen.getByLabelText("Name this route").getAttribute("maxlength")).toBe("60");
  });

  test("clears the name with null rather than with an empty string", async () => {
    const onNamed = vi.fn();

    render(sheet(loaded({ name: "The river loop" }), { onNamed }));

    await userEvent.click(screen.getByRole("button", { name: "Remove name" }));

    await waitFor(() =>
      expect(nameRoute).toHaveBeenCalledWith({
        date: DATE,
        entryId: "entry-2",
        name: null,
      }),
    );

    expect(onNamed).toHaveBeenCalledWith(null);
  });

  test("puts the name back and says so when the write is refused", async () => {
    nameRoute.mockResolvedValue({ ok: false });

    const onNamed = vi.fn();

    render(sheet(loaded({ name: "The river loop" }), { onNamed }));

    await userEvent.click(screen.getByRole("button", { name: "Remove name" }));

    // Optimistic first, reverted second — `findBy` because the revert lands
    // after the action answers, and `getBy` would pass on the frame before it.
    expect(await screen.findByRole("alert")).toBeDefined();
    expect(screen.getByRole("alert").textContent).toContain("Couldn’t save that name.");
    expect(onNamed).toHaveBeenNthCalledWith(1, null);
    expect(onNamed).toHaveBeenNthCalledWith(2, "The river loop");
  });

  test("offers a rename rather than a naming, once it has a name", () => {
    render(sheet(loaded({ name: "The river loop" })));

    expect(screen.getByRole("button", { name: "Rename" })).toBeDefined();
    expect(screen.queryByRole("button", { name: "Name this route" })).toBeNull();
  });
});

describe("the map hand-off", () => {
  test("shows the start coordinate at every width, so nothing is a dead end", () => {
    render(sheet());

    const start = LOOP[0]![0]!;

    expect(screen.getByText(`Starts at ${start.lat}, ${start.lng}`)).toBeDefined();
  });

  test("offers no geo: link where the pointer is fine — a desktop has no handler", () => {
    render(sheet());

    expect(screen.queryByRole("link", { name: /Open in Maps/ })).toBeNull();
    // But the coordinate is still there, which IS the defined desktop
    // behaviour rather than the absence of one.
    expect(screen.getByText(/^Starts at/)).toBeDefined();
  });

  test("hands a geo: string to the platform where the pointer is coarse", () => {
    coarse = true;

    render(sheet());

    const link = screen.getByRole("link", { name: /Open in Maps/ });
    const start = LOOP[0]![0]!;

    expect(link.getAttribute("href")).toBe(`geo:${start.lat},${start.lng}`);
  });

  /**
   * PRD § Integrations survives because nothing is fetched. The link names no
   * host, so there is no origin for a tile, a key or a request to come from.
   */
  test("names no host, no provider and nothing that could be fetched", () => {
    coarse = true;

    render(sheet());

    const href = screen.getByRole("link", { name: /Open in Maps/ }).getAttribute("href") ?? "";

    expect(href.startsWith("geo:")).toBe(true);
    expect(href).not.toMatch(/https?:|\/\/|maps|google|apple/i);
  });

  test("offers the coordinate for copying, which is the desktop's affordance", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);

    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });

    render(sheet());

    await userEvent.click(screen.getByRole("button", { name: "Copy" }));

    const start = LOOP[0]![0]!;

    await waitFor(() => expect(writeText).toHaveBeenCalledWith(`${start.lat}, ${start.lng}`));
    expect(await screen.findByRole("button", { name: "Copied" })).toBeDefined();
  });

  test("says nothing when the clipboard refuses, the text being on screen already", async () => {
    vi.stubGlobal("navigator", {
      ...navigator,
      clipboard: { writeText: vi.fn().mockRejectedValue(new Error("denied")) },
    });

    render(sheet());

    await userEvent.click(screen.getByRole("button", { name: "Copy" }));

    // No alert, and the control does not claim to have copied.
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByRole("button", { name: "Copy" })).toBeDefined();
  });

  test("says that it leaves the app", () => {
    coarse = true;

    render(sheet());

    const link = screen.getByRole("link", { name: /Open in Maps/ });

    expect(within(link).getByText("↗")).toBeDefined();
  });
});
