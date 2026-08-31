"use client";

import { startTransition, useOptimistic, useRef, useState, useTransition } from "react";

import { ACTION_BAR_PRIMARY } from "@/components/action-bar";
import { PageMain } from "@/components/page-main";
import { Button } from "@/components/ui/button";
import { KeyValueGrid, type KeyValueItem } from "@/components/kv-grid";
import { Sheet } from "@/components/ui/sheet";
import { WeightChart } from "@/components/weight-chart";
import {
  deleteWeighIn,
  earlierWeighIns,
  saveWeighIn,
  weighInOn,
} from "@/app/actions/weight";
import type { CalendarDate } from "@/lib/date";
import { figure } from "@/lib/format";
import { PAGE_FRAME_GRID } from "@/lib/frame";
import { entryLabel } from "@/lib/now-display";
import { HOVER_GROUND, HOVER_LIFT, POINTER } from "@/lib/pointer";
import { MAX_NOTE_LENGTH } from "@/lib/session-entry";
import {
  MAX_KG,
  MIN_KG,
  type WeighInRow,
  parseWeighInDate,
  parseWeightKg,
} from "@/lib/weigh-in";
import type { Reading } from "@/lib/weight-chart";
import { cn } from "@/lib/utils";
import { type WeightStats, weightStats } from "@/lib/weight-stats";

/**
 * `/weight` — the weigh-in history and the form that writes it. FUEL-34, P5.
 *
 * ## One form, because the date is the address
 *
 * There is no separate "add" and "edit". `weight_logs` is unique on
 * `(user_id, date)` — schema.ts: "re-weighing is an update" — so a weigh-in is
 * named by its date and the write is an upsert. The form's date field IS the
 * address, and picking a date that already holds a weigh-in loads it: the same
 * three controls then edit that entry, and logging replaces it.
 *
 * The alternative, a second form opened per row, has a failure this one cannot
 * have. That form's date would be editable too, and saving it onto a date that
 * already held a weigh-in would update THAT row while leaving the original
 * behind — a silent duplicate of the number P5 calls "the single number the
 * whole program is judged on", with nothing on the screen to say which is
 * which. Here there is nothing to move.
 *
 * ## Optimistic, like `/training` and unlike `/settings`
 *
 * `settings/slot-times-form.tsx` uses `useActionState` because it saves a form
 * and re-renders it. This screen mutates a LIST: a logged weigh-in appears in
 * the history, a deleted one goes, and § Feedback asks for both to be
 * optimistic. So the arrangement is `components/training.tsx`'s — client state
 * for the fields, `useOptimistic` over the rows, and a failure stored as the
 * ATTEMPT rather than as a message, so "Try again" re-runs what was refused and
 * not what the boxes happen to hold a minute later.
 *
 * ## Two kinds of refusal, said in two places
 *
 * A value the parser will not take is caught before the request: `lib/weigh-in.ts`
 * is pure and imports nothing from the database, so the screen and the server
 * share one definition of a valid weigh-in rather than two that can drift. That
 * refusal is a message under the field it belongs to — § Feedback's "inline
 * banner at the point of action" — because it names something the user can fix.
 *
 * A request the SERVER refused is the banner with "Try again", because from
 * here it is indistinguishable from a dropped connection. The action returns one
 * answer for every failure on purpose (see `actions/weight.ts`), so the screen
 * does not pretend to know more than it does.
 */

/**
 * One weigh-in, narrowed by `lib/weigh-in.ts`. No id — the date is the id.
 *
 * Re-exported from here, where this screen's callers already reach for it.
 * FUEL-84 moved the declaration itself so that `actions/weight.ts` could narrow
 * older entries to the same shape without importing a client component.
 */
export type { WeighInRow };

/**
 * A tap, in the form a retry needs.
 *
 * The fields are carried on the attempt rather than read from state at retry
 * time, so a retry writes what was refused and not what the boxes hold after the
 * user has moved on — `training.tsx` and `right-now.tsx` both do this.
 */
type Attempt =
  | {
      kind: "log";
      date: CalendarDate;
      /** What was TYPED, which is what the action is sent — see `act`. */
      weight: string;
      /**
       * The same reading parsed, which is what the optimistic row draws.
       *
       * Carried rather than re-derived, so the type says what `log` has already
       * established: an attempt only exists once the weight parsed. Without it
       * the reducer would need a fallback for a number it can never be given,
       * and an unreachable fallback that renders "0 kg" is worse than no
       * fallback at all.
       */
      weightKg: number;
      note: string;
    }
  | { kind: "delete"; date: CalendarDate };

/** Newest first — the order `loadWeighIns` returns and the list reads in. */
function newestFirst(a: Reading, b: Reading): number {
  return a.date < b.date ? 1 : -1;
}

/**
 * Puts a reading into a list at its date, replacing whatever was on that date.
 *
 * Generic over the two lists FUEL-84 split the history into — the ROWS the
 * screen lists and the READINGS the chart draws — because a weigh-in has to
 * land in both at the same moment, or the line and the list disagree about what
 * just happened. One function, so the two cannot drift.
 *
 * Re-sorted rather than prepended: a weigh-in logged for a past date belongs
 * where that date belongs and not at the top.
 */
function withReading<T extends Reading>(list: readonly T[], entry: T): readonly T[] {
  return [entry, ...list.filter((row) => row.date !== entry.date)].sort(newestFirst);
}

/**
 * Applies a write to the older pages the reader loaded — the half `refresh()`
 * cannot reach.
 *
 * Those pages are client state. The server re-renders `entries`, so a write
 * inside the window corrects itself; a write to a row the reader had PAGED IN
 * does not, and the optimistic value is discarded the moment the transition
 * ends. Without this, a deleted old entry reappears and a corrected one
 * reappears at its old weight.
 *
 * A logged weigh-in is put back only if it is older than the server's window,
 * which is where the server would put it. Anything newer arrives in `entries`
 * on the next render, and a second copy here is what the dedupe in `loaded`
 * would then have to undo.
 */
