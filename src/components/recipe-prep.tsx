"use client";

import { useEffect, useRef, useSyncExternalStore } from "react";

import { Blocks, Quiet, Runs, Section } from "@/components/recipe-parts";
import { TickMark } from "@/components/tick-mark";
import { type CalendarDate, toCalendarDate } from "@/lib/date";
import type { RecipeIngredient } from "@/lib/db/queries/recipe";
import { FOCUS_RING, HOVER_GROUND, HOVER_LIFT, HOVER_LINK, POINTER } from "@/lib/pointer";
import {
  ingredientTickId,
  parsePrep,
  PREP_PREFIX,
  prepKey,
  serialisePrep,
  staleKeys,
  stepTickId,
} from "@/lib/prep-ticks";
import type { Method } from "@/lib/recipe";

/**
 * The recipe's two lists as checklists — FUEL-144, Brand Guide § Recipe.
 *
 * Ingredients tick onto the counter, steps tick off as done, and each list
 * counts itself. One island for both because the two counts and Clear share
 * one stored value: a Clear that reached only one list would be half a reset.
 *
 * ## Where a tick lives
 *
 * `localStorage`, under `prepKey` — see `prep-ticks.ts` for the key and why a
 * tick is named by what it ticked. Read through `useSyncExternalStore` on the
 * stored STRING, as `/training` reads its keys: the server has no storage and
 * renders no ticks, hydration matches it, and the client's snapshot follows.
 *
 * **Without a date there is nothing to keep.** A recipe opened from the
 * library — a bookmark, a bare `/recipe/{id}` — is no day's meal, so its ticks
 * are held in memory for as long as the tab is, and a reload starts clean.
 * The lists stay drawn: a recipe without a plan is still cooked from.
 *
 * **When storage refuses** — a Safari private window, blocked site data, a
 * full quota — the tick is held in the same memory instead, so the list still
 * works while the page is open. Every access is wrapped; a screen that could
 * not render because it could not remember a tick would be the worse answer.
 */
