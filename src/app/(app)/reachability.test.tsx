import { render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, test, vi } from "vitest";

import { DESTINATIONS, ROUTE_PATHS, resolveActive } from "@/lib/nav";

/**
 * Can you get there from here — FUEL-62.
 *
 * Every other test in this suite asserts what ONE screen renders, which is
 * exactly the check that passes while the link graph comes apart. `/weight`
 * quietly could not reach `/plan` for six tasks, and `/`'s finished page reached
 * nothing at all; both screens had tests, both suites were green, and neither
 * suite was asking a question that spanned two screens. This file asks that one.
 *
 * ## Why this is a Vitest file and not a Playwright spec
 *
 * FUEL-62 offered both levels and asked for an explicit decision. The argument
 * for Playwright was that "component-level cannot see the layout-mounted shell",
 * and that is not true here: `AppLayout` is a plain function component, so it
 * renders in jsdom — `layout.test.tsx` has been doing it since FUEL-58. Wrapping
 * a real page in the real layout gives the real mounted graph, which is the
 * thing the browser was wanted for.
 *
 * What a browser would add is CSS, and none of the claims below are about CSS.
 * The pill-versus-sidebar reflow is a media query measured at `/dev/nav-shell`
 * and on the manual Appearance checklist; the sticky bar clearing the shell was
 * measured at 375×667 under FUEL-58. Standing up Playwright for this would mean
 * a dependency, browsers, a config, a web server, a signed session cookie and a
 * test database — FUEL-48's work, for an assertion that would restate this one.
 *
 * ## What is asserted, and what is deliberately not
 *
 * By ROLE and ACCESSIBLE NAME throughout, never by class or by DOM shape. That
 * is FUEL-62's own instruction and it has a reason with a date on it: the
 * Desktop Version milestone will change this markup again, and a test that
 * pinned structure would fail on a reflow while still not noticing a dead link.
 * Names rather than hrefs alone, because the name is the other half of the
 * contract — § Navigation gives each destination exactly one, and FUEL-60
 * settled them.
 *
 * The four destinations are looked up INSIDE the Primary landmark. Not a
 * convenience: `/settings` renders its own link to `/plan`, so an unscoped
 * `getByRole("link", { name: "Plan" })` would find a page link and pass on a
 * screen whose shell had vanished entirely. Scoping is what makes this a claim
 * about the shell rather than about whatever happens to be on the page.
 *
 * The route table drives the sweep. `SCREENS` below is checked against
 * `ROUTE_PATHS` before anything else runs, so a row added to `lib/nav.ts` with
 * no screen here fails — FUEL-62's "adding a route to the route table without
 * wiring it makes the test fail". `tests/unit/route-table.test.ts` holds the
 * other half of that, against the filesystem.
 */

/* -------------------------------------------------------------------------- */
/* The seven screens' boundaries                                              */
/* -------------------------------------------------------------------------- */

/*
 * One `vi.hoisted` block for all seven routes, which is the price of asking a
 * question that spans them. Every per-screen test file mocks its own loader;
 * this one needs all of them at once, and they are seven distinct modules so
 * nothing collides.
 *
 * `pathname` is a mutable holder rather than a value because `vi.mock` is
 * hoisted and evaluated once, while the pathname has to change for every route
 * in the sweep. The mock closes over the object and reads the field.
 */
const {
  nav,
  redirect,
  getSession,
  loadToday,
  readCursor,
  loadWeek,
  loadTemplate,
  loadTraining,
  loadWeighIns,
  loadShoppingWeek,
  loadSchedule,
} = vi.hoisted(() => ({
  nav: { pathname: "/" },
  redirect: vi.fn((path: string) => {
    // The real `redirect` throws, which is what terminates the render. A mock
    // that only recorded the call would let a page run on with no session —
    // every per-screen test file makes the same point.
    throw new Error(`NEXT_REDIRECT:${path}`);
  }),
  getSession: vi.fn(),
  loadToday: vi.fn(),
  readCursor: vi.fn(),
  loadWeek: vi.fn(),
  loadTemplate: vi.fn(),
  loadTraining: vi.fn(),
  loadWeighIns: vi.fn(),
  loadShoppingWeek: vi.fn(),
  loadSchedule: vi.fn(),
}));

