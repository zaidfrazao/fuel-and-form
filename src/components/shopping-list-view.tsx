"use client";

import { startTransition, useOptimistic, useState } from "react";

import { Button } from "@/components/ui/button";
import { setChecked } from "@/app/actions/shopping";
import type { CalendarDate } from "@/lib/date";
import { HOVER_GROUND, HOVER_LIFT, POINTER } from "@/lib/pointer";
import type { ShoppingGroup, ShoppingLine } from "@/lib/shopping-list";
import { quantity, shoppingText } from "@/lib/shopping-text";

/**
 * The week's shopping, as a list you can tick — P8, FUEL-45.
 *
 * § Lists, exactly: "rows on the canvas, separated by hairlines. No card, no
 * fill, no outer rule. 54px minimum; 46px in dense contexts (ingredients,
 * exercises)". Ingredients are one of the two dense contexts the guide names,
 * so the rows are 46px, which also clears § Accessibility's 44px touch minimum
 * with nothing to spare and nothing wasted.
 *
 * ## Why this is a client component at all
 *
 * The list itself is server-rendered data and could have been a Server
 * Component with a form per row. It is not, because § Feedback asks for
 * optimism — "the PRD budgets 300ms and optimism is how that is met" — and a
 * shop is the one screen in this app where taps come in a run: half a dozen
 * ticks in the time it takes to walk an aisle, each one wanting the row to
 * change on the frame it was tapped rather than after a round trip.
 *
 * ## One optimistic map, not one `useOptimistic` per row
 *
 * `week-grid.tsx` made the same call and states the reason: separate optimistic
 * values revert independently, which can leave the screen in a combination
 * neither the server nor the user ever asked for. Here it would be two rows
 * disagreeing about whether a failed batch happened. One map over the whole
 * list means the answer is always internally consistent.
 */

/** A tick, or its removal — what one tap asks for. */
type Attempt = { key: string; checked: boolean };

/**
 * The ticked keys, with one attempt applied.
 *
 * A new `Set` rather than a mutation: React compares the value to decide
 * whether to re-render, and mutating the one it already holds would make the
 * optimistic update invisible on the frame it matters.
 */
function applyTick(current: ReadonlySet<string>, attempt: Attempt): ReadonlySet<string> {
  const next = new Set(current);

  if (attempt.checked) next.add(attempt.key);
  else next.delete(attempt.key);

  return next;
}

/* -------------------------------------------------------------------------- */
/* One row                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * One line of the list, and the control that ticks it.
 *
 * ## A real checkbox, hidden but present
 *
 * `sr-only` rather than `appearance-none`, with the visible mark drawn beside
 * it off the `peer-checked:` state. That keeps the element a native checkbox:
 * space toggles it, a screen reader announces it as checked, and the browser's
 * own focus handling applies — none of which a `div` with `role="checkbox"`
 * gets without reimplementing it, and each of which is a thing to get subtly
 * wrong. § Accessibility's focus ring is drawn from `peer-focus-visible:` for
 * the same reason: the ring belongs on what is focused, and what is focused is
 * the input.
 *
 * The whole row is the `<label>`, so the target is the full 46px width rather
 * than a 20px box someone has to hit while holding a basket.
 *
 * ## Checked is a shape, not a colour
 *
 * The name goes `text-tertiary` AND gains a line-through. § Accessibility:
 * "never colour alone" — the strike survives greyscale and a dimmed name alone
 * would not. The tick itself is `ink`, which is § Actions' rule ("ink, not
 * colour") and leaves the screen's one accent unspent; § Deliberately Absent
 * rules out the filled status pill that would otherwise be the obvious way to
 * say "done".
 */