export function RecipePrep({
  userId,
  mealId,
  date,
  ingredients,
  method,
}: {
  userId: string;
  mealId: string;
  /** The plan's date. Null is the library's view, kept in memory only. */
  date: CalendarDate | null;
  ingredients: readonly RecipeIngredient[];
  method: Method | null;
}) {
  const key = date ? prepKey(userId, date, mealId) : `${PREP_PREFIX}${userId}:library:${mealId}`;
  const persist = date !== null;

  const ingredientIds = ingredients.map((row) => ingredientTickId(row.id));
  const stepIds = method ? method.steps.map((step, i) => stepTickId(i, step)) : [];

  const raw = useSyncExternalStore(
    subscribe,
    () => read(key, persist),
    () => null,
  );
  const ticked = parsePrep(raw, new Set([...ingredientIds, ...stepIds]));

  const firstBox = useRef<HTMLInputElement>(null);

  useEffect(prune, []);

  const toggle = (id: string, on: boolean) => {
    const next = new Set(ticked);
    if (on) next.add(id);
    else next.delete(id);
    write(key, persist, serialisePrep(next));
  };

  const clear = () => {
    write(key, persist, null);
    // The button unmounts with the last tick, which would drop focus to
    // <body>. The first box is where the cook starts over, and `preventScroll`
    // keeps the page where they are reading.
    firstBox.current?.focus({ preventScroll: true });
  };

  const count = (ids: readonly string[]) => ({
    done: ids.filter((id) => ticked.has(id)).length,
    of: ids.length,
  });

  return (
    <>
      <Section
        label="Ingredients"
        count={ingredients.length > 0 ? count(ingredientIds) : undefined}
      >
        {ingredients.length > 0 ? (
          <ul className="flex flex-col">
            {ingredients.map((row, i) => {
              const id = ingredientIds[i]!;
              const checked = ticked.has(id);

              return (
                <li key={row.id} className="border-b border-border last:border-b-0">
                  {/* `/shopping`'s row: the whole row is the label, the input
                      is native and hidden, the mark is drawn off it. 46px is
                      23px of body line plus 11.5px either side, § Lists'
                      dense row. */}
                  <label
                    className={`group flex min-h-[46px] items-start gap-3 py-[11.5px] transition-colors duration-150 ${HOVER_GROUND} ${POINTER}`}
                  >
                    <input
                      ref={i === 0 ? firstBox : undefined}
                      type="checkbox"
                      className="peer sr-only"
                      checked={checked}
                      onChange={(event) => toggle(id, event.target.checked)}
                    />
                    <TickMark />

                    <span className="flex min-w-0 flex-1 flex-col">
                      {/* Checked is a shape, not a colour: the strike survives
                          greyscale, § Accessibility. */}
                      <span
                        className={
                          checked
                            ? `text-body text-text-tertiary line-through ${HOVER_LIFT}`
                            : "text-body text-text-primary"
                        }
                      >
                        {row.name}
                      </span>
                      {row.nonScaleMeasure && (
                        <span className={`text-body text-text-secondary ${HOVER_LIFT}`}>
                          {row.nonScaleMeasure}
                        </span>
                      )}
                    </span>
                    {row.grams !== null && (
                      <span
                        className={`shrink-0 text-body tabular-nums text-text-secondary ${HOVER_LIFT}`}
                      >
                        {row.grams} g
                      </span>
                    )}
                  </label>
                </li>
              );
            })}
          </ul>
        ) : (
          <Quiet>No ingredients recorded.</Quiet>
        )}
      </Section>

      <Section label="Method" count={method ? count(stepIds) : undefined}>
        {method ? (
          <div className="flex flex-col gap-5">
            {method.before.length > 0 && <Blocks blocks={method.before} />}

            <ol className="flex flex-col">
              {method.steps.map((step, i) => {
                const id = stepIds[i]!;
                const checked = ticked.has(id);

                return (
                  <li key={id}>
                    {/* A step is a paragraph, so still no hairline between
                        them (§ Recipe); the 10.5px either side is what makes
                        a one-line step a 44px target. */}
                    <label
                      className={`group flex min-h-[44px] gap-3 py-[10.5px] text-body transition-colors duration-150 ${HOVER_GROUND} ${POINTER}`}
                    >
                      <input
                        ref={i === 0 && ingredients.length === 0 ? firstBox : undefined}
                        type="checkbox"
                        className="peer sr-only"
                        checked={checked}
                        onChange={(event) => toggle(id, event.target.checked)}
                      />
                      <TickMark />

                      {/* The number is its own column so a wrapped line hangs
                          under the step's text, not under its number. Hidden
                          from the tree: an `<ol>` already announces "1 of 10",
                          and it would otherwise lead the checkbox's name. */}
                      <span
                        aria-hidden
                        className={`w-[2ch] shrink-0 text-right tabular-nums text-text-secondary ${HOVER_LIFT}`}
                      >
                        {i + 1}
                      </span>
                      <span
                        className={
                          checked
                            ? `min-w-0 flex-1 text-text-tertiary line-through ${HOVER_LIFT}`
                            : "min-w-0 flex-1 text-text-primary"
                        }
                      >
                        <Runs inline={step} />
                      </span>
                    </label>
                  </li>
                );
              })}
            </ol>

            {method.after.length > 0 && <Blocks blocks={method.after} tone="secondary" />}
          </div>
        ) : (
          <Quiet>No method recorded.</Quiet>
        )}
      </Section>

      {/* Drawn only with something to clear — a control that resets nothing
          is a control that does nothing. 44px tall for § Touch Targets. */}
      {ticked.size > 0 && (
        <div className="-mt-4 flex">
          <button
            type="button"
            onClick={clear}
            className={`inline-flex min-h-11 items-center text-body text-text-secondary underline decoration-text-tertiary underline-offset-4 ${HOVER_LINK} ${POINTER} ${FOCUS_RING}`}
          >
            Clear ticks
          </button>
        </div>
      )}
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* The store                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Ticks the browser would not keep, or was never asked to: the library's view,
 * and any key whose last write storage refused. A key in `held` is read from
 * here and not from storage, so a refused write cannot be shadowed by an older
 * value storage still has.
 */
const memory = new Map<string, string>();
const held = new Set<string>();

const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  window.addEventListener("storage", listener);

  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}

function read(key: string, persist: boolean): string | null {
  if (!persist || held.has(key)) return memory.get(key) ?? null;

  try {
    return window.localStorage.getItem(key);
  } catch {
    return memory.get(key) ?? null;
  }
}

function write(key: string, persist: boolean, value: string | null): void {
  const hold = () => {
    held.add(key);
    if (value === null) memory.delete(key);
    else memory.set(key, value);
  };

  if (!persist) hold();
  else {
    try {
      if (value === null) window.localStorage.removeItem(key);
      else window.localStorage.setItem(key, value);
      held.delete(key);
      memory.delete(key);
    } catch {
      hold();
    }
  }

  for (const listener of listeners) listener();
}

/**
 * Deletes prep keys more than a week old, once per page load — the ticket's
 * "storage doesn't grow forever". Today is the browser's, which is the zone
 * the cook is standing in; a wrong guess by a day keeps a key a day longer.
 */
let pruned = false;

function prune(): void {
  if (pruned) return;
  pruned = true;

  try {
    const storage = window.localStorage;
    const keys = Array.from({ length: storage.length }, (_, i) => storage.key(i)).filter(
      (key): key is string => key !== null,
    );
    const today = toCalendarDate(new Date(), Intl.DateTimeFormat().resolvedOptions().timeZone);

    for (const key of staleKeys(keys, today)) storage.removeItem(key);
  } catch {
    // Nothing to prune in storage that cannot be read.
  }
}

/** For tests: forget what memory holds and that pruning has run. */
export function resetPrepStore(): void {
  memory.clear();
  held.clear();
  pruned = false;
}