vi.mock("next/navigation", () => ({ redirect, usePathname: () => nav.pathname }));
vi.mock("@/lib/auth/session", () => ({ getSession }));
vi.mock("@/lib/cursor-cookie", () => ({ readCursor }));
vi.mock("@/lib/db/queries/today", () => ({ loadToday }));
vi.mock("@/lib/db/queries/week", () => ({ loadWeek }));
vi.mock("@/lib/db/queries/template", () => ({ loadTemplate }));
vi.mock("@/lib/db/queries/training", () => ({ loadTraining }));
vi.mock("@/lib/db/queries/weight", () => ({ loadWeighIns }));
vi.mock("@/lib/db/queries/shopping", () => ({ loadShoppingWeek }));
vi.mock("@/lib/db/queries/profile", () => ({ loadSchedule }));

// The client components each screen renders import "use server" modules, which
// cannot be imported under jsdom. Every per-screen test file mocks its own; this
// one needs the union.
vi.mock("@/app/actions/log", () => ({ logItem: vi.fn(), undoLastLog: vi.fn() }));
vi.mock("@/app/actions/swap", () => ({ swapMeal: vi.fn(), revertSwap: vi.fn() }));
vi.mock("@/app/actions/log-walk", () => ({ logWalk: vi.fn(), clearWalk: vi.fn() }));
vi.mock("@/app/actions/plan", () => ({
  swapPlannedMeal: vi.fn(),
  revertPlannedMeal: vi.fn(),
  repeatPlannedMeal: vi.fn(),
}));
vi.mock("@/app/actions/template", () => ({
  setTemplateMeal: vi.fn(),
  clearTemplateMeal: vi.fn(),
}));
vi.mock("@/app/actions/training", () => ({
  setSessionStatus: vi.fn(),
  clearSessionStatus: vi.fn(),
}));
vi.mock("@/app/actions/weight", () => ({ logWeighIn: vi.fn(), deleteWeighIn: vi.fn() }));
vi.mock("@/app/actions/shopping", () => ({ setChecked: vi.fn() }));
vi.mock("@/app/actions/settings", () => ({ saveSlotTimes: vi.fn() }));
vi.mock("@/app/actions/push", () => ({
  subscribeToWalkReminder: vi.fn(),
  unsubscribeFromWalkReminder: vi.fn(),
}));

const { default: AppLayout } = await import("@/app/(app)/layout");
const { default: Home } = await import("@/app/(app)/page");
const { default: PlanPage } = await import("@/app/(app)/plan/page");
const { default: TemplatePage } = await import("@/app/(app)/plan/template/page");
const { default: TrainingPage } = await import("@/app/(app)/training/page");
const { default: WeightPage } = await import("@/app/(app)/weight/page");
const { default: ShoppingPage } = await import("@/app/(app)/shopping/page");
const { default: SettingsPage } = await import("@/app/(app)/settings/page");

/* -------------------------------------------------------------------------- */
/* Fixtures                                                                   */
/* -------------------------------------------------------------------------- */

const SESSION = { userId: "11111111-2222-3333-4444-555555555555", kind: "owner" as const };

const MON = "2026-03-09";
const TUE = "2026-03-10";

/**
 * A week other than the one the server calls "now".
 *
 * `today` is in the week of the 9th throughout, so this is the previous week and
 * the "Back to this week" resets appear. Both `/plan` and `/shopping` decide
 * that with `startOfWeek`, so one constant drives both.
 */
const OTHER_WEEK = "2026-03-02";

const PROFILE = {
  userId: SESSION.userId,
  timezone: "Europe/London",
  programStartDate: "2026-03-02",
  targetKcal: 1780,
  targetProteinG: 148,
  targetFatG: 50,
  targetCarbG: 185,
  // Invented, per Testing Strategy § 1.5 — the owner's real metrics stay out of
  // a public repository.
  startWeightKg: 84,
  targetWeightKg: "76.0",
  goalPaceKgPerWeek: "0.5",
  slotTimes: {},
} as unknown as never;