function Row({
  line,
  checked,
  failed,
  onToggle,
}: {
  line: ShoppingLine;
  checked: boolean;
  /** The attempt that failed on this row, if one did. */
  failed: Attempt | undefined;
  onToggle: (attempt: Attempt) => void;
}) {
  const amount = quantity(line);

  return (
    <li className="flex flex-col border-b border-border last:border-b-0">
      {/*
       * `items-start` with the height made of padding rather than of centring.
       *
       * A row that can now take two lines has to decide what the tick box lines
       * up with, and the answer is the NAME — it is what you scan the list
       * against, and a box centred on a three-line row sits beside the quantity
       * instead, which is FUEL-80's own complaint one level down.
       *
       * `items-center` cannot say that, so the vertical centring of a
       * single-line row moves into the padding, where it is arithmetic rather
       * than alignment: § Lists' 46px is 23px of `text-body` line box (fixed by
       * the token, so it holds whether or not the font has loaded) plus 11.5px
       * above and below. `min-h-[46px]` stays as the floor that guarantees
       * § Touch Targets even if that arithmetic ever stops being true.
       */}
      {/*
       * The pointer — Brand Guide § Desktop, "Pointer states". § Desktop's
       * first row names both "list rows" and "checkboxes", and this control is
       * both: a 46px row whose whole area is the label for the box inside it.
       * The ground goes on the row, because that is what the pointer presses;
       * the box takes the border darkening the mock draws for `.cbx:hover` and
       * not a second ground, which on a row already grounded would be `surface`
       * over `surface` — "a control that does not answer".
       *
       * `cursor-pointer` was the app's ONLY one before FUEL-75, and it was
       * already here rather than anywhere it was needed. It is now the constant
       * every other control uses.
       */}
      <label
        className={`group flex min-h-[46px] items-start gap-3 py-[11.5px] transition-colors duration-150 ${HOVER_GROUND} ${POINTER}`}
      >
        <input
          type="checkbox"
          className="peer sr-only"
          checked={checked}
          onChange={(event) => onToggle({ key: line.key, checked: event.target.checked })}
        />

        {/*
         * The mark. `aria-hidden` because the input beside it already carries
         * the state to the accessibility tree, and a second announcement of the
         * same fact is noise.
         *
         * The tick is an SVG path rather than a glyph so it inherits `ink-fg`
         * cleanly at any size and does not depend on a font having a checkmark
         * at the weight this needs.
         *
         * `mt-[2.5px]` is the rest of the label's arithmetic: the box is 18px
         * and the line it belongs beside is 23px, so half the difference centres
         * it on that line rather than hanging it from the top of one.
         */}
        <span
          aria-hidden
          // The tick's own visibility is reached through `[&>svg]`, not through
          // a second `peer-checked:` on the svg itself: `peer-*` compiles to a
          // SIBLING combinator, and the svg is a CHILD of this span rather than
          // a sibling of the input, so `peer-checked:opacity-100` on it would
          // never match and the box would fill with an invisible tick in it.
          className={`mt-[2.5px] flex size-[18px] shrink-0 items-center justify-center rounded-[4px] border border-border [&>svg]:opacity-0 group-hover:border-text-secondary peer-checked:border-ink peer-checked:bg-ink peer-checked:[&>svg]:opacity-100 peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-accent`}
        >
          <svg viewBox="0 0 12 12" className="size-[10px] text-ink-fg">
            <path
              d="M2 6.2 4.6 8.8 10 3.4"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </span>

        {/*
         * Name and amount, on one line while they both fit and on two when they
         * do not.
         *
         * ## What the cap fixed, and what it cost
         *
         * The amount was `shrink-0` with no bound, and until FUEL-65 that was
         * all it was — including when the AMOUNT was the long one.
         * `shopping-text.ts` composes household measures onto the weight, so
         * these run to "800g · 2/3–3/4 cup, or a small handful", and a span that
         * refuses to shrink simply left the row: measured at 375px, four lines
         * reached 487px and the whole page scrolled 112px sideways to follow
         * them. `max-w-[55%] truncate` stopped that, and the ellipsis was argued
         * for the amount specifically — the weight leads the string, so what an
         * ellipsis takes is the parenthetical, which is the half § Slash
         * Metadata calls secondary.
         *
         * That argument was sound and it was only ever about the amount. The
         * name beside it was `flex-1 truncate`, and with the amount entitled to
         * 55% of a 301px content box the name was left ~136px and lost: measured
         * at 375px, 34 of 58 rows clipped, and `Bell pepper, red or …` does not
         * tell you which pepper to buy. A cap that protects one half by clipping
         * the other is a trade, not a fix, and the half it clipped is the
         * primary content — FUEL-80.
         *
         * ## Wrapping instead of clipping, and why not simply a taller row
         *
         * Nothing here refuses to shrink and nothing carries a width cap, so the
         * overflow FUEL-65 measured cannot return: a flex line that does not fit
         * WRAPS, and `min-w-0` plus `break-words` mean even a single unbroken
         * token wider than the row breaks rather than pushing the page out.
         * What was an ellipsis is now a second line.
         *
         * Wrapping rather than a permanent second line, because the condition is
         * the whole point. § Lists gives ingredients the 46px dense height and
         * this list is ~58 rows; stacking every one of them to fix the ~34 that
         * overflow would spend that height on "Spinach · 200g", which has always
         * fit. A wrapped row grows only where the text genuinely does not fit.
         *
         * It is also why there is no breakpoint here. The row composes off the
         * width it is given, so it needs no opinion about which width is a phone
         * — which is what lets it sit inside FUEL-78's desktop columns without
         * the two having to agree about a number.
         *
         * `ml-auto` keeps the amount hard right on whichever line it lands, so
         * the tabular figures still line up down the aisle when some rows have
         * wrapped and others have not.
         */}
        <span className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-3">
          <span
            className={
              checked
                ? `min-w-0 break-words text-body text-text-tertiary line-through ${HOVER_LIFT}`
                : "min-w-0 break-words text-body text-text-primary"
            }
          >
            {line.name}
          </span>

          {/*
           * § Slash Metadata's register: the amount is secondary to the name,
           * and it is what the eye lands on second. Tabular figures so a column
           * of weights lines up down the aisle.
           *
           * Absent entirely rather than an em dash when a line has no quantity —
           * `shopping-text.ts` argues it: for salt, the name IS the instruction.
           */}
          {amount && (
            <span
              className={`ml-auto min-w-0 break-words text-slash tabular-nums text-text-secondary ${HOVER_LIFT}`}
            >
              {amount}
            </span>
          )}
        </span>
      </label>

      {failed && (
        <div role="alert" className="flex items-center justify-between gap-3 pb-2">
          {/* § Tone of Voice: name what happened. Never "Something went wrong". */}
          <p className="text-slash text-error">
            {failed.checked ? "Couldn’t tick that off." : "Couldn’t put that back."}
          </p>
          <Button variant="link" size="xs" onClick={() => onToggle(failed)}>
            Try again
          </Button>
        </div>
      )}
    </li>
  );
}

