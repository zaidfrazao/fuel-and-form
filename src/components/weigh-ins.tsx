"use client";

import Link from "next/link";
import { startTransition, useOptimistic, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/ui/sheet";
import { WeightChart } from "@/components/weight-chart";
import { deleteWeighIn, saveWeighIn } from "@/app/actions/weight";
import type { CalendarDate } from "@/lib/date";
import { figure } from "@/lib/format";
import { entryLabel } from "@/lib/now-display";
import { MAX_NOTE_LENGTH } from "@/lib/session-entry";
import { MAX_KG, MIN_KG, parseWeighInDate, parseWeightKg } from "@/lib/weigh-in";

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

/** One weigh-in, narrowed by `app/weight/page.tsx`. No id — the date is the id. */
export type WeighInRow = {
  date: CalendarDate;
  weightKg: number;
  note: string | null;
};

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

/** § Tone of Voice: name what happened. Never "Something went wrong". */
function banner(failure: Attempt): string {
  return failure.kind === "delete" ? "Couldn’t delete that." : "Couldn’t log that.";
}

/** `77.4 kg`. One decimal, which is every bathroom scale there is. */
function kilograms(weightKg: number): string {
  return `${figure(weightKg)} kg`;
}

export function WeighIns({
  today,
  entries,
  startWeightKg,
  targetWeightKg,
}: {
  /** Today in the user's own zone — the form's default and its ceiling. */
  today: CalendarDate;
  /** Every weigh-in, newest first, from `loadWeighIns`. */
  entries: readonly WeighInRow[];
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

  // Focus moves to the weight box when a row is loaded for editing: the form is
  // above the list, so without it the user taps Edit and nothing they can see
  // changes. § Accessibility's "focus is never removed" is the same rule from
  // the other side.
  const weightBox = useRef<HTMLInputElement>(null);

  /*
   * What the screen says the history is, before the server has answered.
   *
   * One reducer over the whole list rather than a value per row, so a log and a
   * delete cannot revert independently. Both are keyed by date, which is the
   * row's address — see the module comment.
   */
  const [rows, apply] = useOptimistic(
    entries,
    (current: readonly WeighInRow[], next: Attempt) => {
      const without = current.filter((row) => row.date !== next.date);

      if (next.kind === "delete") return without;

      return [
        { date: next.date, weightKg: next.weightKg, note: next.note.trim() || null },
        ...without,
        // Newest first, matching `loadWeighIns`. Re-sorted rather than
        // prepended, because a weigh-in logged for a past date belongs where
        // that date belongs and not at the top.
      ].sort((a, b) => (a.date < b.date ? 1 : -1));
    },
  );

  /** The weigh-in already on the form's date, if there is one. */
  const existing = rows.find((row) => row.date === date);

  /**
   * The most recent reading — the figure the screen leads with.
   *
   * `rows[0]` because the list is newest first, and read into a name rather
   * than indexed twice so the empty case is stated once. FUEL-36 puts the
   * progress figures beside this; until then the number and its date are the
   * whole hero.
   */
  const latest = rows[0];

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
      if (!result.ok) setFailure(attempt);
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
    setDate(today);
  };

  /** Loads a row into the form — the "edit" half of the criterion. */
  const edit = (row: WeighInRow) => {
    setProblem({});
    setDate(row.date);
    setWeight(String(row.weightKg));
    setNote(row.note ?? "");
    weightBox.current?.focus();
  };

  const field =
    "h-11 rounded-md border border-border bg-surface px-3 text-body text-text-primary outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background aria-invalid:border-destructive";

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[640px] flex-col gap-7 px-[22px] pt-[22px] pb-[max(1.375rem,env(safe-area-inset-bottom))] md:px-7">
      <div className="flex flex-col gap-3">
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

      <section className="flex flex-col gap-[14px]">
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

              setDate(next);
              setProblem({});

              /*
               * The date is the address, so changing it changes which weigh-in
               * the form is editing — and the fields follow it. Without this,
               * moving to a date that already has a reading would leave the
               * previous one's number in the box, one tap away from
               * overwriting a measurement with a different day's.
               *
               * A date with no weigh-in clears them rather than leaving them:
               * the form is then empty, which is what "this date has nothing"
               * should look like.
               */
              const row = rows.find((entry) => entry.date === next);

              setWeight(row ? String(row.weightKg) : "");
              setNote(row?.note ?? "");
            }}
            // Today in the USER's zone, not the browser's. It is what stops a
            // future weigh-in by accident; `lib/weigh-in.ts` is what stops one
            // on purpose, since an input attribute is only a suggestion to a
            // browser.
            max={today}
            aria-invalid={problem.date ? true : undefined}
            aria-describedby={problem.date ? "weigh-in-date-error" : undefined}
            className={field}
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
            onChange={(event) => setNote(event.target.value)}
            // The same bound `parseNote` refuses past, so the refusal is
            // unreachable through the screen and is only ever a forged request.
            maxLength={MAX_NOTE_LENGTH}
            rows={2}
            placeholder="Optional — before breakfast, after the walk"
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
        <Button className="w-full" onClick={log}>
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
       * `rows`, not `entries`: these are the optimistic rows, so a logged
       * weigh-in moves the line at the same moment it appears in the list.
       * `WeightChart` renders nothing at all when there are none, which is why
       * this needs no gate of its own.
       */}
      <WeightChart
        entries={rows}
        today={today}
        startWeightKg={startWeightKg}
        targetWeightKg={targetWeightKg}
      />

      {latest && (
        <section className="flex flex-col gap-[14px]">
          <h2 className="text-micro uppercase text-text-secondary">History</h2>

          {/* § Lists: rows on the canvas, separated by hairlines. No card, no
              fill, no outer rule. */}
          <ul aria-label="Weigh-ins" className="flex flex-col">
            {rows.map((row) => (
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
                  aria-current={row.date === date ? "true" : undefined}
                  className="flex min-h-[54px] min-w-0 flex-1 flex-col justify-center gap-1 py-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                >
                  <span className="flex items-baseline gap-2">
                    <span className="text-value tabular-nums text-text-primary">
                      {kilograms(row.weightKg)}
                    </span>
                    <span className="truncate text-slash text-text-tertiary">
                      {entryLabel(row.date, today)}
                    </span>
                  </span>
                  {row.note && (
                    <span className="truncate text-slash text-text-tertiary">
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
        </section>
      )}

      {/*
       * The way back, at the foot of the reading order — the register
       * `right-now.tsx` and `training.tsx` both put their links in, and for the
       * same reason: below everything the screen is for.
       */}
      <span className="mt-auto flex items-center gap-4 pt-[30px]">
        <Link
          href="/"
          className="text-slash text-text-tertiary underline decoration-text-tertiary underline-offset-4"
        >
          Right now
        </Link>
        <Link
          href="/training"
          className="text-slash text-text-tertiary underline decoration-text-tertiary underline-offset-4"
        >
          Training
        </Link>
      </span>

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
    </main>
  );
}