const MEAL = {
  id: "meal-1",
  userId: SESSION.userId,
  name: "Chilli con Carne",
  slotType: "dinner",
  kcal: 700,
  proteinG: 45,
  fatG: 20,
  carbG: 60,
  method: null,
  notes: null,
  isArchived: false,
} as unknown as never;

/**
 * `/`'s view, in whichever of its three states the caller asks for.
 *
 * `loadToday` hands the resolved `NowView` straight to the route, so a branch is
 * chosen by naming it here rather than by arranging inputs a resolver would have
 * to agree with. That keeps the three branches of `right-now.tsx` reachable from
 * the REAL page, which is the point — rendering the component directly would
 * lose the layout, and the layout is what carries the shell.
 */
const DINNER = {
  kind: "meal",
  meal: { slot: "dinner", meal: MEAL, source: "template", entryId: "entry-1" },
  key: "meal:e1",
  at: "19:00",
  minutes: 1140,
} as unknown as never;

const view = (state: "active" | "day-complete" | "nothing-planned") =>
  ({
    date: MON,
    minutesOfDay: 8 * 60,
    timeline: state === "nothing-planned" ? [] : [DINNER],
    anytime: [],
    state,
    ...(state === "active" ? { index: 0, active: DINNER, upcoming: [] } : {}),
  }) as unknown as never;

const today = (state: "active" | "day-complete" | "nothing-planned" = "active") => ({
  view: view(state),
  profile: PROFILE,
  exercises: new Map(),
  logs: { meals: [], workouts: [] },
  meals: [MEAL],
  templatePlan: [],
});

const DAY = {
  date: MON,
  meals: [{ slot: "dinner", meal: MEAL, source: "template", entryId: "t1" }],
};

const WEEK = {
  monday: MON,
  today: TUE,
  profile: PROFILE,
  meals: [MEAL],
  days: [DAY],
  templateDays: [DAY],
};

const SHOPPING = {
  monday: MON,
  today: TUE,
  groups: [
    {
      category: "meat",
      lines: [
        {
          key: "beef mince",
          name: "Beef mince",
          category: "meat",
          grams: 300,
          gramsPartial: false,
          measures: [],
          times: 2,
        },
      ],
    },
  ],
  checked: [],
};

/** A rest day. The screen renders its frame either way, and the frame is what is under test. */
const TRAINING = { date: MON, today: TUE, day: { date: MON, sessions: [] }, logs: [], adherence: [] };

const WEIGHT = {
  today: TUE,
  entries: [],
  startWeightKg: 84,
  targetWeightKg: 76,
  goalPaceKgPerWeek: 0.5,
};

const SCHEDULE = {
  slotTimes: { breakfast: "07:30" },
  workoutTimes: { circuit: "06:30" },
  timezone: "Europe/London",
};

/* -------------------------------------------------------------------------- */
/* Rendering a screen inside the real frame                                   */
/* -------------------------------------------------------------------------- */

type Search = Record<string, string | string[]>;

const params = (search: Search = {}) => ({ searchParams: Promise.resolve(search) }) as never;

/**
 * Every authenticated screen, keyed by the route it answers on.
 *
 * Keyed by path rather than listed in an array so the check against
 * `ROUTE_PATHS` below is a set comparison against the table itself. The three
 * routes that take `searchParams` accept them; the four that do not, ignore
 * them — uniform signatures keep the sweep from special-casing.
 */
const SCREENS: Record<string, (search: Search) => Promise<ReactNode>> = {
  "/": () => Home(),
  "/plan": (search) => PlanPage(params(search)),
  "/training": (search) => TrainingPage(params(search)),
  "/weight": () => WeightPage(),
  "/plan/template": () => TemplatePage(),
  "/shopping": (search) => ShoppingPage(params(search)),
  "/settings": () => SettingsPage(),
};

/**
 * Render one screen inside the layout that mounts the shell.
 *
 * This is the whole method. `AppLayout` is what puts the four destinations on
 * every authenticated page, so a test that renders a page ALONE — which is what
 * all seven per-screen files do — is structurally unable to see them. Rendering
 * the page as the layout's child is the smallest arrangement that can.
 */
