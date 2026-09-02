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
