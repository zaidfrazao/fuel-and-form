import { addDays, type CalendarDate, parseCalendarDate } from "./date";
import { type Inline, plain } from "./recipe";

/**
 * What is on the counter and which steps are done — FUEL-144, Brand Guide
 * § Recipe.
 *
 * Held on this device only, in `localStorage`, decided over a table on
 * 2026-10-01: a tick is where the cook is standing, not a fact about the meal,
 * and it is worthless by tomorrow. This module is the pure half — the key, what
 * a tick is called, and how a stored value is read. `recipe-prep.tsx` is the
 * half that touches the browser.
 *
 * ## Keyed by who, which day and which meal
 *
 * `fuel:prep:{userId}:{date}:{mealId}`. The date is the plan's, so tomorrow's
 * breakfast starts empty even when it is today's breakfast again; the user is
 * in it so a demo session on the owner's phone does not open on the owner's
 * ticks. Meal ids are per account, so the user is belt to that braces — but a
 * demo's meal ids are never the owner's, and nothing here should depend on it.
 *
 * ## A tick names what it ticked
 *
 * An ingredient is its row id. A step is its position AND a hash of its text,
 * so a seed edit that inserts a step or rewords one cannot slide a tick onto a
 * step the cook has not done: the edited step's id no longer matches, and the
 * tick is dropped on read rather than moved.
 */

export const PREP_PREFIX = "fuel:prep:";

/** How long a day's ticks are kept, counted back from today. */
export const KEEP_DAYS = 7;

export const prepKey = (userId: string, date: CalendarDate, mealId: string): string =>
  `${PREP_PREFIX}${userId}:${date}:${mealId}`;

export const ingredientTickId = (rowId: string): string => `i:${rowId}`;

export const stepTickId = (index: number, step: readonly Inline[]): string =>
  `s:${index}:${fnv1a(plain(step))}`;

/**
 * FNV-1a, 32-bit, as hex. Not for security — two steps would have to collide
 * at the same position in the same recipe for it to matter, and the cost if
 * they did is one tick surviving an edit.
 */
function fnv1a(text: string): string {
  let hash = 0x811c9dc5;

  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }

  return (hash >>> 0).toString(16).padStart(8, "0");
}

/**
 * The ticks a stored value holds, among the ones this screen can draw.
 *
 * The value is whatever was left in `localStorage` — by this code, by an older
 * build of it, or by hand — so it is read as untrusted, on `parseMoved`'s
 * terms: anything that is not `{ ticked: string[] }` is no ticks, an id the
 * screen does not know is dropped, and nothing here throws.
 */
export function parsePrep(raw: string | null, known: ReadonlySet<string>): Set<string> {
  const out = new Set<string>();
  if (!raw) return out;

  let value: unknown;

  try {
    value = JSON.parse(raw);
  } catch {
    return out;
  }

  if (typeof value !== "object" || value === null) return out;

  const ticked = (value as { ticked?: unknown }).ticked;
  if (!Array.isArray(ticked)) return out;

  for (const id of ticked) {
    if (typeof id === "string" && known.has(id)) out.add(id);
  }

  return out;
}

/** The value to store, or null to remove the key — an empty list is no list. */
export function serialisePrep(ticked: ReadonlySet<string>): string | null {
  if (ticked.size === 0) return null;

  return JSON.stringify({ ticked: [...ticked].sort() });
}

/**
 * The prep keys to delete: older than `KEEP_DAYS` before today, or not readable
 * as a prep key at all. Keys outside the prefix are never touched — the rest
 * of `localStorage` is `/training`'s and the demo banner's.
 *
 * A date after today is kept. The plan is browsable a week ahead, and a tick
 * on next Monday's prep is still a tick someone made on purpose.
 */
export function staleKeys(keys: Iterable<string>, today: CalendarDate): string[] {
  const oldest = addDays(today, -KEEP_DAYS);

  return [...keys].filter((key) => {
    if (!key.startsWith(PREP_PREFIX)) return false;

    const date = key.slice(PREP_PREFIX.length).split(":")[1];
    if (date === undefined || !isCalendarDate(date)) return true;

    return date < oldest;
  });
}

function isCalendarDate(value: string): boolean {
  try {
    parseCalendarDate(value);
    return true;
  } catch {
    return false;
  }
}
