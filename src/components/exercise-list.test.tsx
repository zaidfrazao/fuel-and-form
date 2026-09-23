import { render, screen, within } from "@testing-library/react";
import { describe, expect, test } from "vitest";

import {
  ExerciseList,
  type ListedExercise,
  type RowAffordance,
} from "@/components/exercise-list";
import { WORKING_SECTION } from "@/lib/section";

/**
 * The exercise list, and the sections it divides into — § P10, FUEL-92.
 *
 * The component has been rendered through its two callers' suites since FUEL-27
 * — `/`'s card and `/training`'s plan state — and that was fine while it drew
 * one flat list. The grouping is a shape neither caller's fixture exercises, and
 * both of the properties it has to hold are properties of ABSENCE: a session
 * with one section must render exactly what it rendered before, and a section
 * with no rows must produce no heading. Neither is visible in a screenshot of a
 * seeded session, and jsdom applies no stylesheet, so nothing else would catch
 * either one.
 */

const exercise = (
  fields: Partial<ListedExercise> & { id: string },
): ListedExercise => ({
  name: "Squats",
  prescription: "3 x 12",
  notes: null,
  section: WORKING_SECTION,
  ...fields,
});

/** The three-section session the seed now produces. */
const SESSION: ListedExercise[] = [
  exercise({ id: "u1", name: "Joint prep", prescription: "~2 min", section: "warmup" }),
  exercise({ id: "w1", name: "Squats" }),
  exercise({ id: "w2", name: "Push-ups", prescription: "3 x 8–15" }),
  exercise({
    id: "c1",
    name: "Lower-body stretches",
    prescription: "30 sec each",
    section: "cooldown",
  }),
];

const headings = () =>
  screen.getAllByRole("heading", { level: 2 }).map((heading) => heading.textContent);

describe("a session with one section", () => {
  test("renders the flat list it always did, with no heading above it", () => {
    // The acceptance criterion "existing sessions render identically". Every row
    // stored before this ticket is working-section by the column's default, so
    // this is what every one of them looks like — and a lone "WORK" heading
    // would be a heading that groups nothing.
    render(<ExerciseList exercises={[exercise({ id: "w1" }), exercise({ id: "w2" })]} />);

    expect(screen.queryByRole("heading")).toBeNull();
    expect(screen.getAllByRole("list")).toHaveLength(1);
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
  });

  test("draws no heading even when that one section is a warm-up", () => {
    // The rule is "one section is not a grouping", not "the work needs no
    // heading" — a session that is only mobility work is still undivided.
    render(<ExerciseList exercises={[exercise({ id: "u1", section: "warmup" })]} />);

    expect(screen.queryByRole("heading")).toBeNull();
  });
});