/* -------------------------------------------------------------------------- */
/* Copy                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * The list as plain text, on the clipboard — P8's last criterion.
 *
 * ## Success is not silent here, and that is a deliberate departure
 *
 * § Feedback says success is silent, because "the UI reflecting the new state
 * *is* the confirmation". That reasoning presumes there is a new state on
 * screen. A clipboard write leaves the screen identical, so silence is
 * indistinguishable from the button having done nothing — which is exactly what
 * a person would then check by tapping it again. The word "Copied" is the
 * smallest thing that closes that loop, and it is a `role="status"` so it is
 * announced rather than only seen.
 *
 * ## Every way this fails is the same answer
 *
 * `navigator.clipboard` is absent outside a secure context, and `writeText`
 * rejects when the document is not focused or permission is refused. All three
 * take § Feedback's inline failure, because a person's next move is identical
 * in each case and none of them is worth explaining on a shopping screen.
 */
function CopyButton({ text }: { text: string }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");

  const copy = () => {
    // Read out and checked rather than called through `?.`: `navigator.clipboard`
    // is undefined outside a secure context, and an optional call there yields
    // `undefined` rather than a promise — so the `.then` chain would be skipped
    // silently and the button would appear to do nothing at all.
    const clipboard = navigator.clipboard;

    if (!clipboard) {
      setState("failed");

      return;
    }

    // Two callbacks rather than `.then().catch()`: a `catch` after a `then`
    // also catches anything the success handler throws, which would report a
    // failed copy for a copy that succeeded.
    void clipboard.writeText(text).then(
      () => setState("copied"),
      () => setState("failed"),
    );
  };

  return (
    <div className="flex items-center gap-3">
      <Button variant="outline" onClick={copy}>
        Copy as text
      </Button>

      {state !== "idle" && (
        <p
          role="status"
          className={state === "copied" ? "text-slash text-text-secondary" : "text-slash text-error"}
        >
          {state === "copied" ? "Copied." : "Couldn’t copy that."}
        </p>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* The list                                                                   */
/* -------------------------------------------------------------------------- */

export function ShoppingListView({
  week,
  groups,
  checked,
}: {
  /** The Monday the ticks are stored against. Sent with every tap. */
  week: CalendarDate;
  groups: readonly ShoppingGroup[];
  /** The keys already ticked, from the server. */
  checked: readonly string[];
}) {
  const [ticked, tick] = useOptimistic<ReadonlySet<string>, Attempt>(
    new Set(checked),
    applyTick,
  );

  /**
   * The attempt that failed, so "Try again" re-runs the same one.
   *
   * `walk-row.tsx`'s arrangement and `right-now.tsx`'s: a failure is stored as
   * the tap rather than as a message, because a retry has to write what was
   * refused and not what the row happens to show a moment later.
   */
  const [failure, setFailure] = useState<Attempt | undefined>(undefined);

  const onToggle = (attempt: Attempt) => {
    setFailure(undefined);

    startTransition(async () => {
      tick(attempt);

      // The `try` covers the CALL, not the action. The action catches
      // everything itself and answers `{ ok: false }` — but reaching it is a
      // network request, and a shop is exactly where that request fails: a
      // supermarket basement with one bar of signal. Those reject rather than
      // resolve, and an escaping rejection would revert the row with nothing on
      // screen to say why.
      try {
        const result = await setChecked({ week, key: attempt.key, checked: attempt.checked });

        // The transition wrapper is not optional: React does not treat a state
        // update after an `await` as part of the transition it was started in,
        // so without it the banner paints a frame before the optimistic value
        // reverts — the message arriving over a row that is about to change
        // back. `walk-row.tsx` carries the same wrapper for the same reason.
        if (!result.ok) startTransition(() => setFailure(attempt));
      } catch {
        startTransition(() => setFailure(attempt));
      }
    });
  };

  return (
    <div className="flex flex-col gap-7">
      {groups.map((group) => (
        <section key={group.category} className="flex flex-col gap-1">
          {/*
           * § Micro labels are "permitted only where the value sits adjacent at
           * 22px or more — never for standalone information". An aisle heading
           * is standalone, so it takes Slash rather than Micro, in caps for the
           * heading reading and `text-secondary` so it sits under the names it
           * groups rather than competing with them.
           */}
          <h2 className="text-slash uppercase tracking-[0.16em] text-text-secondary">
            {group.category}
          </h2>

          <ul className="flex flex-col">
            {group.lines.map((line) => (
              <Row
                key={line.key}
                line={line}
                checked={ticked.has(line.key)}
                failed={failure?.key === line.key ? failure : undefined}
                onToggle={onToggle}
              />
            ))}
          </ul>
        </section>
      ))}

      {/*
       * Below the list rather than above it: the copy is of what has just been
       * read, and § Progressive Disclosure's "one question per screen" makes
       * the list the question. The text is computed from the OPTIMISTIC set, so
       * a copy taken immediately after a tap carries the tick that tap made.
       */}
      <CopyButton text={shoppingText(groups, ticked)} />
    </div>
  );
}