async function show(path: string, search: Search = {}) {
  nav.pathname = path;

  return render(<AppLayout>{await SCREENS[path]!(search)}</AppLayout>);
}

/** The four destinations as the shell renders them, scoped to the landmark. */
const shell = () => within(screen.getByRole("navigation", { name: "Primary" }));

/**
 * Everything the shell links to, in order, as `[accessible name, href]`.
 *
 * The name falls back to the text because the four destinations carry an
 * `aria-label` — § Navigation: "The `aria-label` is the label" — and the
 * sidebar's Settings link does not, being a link rather than a destination.
 */
const shellLinks = () =>
  shell()
    .getAllByRole("link")
    .map((link) => [
      link.getAttribute("aria-label") ?? link.textContent!.trim(),
      link.getAttribute("href"),
    ]);

/**
 * What the shell must contain, written out longhand rather than read from
 * `DESTINATIONS`.
 *
 * This is the whole point of the literal and it was found by mutation rather
 * than by design. The first draft of the sweep below iterated `DESTINATIONS` and
 * asserted each entry was reachable — which cannot fail when a destination is
 * DELETED, because the loop simply runs one time fewer. Removing Training from
 * the array left every "all four are reachable" case green. A test that reads
 * its expectations from the thing under test measures nothing about that thing's
 * contents; § Navigation names four and this is where the shell is held to it.
 *
 * The order is asserted too, and is load-bearing for the same reason
 * `nav.test.ts` pins it: the pill shows inactive items as icons alone, so
 * position is the only cue about which slot is which.
 *
 * The Settings link at the end is the sidebar's foot — inside this landmark,
 * desktop-only in CSS and therefore always in the tree under jsdom. It is listed
 * because the set is asserted whole: a fifth destination promoted into the pill
 * has to come through here, which is the argument § Navigation makes for why
 * Settings is NOT one of the four.
 */
const THE_SHELL: [name: string, href: string | null][] = [
  ["Now", "/"],
  ["Plan", "/plan"],
  ["Training", "/training"],
  ["Weight", "/weight"],
  ["Settings", "/settings"],
];

beforeEach(() => {
  vi.clearAllMocks();
  nav.pathname = "/";
  getSession.mockResolvedValue(SESSION);
  readCursor.mockResolvedValue(null);
  loadToday.mockResolvedValue(today());
  loadWeek.mockResolvedValue(WEEK);
  loadTemplate.mockResolvedValue({ entries: [], meals: [] });
  loadTraining.mockResolvedValue(TRAINING);
  loadWeighIns.mockResolvedValue(WEIGHT);
  loadShoppingWeek.mockResolvedValue(SHOPPING);
  loadSchedule.mockResolvedValue(SCHEDULE);
});

/* -------------------------------------------------------------------------- */
/* The table drives the sweep                                                 */
/* -------------------------------------------------------------------------- */

describe("the sweep", () => {
  test("covers every route in the table, and no others", () => {
    /*
     * FUEL-62: "Adding a route to the route table without wiring it makes the
     * test fail." This is that assertion, and it is first in the file because
     * every test below iterates `ROUTE_PATHS` — without it, a row added to
     * `lib/nav.ts` with no entry here would make the sweep throw on a missing
     * key with a message about `undefined` rather than about a route nobody
     * wired.
     *
     * Both directions, so a screen listed here that the table has forgotten
     * fails too. `tests/unit/route-table.test.ts` runs the same comparison
     * against the filesystem; between them a route has to exist in three places
     * or in none.
     */
    expect(Object.keys(SCREENS).sort()).toEqual([...ROUTE_PATHS].sort());
  });
});

/* -------------------------------------------------------------------------- */
/* Every destination, from every screen                                       */
/* -------------------------------------------------------------------------- */

