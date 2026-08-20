import { render, screen, within } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

import { RecentSessions } from "@/components/recent-sessions";
import type { RecentSession } from "@/lib/adherence";

/**
 * FUEL-30 — the way back to a past session.
 *
 * `lib/adherence.test.ts` owns which dates end up in the list; this file owns
 * what a row is once one has. Two of the criteria live here rather than there:
 * the rows have to be reachable — that is the acceptance criterion the dots
 * cannot satisfy on their own, at 36×21px — and they have to state an outcome
 * in words, because § The Governing Principle asks a skipped session and a
 * completed one to be rendered with the same visual weight.
 *
 * Invented data, per Testing Strategy § 1.5: the repository is public and the
 * owner's real training stays in docs/.
 */

const VIEWING = "2026-04-08";

const SESSIONS: RecentSession[] = [
  { date: "2026-04-08", label: "Bodyweight Circuit A", status: "none" },
  { date: "2026-04-07", label: "Skipping Intervals + Core", status: "skipped" },
  { date: "2026-04-06", label: "Bodyweight Circuit B", status: "partial" },
  { date: "2026-04-03", label: "Bodyweight Circuit A", status: "done" },
];

describe("the rows", () => {
  test("sends each date to its own screen, in the order it was given", () => {
    render(<RecentSessions sessions={SESSIONS} viewing={VIEWING} />);

    expect(screen.getAllByRole("link").map((row) => row.getAttribute("href"))).toEqual([
      "/training?date=2026-04-07",
      "/training?date=2026-04-06",
      "/training?date=2026-04-03",
    ]);
  });

  test("names the day, the workout and the outcome", () => {
    render(<RecentSessions sessions={SESSIONS} viewing={VIEWING} />);

    // A row named only by its date would tell a screen-reader user nothing the
    // dot grid above had not already said.
    const row = screen.getByRole("link", { name: /7 Apr/ });

    expect(row.textContent).toContain("Tue 7 Apr");
    expect(row.textContent).toContain("Skipping Intervals + Core");
    expect(row.textContent).toContain("Skipped");
  });

  test("says an unrecorded session is unrecorded, and does not call it a skip", () => {
    render(<RecentSessions sessions={SESSIONS} viewing={VIEWING} />);

    // The rule `lib/adherence.ts` keeps everywhere: absence of a record is
    // absence of a record. A list is where it would be easiest to break, by
    // quietly leaving the unlogged day out or by rounding it into a skip.
    const [today] = screen.getAllByRole("listitem");

    expect(today?.textContent).toContain("Not recorded");
  });

  test("marks the date being viewed and does not link it to itself", () => {
    render(<RecentSessions sessions={SESSIONS} viewing={VIEWING} />);

    const [current] = screen.getAllByRole("listitem");

    // Present, because a list that dropped the current date would look like a
    // list with a day missing — but inert, on `DateNav`'s rule that a control
    // taking you where you already are is a control that does nothing.
    expect(current?.textContent).toContain("Wed 8 Apr");
    expect(within(current as HTMLElement).queryByRole("link")).toBeNull();
    expect(current?.querySelector("[aria-current='page']")).toBeTruthy();
  });

  test("gives every outcome the same type and the same ink", () => {
    // § Accessibility's "never colour alone" and § The Governing Principle's
    // equal visual weight. A column of red Skippeds down the right-hand edge
    // would be the grading the graphic above it exists to refuse.
    render(<RecentSessions sessions={SESSIONS} viewing={VIEWING} />);

    const outcomes = ["Not recorded", "Skipped", "Partial", "Done"].map((word) =>
      screen.getByText(word),
    );

    for (const outcome of outcomes) {
      expect(outcome.className).toBe(outcomes[0]?.className);
      expect(outcome.className).not.toContain("error");
    }
  });

  test("draws a repeated date twice rather than collapsing it", () => {
    // `recentSessions` keeps both rows when a caller's weeks name one date
    // twice, so this has to render both — and without a duplicate React key,
    // which is a console error rather than a visible fault.
    const warn = vi.spyOn(console, "error").mockImplementation(() => {});
    const twice = [SESSIONS[0]!, SESSIONS[0]!];

    render(<RecentSessions sessions={twice} viewing="2026-04-01" />);

    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    expect(warn).not.toHaveBeenCalled();

    warn.mockRestore();
  });

  test("describes what will appear rather than nudging, when there is nothing", () => {
    // § Tone of Voice. Before the plan reaches a training day there is nothing
    // to go back to, which is a fact about a new account and not a lapse.
    render(<RecentSessions sessions={[]} viewing={VIEWING} />);

    expect(screen.queryByRole("list")).toBeNull();
    expect(
      screen.getByText("Sessions appear here once the plan reaches a training day."),
    ).toBeTruthy();
  });
});