describe("a session with sections", () => {
  test("heads each one, in the order the session performs them", () => {
    render(<ExerciseList exercises={SESSION} />);

    expect(headings()).toEqual(["Warm-up", "Work", "Cool-down"]);
  });

  test("puts the sections in that order however the rows arrive", () => {
    // The rows are handed over backwards, which a query can legitimately do.
    render(<ExerciseList exercises={[...SESSION].reverse()} />);

    expect(headings()).toEqual(["Warm-up", "Work", "Cool-down"]);
  });

  test("keeps each section's rows under its own heading", () => {
    render(<ExerciseList exercises={SESSION} />);

    const lists = screen.getAllByRole("list");

    expect(lists).toHaveLength(3);
    expect(
      lists.map((list) =>
        within(list).getAllByRole("listitem").map((row) => row.textContent),
      ),
    ).toEqual([
      ["01Joint prep~2 min"],
      ["01Squats3 x 12", "02Push-ups3 x 8–15"],
      ["01Lower-body stretches30 sec each"],
    ]);
  });

  test("restarts the ordinals in each section", () => {
    // Asserted above and stated here as its own case because it is a decision
    // rather than a consequence: the third working exercise is 03 whether or not
    // a warm-up was scheduled before it, which is what keeps the numbers on this
    // screen agreeing with the session state's "Exercise 3 of 5".
    render(<ExerciseList exercises={SESSION} />);

    const work = screen.getAllByRole("list")[1]!;

    expect(
      within(work).getAllByRole("listitem").map((row) => row.textContent?.slice(0, 2)),
    ).toEqual(["01", "02"]);
  });

  test("renders no heading for a section with no rows", () => {
    // § Lists: "a group with no rows renders nothing at all — no heading, no
    // gap". An empty heading is a claim that something is missing rather than
    // that nothing was scheduled.
    render(
      <ExerciseList
        exercises={[
          exercise({ id: "u1", section: "warmup" }),
          exercise({ id: "w1" }),
        ]}
      />,
    );

    expect(headings()).toEqual(["Warm-up", "Work"]);
    expect(screen.queryByText("Cool-down")).toBeNull();
  });

  test("heads a section this build does not know, and puts it last", () => {
    // The open vocabulary: the column is text with a CHECK, so a build can meet
    // a value it predates. Dropping the row would hide an exercise somebody
    // scheduled — silently, which is the failure mode this whole column is
    // about.
    render(
      <ExerciseList
        exercises={[
          exercise({ id: "f1", name: "Farmer's carry", section: "finisher" }),
          exercise({ id: "w1" }),
        ]}
      />,
    );

    expect(headings()).toEqual(["Work", "finisher"]);
    expect(screen.getByText("Farmer's carry")).toBeTruthy();
  });

  test("carries the set progress into the section a row is in", () => {
    // The map is keyed by exercise id and the grouped list passes it down
    // whole — a row must not lose its slash line by being in a section.
    render(
      <ExerciseList
        exercises={SESSION}
        progress={new Map([["w1", "2 of 3 sets"]])}
      />,
    );

    expect(screen.getByText("2 of 3 sets")).toBeTruthy();
  });
});

describe("a workout with no exercises at all", () => {
  test("says so, which is what the daily walk is", () => {
    // Ordinary data, not missing data — and it must not become a heading with
    // nothing under it now that headings exist.
    render(<ExerciseList exercises={[]} />);

    expect(screen.getByText("No exercises listed.")).toBeTruthy();
    expect(screen.queryByRole("heading")).toBeNull();
    expect(screen.queryByRole("list")).toBeNull();
  });
});

/**
 * The form affordance, and the screen that may not have it — § P10, FUEL-108.
 *
 * Every case here is a property of ABSENCE, which is this file's recurring
 * reason for existing. The affordance is opt-in because FUEL-94's criterion is
 * that media is "never loaded on `/`", and the way that criterion fails is
 * silently: a row that gained a button on the wrong screen looks like a row.
 * jsdom applies no stylesheet and the visual suite photographs a seeded
 * session, so neither would report it.
 */