describe("the four destinations", () => {
  /*
   * FUEL-62's first criterion: "every top-level destination is reachable from
   * every authenticated screen". Seven screens × four destinations, driven from
   * the two tables rather than written out — so neither a new route nor a fifth
   * destination can be added without landing here.
   */
  test.each([...ROUTE_PATHS])("are all reachable from %s", async (path) => {
    await show(path);

    expect(shellLinks()).toEqual(THE_SHELL);
  });

  test.each([...ROUTE_PATHS])("light the one the table names, from %s", async (path) => {
    /*
     * The active state, asserted across screens rather than on the shell alone.
     * `nav-shell.test.tsx` proves the component marks whatever `resolveActive`
     * returns; what it cannot prove is that the mounted shell is asked about the
     * route the user is actually on. A `usePathname` that stopped updating would
     * leave every screen lighting Now and pass that other file completely.
     *
     * This is also where the level-2 routes earn their rows: `/shopping` and
     * `/plan/template` light Plan, and `/settings` lights Now — the parent's
     * slot, not their own, because that is the section the user is in.
     */
    await show(path);

    const current = shell()
      .getAllByRole("link")
      .filter((link) => link.getAttribute("aria-current") === "page");

    const expected = DESTINATIONS.find((d) => d.id === resolveActive(path));

    expect(current.map((link) => link.getAttribute("aria-label"))).toEqual([expected!.label]);
  });

  test.each([...ROUTE_PATHS])("are carried by exactly one landmark on %s", async (path) => {
    // A page that grew its own nav would put a second "Primary" landmark in the
    // document, and every assertion above would still pass — `within` would just
    // be scoped to whichever came first. This is what stops the improvised link
    // clusters FUEL-58 retired from coming back one screen at a time.
    await show(path);

    expect(screen.getAllByRole("navigation", { name: "Primary" })).toHaveLength(1);
  });
});

/* -------------------------------------------------------------------------- */
/* `/`, in all three of its states                                            */
/* -------------------------------------------------------------------------- */

describe("the home screen", () => {
  /*
   * FUEL-62: "`/` has three render branches, and a test that only exercises the
   * default one is how the `day-complete` hole survived — assert all three
   * explicitly."
   *
   * The hole was real and is fixed: `right-now.tsx` returned a finished page
   * carrying no navigation at all, so once the day was logged `/` reached
   * nothing. FUEL-58 fixed it; nothing pinned it across the layout until now.
   */
  const STATES = ["active", "day-complete", "nothing-planned"] as const;

  test.each(STATES)("reaches all four destinations in %s", async (state) => {
    loadToday.mockResolvedValue(today(state));

    await show("/");

    expect(shellLinks(), state).toEqual(THE_SHELL);
  });

  test.each(STATES)("keeps Settings at the foot in %s", async (state) => {
    /*
     * Settings is not one of the four and does not go in the pill. § Navigation
     * puts it at the foot of `/` instead — "Two taps from anywhere: the Now
     * pill, then the link" — and `nav-shell.tsx`'s sidebar foot renders its own
     * copy only at ≥1024px, explicitly deferring the phone to this one.
     *
     * So this is the assertion that keeps `/settings` reachable on a phone at
     * all, and it is asserted in all three states because day-complete is the
     * one that used to omit it: once the day is logged, day-complete IS `/`, and
     * a finished page without this link makes "two taps from anywhere" false
     * every evening.
     *
     * Looked up OUTSIDE the shell, since the sidebar foot renders the same name
     * and jsdom applies no CSS — both are in the tree here, and the one under
     * test is the page's.
     */
    loadToday.mockResolvedValue(today(state));

    const { container } = await show("/");

    const main = within(container.querySelector("main")!);

    expect(main.getByRole("link", { name: "Settings" }).getAttribute("href")).toBe(
      "/settings",
    );
  });

  test.each(STATES)("carries no up-link in %s", async (state) => {
    // `/` is level 1 — § Navigation caps the depth at two and this is the top,
    // so there is nothing above it to go up to. `resolveParent` returns null and
    // `up-link.tsx` renders nothing. Asserted because an up-link here would be a
    // link out of the hierarchy dressed as a way back into it.
    loadToday.mockResolvedValue(today(state));

    await show("/");

    expect(screen.queryByRole("link", { name: /^Back to / })).toBeNull();
  });
});

