import type { MotifName } from "@/components/motifs";
import type { Meal, MealSlot } from "@/lib/db/schema";

/**
 * Which of the eight marks stands for a meal — Brand Guide § Materials.
 *
 * The tile wants exactly one line motif per meal (§ Tiles), and `meals` has no
 * column to put one in. This file is that column's absence made deliberate: a
 * pure function from the name and slot a meal already has, to one of the eight
 * marks `components/motifs.tsx` ships.
 *
 * ## Why derived rather than stored
 *
 * A `meals.motif` column is the honest long-term answer and should be added the
 * moment the library outgrows the seeded set — PRD § Assumptions budgets "ten or
 * so recipes ... the library will grow slowly, not explode", and every one of
 * those seventeen is matched by a rule below. The tradeoff, stated plainly: a
 * meal added later whose name matches nothing falls back to its slot's mark,
 * which is always *a* reasonable mark and sometimes not the best one. That is a
 * cosmetic miss on a decorative element, and it costs no migration to fix later
 * because nothing persists what this returns.
 *
 * ## Why the rules are ordered and the words are whole
 *
 * First match wins, most specific first — "Butter Chicken with Garlic Naan" is a
 * curry (`pot`), not a chicken plate and not a bread roll, and it says all three.
 * Ordering is the only thing that makes that come out right, so the array below
 * is a sequence and not a lookup.
 *
 * Every pattern is anchored to word boundaries. Without them `egg` matches
 * "veggie" and `bar` matches "barbecue" — both plausible future names, and both
 * failures that look like a working function until someone notices the wrong
 * mark on a tile and has no reason to suspect a substring.
 *
 * `walk` is never returned. It is the training mark, and a meal is not a walk.
 */

/** The subset of a meal this needs. Anything with a name and a slot works. */
export type MotifBearing = Pick<Meal, "name" | "slotType">;

/**
 * The vocabulary, in priority order.
 *
 * Read top to bottom: a dish that is a *preparation* (curry, stew) is claimed
 * before one that is an *ingredient* (chicken, rice), because the preparation is
 * what the mark is actually depicting.
 */
const RULES: readonly { motif: MotifName; words: readonly string[] }[] = [
  // Drinks and anything drunk from a vessel. First because "whey shake" would
  // otherwise be nothing and "black coffee" would fall through to its slot.
  { motif: "cup", words: ["coffee", "espresso", "latte", "tea", "shake", "smoothie"] },

  // Before `plate`'s "chicken": a curry is a pot, whatever is in it.
  {
    motif: "pot",
    words: ["curry", "butter chicken", "stew", "soup", "casserole", "masala", "dal"],
  },

  { motif: "egg", words: ["egg", "eggs", "omelette", "frittata", "scramble"] },

  // The bowl covers both halves of the library's bowl food — the breakfast oats
  // and yoghurts, and the loose-served dinners the mock draws with this mark.
  {
    motif: "bowl",
    words: [
      "oats",
      "porridge",
      "granola",
      "yogurt",
      "yoghurt",
      "chilli",
      "chili",
      "nachos",
      "salad",
      "bowl",
    ],
  },

  {
    motif: "roll",
    words: [
      "roll",
      "ciabatta",
      "burger",
      "sandwich",
      "wrap",
      "naan",
      "bread",
      "toast",
      "bagel",
      "pitta",
      "pita",
      "pancake",
      "pancakes",
    ],
  },

  { motif: "bar", words: ["bar", "bars", "flapjack", "biscuit", "cracker", "crackers"] },

  // Last, and deliberately the widest: a named protein or starch with no
  // preparation word around it is a plated meal.
  {
    motif: "plate",
    words: [
      "steak",
      "chicken",
      "beef",
      "fish",
      "salmon",
      "cod",
      "rice",
      "chips",
      "potato",
      "potatoes",
      "pasta",
    ],
  },
];

/**
 * The mark a slot gets when nothing in the name is recognised.
 *
 * Chosen so the fallback is never absurd rather than never wrong: a breakfast is
 * more often a bowl than anything else, a lunch more often something in bread,
 * a snack more often a bar. `extra` is the untracked flexible slot — the mock
 * draws it with `egg`, which is the one mark that reads as "some food" without
 * claiming a form.
 */
const BY_SLOT: Record<MealSlot, MotifName> = {
  breakfast: "bowl",
  lunch: "roll",
  snack: "bar",
  dinner: "plate",
  extra: "egg",
};

/**
 * Cached because this runs once per tile per render and the patterns are fixed.
 *
 * `\b` on both sides is what keeps `egg` out of "veggie". The words are literal
 * — no pattern below contains a regex metacharacter, and none should; if one
 * ever needs to, escape it here rather than letting it through.
 */
const PATTERNS: readonly { motif: MotifName; test: RegExp }[] = RULES.flatMap((rule) =>
  rule.words.map((word) => ({ motif: rule.motif, test: new RegExp(`\\b${word}\\b`, "i") })),
);

/**
 * The mark for one meal. Total: every meal gets one, and the same one every time.
 *
 * Deterministic by construction — no hashing, no index, nothing that depends on
 * how many meals are in the list or what order they arrived in. A meal's mark is
 * a property of the meal, so it does not change when the picker is filtered.
 */
export function motifFor(meal: MotifBearing): MotifName {
  // Not lower-cased first: the patterns already carry `i`, and normalising
  // twice invites the reading that case matters in two places. `toLowerCase`
  // is also locale-sensitive for a few alphabets, which is a needless edge to
  // own when the regex flag has none.
  for (const { motif, test } of PATTERNS) {
    if (test.test(meal.name)) return motif;
  }

  return BY_SLOT[meal.slotType];
}