function reconcile(
  earlier: readonly WeighInRow[],
  attempt: Attempt,
  window: readonly WeighInRow[],
): readonly WeighInRow[] {
  const without = earlier.filter((row) => row.date !== attempt.date);

  if (attempt.kind === "delete") return without;

  const oldest = window[window.length - 1];

  if (!oldest || attempt.date >= oldest.date) return without;

  return withReading(without, {
    date: attempt.date,
    weightKg: attempt.weightKg,
    note: attempt.note.trim() || null,
  });
}

/** § Tone of Voice: name what happened. Never "Something went wrong". */
function banner(failure: Attempt): string {
  return failure.kind === "delete" ? "Couldn’t delete that." : "Couldn’t log that.";
}

/** `77.4 kg`. One decimal, which is every bathroom scale there is. */
function kilograms(weightKg: number): string {
  return `${figure(weightKg)} kg`;
}

/**
 * `0.50 kg/wk`. Two decimals, and `figure` deliberately not used.
 *
 * `figure` caps at one decimal, which is right for a weight — no scale reads
 * finer — and wrong for this. `goal_pace_kg_per_week` is `numeric(4, 2)` and
 * the band FUEL-36 judges against is five hundredths wide, so a rate shown to
 * one decimal would round 0.45 and 0.54 onto the same figure while the verdict
 * printed beside it told them apart. A reader cannot check a comparison whose
 * operands have been rounded past the point that decides it.
 *
 * Always two, including the trailing zero: these are read as a column against
 * the goal directly beneath, and `0.5` beside `0.50` invites the eye to compare
 * digits that are not in the same place.
 */
function perWeek(kgPerWeek: number): string {
  return `${kgPerWeek.toFixed(2)} kg/wk`;
}

/**
 * The trailing rate with the Brand Guide's sign in front of it.
 *
 * U+2212 MINUS SIGN, per `format.ts` — and not `signed()` itself, which is
 * built for a delta from a target and formats through `figure`. The `+` on a
 * gain is kept, because this IS a delta: a rate of change with a direction, and
 * a week that went up is the one week a reader must not misread as a small
 * loss. A flat week carries no sign at all, for `signed()`'s reason.
 */
function ratePerWeek(kgPerWeek: number): string {
  const magnitude = perWeek(Math.abs(kgPerWeek));

  if (kgPerWeek === 0) return magnitude;

  return kgPerWeek > 0 ? `+${magnitude}` : `−${magnitude}`;
}

/**
 * The progress grid's four pairs — Brand Guide § Key/Value Grid.
 *
 * ## The rate is the only coloured figure on the screen
 *
 * § Color Palette gives `success` to the "goal-pace rate", and this is that
 * rate. Off pace stays in `text-primary` and is never `error`: § The Governing
 * Principle is that divergence is data rather than guilt, and P5's target moves
 * every 5kg anyway, so a week outside the band is information rather than a
 * failure. Losing FASTER than the goal is outside it too — the pace is what
 * separates a cut from a crash — which is a second reason the off-pace
 * treatment cannot be a warning colour.
 *
 * § Accessibility's "never colour alone" is what puts the words "on pace" in
 * the metadata line. The green is the second signal, not the only one, and the
 * line still names the goal either way so the comparison can be checked by
 * anyone who cannot see the difference.
 */
function progressItems(
  stats: WeightStats,
  {
    startWeightKg,
    targetWeightKg,
    goalPaceKgPerWeek,
  }: { startWeightKg: number; targetWeightKg: number; goalPaceKgPerWeek: number },
): KeyValueItem[] {
  const { lostKg, remainingKg, journeyKg, percentToTarget, rate } = stats;
  const goal = `goal ${perWeek(goalPaceKgPerWeek)}`;

  return [
    {
      // The label moves rather than the figure. `weight-stats.ts` leaves a gain
      // as a negative loss because "0.0 kg" under "Lost" would be untrue, and
      // "−1.2 kg" under it is a double negative the reader has to unpick.
      label: lostKg < 0 ? "Gained" : "Lost",
      value: kilograms(Math.abs(lostKg)),
      meta: `from ${kilograms(startWeightKg)}`,
    },
    {
      label: "Remaining",
      value: kilograms(remainingKg),
      meta: `to ${kilograms(targetWeightKg)}`,
    },
    {
      label: "To target",
      // Null only when the start and the target are the same weight, which is a
      // profile with no journey in it rather than a program at 0%.
      value: percentToTarget === null ? "—" : `${percentToTarget}%`,
      meta: `of ${kilograms(journeyKg)}`,
    },
    {
      label: "Rate",
      value: rate ? (
        <span className={rate.onPace ? "text-success" : undefined}>
          {ratePerWeek(rate.kgPerWeek)}
        </span>
      ) : (
        "—"
      ),
      // § Tone of Voice asks an empty state to describe what will make the
      // thing appear. A goal printed beside no rate at all would be half a
      // comparison.
      meta: rate ? (rate.onPace ? `on pace · ${goal}` : goal) : "a second weigh-in starts this",
    },
  ];
}