/* -------------------------------------------------------------------------- */
/* One parent per route, from either entry point                              */
/* -------------------------------------------------------------------------- */

describe("the way up", () => {
  /*
   * The four screens § Navigation gives a parent, and the name each up-link
   * carries. The name is the PARENT's, not the screen's — that is what makes an
   * up-link say where it goes rather than where you are — and `up-link.tsx`
   * prefixes "Back to" so it cannot be confused with a cross-link pointing the
   * other way.
   */
  const PARENTS: [route: string, name: string, href: string][] = [
    ["/plan/template", "Back to Plan", "/plan"],
    ["/shopping", "Back to Plan", "/plan"],
    ["/settings", "Back to Now", "/"],
  ];

  test.each(PARENTS)("%s goes up to %s", async (route, name, href) => {
    await show(route);

    const links = screen.getAllByRole("link", { name });

    expect(links).toHaveLength(1);
    // `/shopping` appends its week; the others have none to append. Asserted as
    // a prefix so this case stays about WHICH parent, and the week is the
    // subject of its own test below.
    expect(links[0]!.getAttribute("href")!.startsWith(href)).toBe(true);
  });

  test("the level-1 routes have no parent to go up to", async () => {
    for (const route of ["/", "/plan", "/training", "/weight"]) {
      const { unmount } = await show(route);

      expect(screen.queryByRole("link", { name: /^Back to / }), route).toBeNull();

      unmount();
    }
  });

  /*
   * FUEL-62: "`/plan/template` resolves to the same parent from both entry
   * points, asserted from both."
   *
   * The bug was that it named `/settings` — a screen that links TO it. Two
   * screens link here and only one is the parent, which § Navigation settles
   * outright: "a link is not a parent."
   *
   * There is no `from` param and no `referer` to resolve, because since FUEL-59
   * the parent is a property of the ROUTE rather than of the journey. So "from
   * both entry points" is asserted as the thing that makes the entry point
   * irrelevant: the template's up-link names Plan, and each entry point's link
   * to it is a cross-link that is not styled as a second way back.
   */
  describe("/plan/template, reached from either screen", () => {
    test("names Plan as its parent, whichever screen was left", async () => {
      // The route resolves its own parent, so the assertion is that the answer
      // does not depend on anything the caller could vary. Rendered twice with
      // the two referring screens' pathnames set on the shell, which is the only
      // thing about the journey the app can still observe.
      for (const from of ["/plan", "/settings"]) {
        nav.pathname = from;

        const { unmount } = render(<AppLayout>{await TemplatePage()}</AppLayout>);

        const up = screen.getAllByRole("link", { name: "Back to Plan" });

        expect(up, `arrived from ${from}`).toHaveLength(1);
        expect(up[0]!.getAttribute("href")).toBe("/plan");
        expect(screen.queryByRole("link", { name: "Back to Settings" })).toBeNull();

        unmount();
      }
    });

    test("is a cross-link from both, and an up-link from neither", async () => {
      /*
       * The other half, on the two screens that link here. § Navigation: a
       * cross-link "must never be styled as an up-link, because a second thing
       * that looks like a way back is a second parent in everything but name."
       *
       * Asserted by NAME, which is where the distinction lives: `up-link.tsx`
       * gives its anchor "Back to …" and a cross-link carries the destination's
       * bare name. Both screens call it "Weekly template" since FUEL-60.
       */
      for (const from of ["/plan", "/settings"]) {
        const { unmount } = await show(from);

        expect(
          screen.getByRole("link", { name: "Weekly template" }).getAttribute("href"),
          from,
        ).toBe("/plan/template");
        expect(screen.queryByRole("link", { name: "Back to Weekly template" })).toBeNull();

        unmount();
      }
    });
  });
});

/* -------------------------------------------------------------------------- */
/* The week and the date, across the up-link                                  */
/* -------------------------------------------------------------------------- */

