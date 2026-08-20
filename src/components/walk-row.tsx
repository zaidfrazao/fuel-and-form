"use client";

import { startTransition, useOptimistic, useState } from "react";

import { clearWalk, logWalk } from "@/app/actions/log-walk";
import { Button } from "@/components/ui/button";
import type { CalendarDate } from "@/lib/date";
import { WALK_PRESETS, type WalkEntryView } from "@/lib/walk";

/**
 * The daily walk's row — FUEL-29, PRD § P3.
 *
 * "A separate, always-present item logged with a single tap", every day
 * including weekends, with an optional duration. One component, rendered by both
 * screens that show the walk: `/`'s Anytime list and `/training`'s.
 *
 * ## Why it is shared rather than written twice
 *
 * The two screens agree about the walk in every respect that matters — the same
 * row, the same one tap, the same presets, the same way back — and they disagree
 * only about which DATE they are showing, which is a prop. Two copies would be
 * two places for the preset list to drift, and two chances for one screen to
 * offer a control the other's action would refuse.
 *
 * ## It owns its own optimism, and its own banner
 *
 * Unlike every other control on `/`, this one is not part of the card's
 * optimistic layer. It cannot be: that layer is a POSITION in the day's
 * timeline plus the log the action bar wrote, and the walk is on neither —
 * `lib/walk.ts` sets out why. So the row holds its own `useOptimistic` over its
 * own entry, which resets when the server's render arrives exactly as the card's
 * does, and reverts on a refusal the same way.
 *
 * The banner is here for the same reason, and § Feedback agrees with the
 * arrangement rather than merely tolerating it: "inline banner at the point of
 * action". The point of action is this row. It also has to be here — `/`'s
 * banner lives in the action bar, and `/training`'s bar is not rendered at all
 * on a rest day, which is precisely a day when the walk is the only thing there
 * is to log.
 *
 * ## One tap, and the duration after it
 *
 * The tap writes the row. Nothing sits between the two — no sheet, no keypad, no
 * confirmation — because "loggable in one tap" is the criterion, and a duration
 * asked for first would make it two. Once the row exists, the presets appear
 * beneath it: § Progressive Disclosure's one question per screen, with the
 * optional second question asked only after the first is answered.
 *
 * A preset that is already set clears it when tapped again. That is what makes
 * the duration genuinely optional in both directions — a walk recorded as 45
 * minutes by a mistap has a way back that is not "delete the whole row and log
 * it again" — and `aria-pressed` is what says so to a screen reader.
 */