describe("the form affordance", () => {
  const AVAILABLE = new Map([["w1", "form"]] as const);

  test("without the prop there is no control at all, which is what `/` renders", () => {
    // The regression guard for FUEL-94's criterion, asserted on the component
    // rather than on `/` — `right-now.test.tsx` has the same assertion against
    // the real screen, and this one is what fails first if the prop stops being
    // the thing that decides.
    render(<ExerciseList exercises={SESSION} />);

    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });

  test("only an exercise that HAS a reference becomes one", () => {
    // Not a disabled control on the others: FUEL-107 left Skipping intervals
    // without a reference deliberately, and a control that promises one that
    // does not exist is the state `training.tsx` refuses at the other end too.
    render(
      <ExerciseList exercises={SESSION} affordance={{ available: AVAILABLE, onShow: () => {} }} />,
    );

    const buttons = screen.getAllByRole("button");

    expect(buttons).toHaveLength(1);
    expect(buttons[0]!.textContent).toContain("Show form for");
    expect(buttons[0]!.textContent).toContain("Squats");
  });

  test("says what it does WITHOUT silencing what the row says", () => {
    /*
     * The regression this replaced an `aria-label` to avoid.
     *
     * A label on a control that wraps a whole row replaces its contents as the
     * accessible name, so "Show form for Squats" would have been the entirety
     * of what a screen reader got — and the note and the prescription, which
     * are announced on this row today, would have gone silent. The name is
     * built from the contents instead, with the purpose prefixed.
     */
    render(
      <ExerciseList
        exercises={[exercise({ id: "w1", notes: "Sit back like you're reaching for a chair." })]}
        affordance={{ available: new Map([["w1", "form"]]), onShow: () => {} }}
      />,
    );

    // `getByRole`'s `name` IS the computed accessible name, so each of these
    // is an assertion about what a screen reader is handed — not about markup.
    expect(screen.getByRole("button", { name: /^Show form for/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Squats/ })).toBeTruthy();
    // The two that an `aria-label` would have silenced.
    expect(screen.getByRole("button", { name: /reaching for a chair/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /3 x 12/ })).toBeTruthy();
  });

  test("hands back the id that was pressed", () => {
    // The whole contract with the caller. An affordance that reported the wrong
    // row would open a movement under another one's name, which is the failure
    // FUEL-94's id-rather-than-boolean state exists to make unrepresentable.
    const shown: string[] = [];

    render(
      <ExerciseList
        exercises={SESSION}
        affordance={{ available: new Map([["w2", "form"]]), onShow: (id) => shown.push(id) }}
      />,
    );

    screen.getByRole("button", { name: /Push-ups/ }).click();

    expect(shown).toEqual(["w2"]);
  });

  test("works in the grouped shape as well as the flat one", () => {
    // Two shapes render rows and both thread the prop. A warm-up or cool-down
    // movement has a reference like any other — the plan list draws those rows
    // and the session state does not step through them, which is precisely why
    // this list is where they become reachable.
    render(
      <ExerciseList
        exercises={SESSION}
        affordance={{
          available: new Map([
            ["u1", "form"],
            ["c1", "form"],
          ]),
          onShow: () => {},
        }}
      />,
    );

    expect(
      screen.getAllByRole("button").map((button) => button.textContent),
    ).toEqual([
      "Show form for 01Joint prep~2 min",
      "Show form for 01Lower-body stretches30 sec each",
    ]);
  });

  test("each row announces what IT opens, not what the list's first row does", () => {
    // FUEL-127. A working row opens its sets and a bookend its reference, in
    // one list — so the prefix is per row. A list-wide prefix would tell a
    // screen reader that a warm-up row opens sets it has never had, which is
    // the promise of an action that does not exist, made in words.
    render(
      <ExerciseList
        exercises={SESSION}
        affordance={{
          available: new Map([
            ["u1", "form"],
            ["w1", "sets"],
          ]),
          onShow: () => {},
        }}
      />,
    );

    expect(
      screen.getAllByRole("button").map((button) => button.textContent),
    ).toEqual(["Show form for 01Joint prep~2 min", "Show sets for 01Squats3 x 12"]);
  });

  test("keeps the row a row: one list item, still carrying its own content", () => {
    // § Lists' window is a height, and the whole argument for this shape is that
    // it adds none. A control drawn as a second row — or a row that gained a
    // sibling — would be the per-row affordance FUEL-90 refused, arrived at by
    // accident.
    render(
      <ExerciseList
        exercises={[exercise({ id: "w1" })]}
        affordance={{ available: AVAILABLE, onShow: () => {} }}
      />,
    );

    const rows = screen.getAllByRole("listitem");

    expect(rows).toHaveLength(1);
    expect(within(rows[0]!).getByText("Squats")).toBeTruthy();
    expect(within(rows[0]!).getByText("3 x 12")).toBeTruthy();
  });
});

/**
 * The mark costs no layout, asserted as structure — § P10, FUEL-108.
 *
 * This is the one property the ticket's whole argument rests on, and it is the
 * one that broke: the first build marked the row with a trailing chevron, which
 * is a flex child, which took 16px from a name column holding all of the row's
 * slack. At 375 the seed's Plank row re-wrapped its note and grew 101px → 118,
 * and the screen grew with it. jsdom applies no stylesheet, so no test here
 * could have measured that — but it can hold the shape that caused it.
 *
 * So the guard is structural rather than dimensional: becoming a control adds
 * no ELEMENT to the row. A mark that occupies a box is how the height comes
 * back, whatever box it is.
 */