describe("a week other than this one", () => {
  /*
   * FUEL-62: "`?week=` and `?date=` survive the up-link, asserted on `/shopping`
   * and `/plan`."
   *
   * It survives on `/shopping` and it deliberately does NOT on `/plan`, and the
   * criterion as worded does not distinguish them. The route table is what
   * decides: `/shopping`'s parent is `/plan` and both are addressed by week, so
   * the week has to travel or the link lands on a different week's plan. `/plan`
   * and `/settings` are parented to `/`, which takes no `searchParams` at all —
   * `up-link.tsx` says so in as many words — so there is no week to carry there
   * and appending one would invent a parameter the route does not read.
   *
   * `/training?date=` is the third case and it has no up-link at all: `/training`
   * is level 1. Asserted below rather than left out, because "the date survives
   * the up-link" is only vacuously true on a screen with no up-link, and a
   * vacuous pass is what FUEL-62 exists to stop.
   *
   * So each is pinned as the behaviour the table specifies, and the divergence
   * from the criterion's wording is written here rather than asserted away.
   */
  /**
   * Put both week-addressed screens on a week other than the current one.
   *
   * The loaders are mocked, so they ignore the anchor they are passed and the
   * query string alone would change nothing — the week a screen is ON is the one
   * its loader RESOLVED, which is what these return. That is not a workaround:
   * both screens hand `up-link.tsx` their resolved `monday` rather than the raw
   * `?week=`, and deliberately, since `requestedWeek` is what refuses a
   * malformed parameter. A test that asserted the query string travelled would
   * be asserting that unvalidated input propagates.
   *
   * The parameter is still passed, so the render path is the one a real request
   * takes rather than a default.
   */
  const offWeek = () => {
    loadShoppingWeek.mockResolvedValue({ ...SHOPPING, monday: OTHER_WEEK });
    loadWeek.mockResolvedValue({ ...WEEK, monday: OTHER_WEEK });
  };

  test("travels up from /shopping, because both screens are addressed by one", async () => {
    offWeek();

    await show("/shopping", { week: OTHER_WEEK });

    expect(
      screen.getByRole("link", { name: "Back to Plan" }).getAttribute("href"),
    ).toBe(`/plan?week=${OTHER_WEEK}`);
  });

  test("does not travel up from /plan, whose parent has no week", async () => {
    offWeek();

    await show("/plan", { week: OTHER_WEEK });

    // No up-link at all — `/plan` is level 1. The assertion that matters is the
    // one below it: the reset link is what carries the week question here, and
    // the two must not be confused for one another.
    expect(screen.queryByRole("link", { name: /^Back to (Now|Plan)$/ })).toBeNull();
  });

  test.each(["/plan", "/shopping"])("offers a reset on %s, distinct from the way up", async (route) => {
    /*
     * "Back to this week" resets `?week=`; an up-link moves a level. § Navigation
     * insists they stay distinguishable, and on `/shopping` they are both on the
     * screen at once — which is the case worth pinning, because that is where a
     * shared register would make two links that look like the same promise.
     *
     * Distinguished by NAME, which is the only thing a screen reader has: the
     * reset says "this week" and the up-link says where it goes.
     */
    offWeek();

    await show(route, { week: OTHER_WEEK });

    const reset = screen.getByRole("link", { name: "Back to this week" });

    // The reset drops the parameter rather than pointing at a named week, so
    // there is one link that means "now" regardless of which week is on screen.
    expect(reset.getAttribute("href")).toBe(route);
    expect(reset.getAttribute("href")).not.toContain("week=");
  });

  test("is not offered on the current week", async () => {
    // The reset appears only when the week on screen is not the current one —
    // otherwise it is a link back to the page you are on. Both directions, so
    // the test above cannot pass by the link being permanent.
    await show("/shopping");

    expect(screen.queryByRole("link", { name: "Back to this week" })).toBeNull();
  });

  test("/training?date= has no up-link to survive", async () => {
    await show("/training", { date: TUE });

    expect(screen.queryByRole("link", { name: /^Back to / })).toBeNull();
    // And the destinations are still all reachable from a dated view, which is
    // the property that actually matters on a screen with no parent.
    expect(shellLinks()).toEqual(THE_SHELL);
  });
});