export function WalkRow({
  date,
  entryId,
  name,
  entry,
}: {
  /** The date being logged. Today on `/`; the viewed date on `/training`. */
  date: CalendarDate;
  /**
   * The `training_template_entries` row this walk resolved from.
   *
   * The entry and never the workout, for `resolve-training.ts`'s reason: the
   * action re-resolves the date and takes the workout id from its own answer.
   */
  entryId: string;
  name: string;
  /** What is recorded, from the server. `null` until the walk is logged. */
  entry: WalkEntryView | null;
}) {
  const [shown, apply] = useOptimistic(
    entry,
    (_current: WalkEntryView | null, next: WalkEntryView | null) => next,
  );

  /**
   * The attempt that failed, so "Try again" re-runs the same one.
   *
   * `right-now.tsx`'s arrangement and `training.tsx`'s: a failure is stored as
   * the tap rather than as a message, because a retry has to write what was
   * refused and not what the row happens to show a minute later.
   */
  const [failure, setFailure] = useState<WalkEntryView | null | undefined>(undefined);

  /**
   * Writes what the row should say, and says it on this frame.
   *
   * `null` is the revert — the row going back to unlogged — and an entry is a
   * log, with or without a duration. One function for both, because they are one
   * statement on the server too: `logWalk` upserts and `clearWalk` deletes, and
   * which of them runs is decided by what the row is being asked to become.
   */
  const act = (next: WalkEntryView | null) => {
    setFailure(undefined);

    startTransition(async () => {
      apply(next);

      // The `try` covers the CALL, not the action. Both actions catch everything
      // themselves and answer `{ ok: false }` — but reaching them is a network
      // request, and that request can fail on its own: no signal on the way back
      // from a walk, a dropped connection, a cold start that times out. Those
      // reject rather than resolve, and an escaping rejection would revert the
      // row with nothing on screen to say why. `right-now.tsx` carries the same
      // wrapper for the same reason.
      try {
        const result = next
          ? await logWalk({ date, entryId, durationMin: next.durationMin })
          : await clearWalk({ date, entryId });

        // The transition wrapper is not optional: React does not treat a state
        // update after an `await` as part of the transition it was started in,
        // so without it the banner paints a frame before the optimistic value
        // reverts — the message arriving over a row that is about to change
        // back.
        if (!result.ok) startTransition(() => setFailure(next));
      } catch {
        startTransition(() => setFailure(next));
      }
    });
  };

  return (
    <li className="flex flex-col border-b border-border last:border-b-0">
      <div className="flex min-h-[54px] items-center justify-between gap-4 py-3">
        <span className="truncate text-body text-text-primary">{name}</span>

        {shown ? (
          /*
           * § Accessibility's "never colour alone" and § The Governing
           * Principle's equal visual weight, taken the same way `training.tsx`'s
           * `Recorded` takes them: what changes is the word, not the colour.
           *
           * `role="status"` — a polite live region — so a walk logged by a tap
           * is announced without moving focus, and what is announced is the
           * optimistic value, which is what the screen is showing.
           */
          <span role="status" className="text-micro uppercase text-text-secondary">
            Done
            {shown.durationMin !== null && (
              <span className="tabular-nums"> · {shown.durationMin} min</span>
            )}
          </span>
        ) : (
          /*
           * Secondary, not primary. § Buttons allows one primary per screen and
           * on both screens that button is already spoken for — "Log eaten" on
           * `/`, "Mark done" on `/training` — so the walk's control is the
           * outlined variant. `xs` is 44px, the touch minimum, which is what
           * keeps a control this size legal inside a 54px row.
           */
          <Button
            variant="secondary"
            size="xs"
            className="shrink-0"
            onClick={() => act({ durationMin: null })}
          >
            Log walk
          </Button>
        )}
      </div>

      {shown && (
        <div className="flex flex-wrap items-center gap-2 pb-3">
          {WALK_PRESETS.map((minutes) => (
            <Button
              key={minutes}
              variant="secondary"
              size="xs"
              // Which duration is set is said in WORDS, by the status above,
              // and not by promoting one of these buttons. `training.tsx` makes
              // the same call for its three statuses and gives the reason:
              // moving which button is emphasised shifts the row under the
              // reader's thumb between renders. `aria-pressed` is how the same
              // fact reaches a screen reader.
              aria-pressed={shown.durationMin === minutes}
              // Tapping the preset that is already set clears the duration
              // rather than rewriting it — the way back from a mistap that is
              // not "take the whole walk back and log it again".
              onClick={() =>
                act({ durationMin: shown.durationMin === minutes ? null : minutes })
              }
            >
              {minutes} min
            </Button>
          ))}

          {/* Tertiary, so the Text variant — § Buttons gives that one to Revert,
              and this is the same kind of thing: the way back from a tap that
              was made, for the uncommon case where it was the wrong one. */}
          <Button variant="link" className="ml-auto shrink-0" onClick={() => act(null)}>
            Undo
          </Button>
        </div>
      )}

      {failure !== undefined && (
        <div
          role="alert"
          className="flex items-center justify-between gap-3 pb-3"
        >
          {/* § Tone of Voice: name what happened. Never "Something went wrong". */}
          <p className="text-slash text-error">
            {failure === null ? "Couldn’t undo that." : "Couldn’t save that."}
          </p>
          <Button variant="link" size="xs" onClick={() => act(failure)}>
            Try again
          </Button>
        </div>
      )}
    </li>
  );
}