describe("the affordance adds no box", () => {
  const only = (affordance?: RowAffordance) => {
    const { unmount } = render(
      <ExerciseList
        exercises={[exercise({ id: "w1", notes: "Squeeze at the top." })]}
        progress={new Map([["w1", "2 of 3 sets"]])}
        affordance={affordance}
      />,
    );
    const row = screen.getByRole("listitem");

    /*
     * `sr-only` is the declared exception and has to be excluded by NAME.
     *
     * It shrinks its box to a clipped pixel rather than removing it, so it
     * occupies no layout — which is the property this block is really about.
     * jsdom applies no stylesheet, so the class is the only handle on that
     * here; the alternative, asserting on computed geometry, measures nothing
     * in this environment.
     */
    const laidOut = [...row.querySelectorAll("*")].filter(
      (node) => !node.classList.contains("sr-only"),
    );
    const shape = {
      tags: laidOut.map((node) => node.tagName).join(","),
      // What is actually drawn: the sr-only prefix is not.
      text: laidOut
        .filter((node) => node.children.length === 0)
        .map((node) => node.textContent)
        .join("|"),
    };

    unmount();
    return shape;
  };

  test("a control row holds the same elements as an inert one, plus the button", () => {
    const inert = only();
    const control = only({ available: new Map([["w1", "sets"]]), onShow: () => {} });

    // One added element that occupies space, and it is the wrapper itself — no
    // glyph, no spacer, no second span holding a mark.
    expect(control.tags).toBe(`BUTTON,${inert.tags}`);
  });

  test("and it draws identically, because the mark is not a character", () => {
    // The chevron that broke this was a rendered glyph, so it also appeared in
    // the row's drawn text. An underline is a decoration on text that was
    // already there: nothing to lay out. The `sr-only` prefix is excluded
    // above for the same reason — it is announced, not drawn.
    const inert = only();
    const control = only({ available: new Map([["w1", "sets"]]), onShow: () => {} });

    expect(control.text).toBe(inert.text);
  });
});

/**
 * The row's photograph — § Lists › The row's photograph, FUEL-129.
 *
 * Where it sits and how big it is are layout, which jsdom cannot see and
 * `tests/visual/row-photograph.spec.ts` measures. What is held here is what a
 * layout run cannot tell apart: whose photograph a row draws, that it names
 * nothing, and that an empty column is empty.
 */