export function WeighIns({
  today,
  entries,
  readings,
  startWeightKg,
  targetWeightKg,
  goalPaceKgPerWeek,
}: {
  /** Today in the user's own zone — the form's default and its ceiling. */
  today: CalendarDate;
  /**
   * The newest `RECENT_WEIGH_INS` weigh-ins, with their notes — the list.
   *
   * A window rather than the history, since FUEL-84. The list used to render
   * every row there was: 58 on the demo account, 4333px, six and a half screens
   * of phone, and no ceiling on any of it. The rest arrives through
   * `earlierWeighIns` a page at a time, which is also the only way a note older
   * than this window reaches the browser at all.
   */
  entries: readonly WeighInRow[];
  /**
   * EVERY weigh-in as a date and a weight, newest first.
   *
   * The chart draws all of them and § Accessibility obliges it to table all of
   * them, so unlike the rows above this one is not windowed — and because it is
   * whole, it is also what the rest of the screen counts against: the headline
   * reading, the progress figures, whether the date in the form already holds a
   * weigh-in, and how many entries are still unlisted.
   *
   * No notes. A note is `MAX_NOTE_LENGTH` against a reading's thirty-odd bytes,
   * and the list is the one thing that renders one — see `weight/page.tsx`.
   */
  readings: readonly Reading[];
  /**
   * `profiles.start_weight_kg` and `profiles.target_weight_kg` — the chart's two
   * reference lines, and FUEL-35's "target line and starting weight both
   * visible".
   *
   * Carried down from the profile rather than written here as figures. P7 gives
   * the demo persona different body metrics, so a literal target would draw the
   * owner's goal across a visitor's chart — and the owner's goal is one of the
   * numbers § Security keeps out of a public repository.
   */
  startWeightKg: number;
  targetWeightKg: number;
  /**
   * `profiles.goal_pace_kg_per_week` — what FUEL-36's trailing rate is read
   * against, and the only thing on this screen that produces a verdict.
   *
   * From the profile for the same reason the two above are: P5 recalibrates on
   * it every 5kg and P7's persona cuts at its own rate, so a band written here
   * would judge a visitor's history against the owner's program.
   */
  goalPaceKgPerWeek: number;
}) {
  const [date, setDate] = useState<CalendarDate>(today);
  // Strings, not numbers: the boxes have an empty state and `null` is not a
  // thing an input can hold. Parsing happens once, at the edge, in
  // `lib/weigh-in.ts` — which has to parse it anyway, since a Server Action is
  // reachable by anyone who can POST.
  const [weight, setWeight] = useState("");
  const [note, setNote] = useState("");

  const [problem, setProblem] = useState<{ date?: string; weight?: string }>({});
  const [failure, setFailure] = useState<Attempt | null>(null);
  /** The date whose delete is being confirmed, or `null` for no sheet. */
  const [confirming, setConfirming] = useState<CalendarDate | null>(null);

  /** The older pages the reader has asked for, continuing `entries`. */
  const [earlier, setEarlier] = useState<readonly WeighInRow[]>([]);
  /**
   * Where the next page starts — the oldest date PAGING has reached, or `null`
   * before the first step.
   *
   * Held rather than read off the last row on screen, which is what this was
   * first written to do. A weigh-in logged for an old date sorts to the bottom
   * of the list, and a cursor taken from there would ask for "older than
   * January" while August was still unfetched — stranding every row between,
   * counted as unlisted and reachable by nothing. A write must not be able to
   * move the read's place in the history.
   */
  const [cursor, setCursor] = useState<CalendarDate | null>(null);
  /** A page that did not come back — § Feedback, beside the control that asked. */
  const [unreachable, setUnreachable] = useState(false);
  /*
   * The reads are a transition of their own, not the writes'. Nothing about
   * them is optimistic — there is no value to show before the answer arrives —
   * so what is wanted is the pending flag, and sharing `startTransition` with
   * `act` would put a fetch behind a save and make the button say nothing while
   * it waited.
   */
  const [loading, startLoading] = useTransition();

  // Focus moves to the weight box when a row is loaded for editing: the form is
  // above the list, so without it the user taps Edit and nothing they can see
  // changes. § Accessibility's "focus is never removed" is the same rule from
  // the other side.
  const weightBox = useRef<HTMLInputElement>(null);

  /**
   * The date the form is addressed at, readable from an async callback.
   *
   * `date` is state, so a closure that started before the reader moved on holds
   * the date they have left. One thing reads it late — the note prefill below,
   * which waits on a fetch — and dropping a fetched note into a form that now
   * addresses some other day would be a note appearing under the wrong weight.
   * Every write of `date` goes through `address`, so the two cannot separate.
   */
  const addressed = useRef<CalendarDate>(today);

  /**
   * Whether the reader has typed in the note box since the form was addressed.
   *
   * The note prefill below waits on a fetch, and a reader who starts writing a
   * note in the meantime is a reader whose words the answer would overwrite —
   * on the same date, so `addressed` does not catch it. Cleared by `address`,
   * because a form pointed at a new entry has no draft to protect.
   */
  const noteTouched = useRef(false);

  const address = (next: CalendarDate) => {
    addressed.current = next;
    noteTouched.current = false;
    setDate(next);
  };

  /*
   * What the screen has before optimism: the server's window, and every older
   * page the reader has asked for since.
   *
   * Deduplicated on the date and re-sorted, neither of which is belt and braces.
   *
   * The window is the newest `RECENT_WEIGH_INS` and it MOVES: delete a recent
   * weigh-in and the server's next window reaches one row further back, into a
   * page this client already holds. A weigh-in LOGGED for an old date lands in
   * `earlier` through `reconcile` and is then returned again by the page that
   * eventually reaches its date. Either way a row would render twice under one
   * React key, so the dedupe is over the whole concatenation rather than
   * between the two lists — the server's copy first, so it wins.
   *
   * The sort is for that same logged old date. It goes into `earlier` at the
   * end, which is not where its date belongs once the pages between have been
   * fetched, and a history list out of date order is a list you cannot read.
   */
  const seen = new Set<CalendarDate>();
  const loaded = [...entries, ...earlier]
    .filter((row) => !seen.has(row.date) && seen.add(row.date))
    .sort(newestFirst);

  /*
   * What the screen says the history is, before the server has answered.
   *
   * One reducer over the whole history rather than a value per row, so a log
   * and a delete cannot revert independently. Both are keyed by date, which is
   * the row's address — see the module comment.
   *
   * Over BOTH lists since FUEL-84, in one state rather than two `useOptimistic`
   * calls. The rows and the readings are two views of one table and every write
   * touches both, so a logged weigh-in has to reach the list, the line, the
   * progress figures and the count of what is still unlisted in the same
   * render. Two reducers could each be right and still show a screen that was
   * not.
   */
  const [history, apply] = useOptimistic(
    { rows: loaded, readings },
    (
      current: { rows: readonly WeighInRow[]; readings: readonly Reading[] },
      next: Attempt,
    ) => {
      if (next.kind === "delete") {
        return {
          rows: current.rows.filter((row) => row.date !== next.date),
          readings: current.readings.filter((row) => row.date !== next.date),
        };
      }

      const { date: at, weightKg, note } = next;

      return {
        rows: withReading(current.rows, { date: at, weightKg, note: note.trim() || null }),
        readings: withReading(current.readings, { date: at, weightKg }),
      };
    },
  );

  /**
   * The weigh-in already on the form's date, if there is one.
   *
   * Against the READINGS, not the listed rows. The form's date field addresses
   * any date in the history, including one older than the list has loaded, and
   * a lookup that missed those would drop the "replaces" line below on exactly
   * the entries whose replacement is least expected.
   */
  const existing = history.readings.find((row) => row.date === date);

  /**
   * The most recent reading — the figure the screen leads with.
   *
   * `readings[0]` because that list is newest first AND whole, which is what
   * makes the headline independent of how much of the history is listed. Read
   * into a name rather than indexed twice, so the empty case is stated once.
   * The number and its date are the hero; FUEL-36's progress figures sit
   * further down, beneath the chart they are the arithmetic of.
   */
  const latest = history.readings[0];

  /** Weigh-ins that exist and are not listed — FUEL-84's "show earlier". */
  const unlisted = history.readings.length - history.rows.length;

  /*
   * The progress figures and the trailing rate — FUEL-36.
   *
   * Over the OPTIMISTIC readings, which is the chart's reasoning one line of
   * argument further: a logged weigh-in moves the percentage and the rate at
   * the same moment it appears in the list and on the line. Figures that waited
   * for the round trip would sit beside a chart that had already moved, which
   * reads as one of them being broken.
   *
   * Readings rather than rows, since FUEL-84: the rate is a slope through a
   * trailing window of the HISTORY, and taking it through the ten rows that
   * happen to be listed would make a figure about the last four weeks depend on
   * how far the reader had scrolled.
   *
   * `null` for an empty history, so the section below is gated by the same
   * answer that produced it rather than by a second count of the same rows.
   */
  const stats = weightStats({
    readings: history.readings,
    startWeightKg,
    targetWeightKg,
    goalPaceKgPerWeek,
  });

  const act = (attempt: Attempt) => {
    setFailure(null);

    startTransition(async () => {
      // The attempt already carries the parsed reading, so the optimistic row
      // shows the number that will be STORED — rounded to the column's two
      // decimals — rather than the string that was typed.
      apply(attempt);

      const result =
        attempt.kind === "delete"
          ? await deleteWeighIn({ date: attempt.date })
          : await saveWeighIn({
              date: attempt.date,
              weight: attempt.weight,
              note: attempt.note,
            });

      // The optimistic value has already reverted by the time this renders —
      // the transition ending is what discards it — so the banner reports a
      // screen that is back where it started.
      if (!result.ok) {
        setFailure(attempt);

        return;
      }

      // `refresh()` re-renders the server's window, which corrects `entries`.
      // The older pages are this client's own state and it cannot reach them,
      // so the write is applied to them here — see `reconcile`.
      setEarlier((current) => reconcile(current, attempt, entries));
    });
  };

  /**
   * Loads the next page of older weigh-ins — FUEL-84.
   *
   * Keyed on the oldest row the screen holds rather than on a page number, so
   * the step stays correct while the list underneath it moves; `queries/weight.ts`
   * argues the keyset. One way only, with no matching "show fewer": § Progressive
   * Disclosure rules out accordions, and a list that can be collapsed again is
   * one.
   */
  const showEarlier = () => {
    // Before the first step the window's own oldest row is the boundary, read
    // fresh at the tap so a window the server has since moved is the one used.
    const from = cursor ?? entries[entries.length - 1]?.date;

    if (!from) return;

    setUnreachable(false);

    startLoading(async () => {
      const result = await earlierWeighIns({ before: from });

      if (!result.ok) {
        setUnreachable(true);

        return;
      }

      const last = result.entries[result.entries.length - 1];

      if (last) setCursor(last.date);

      setEarlier((current) => [...current, ...result.entries]);
    });
  };

  /**
   * Checks the two fields the user can get wrong, then writes.
   *
   * The checks are the SAME functions the action runs, imported from the same
   * pure module. A screen that could submit something the server will not take
   * is a screen that reports a failure the user cannot understand.
   *
   * The note is not checked here: the textarea carries `maxLength`, so the only
   * way past it is a forged request, which the action refuses on its own.
   */
  const log = () => {
    // Parsed once, and the results carried rather than re-derived: the checks
    // below and the optimistic row must agree about what this reading is.
    const weightKg = parseWeightKg(weight);
    const checked = {
      date: parseWeighInDate(date, today)
        ? undefined
        : "Pick today or a past date — a weigh-in can’t be in the future.",
      weight:
        weightKg === undefined
          ? `Enter a weight in kilograms, between ${MIN_KG} and ${MAX_KG}.`
          : undefined,
    };

    setProblem(checked);

    // `weightKg === undefined` rather than a second look at `checked.weight`,
    // so the narrowing the attempt below depends on is the one TypeScript can
    // see. The two conditions are the same condition.
    if (checked.date || weightKg === undefined) return;

    act({ kind: "log", date, weight, weightKg, note });

    // The form goes back to being addressed at today, which is what it is for
    // most of the time. The number is cleared with it: leaving 77.4 in the box
    // under a date that now reads "today" is a form that looks like it still
    // has something to say.
    setWeight("");
    setNote("");
    address(today);
  };

  /** Loads a row into the form — the "edit" half of the criterion. */
  const edit = (row: WeighInRow) => {
    setProblem({});
    address(row.date);
    setWeight(String(row.weightKg));
    setNote(row.note ?? "");
    weightBox.current?.focus();
  };

  const field =
    "h-11 rounded-md border border-border bg-surface px-3 text-body text-text-primary outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background aria-invalid:border-destructive";

  return (
    /*
     * The frame, and five rows — § Desktop, FUEL-78.
     *
     * ## The DOM order and the desktop order are not the same order
     *
     * This is the one screen in the ticket where they differ, and it is why
     * this grid names five rows where `/`'s names three. The phone reads
     * heading → form → chart → Progress → History, which is § Touch Targets'
     * doing: "below the form rather than above it, so a ~176px graphic never
     * pushes the screen's one primary action out of thumb reach". At the cap
     * there is no thumb, and the composition § Desktop asks for is the chart
     * across the frame with the figures and the entry control beneath it.
     *
     * So neither desktop group is a run of adjacent children — the band wants
     * the heading and the chart with the form between them, and the measure
     * wants Progress above the form with the chart between them.
     *
     * `display: contents` cannot help with that: it dissolves a wrapper, and a
     * wrapper cannot be drawn around children that are not adjacent. Reordering
     * the DOM and correcting it with `order` below the cap could, and is
     * refused — `order` moves boxes and leaves the reading order behind, so the
     * phone would announce its screen in an order it does not draw.
     *
     * Explicit grid placement is what actually fits the problem. Every child is
     * its own item and says which cell it occupies, so the five can be dealt
     * into any arrangement the frame wants **without one line of DOM moving**,
     * and below `xl` they are the flex column they have always been. The
     * 375px and 820px baselines coming back byte-identical is the proof.
     *
     * No `contents` wrappers here either, and for the same reason there are
     * five rows: nothing needs grouping. Each of the five is already one box.
     *
     * ## The rows
     *
     * `auto auto auto auto 1fr` — the heading, the chart, Progress, the entry
     * control, and the slack. The last is `1fr` for the reason FUEL-86 gives in
     * `frame.ts`: History spans the measure's rows, and a grid distributes a
     * spanning item's surplus evenly across every track it spans. With all five
     * `auto`, a history taller than Progress plus the form would push the form
     * down for a reason that has nothing to do with the form. A flexible last
     * track takes the surplus instead, below both.
     */
    <PageMain
      className={cn(
        "gap-7 pt-[22px]",
        PAGE_FRAME_GRID,
        "xl:grid-rows-[auto_auto_auto_auto_1fr]",
      )}
    >
      {/* The band: the reading itself. § Desktop's amendment releases it from
          the measure — "a folio, a figure, a time axis, a trend line and a
          table" may take the frame — and its per-screen table spends that here
          by name: "**the reading and the trend take the frame**". */}
      <div
        className="flex flex-col gap-3 xl:col-start-1 xl:col-end-[-1] xl:row-start-1"
        data-column="header"
      >
        <h2 className="text-micro uppercase text-text-secondary">Weight</h2>
        <h1 className="text-title text-text-primary">
          {latest ? kilograms(latest.weightKg) : "No weigh-ins yet"}
        </h1>
        {/* § Tone of Voice, and the guide's own words for this empty state.
            With a history, the slash line says which reading the figure above
            is rather than adding a fact to it. */}
        <p className="text-slash text-text-tertiary">
          {latest
            ? `/ ${entryLabel(latest.date, today)}`
            : "No weigh-ins yet. Your first entry starts the chart."}
        </p>
      </div>

      {/* The entry control, under the figures at the cap and under the reading
          below it — row four, which is the second half of what the five rows
          are for. `data-column` is on this rather than on Progress because a
          history with one reading has no Progress to measure a column by. */}
      <section
        className="flex flex-col gap-[14px] xl:col-start-1 xl:row-start-4"
        data-column="measure"
      >
        <h2 className="text-micro uppercase text-text-secondary">Log a weigh-in</h2>

        <div className="flex flex-col gap-2">
          <label htmlFor="weigh-in-date" className="text-slash text-text-secondary">
            Date
          </label>
          <input
            id="weigh-in-date"
            type="date"
            value={date}
            onChange={(event) => {
              const next = event.target.value;

              address(next);
              setProblem({});

              /*
               * The date is the address, so changing it changes which weigh-in
               * the form is editing — and the fields follow it. Without this,
               * moving to a date that already has a reading would leave the
               * previous one's number in the box, one tap away from
               * overwriting a measurement with a different day's.
               */
              const row = history.rows.find((entry) => entry.date === next);

              if (row) {
                setWeight(String(row.weightKg));
                setNote(row.note ?? "");

                return;
              }

              /*
               * FUEL-84: a date can now name a weigh-in the LIST has not
               * loaded. The reading is here either way — the chart holds every
               * one — so the weight prefills from it and the "replaces" line
               * below is right whether or not the row is listed.
               *
               * The note is not here, and `recordWeighIn` sets the note on
               * every write. An empty box saved over a real note would lose it
               * with nothing on the screen having said so, which is the one
               * failure a bounded list could introduce that the unbounded one
               * could not. So it is fetched rather than assumed.
               *
               * A date with no weigh-in at all clears both fields rather than
               * leaving them: the form is then empty, which is what "this date
               * has nothing" should look like.
               */
              const unloaded = history.readings.find((entry) => entry.date === next);

              setWeight(unloaded ? String(unloaded.weightKg) : "");
              setNote("");

              if (!unloaded) return;

              startLoading(async () => {
                const result = await weighInOn({ date: next });

                if (!result.ok) {
                  // Said in the date's own error slot, because it is about the
                  // date the form is pointed at — and as a warning rather than
                  // a block: replacing the entry may well be the intention, and
                  // `log` checks the date itself regardless.
                  setProblem((current) => ({
                    ...current,
                    date: "Couldn’t load this entry’s note. Logging now would replace it.",
                  }));

                  return;
                }

                // Two ways the answer can arrive too late to be wanted: the
                // form has moved to another date, or the reader has started
                // writing a note of their own on this one. Neither is a note
                // this fetch may overwrite.
                if (addressed.current === next && !noteTouched.current) {
                  setNote(result.entry?.note ?? "");
                }
              });
            }}
            // Today in the USER's zone, not the browser's. It is what stops a
            // future weigh-in by accident; `lib/weigh-in.ts` is what stops one
            // on purpose, since an input attribute is only a suggestion to a
            // browser.
            max={today}
            aria-invalid={problem.date ? true : undefined}
            aria-describedby={problem.date ? "weigh-in-date-error" : undefined}
            /*
             * Its own width rather than the column's — FUEL-74.
             *
             * A date is a fixed-length value, not prose. Every other control in
             * this app that holds one already says so by its size: Weight below
             * is `w-32`, and `/settings`' seven time inputs are `shrink-0`
             * against their labels. This field was the last one taking the
             * measure's width for a value that can never use it, and it did so
             * by omission — `field` carries no width, so the parent's
             * `flex-col` stretch decided it.
             *
             * 176px is measured rather than chosen. The control's intrinsic
             * width at § Typography's 17px body is 165px, and 176 is the scale
             * step above it: enough headroom that a locale spelling the
             * placeholder differently does not clip, without the width being a
             * number this file invented. An explicit width rather than `w-fit`
             * because the intrinsic one is the browser's, and a zero-tolerance
             * baseline should not rest on something a Chromium release may
             * revise.
             *
             * `h-11` is untouched, so § Touch Targets' 44×44 minimum holds —
             * the box is 176×44.
             */
            className={`${field} w-44`}
          />
          {problem.date && (
            <span id="weigh-in-date-error" role="alert" className="text-slash text-error">
              {problem.date}
            </span>
          )}
        </div>

        <div className="flex flex-col gap-2">
          <label htmlFor="weigh-in-weight" className="text-slash text-text-secondary">
            Weight
          </label>
          <span className="flex items-center gap-2">
            <input
              id="weigh-in-weight"
              ref={weightBox}
              value={weight}
              onChange={(event) => setWeight(event.target.value)}
              /*
               * FUEL-34's criterion, and the reason it is not `type="number"`.
               * A number input whose value is "77,4" reports an EMPTY string to
               * React on a browser whose locale uses a full stop — the digits
               * are on screen and unreachable to the code — so the comma the
               * criterion asks for would be silently lost rather than parsed.
               * `inputMode` asks the phone for the same decimal keypad without
               * taking the value away, and it also drops the 24px spinners and
               * the scroll-wheel behaviour that changes a value nobody touched.
               */
              inputMode="decimal"
              // Six characters covers `400.00` and every reading below it. The
              // parser refuses anything out of range regardless; this is the
              // typo class that never reaches it.
              maxLength={6}
              placeholder="77.4"
              aria-invalid={problem.weight ? true : undefined}
              aria-describedby={problem.weight ? "weigh-in-weight-error" : undefined}
              className={`${field} w-32 tabular-nums`}
            />
            <span className="text-slash text-text-tertiary">kg</span>
          </span>
          {problem.weight && (
            <span id="weigh-in-weight-error" role="alert" className="text-slash text-error">
              {problem.weight}
            </span>
          )}
        </div>

        <div className="flex flex-col gap-2">
          <label htmlFor="weigh-in-note" className="text-slash text-text-secondary">
            Note
          </label>
          <textarea
            id="weigh-in-note"
            value={note}
            onChange={(event) => {
              noteTouched.current = true;
              setNote(event.target.value);
            }}
            // The same bound `parseNote` refuses past, so the refusal is
            // unreachable through the screen and is only ever a forged request.
            maxLength={MAX_NOTE_LENGTH}
            rows={2}
            placeholder="Optional — before breakfast, after the walk"
            /*
             * This one keeps the measure, and that is the decision rather than
             * the leftover — FUEL-74 narrowed the date beside it.
             *
             * A note is prose, and the measure is the width § Typography sets
             * for prose. The rule the date field answers to is that a control
             * takes the width of the value it holds; this value has no length,
             * so the column is its size. Written down because a reader who sees
             * the date shrink will otherwise read this as the change not
             * finished.
             */
            className="rounded-md border border-border bg-surface px-3 py-2 text-body text-text-primary outline-none placeholder:text-text-tertiary focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          />
        </div>

        {/* § Content Guidelines: "state consequences factually and
            immediately, including unwelcome ones". The date already holds a
            reading, and logging replaces it — said before the tap, not after. */}
        {existing && (
          <p className="text-slash text-text-tertiary">
            / replaces {kilograms(existing.weightKg)} on {entryLabel(existing.date, today)}
          </p>
        )}

        {failure && (
          <div
            role="alert"
            className="flex items-center justify-between gap-3 border-b border-border pb-3"
          >
            <p className="text-slash text-error">{banner(failure)}</p>
            <Button variant="link" size="xs" onClick={() => act(failure)}>
              Try again
            </Button>
          </div>
        )}

        {/* § Buttons: one primary per screen, and this is it. § Terminology:
            "Log", never "Save" or "Add" — and it is the same word whether the
            date is empty or already has a reading, because the write is the
            same write. */}
        {/*
         * Full-width below the cap, its content's width at it — § Buttons,
         * amended by FUEL-85, and the paragraph this replaces called the
         * question the other way on the evidence it had.
         *
         * That note said "§ Desktop has no width rule for a button, and
         * `BRAND_GUIDE.html` — authoritative at 1272 since FUEL-67 drew the
         * frames — draws this exact control full-measure... The mock marks the
         * buttons that do NOT fill with an explicit `width:auto`, so the
         * silence here is a decision and not an omission." Both halves were
         * true when FUEL-74 wrote them and neither is now: § Buttons has the
         * rule — "at ≥1272 the buttons in a **page action bar** take their
         * content's width and sit in a row. A 584px slab is a thumb target
         * drawn on a screen with no thumb" — and FUEL-85 redrew D5, which now
         * marks this very control `btn btn-primary auto`. The silence it read
         * as a decision has become a drawing that says the opposite.
         *
         * It also named the ticket: "the button is not too wide, the column is
         * too narrow. Left to FUEL-77/78, which own the other six screens."
         * This is FUEL-78, and the column is 584 either way — so the answer is
         * the rule rather than the width.
         *
         * `ACTION_BAR_PRIMARY` rather than the same two utilities written out.
         * This is not inside an `APP_ACTION_BAR` — the screen has no sticky bar
         * and its primary lives in the form it submits — but it is the page's
         * one primary action, which is what the rule is about, and a second
         * spelling of it is how two controls start disagreeing.
         *
         * `xl:self-start` is what `w-auto` needs here and does not need on `/`.
         * There the primary sits in a flex ROW with `items-center`, so nothing
         * stretches it; this one is in a flex COLUMN, where `align-items:
         * stretch` overrides an auto width and would draw the slab again.
         */}
        <Button className={cn(ACTION_BAR_PRIMARY, "xl:self-start")} onClick={log}>
          Log weigh-in
        </Button>
      </section>

      {/*
       * The trend, above the list it is a picture of — the arrangement
       * `/training` uses for its dot grid and `recent-sessions` beneath it, and
       * for the same reason: the graphic answers "how is it going" at a glance
       * and the rows answer "what exactly happened".
       *
       * Below the form rather than above it, so a ~176px graphic never pushes
       * the screen's one primary action out of thumb reach — § Touch Targets.
       *
       * The optimistic READINGS, so a logged weigh-in moves the line at the
       * same moment it appears in the list. Not the listed rows: FUEL-35 asks
       * for the full history by acceptance criterion and § Accessibility makes
       * the chart table every point, so FUEL-84's window is the list's and not
       * the chart's. `WeightChart` renders nothing at all when there are none,
       * which is why this needs no gate of its own.
       */}
      <WeightChart
        entries={history.readings}
        today={today}
        startWeightKg={startWeightKg}
        targetWeightKg={targetWeightKg}
        /* The trend, at the frame's span — the other half of the ruling above,
           and "the complaint FUEL-76 fixed INSIDE the chart still standing
           around it". Row two rather than beside anything: a chart 968px wide
           has nothing to sit next to. The component draws a second shape for
           this box; `weight-chart.ts` says why a wider one alone would not do. */
        className="xl:col-start-1 xl:col-end-[-1] xl:row-start-2"
      />

      {/*
       * The figures the chart is a picture of — FUEL-36, PRD § P5.
       *
       * Under the chart rather than under the headline, for the reason the
       * chart itself is under the form: § Touch Targets keeps the screen's one
       * primary action within thumb reach, and a grid pushed between the
       * heading and "Log a weigh-in" would move it down by two more rows. It
       * also puts the numbers next to the graphic that explains them — the
       * trend line above IS the rate below, and a reader who wants to check one
       * against the other should not have to scroll between them.
       */}
      {stats && (
        /* First in the measure at the cap, where the chart above has taken the
           reading's place at the top of the screen. Below it, unchanged: the
           order in the DOM is the phone's. */
        <section
          className="flex flex-col gap-[14px] xl:col-start-1 xl:row-start-3"
          data-row="progress"
        >
          <h2 className="text-micro uppercase text-text-secondary">Progress</h2>

          {/* Four across on the measure — § Desktop, amended by FUEL-85: "the
              four-macro grid, which this rule names out of scope, goes
              four-across on a measure and stays 2×2 in an aside". These are
              four figures on a 584px measure, which is the case that amendment
              describes; `kv-grid.tsx` has taken a 4 since FUEL-86. */}
          <KeyValueGrid
            columns={4}
            items={progressItems(stats, { startWeightKg, targetWeightKg, goalPaceKgPerWeek })}
          />
        </section>
      )}

      {latest && (
        /*
         * The aside: "the record, and only the record" — § Desktop gives this
         * zone the question *what is the context?*, and the weigh-in history
         * FUEL-84 bounded is this screen's answer.
         *
         * `row-span-3` covers rows three, four and five. Three rather than two
         * because the fifth is the flexible one: a history longer than Progress
         * plus the entry control has to have somewhere to put its surplus, and
         * a span that stopped at row four would push the form down with it —
         * which is the fault FUEL-86 measured on `/` and fixed the same way.
         */
        <section
          className="flex flex-col gap-[14px] xl:col-start-2 xl:row-start-3 xl:row-span-3"
          data-column="aside"
        >
          <h2 className="text-micro uppercase text-text-secondary">History</h2>

          {/* § Lists: rows on the canvas, separated by hairlines. No card, no
              fill, no outer rule. */}
          <ul aria-label="Weigh-ins" className="flex flex-col">
            {history.rows.map((row) => (
              <li
                key={row.date}
                className="flex items-center justify-between gap-3 border-b border-border last:border-b-0"
              >
                {/*
                 * The row is the edit control, which is what gets it to the
                 * guide's 54px — a text button beside the figures would be a
                 * smaller target for the thing done most often here.
                 */}
                <button
                  type="button"
                  onClick={() => edit(row)}
                  /*
                   * The row the FORM is addressed at, which is the latest one
                   * only because the form opens on today. Said here because
                   * FUEL-84 and FUEL-78 both read it as "the latest entry
                   * carries aria-current": it does not, and a change that made
                   * it so would stop the marker following an entry being
                   * edited, which is the one thing it is for.
                   */
                  aria-current={row.date === date ? "true" : undefined}
                  /*
                   * The ground covers the edit control, not the whole `<li>`.
                   *
                   * § Desktop grounds a list row, and the mock's `.list .row`
                   * is a row with one target. This one has two: the edit
                   * button below and Delete beside it, pushed to opposite
                   * edges. Grounding the `<li>` on hovering either would draw
                   * one shape over two targets and say the Delete was part of
                   * what the pointer was about to press — so each control
                   * grounds exactly what it activates, and Delete takes the
                   * same first-row ground from its own Destructive variant.
                   */
                  className={`group flex min-h-[54px] min-w-0 flex-1 flex-col justify-center gap-1 py-3 text-left transition-colors duration-150 outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background ${HOVER_GROUND} ${POINTER}`}
                >
                  <span className="flex items-baseline gap-2">
                    <span className="text-value tabular-nums text-text-primary">
                      {kilograms(row.weightKg)}
                    </span>
                    <span
                      className={`truncate text-slash text-text-tertiary ${HOVER_LIFT}`}
                    >
                      {entryLabel(row.date, today)}
                    </span>
                  </span>
                  {row.note && (
                    <span
                      className={`truncate text-slash text-text-tertiary ${HOVER_LIFT}`}
                    >
                      / {row.note}
                    </span>
                  )}
                </button>

                {/*
                 * § Touch Targets: "destructive controls never sit adjacent to
                 * a frequently-tapped one". The frequently-tapped control on
                 * this screen is the primary above — Log weigh-in — and it is a
                 * whole section away. Within the row, the edit target and this
                 * one are pushed to opposite edges by `justify-between` rather
                 * than sitting side by side, and this one is § Buttons'
                 * Destructive variant: no fill, `error` text, filled only
                 * inside the confirmation sheet below.
                 */}
                <Button
                  variant="destructive"
                  size="xs"
                  onClick={() => setConfirming(row.date)}
                  // The visible word is "Delete" for everyone; the name says
                  // WHICH, because a list of seven identically-named buttons
                  // tells a screen-reader user nothing about what they are
                  // about to remove.
                  aria-label={`Delete the weigh-in for ${entryLabel(row.date, today)}`}
                >
                  Delete
                </Button>
              </li>
            ))}
          </ul>

          {/*
           * FUEL-84's way back to the rest of it.
           *
           * A step rather than a collapsible section: § Progressive Disclosure
           * rules out accordions, and it only goes one way for the same reason
           * — a list that can be folded shut again is one. The count is beside
           * the control rather than inside its label, because the label says
           * what the tap does and the tap shows a page rather than all of them.
           *
           * Gated on there being unlisted entries, so a history shorter than
           * the window renders exactly what it did before this ticket: a list,
           * and nothing underneath it.
           */}
          {unlisted > 0 && (
            <div className="flex flex-col gap-2">
              <p className="text-slash text-text-tertiary">
                / {unlisted} earlier {unlisted === 1 ? "weigh-in" : "weigh-ins"}
              </p>

              {unreachable && (
                <p role="alert" className="text-slash text-error">
                  Couldn’t load earlier weigh-ins.
                </p>
              )}

              {/* § Buttons' Text variant. The screen's one primary is "Log
                  weigh-in" and this is not competing with it. */}
              <Button
                variant="link"
                className="w-full"
                onClick={showEarlier}
                disabled={loading}
              >
                {loading ? "Loading…" : unreachable ? "Try again" : "Show earlier"}
              </Button>
            </div>
          )}
        </section>
      )}

      {/*
       * § Progressive Disclosure: "no modals" — a sheet answers every question a
       * modal would. It is also what makes the delete a two-step: the row's
       * control opens this, and nothing is removed until the button inside it.
       */}
      <Sheet
        open={confirming !== null}
        onOpenChange={(open) => !open && setConfirming(null)}
        title="Delete weigh-in"
        meta={confirming ? entryLabel(confirming, today) : undefined}
      >
        {/* The Brand Guide's own words, in § UI Copy Examples under
            Destructive. Not "Are you sure you want to do this?" — the question
            names the thing and the sentence states the consequence. */}
        <p className="text-body text-text-primary">
          Delete this weigh-in? This can’t be undone.
        </p>

        <div className="flex flex-col gap-2">
          {/*
           * The one filled destructive in the app, which is exactly what
           * § Buttons allows: "no fill; it is filled only inside a confirmation
           * sheet". Done at the call site rather than by adding a variant,
           * because widening a shared primitive for a single caller is how the
           * fill escapes the sheet it is confined to.
           */}
          <Button
            variant="destructive"
            className="w-full bg-destructive text-ink-fg hover:bg-destructive/90"
            onClick={() => {
              // Read before the state is cleared — `confirming` is what the
              // sheet was opened for, and closing it first would delete `null`.
              const date = confirming;

              setConfirming(null);

              if (date) act({ kind: "delete", date });
            }}
          >
            Delete
          </Button>

          {/* § Buttons' Text variant, and § Voice: the way out says what it
              does rather than "Cancel", which says nothing about the weigh-in. */}
          <Button variant="link" className="w-full" onClick={() => setConfirming(null)}>
            Keep it
          </Button>
        </div>
      </Sheet>
    </PageMain>
  );
}
