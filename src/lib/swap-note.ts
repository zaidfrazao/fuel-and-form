import { signed } from "./format";
import { type MacroBearing, round1, totalMacros } from "./macros";

/**
 * The sentence under a swapped meal — Brand Guide § UI Copy Examples:
 *
 *     Swapped. −21g protein, −140 kcal today.
 *
 * and explicitly NOT `No problem! We've updated your plan.`
 *
 * ## Why this is a persistent line and not a toast
 *
 * § Feedback says routine success is silent, "the UI reflecting the new state
 * *is* the confirmation" — and `components/ui/sonner.tsx` is installed but
 * deliberately unmounted on the strength of it. That looks like it contradicts
 * the copy example above, and it does not, because this line is not an
 * acknowledgement of a tap. It is the STATE of a slot that has diverged from the
 * template: derived from resolution, present for as long as the override is,
 * still there after a reload and in a tab that did not perform the swap.
 *
 * The consequence worth stating: the caller passes what the TEMPLATE plans and
 * what is planned NOW, never "the meal that was on screen a second ago". A note
 * built from the latter would be right once and wrong on every subsequent
 * render, which is exactly the class of bug a toast hides and a persistent line
 * exposes.
 *
 * ## What it does not say
 *
 * No apology, no reassurance, no praise, and no framing of a swap as a slip
 * (§ Content Guidelines, "Don't"). It also does not name the two meals: both are
 * already on the screen — the new one as the card's title, the old one as the
 * thing the Revert control offers to bring back — and repeating them would push
 * the numbers, which are the part that is genuinely not visible anywhere else,
 * to the end of a longer sentence.
 *
 * Only protein and kcal, in that order, because that is the guide's example and
 * because they are the two figures the PRD's § Problem Statement is about
 * ("swaps silently break macros"). Fat and carbs are one tap away in the
 * sheet's totals grid, against target, which is where a four-value comparison
 * belongs.
 */

/** The bare sentence, for a swap whose macros land exactly where they started. */
const UNCHANGED = "Swapped.";

/**
 * How the day changed, in one sentence.
 *
 * `from` is what the template plans for the slot — `templateSlot()`'s answer —
 * and `null` when the template plans nothing there. That is not an edge case to
 * be defended against: a swap into an empty slot is "a real action, an extra
 * meal, today only" (resolve-plan.ts), and the day genuinely gains the whole of
 * it, so the delta is the meal itself. Treating `null` as zero macros is the
 * arithmetic saying so rather than a fallback covering something up.
 *
 * `to` is what is planned now. The delta is `to − from`, the same signed
 * convention as everywhere else in the app: under is negative, over positive,
 * so `−21g protein` needs no sentence around it to be read correctly.
 *
 * Both figures go through `totalMacros`, which is what makes an untracked meal
 * contribute nothing here exactly as it contributes nothing to the day's totals
 * — a swap to an untracked meal reads as the loss of what it displaced, which
 * is true, rather than as an unexplained zero.
 *
 * A clause whose delta is zero is dropped, and a swap that changes neither is
 * the bare "Swapped." — stating `−0g protein` would be reporting a change that
 * did not happen, and "no person for facts" leaves nothing else to say.
 */
export function swapNote(from: MacroBearing | null, to: MacroBearing): string {
  const before = totalMacros(from ? [from] : []);
  const after = totalMacros([to]);

  // Rounded figures subtracted, never the difference of two raw ones. The
  // numbers on screen elsewhere are the rounded ones, so a delta taken from the
  // originals could disagree with them by a tenth — the reader would be able to
  // see that the sentence and the totals grid above it do not add up.
  const protein = round1(after.proteinG - before.proteinG);
  const kcal = round1(after.kcal - before.kcal);

  const clauses = [
    protein !== 0 && `${signed(protein)}g protein`,
    kcal !== 0 && `${signed(kcal)} kcal`,
  ].filter((clause): clause is string => clause !== false);

  return clauses.length === 0 ? UNCHANGED : `Swapped. ${clauses.join(", ")} today.`;
}