describe("the row's photograph", () => {
  const SQUAT = { path: "/form/squat-2.jpg", width: 850, height: 567 };
  const PUSH_UP = { path: "/form/push-up-2.jpg", width: 850, height: 567 };

  const offering = (
    thumbnails?: RowAffordance["thumbnails"],
    onShow: (id: string) => void = () => {},
  ): RowAffordance => ({
    available: new Map([
      ["u1", "form"],
      ["w1", "sets"],
      ["w2", "sets"],
      ["c1", "form"],
    ]),
    thumbnails,
    onShow,
  });

  /** The empty column — the one element in a row that is neither text nor a photograph. */
  const spacers = (container: HTMLElement) =>
    container.querySelectorAll('li span[aria-hidden="true"]:empty');

  test("draws the frame it is given, as the shipped file at its own size", () => {
    const { container } = render(
      <ExerciseList exercises={SESSION} affordance={offering(new Map([["w1", SQUAT]]))} />,
    );

    const img = within(screen.getByRole("button", { name: /Squats/ })).getByRole("presentation");

    expect(img.getAttribute("src")).toBe("/form/squat-2.jpg");
    // The manifest's dimensions are what reserve the box before the file lands.
    expect(img.getAttribute("width")).toBe("850");
    expect(img.getAttribute("height")).toBe("567");
    expect(img.getAttribute("loading")).toBe("lazy");
    expect(img.getAttribute("decoding")).toBe("async");
    expect(container.querySelectorAll("img")).toHaveLength(1);
  });

  test("names nothing: alt is empty and the row's accessible name is unchanged", () => {
    // § The row as a control: the name is the row's contents. A described alt
    // would read the frame's caption into it as though it were the exercise.
    const name = (thumbnails?: RowAffordance["thumbnails"]) => {
      const { unmount } = render(
        <ExerciseList
          exercises={[exercise({ id: "w1", notes: "Sit back." })]}
          affordance={offering(thumbnails)}
        />,
      );
      const button = screen.getByRole("button");
      const img = button.querySelector("img");
      const text = button.textContent;
      unmount();
      return { alt: img?.getAttribute("alt"), text };
    };

    const without = name();
    const withPhoto = name(new Map([["w1", SQUAT]]));

    expect(withPhoto.alt).toBe("");
    expect(withPhoto.text).toBe(without.text);
  });

  test("gives the group's column to a row without one, and draws nothing in it", () => {
    // Squats has a reference and Push-ups does not, so Push-ups keeps the
    // column — an empty, unlabelled box — and the two names start on one x.
    const { container } = render(
      <ExerciseList exercises={SESSION} affordance={offering(new Map([["w1", SQUAT]]))} />,
    );

    const pushUps = screen.getByRole("button", { name: /Push-ups/ });

    expect(pushUps.querySelector("img")).toBeNull();
    expect(spacers(container)).toHaveLength(1);
    expect(pushUps.contains(spacers(container)[0]!)).toBe(true);
  });

  test("draws no column in a group where no row has a photograph", () => {
    // The warm-up and cool-down today. Both work rows have one, so no row in
    // the list needs an empty column at all.
    const { container } = render(
      <ExerciseList
        exercises={SESSION}
        affordance={offering(
          new Map([
            ["w1", SQUAT],
            ["w2", PUSH_UP],
          ]),
        )}
      />,
    );

    expect(container.querySelectorAll("img")).toHaveLength(2);
    expect(spacers(container)).toHaveLength(0);
  });

  test("holds the column in the flat, one-section shape too", () => {
    const { container } = render(
      <ExerciseList
        exercises={[exercise({ id: "w1" }), exercise({ id: "w2", name: "Push-ups" })]}
        affordance={offering(new Map([["w1", SQUAT]]))}
      />,
    );

    expect(screen.queryByRole("heading")).toBeNull();
    expect(container.querySelectorAll("img")).toHaveLength(1);
    expect(spacers(container)).toHaveLength(1);
  });

  test("is drawn only inside a control, so it always opens something", () => {
    // A frame for a row the screen did not make a door is dropped rather than
    // drawn on an inert row, where tapping it would do nothing.
    const { container } = render(
      <ExerciseList
        exercises={SESSION}
        affordance={{
          available: new Map([["w2", "sets"]]),
          thumbnails: new Map([["w1", SQUAT]]),
          onShow: () => {},
        }}
      />,
    );

    expect(container.querySelectorAll("img")).toHaveLength(0);
  });

  test("opens the row's sheet when it is the part that is tapped", () => {
    const shown: string[] = [];
    const { container } = render(
      <ExerciseList
        exercises={SESSION}
        affordance={offering(new Map([["w2", PUSH_UP]]), (id) => shown.push(id))}
      />,
    );

    container.querySelector("img")!.click();

    expect(shown).toEqual(["w2"]);
  });

  test("an affordance without photographs draws the row it drew before", () => {
    // What `/training` rendered before this ticket, and the shape any screen
    // that offers the doors without the pictures gets: no image, no column.
    const { container } = render(<ExerciseList exercises={SESSION} affordance={offering()} />);

    expect(container.querySelectorAll("img")).toHaveLength(0);
    expect(spacers(container)).toHaveLength(0);
  });

  test("`/` passes no affordance, so it can draw no photograph", () => {
    const { container } = render(<ExerciseList exercises={SESSION} />);

    expect(container.querySelectorAll("img")).toHaveLength(0);
    expect(spacers(container)).toHaveLength(0);
  });
});
