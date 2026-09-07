import { render, screen, within } from "@testing-library/react";
import { describe, expect, test } from "vitest";

import { ExerciseList, type ListedExercise } from "@/components/exercise-list";
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
  const AVAILABLE = new Set(["w1"]);

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
      <ExerciseList exercises={SESSION} form={{ available: AVAILABLE, onShow: () => {} }} />,
    );

    const buttons = screen.getAllByRole("button");

    expect(buttons).toHaveLength(1);
    expect(buttons[0]!.getAttribute("aria-label")).toBe("Show form for Squats");
  });

  test("names the control for its exercise, not for the affordance", () => {
    // Without the label the computed name is the whole row — ordinal, name,
    // note, progress and prescription — read out per control on a list of up to
    // eight. The label is the fix and the fix is what is asserted.
    render(
      <ExerciseList
        exercises={SESSION}
        form={{
          available: new Set(["w1", "w2"]),
          onShow: () => {},
        }}
      />,
    );

    expect(
      screen.getAllByRole("button").map((button) => button.getAttribute("aria-label")),
    ).toEqual(["Show form for Squats", "Show form for Push-ups"]);
  });

  test("hands back the id that was pressed", () => {
    // The whole contract with the caller. An affordance that reported the wrong
    // row would open a movement under another one's name, which is the failure
    // FUEL-94's id-rather-than-boolean state exists to make unrepresentable.
    const shown: string[] = [];

    render(
      <ExerciseList
        exercises={SESSION}
        form={{ available: new Set(["w2"]), onShow: (id) => shown.push(id) }}
      />,
    );

    screen.getByRole("button", { name: "Show form for Push-ups" }).click();

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
        form={{ available: new Set(["u1", "c1"]), onShow: () => {} }}
      />,
    );

    expect(
      screen.getAllByRole("button").map((button) => button.getAttribute("aria-label")),
    ).toEqual(["Show form for Joint prep", "Show form for Lower-body stretches"]);
  });

  test("keeps the row a row: one list item, still carrying its own content", () => {
    // § Lists' window is a height, and the whole argument for this shape is that
    // it adds none. A control drawn as a second row — or a row that gained a
    // sibling — would be the per-row affordance FUEL-90 refused, arrived at by
    // accident.
    render(
      <ExerciseList
        exercises={[exercise({ id: "w1" })]}
        form={{ available: AVAILABLE, onShow: () => {} }}
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
  const only = (form?: {
    available: ReadonlySet<string>;
    onShow: (id: string) => void;
  }) => {
    const { unmount } = render(
      <ExerciseList
        exercises={[exercise({ id: "w1", notes: "Squeeze at the top." })]}
        progress={new Map([["w1", "2 of 3 sets"]])}
        form={form}
      />,
    );
    const row = screen.getByRole("listitem");
    const shape = {
      // Every element in the row, by tag, in order.
      tags: [...row.querySelectorAll("*")].map((node) => node.tagName).join(","),
      text: row.textContent,
    };

    unmount();
    return shape;
  };

  test("a control row holds the same elements as an inert one, plus the button", () => {
    const inert = only();
    const control = only({ available: new Set(["w1"]), onShow: () => {} });

    // One added element and it is the wrapper itself — no glyph, no spacer, no
    // second span holding a mark.
    expect(control.tags).toBe(`BUTTON,${inert.tags}`);
  });

  test("and it reads identically, because the mark is not a character", () => {
    // The chevron that broke this was a rendered glyph, so it also appeared in
    // the row's text. An underline is a decoration on text that was already
    // there: nothing to announce, nothing to lay out.
    expect(only({ available: new Set(["w1"]), onShow: () => {} }).text).toBe(only().text);
  });
});
