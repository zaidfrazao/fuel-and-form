import type { SeedMeal } from "./types";

/**
 * The recipe library — PRD § P7 → repository privacy.
 *
 * Food, not body data. Nothing here is a weight, a target or a measurement, and
 * the provenance notes that came with the source recipes ("recalculated off your
 * actual NNkg weight") are deliberately absent: they are exactly the class of
 * value `scripts/check-no-metrics.sh` (FUEL-16) exists to catch.
 *
 * ## Macros are transcribed, never computed
 *
 * PRD § Assumptions: "Recipe macros are per serving and already correct; the app
 * displays them and does not recompute from ingredients." So every macro below
 * is the figure supplied with the recipe, copied as given. Where a recipe's own
 * ingredient list and its stated macros disagree, the stated macros win and the
 * disagreement is a question for the author — not something this file quietly
 * reconciles. The day totals in P4 are only as honest as this transcription.
 *
 * ## Two transcription conventions
 *
 * 1. **Ranged quantities take the midpoint in `grams`, and keep the range in
 *    `nonScaleMeasure`.** "150-180g fish fillet" becomes `grams: 165` with the
 *    range preserved in the human-readable measure. P8 sums grams to build a
 *    shopping list and cannot sum a range; the measure is what actually gets
 *    read in the kitchen, so nothing is lost by keeping the range only there.
 *
 * 2. **Optional items are ingredient rows with "(optional)" in the name.** The
 *    schema has no optionality flag, and dropping them would mean the shopping
 *    list silently omits the jalapenos the recipe tells you to buy. Naming them
 *    is the honest encoding available.
 *
 * `grams` is null wherever the recipe gives no weight — "salt and pepper to
 * taste", "1 clove garlic". The column was made nullable for precisely this, and
 * inventing a number to fill it would be worse than the gap.
 *
 * ## The exception: estimated macros
 *
 * Five meals in the weekday rotation and all seven treat recipes arrived without
 * usable macros — the oats had one figure covering three different flavours, the
 * snacks gave kcal and protein but no fat or carb, and the treats gave none at
 * all. Every macro column is NOT NULL, so those meals could not be seeded as
 * supplied, and a banana recorded at 0g carb would have quietly corrupted every
 * day total in P4 and every row of the P6 export.
 *
 * They are therefore derived from the ingredient lists, which is a deliberate,
 * authorised departure from the rule above. Each one carries `ESTIMATED` at the
 * head of its `notes`, so the estimate is visible in the kitchen and in the app
 * rather than only in this comment — and one `grep -rn "ESTIMATED" src/lib/seed`
 * lists everything still awaiting real figures.
 */

/**
 * Prefix for any meal whose macros this file derived rather than transcribed.
 *
 * Rendered to the user, not just a marker: a macro the app made up should say so
 * wherever it is read, because the export built from it (P6) is what a nutrition
 * assistant makes decisions against at a check-in.
 */
const ESTIMATED =
  "**ESTIMATED macros** — derived from the ingredient list, not supplied with " +
  "the recipe. Replace with measured figures before relying on these for a check-in.";

/**
 * The three oats flavours are one recipe with three mix-ins, so the base method
 * and the base ingredients are written once here and shared. They are separate
 * library rows rather than one row with a note because the plan template names a
 * specific flavour per weekday (Mon and Thu are Cinnamon Apple, Tue and Fri are
 * PB Cocoa), and a swap has to be able to pick between them.
 */
const oatsMethod = (mixIn: string) =>
  [
    "Add the oats to the jar, then the scoop of whey, then the milk.",
    "Stir for 15–20 seconds until there are no dry clumps of powder left. No heat, no cooking at all.",
    `Add the flavouring — ${mixIn} — and stir once more to distribute it.`,
    "Push the lid on firmly and refrigerate at least 6 hours, ideally overnight.",
    "In the morning: one stir, then eat it cold, straight from the jar or tipped into a bowl. It is meant to be cold — don't reheat it.",
    "",
    "Jars keep 4 days. Prepping all seven on Sunday doesn't work; do Sunday and a mid-week top-up instead.",
  ].join("\n");

const OATS_BASE_INGREDIENTS = [
  { name: "Rolled oats (not instant)", grams: 40, nonScaleMeasure: "a scant 1/2 cup, or 6–7 tbsp", category: "dry goods" },
  { name: "Milk", grams: null, nonScaleMeasure: "200ml (3/4 cup + 1 tbsp)", category: "dairy" },
  { name: "Whey protein powder", grams: null, nonScaleMeasure: "1 level scoop (~25–30g)", category: "dry goods" },
] as const;

export const seedMeals: readonly SeedMeal[] = [
  /* ------------------------------------------------------------------------ */
  /* Dinners                                                                  */
  /* ------------------------------------------------------------------------ */

  {
    key: "beef-mince-chilli",
    name: "Lean Beef Mince Chilli",
    slotType: "dinner",
    kcal: 355,
    proteinG: 41,
    fatG: 4,
    carbG: 36,
    notes:
      "Turkey mince works in place of beef at effectively the same macros. " +
      "Swap the basmati for 50g brown rice for extra fibre: 130ml water instead " +
      "of 100ml, and 25 minutes covered instead of 12.",
    method: [
      "Start the rice first. Put the rice in a small pot with 100ml water, bring to a boil, then turn to low, cover, and cook 12 minutes. Take off the heat and leave covered — lid down — for 5 minutes to steam. Fluff with a fork.",
      "While the rice cooks, put a saucepan on medium heat. Add the olive oil and heat 30 seconds.",
      "Add the onion and cook 2–3 minutes, stirring occasionally, until soft and translucent.",
      "Add the garlic (and the fresh chilli if using) and cook 30 seconds, stirring constantly — garlic burns fast.",
      "Add the mince. Break it up with a wooden spoon and spread it across the pan. Cook 4–5 minutes, stirring every minute or so, until no pink remains anywhere.",
      "Add the cumin, smoked paprika, chilli flakes and oregano. Stir through and cook 30 seconds to toast the spices.",
      "Add the chopped tomatoes and Worcestershire sauce. Stir well, scraping the browned bits off the bottom of the pan.",
      "Turn down to low-medium and simmer uncovered 12–15 minutes, stirring every few minutes, until it thickens — it should hold together on a spoon rather than run off it.",
      "Stir in the chopped spinach and cook 1–2 minutes, just until it wilts. It wilts fast; don't walk away.",
      "Season with salt and pepper. Serve over the rice, topped with the yoghurt.",
      "",
      "**Baked potato instead of rice:** scrub the potato, pierce it 4–5 times with a fork, and bake at 200°C (180°C fan) for 35–45 minutes until a knife slides in with no resistance. Start it before the chilli — it takes far longer.",
    ].join("\n"),
    ingredients: [
      { name: "Beef mince, 5% fat", grams: 150, nonScaleMeasure: "about the size of your fist", category: "meat" },
      { name: "Onion", grams: null, nonScaleMeasure: "1/2 small, diced", category: "produce" },
      { name: "Garlic", grams: null, nonScaleMeasure: "1 clove, minced", category: "produce" },
      { name: "Ground cumin", grams: null, nonScaleMeasure: "1/2 tsp", category: "dry goods" },
      { name: "Smoked paprika", grams: null, nonScaleMeasure: "1 tsp", category: "dry goods" },
      { name: "Dried oregano", grams: null, nonScaleMeasure: "1/4–1/2 tsp", category: "dry goods" },
      { name: "Chilli flakes", grams: null, nonScaleMeasure: "1/2–3/4 tsp", category: "dry goods" },
      { name: "Jalapeno or red chilli (optional)", grams: null, nonScaleMeasure: "1/2, finely diced", category: "produce" },
      { name: "Tinned chopped tomatoes", grams: 200, nonScaleMeasure: "half a 400g tin (3/4–1 cup)", category: "dry goods" },
      { name: "Worcestershire sauce", grams: null, nonScaleMeasure: "1 tsp", category: "other" },
      { name: "Baby spinach", grams: 40, nonScaleMeasure: "a big handful", category: "produce" },
      { name: "Olive oil", grams: null, nonScaleMeasure: "1 tsp", category: "other" },
      { name: "Salt and pepper", grams: null, nonScaleMeasure: "to taste", category: "other" },
      { name: "Basmati rice", grams: 50, nonScaleMeasure: "4 tbsp (a scant 1/3 cup)", category: "dry goods" },
      { name: "Plain yoghurt", grams: null, nonScaleMeasure: "1 tbsp, to serve", category: "dairy" },
      { name: "Grated cheese (optional)", grams: null, nonScaleMeasure: "small handful, to serve", category: "dairy" },
    ],
  },

  {
    key: "smoky-paprika-chicken-rice",
    name: "Smoky Paprika Chicken & Rice",
    slotType: "dinner",
    kcal: 365,
    proteinG: 43,
    fatG: 3,
    carbG: 39,
    notes:
      "One pan. Swap the basmati for 50g brown rice for extra fibre: 160ml stock " +
      "instead of 120ml, and 25 minutes covered instead of 12 — about +15–20 kcal " +
      "and +2–3g fibre.",
    method: [
      "Prep everything before the stove goes on — chop the chicken, onion, pepper and spinach, mince the garlic. This moves fast once it starts.",
      "Boil the kettle and make up 120ml stock. Set aside.",
      "Put the pan on medium-high heat. Add the olive oil and let it heat ~30 seconds until it looks shimmery, not smoking.",
      "Add the chicken in a single layer. Don't touch it for 2 minutes — let it sear golden on one side.",
      "Flip each piece and cook another 2 minutes.",
      "Add the onion and garlic, stir together with the chicken, and cook 2 minutes until the onion softens.",
      "Sprinkle in the smoked paprika, cumin and chilli flakes. Stir 30 seconds — you'll smell them toast.",
      "Add the uncooked rice straight into the pan, stir to coat it in the spice and oil, and cook 1 minute.",
      "Pour in the stock. Stir once, then leave it alone.",
      "Turn down to low — a gentle simmer, not a rolling boil. Lid on, 12 minutes. Do not lift the lid.",
      "Lay the sliced pepper on top without stirring it in, lid back on, 3 more minutes.",
      "Off the heat. Check the rice: it should have absorbed the liquid and be tender. If it's still hard, add a splash more stock, 2 tbsp at a time, and cook covered 2–3 minutes more.",
      "Put the chopped spinach on top and the lid back on for 1–2 minutes — residual heat wilts it, no extra cooking.",
      "Stir everything together, squeeze over the lemon, and season with salt and pepper.",
      "",
      "**Doneness:** cut the thickest piece of chicken in half — white all the way through, no pink, juices running clear.",
    ].join("\n"),
    ingredients: [
      { name: "Chicken breast", grams: 150, nonScaleMeasure: "1 small-medium breast, palm-sized, cut into 2cm strips", category: "meat" },
      { name: "Basmati rice", grams: 50, nonScaleMeasure: "4 tbsp (a scant 1/3 cup)", category: "dry goods" },
      { name: "Chicken stock", grams: null, nonScaleMeasure: "120ml (1/2 cup)", category: "other" },
      { name: "Onion", grams: null, nonScaleMeasure: "1/2 small, sliced", category: "produce" },
      { name: "Bell pepper, red or yellow", grams: null, nonScaleMeasure: "1/2, sliced into strips", category: "produce" },
      { name: "Baby spinach", grams: 40, nonScaleMeasure: "a big handful", category: "produce" },
      { name: "Garlic", grams: null, nonScaleMeasure: "1 clove, minced", category: "produce" },
      { name: "Smoked paprika", grams: null, nonScaleMeasure: "1 tsp", category: "dry goods" },
      { name: "Ground cumin", grams: null, nonScaleMeasure: "1/2 tsp", category: "dry goods" },
      { name: "Chilli flakes", grams: null, nonScaleMeasure: "1/2–3/4 tsp", category: "dry goods" },
      { name: "Olive oil", grams: null, nonScaleMeasure: "1 tsp", category: "other" },
      { name: "Salt and pepper", grams: null, nonScaleMeasure: "to taste", category: "other" },
      { name: "Lemon", grams: null, nonScaleMeasure: "1/2, for squeezing", category: "produce" },
      { name: "Parsley or coriander (optional)", grams: null, nonScaleMeasure: "chopped, to garnish", category: "produce" },
      { name: "Hot sauce (optional)", grams: null, nonScaleMeasure: "a dash at the table", category: "other" },
    ],
  },

  {
    key: "lemon-garlic-baked-fish",
    name: "Lemon-Garlic Herb Baked Fish",
    slotType: "dinner",
    kcal: 360,
    proteinG: 38,
    fatG: 6,
    carbG: 33,
    notes:
      "With roasted potatoes and greens. Hake is the default; salmon works but is " +
      "thicker, runs higher in fat and kcal, and needs 12–15 minutes rather than 8–9.",
    method: [
      "Heat the oven to 200°C (180°C fan).",
      "Toss the potato chunks with 1 tsp olive oil, salt and pepper directly on an oven tray. Spread them in a single layer — crowded potatoes steam instead of roasting, so use two trays if you need to.",
      "Potatoes into the oven. Timer for 20 minutes.",
      "While they roast, pat the fish really dry with paper towel. Don't rush this — hake holds a lot of surface moisture and wet fish steams itself even uncovered. Put it on a separate tray, no foil: baking uncovered is what gives you firm flakes rather than mush. Rub with 1 tsp olive oil, the garlic, oregano, dill and chilli flakes, and season generously — more than feels natural, since hake is mild and some of it cooks off. Lay a slice or two of lemon on top.",
      "At 20 minutes, take the potatoes out and shake or turn them. There isn't much potato here, so pull any smaller pieces that are already done.",
      "Fish into the oven alongside, uncovered. Start checking hake at 8–9 minutes — it goes from just-done to mushy in a minute or two. Thicker fillets like salmon want 12–15.",
      "It's done when it flakes apart easily with a fork and is opaque all the way through. Pull it the moment it gets there; leaving it in 'just to be safe' is what makes it fall apart.",
      "While the fish finishes, cook the greens. Steam them over 2cm of boiling water with the lid on — 4–5 minutes for beans or broccoli, 1–2 for spinach. Or microwave with 1 tbsp water, covered, 2–3 minutes, stirring halfway.",
      "Squeeze the remaining lemon over the fish and add a pinch of flaky salt just before serving — seasoning after cooking does more for the flavour than seasoning before.",
      "Plate the potatoes and greens, fish on top.",
    ].join("\n"),
    ingredients: [
      { name: "White fish fillet (hake)", grams: 165, nonScaleMeasure: "1 fillet, 150–180g, about the size of your palm", category: "meat" },
      { name: "Potatoes", grams: 100, nonScaleMeasure: "1 small potato, golf-ball to small-fist sized, in 2cm chunks", category: "produce" },
      { name: "Olive oil (for the potatoes)", grams: null, nonScaleMeasure: "1 tsp", category: "other" },
      { name: "Olive oil (for the fish)", grams: null, nonScaleMeasure: "1 tsp", category: "other" },
      { name: "Garlic", grams: null, nonScaleMeasure: "1 clove, minced", category: "produce" },
      { name: "Lemon", grams: null, nonScaleMeasure: "1/2, plus slices to serve", category: "produce" },
      { name: "Dried oregano", grams: null, nonScaleMeasure: "1/2 tsp", category: "dry goods" },
      { name: "Dried dill (or parsley)", grams: null, nonScaleMeasure: "1/2 tsp", category: "dry goods" },
      { name: "Chilli flakes or cayenne", grams: null, nonScaleMeasure: "1/2 tsp, or a pinch of cayenne", category: "dry goods" },
      { name: "Salt and pepper", grams: null, nonScaleMeasure: "to taste, generously", category: "other" },
      { name: "Flaky salt", grams: null, nonScaleMeasure: "a pinch, to finish", category: "other" },
      { name: "Greens (green beans, broccoli or spinach)", grams: 90, nonScaleMeasure: "1–1.5 cups, or 1–2 large handfuls", category: "produce" },
      { name: "Hot sauce (optional)", grams: null, nonScaleMeasure: "to drizzle", category: "other" },
    ],
  },

  /* ------------------------------------------------------------------------ */
  /* The morning ritual                                                       */
  /* ------------------------------------------------------------------------ */

  {
    key: "black-coffee-mct",
    name: "Black Coffee + MCT Oil",
    slotType: "extra",
    kcal: 125,

    // MCT oil is pure fat and black coffee is negligible, so the whole 125 kcal
    // is the 14g of fat: 14 x 9 = 126. This is the one meal here whose stated
    // macros and stated kcal reconcile exactly, which is why the zeroes are
    // transcription rather than the placeholder they would be anywhere else.
    proteinG: 0,
    fatG: 14,
    carbG: 0,

    notes:
      "Doubles as pre-workout — taken around 5:05am, it lands 30–55 minutes " +
      "before lifting, inside the effective caffeine window, so no separate " +
      "pre-workout product is needed.",
    method: [
      "Grind the beans fresh and brew the coffee black.",
      "Stir in 1 tbsp MCT oil until it emulsifies and the surface goes glossy.",
    ].join("\n"),
    ingredients: [
      { name: "Coffee beans", grams: null, nonScaleMeasure: "freshly ground, for 1 cup", category: "dry goods" },
      { name: "MCT oil", grams: null, nonScaleMeasure: "1 tbsp", category: "other" },
    ],
  },

  /* ------------------------------------------------------------------------ */
  /* Lunch                                                                    */
  /* ------------------------------------------------------------------------ */

  {
    key: "red-pepper-provolone-ciabatta",
    name: "Roasted Red Pepper & Provolone Ciabatta Roll",
    slotType: "lunch",
    kcal: 540,
    proteinG: 27,
    fatG: 16,
    carbG: 55,
    notes:
      "Under 5 minutes, and zero-cook if you skip the toasting. Hot sauce stands " +
      "in for mayo — more heat, less fat. Scales up on heat for free: extra hot " +
      "sauce and jalapenos cost effectively no fat or kcal.",
    method: [
      "Slice the ciabatta roll horizontally if it isn't pre-sliced.",
      "*Optional, adds ~2 minutes:* toast the cut sides. Dry frying pan on medium heat, no oil, roll cut-side down for 1–2 minutes until lightly golden. Skip it for a zero-cook lunch.",
      "Spread the mustard on one cut half and the hot sauce on the other.",
      "On the bottom half, layer the ham first, then the provolone, then the pepper strips.",
      "Drizzle the balsamic glaze over the peppers.",
      "Add the jalapeno slices now if using.",
      "Top with the rocket, and the onion and basil if using.",
      "Close the sandwich. Press down gently and slice in half if you want it easier to eat.",
    ].join("\n"),
    ingredients: [
      { name: "Ciabatta roll", grams: null, nonScaleMeasure: "1 roll", category: "dry goods" },
      { name: "Provolone", grams: null, nonScaleMeasure: "1 slice", category: "dairy" },
      { name: "Sandwich ham", grams: 45, nonScaleMeasure: "2–3 slices, about the size of your palm", category: "meat" },
      { name: "Roasted red pepper, from a jar", grams: null, nonScaleMeasure: "2–3 strips, patted dry", category: "other" },
      { name: "Wholegrain mustard", grams: null, nonScaleMeasure: "1 tsp", category: "other" },
      { name: "Hot sauce or sriracha", grams: null, nonScaleMeasure: "1 tbsp", category: "other" },
      { name: "Rocket", grams: 10, nonScaleMeasure: "small handful, a few leaves", category: "produce" },
      { name: "Balsamic glaze", grams: null, nonScaleMeasure: "1/2 tsp", category: "other" },
      { name: "Pickled jalapeno slices (optional)", grams: null, nonScaleMeasure: "3–4 slices", category: "other" },
      { name: "Red onion (optional)", grams: null, nonScaleMeasure: "1 thin slice", category: "produce" },
      { name: "Basil (optional)", grams: null, nonScaleMeasure: "a couple of leaves", category: "produce" },
    ],
  },

  /* ------------------------------------------------------------------------ */
  /* Breakfast — the three overnight oats flavours                            */
  /* ------------------------------------------------------------------------ */

  {
    key: "oats-cinnamon-apple",
    name: "Overnight Oats — Cinnamon Apple",
    slotType: "breakfast",

    // Base 350/30/8/38 plus half a grated apple (~90g) and cinnamon.
    kcal: 400,
    proteinG: 30,
    fatG: 8,
    carbG: 51,

    notes: ESTIMATED,
    method: oatsMethod("the grated apple and the cinnamon"),
    ingredients: [
      ...OATS_BASE_INGREDIENTS,
      { name: "Apple", grams: null, nonScaleMeasure: "1/2 medium, grated on the coarse side of a box grater", category: "produce" },
      { name: "Ground cinnamon", grams: null, nonScaleMeasure: "1/2 tsp", category: "dry goods" },
    ],
  },

  {
    key: "oats-pb-cocoa",
    name: "Overnight Oats — PB Cocoa",
    slotType: "breakfast",

    // Base plus 1 tbsp peanut butter (~17g) and 1 tsp cocoa. The peanut butter
    // alone is about +100 kcal and +8g fat, which is why this flavour could not
    // share the base figure with the other two.
    kcal: 455,
    proteinG: 34.5,
    fatG: 16.5,
    carbG: 42.5,

    notes: ESTIMATED,
    method: oatsMethod("the peanut butter and the cocoa"),
    ingredients: [
      ...OATS_BASE_INGREDIENTS,
      { name: "Smooth peanut butter", grams: null, nonScaleMeasure: "1 tbsp (~15–20g)", category: "dry goods" },
      { name: "Cocoa powder, unsweetened", grams: null, nonScaleMeasure: "1 tsp", category: "dry goods" },
    ],
  },

  {
    key: "oats-vanilla-berry",
    name: "Overnight Oats — Vanilla Berry",
    slotType: "breakfast",

    // Base plus vanilla extract and 30g frozen berries.
    kcal: 370,
    proteinG: 30.5,
    fatG: 8,
    carbG: 42,

    notes: `${ESTIMATED}\n\nThe berries go in frozen and whole — no need to thaw them, they soften overnight.`,
    method: oatsMethod("the vanilla and the frozen berries"),
    ingredients: [
      ...OATS_BASE_INGREDIENTS,
      { name: "Vanilla extract", grams: null, nonScaleMeasure: "1/2 tsp", category: "other" },
      { name: "Frozen berries", grams: 30, nonScaleMeasure: "3–4 tbsp, a small handful", category: "produce" },
    ],
  },

  /* ------------------------------------------------------------------------ */
  /* Snacks                                                                   */
  /* ------------------------------------------------------------------------ */

  {
    key: "greek-yogurt-berries",
    name: "Greek Yogurt + Berries",
    slotType: "snack",

    // kcal and protein were supplied (180, 18g); fat and carb are derived to
    // reconcile against them. The stated kcal only closes if the optional honey
    // is included, so it is treated as part of the serving here.
    kcal: 180,
    proteinG: 18,
    fatG: 4,
    carbG: 17,

    notes: `${ESTIMATED}\n\nZero prep, no cooking. Frozen berries are fine straight from the bag — slightly icy is part of it.`,
    method: [
      "Spoon the yoghurt into a bowl.",
      "Top with the berries.",
      "Drizzle over the honey if using.",
    ].join("\n"),
    ingredients: [
      { name: "Plain Greek yoghurt", grams: 160, nonScaleMeasure: "2/3–3/4 cup, or a small single-serve tub plus a couple of spoonfuls", category: "dairy" },
      { name: "Berries, fresh or frozen", grams: 40, nonScaleMeasure: "1/4 cup, a small handful", category: "produce" },
      { name: "Honey (optional)", grams: null, nonScaleMeasure: "1 tsp", category: "dry goods" },
    ],
  },

  {
    key: "whey-shake-banana",
    name: "Whey Shake + Banana",
    slotType: "snack",

    // As above: 230 kcal and 30g protein supplied, fat and carb derived. Figures
    // assume the water version; making it with milk adds roughly 100 kcal.
    kcal: 230,
    proteinG: 30,
    fatG: 1.5,
    carbG: 25,

    notes: `${ESTIMATED}\n\nMade with water. Milk instead adds roughly 100 kcal and 8g protein. The banana is eaten alongside, not blended — no blender needed.`,
    method: [
      "Add the whey powder to a shaker bottle, then the water or milk.",
      "Lid on tight, shake 15–20 seconds until there are no clumps.",
      "Drink the shake and eat the banana alongside it.",
    ].join("\n"),
    ingredients: [
      { name: "Whey protein powder", grams: null, nonScaleMeasure: "1 scoop (~25–30g)", category: "dry goods" },
      { name: "Water or milk", grams: null, nonScaleMeasure: "250–300ml (1–1 1/4 cups)", category: "other" },
      { name: "Banana", grams: null, nonScaleMeasure: "1", category: "produce" },
    ],
  },

  /* ------------------------------------------------------------------------ */
  /* Treats and weekend meals                                                 */
  /*                                                                          */
  /* Not part of the weekday rotation. These fill the weekend Flex slots and   */
  /* cheat days — PRD Open Question 4 asked whether they should be real        */
  /* library entries or an untracked placeholder, and these rows are the       */
  /* "real entries" answer. Every macro here is estimated: none of the source  */
  /* recipes carried any, and portions this large would distort a day total    */
  /* badly if they were seeded at zero.                                        */
  /* ------------------------------------------------------------------------ */

  {
    key: "fried-eggs-lamb-bangers",
    name: "Fried Eggs + Lamb Bangers",
    slotType: "breakfast",
    kcal: 600,
    proteinG: 32,
    fatG: 50.5,
    carbG: 5,

    notes: `${ESTIMATED}\n\nThe standing Saturday and Sunday breakfast. No recipe was supplied for this one, so both the method and the quantities below are assumed — check them before trusting the macros.`,
    method: [
      "Fry the sausages over medium heat, turning, 12–15 minutes until browned all over and cooked through.",
      "Push them to one side, crack the eggs into the pan, and fry to your liking — 2–3 minutes for a set white and a runny yolk.",
      "Season and serve.",
    ].join("\n"),
    ingredients: [
      { name: "Lamb sausages", grams: 130, nonScaleMeasure: "2 sausages", category: "meat" },
      { name: "Eggs", grams: null, nonScaleMeasure: "2 large", category: "dairy" },
      { name: "Oil or butter, for frying", grams: null, nonScaleMeasure: "1 tsp", category: "other" },
      { name: "Salt and pepper", grams: null, nonScaleMeasure: "to taste", category: "other" },
    ],
  },

  {
    key: "french-toast-bacon",
    name: "French Toast + Bacon",
    slotType: "breakfast",
    kcal: 1165,
    proteinG: 42,
    fatG: 72,
    carbG: 88,

    notes: `${ESTIMATED}\n\nCheat-day breakfast. Day-old bread works best — it soaks without collapsing.`,
    method: [
      "Whisk the eggs, milk, vanilla, cinnamon and salt together in a shallow bowl wide enough to take a slice of bread.",
      "Cook the bacon in a pan over medium heat until crispy, 3–4 minutes a side. Set aside on paper towel and keep the pan.",
      "Dunk each slice of bread in the egg mixture, 10–15 seconds a side — soaked through but not falling apart.",
      "Melt a knob of butter in a clean pan, or the bacon pan wiped of excess fat, over medium heat. Fry each slice 2–3 minutes a side until golden and set in the middle.",
      "While the toast cooks, melt the 20g butter with the maple syrup in a small saucepan or the microwave until it comes together into a glossy sauce.",
      "Plate the toast, pour over the maple butter, and serve the bacon alongside. More syrup on top if you want it sweeter.",
    ].join("\n"),
    ingredients: [
      { name: "Bread, brioche or thick white", grams: null, nonScaleMeasure: "3 thick slices, about 1cm, ideally day-old", category: "dry goods" },
      { name: "Eggs", grams: null, nonScaleMeasure: "2 large", category: "dairy" },
      { name: "Milk", grams: null, nonScaleMeasure: "60ml (1/4 cup)", category: "dairy" },
      { name: "Vanilla extract", grams: null, nonScaleMeasure: "1/2 tsp", category: "other" },
      { name: "Ground cinnamon", grams: null, nonScaleMeasure: "1/2 tsp", category: "dry goods" },
      { name: "Salt", grams: null, nonScaleMeasure: "a pinch", category: "other" },
      { name: "Butter", grams: 20, nonScaleMeasure: "1.5 tbsp, plus extra for frying", category: "dairy" },
      { name: "Bacon", grams: null, nonScaleMeasure: "4–6 rashers, each about the length of your palm", category: "meat" },
      { name: "Maple syrup", grams: null, nonScaleMeasure: "30ml (2 tbsp), plus more to drizzle", category: "dry goods" },
    ],
  },

  {
    key: "steak-chips-peppercorn",
    name: "Steak with Garlic Butter, Chips & Peppercorn Sauce",
    slotType: "dinner",
    kcal: 1610,
    proteinG: 68.5,
    fatG: 118,
    carbG: 72,

    notes: [
      ESTIMATED,
      "",
      "The fat figure assumes all the searing oil and butter ends up on the plate; in practice some stays in the pan, so treat it as an upper bound.",
      "",
      "**Use real butter, not a spread or margarine.** It makes a genuine difference to the richness and to how well the sauce glazes.",
      "",
      "**Salt the sauce at the very end, and taste first.** The reduced stock and pan drippings are usually salty enough on their own.",
      "",
      "Scraping the sauce onto the steak and eating it that way beat pouring it over — worth doing on purpose.",
    ].join("\n"),
    method: [
      "### Heat guide",
      "",
      "This moves through five heat levels, in order. Chips are oven, not stovetop.",
      "",
      "| Stage | Heat |",
      "|---|---|",
      "| Cooking the steak | **HIGH** — pan visibly smoking before the steak goes in |",
      "| Sauce, the onion | **MEDIUM** — turn down after the steak comes out |",
      "| Sauce, reducing the stock | **MEDIUM-HIGH** — visible, steady bubbling |",
      "| Sauce, once the cream is in | **MEDIUM-LOW** — a gentle bubble, never a rolling boil |",
      "",
      "### Steps",
      "",
      "1. **Chips.** Heat the oven to 200°C fan (220°C conventional) — hot but not scorching. Toss the chips with 1 tbsp oil and salt, spread them on a tray in a single layer without crowding, and roast 25–30 minutes, flipping halfway, until golden and crisp. Ovens vary: check at 20 minutes the first time and note what yours actually takes.",
      "2. Take the steak out of the fridge 20–30 minutes ahead so it comes to room temperature. Pat it dry and season generously both sides.",
      "3. **HIGH.** Heat a heavy pan — cast iron ideally — with 1 tbsp oil until it is visibly smoking. That smoke is the signal it's hot enough. Still on HIGH, sear the steak 2–3 minutes a side for medium-rare, adding a minute a side per level of doneness up. The heat stays HIGH for this whole step.",
      "4. Still on HIGH, in the last minute: add the butter, the smashed garlic and the herb sprig, and baste the steak by spooning the foaming butter over it repeatedly.",
      "5. Take the steak out and rest it on a plate, loosely tented with foil, for 5 minutes. Turn the stove off or down while the pan is idle — you'll bring it back for the sauce.",
      "6. **Sauce, stage 1 — MEDIUM.** The pan is still hot from the steak, so it won't need long. Pour off the excess fat if it's very greasy, melt 1 tbsp butter, and cook the onion 2–3 minutes, stirring, until soft and translucent — not browned. Add the crushed peppercorns and cook 30 seconds more.",
      "7. **Sauce, stage 2 — MEDIUM-HIGH.** Deglaze with the brandy if using; it can flame briefly. Add the stock and let it bubble steadily 2–3 minutes to reduce.",
      "8. **Sauce, stage 3 — MEDIUM-LOW.** Stir in the cream, then *immediately* drop the heat. This is the most important heat change in the recipe: once cream is in, a rolling boil can split the sauce. Simmer gently 2–3 minutes, stirring, until it coats the back of a spoon. Taste before adding any salt.",
      "9. Plate the steak with the chips, sauce over or alongside.",
    ].join("\n"),
    ingredients: [
      { name: "Sirloin or ribeye steak", grams: 275, nonScaleMeasure: "1 steak, palm-sized and 2–3cm thick", category: "meat" },
      { name: "Potatoes", grams: 350, nonScaleMeasure: "2 medium, cut into thick chips", category: "produce" },
      { name: "Oil (for searing and for the chips)", grams: null, nonScaleMeasure: "2 tbsp total", category: "other" },
      { name: "Real butter (not a spread or margarine)", grams: 20, nonScaleMeasure: "1.5 tbsp for the steak, plus 1 tbsp for the sauce", category: "dairy" },
      { name: "Garlic", grams: null, nonScaleMeasure: "1 clove, smashed", category: "produce" },
      { name: "Thyme or rosemary (optional)", grams: null, nonScaleMeasure: "1 sprig", category: "produce" },
      { name: "Onion or shallot", grams: null, nonScaleMeasure: "1/4 small onion, or 1 shallot, finely diced", category: "produce" },
      { name: "Black peppercorns", grams: null, nonScaleMeasure: "1 tsp, crushed", category: "dry goods" },
      { name: "Low-sodium beef stock", grams: null, nonScaleMeasure: "60ml (1/4 cup) — full-salt stock tastes too salty once reduced", category: "other" },
      { name: "Cream", grams: null, nonScaleMeasure: "60ml (1/4 cup)", category: "dairy" },
      { name: "Brandy or whisky (optional)", grams: null, nonScaleMeasure: "a splash", category: "other" },
      { name: "Salt and pepper", grams: null, nonScaleMeasure: "to taste — salt the sauce at the very end only", category: "other" },
    ],
  },

  {
    key: "butter-chicken-naan",
    name: "Butter Chicken with Garlic Naan",
    slotType: "dinner",
    kcal: 1410,
    proteinG: 62.5,
    fatG: 89,
    carbG: 85,

    notes: `${ESTIMATED}\n\nFigures include the naan but not the optional rice, which would add roughly 200 kcal and 44g carb. The sauce base freezes well if you want to batch it.`,
    method: [
      "Mix the chicken with the yoghurt, garam masala, turmeric, ginger-garlic paste and salt, and leave at least 20 minutes — or overnight in the fridge.",
      "Heat a splash of oil in a pan over medium-high and sear the chicken 5–6 minutes until browned and mostly cooked through. Set aside.",
      "In the same pan, melt 1 tbsp butter and soften the onion 3–4 minutes. Add the ginger-garlic paste and cook 30 seconds until fragrant.",
      "Add the passata, garam masala, chilli powder and ground coriander. Simmer 8–10 minutes, stirring occasionally, until the sauce thickens and darkens slightly.",
      "*Optional:* blend the sauce smooth with a stick blender for a restaurant-style finish. Skip it if you like it rustic.",
      "Return the chicken, stir in the cream, sugar and the remaining 20g butter, and simmer 5 minutes until the chicken is cooked through and the sauce is glossy.",
      "Taste and adjust the salt, sugar and heat. Garnish with coriander and a drizzle of cream, and serve with warmed naan.",
    ].join("\n"),
    ingredients: [
      { name: "Chicken thigh, boneless skinless", grams: 250, nonScaleMeasure: "about two palms' worth, in bite-sized chunks", category: "meat" },
      { name: "Plain yoghurt", grams: null, nonScaleMeasure: "2 tbsp", category: "dairy" },
      { name: "Garam masala", grams: null, nonScaleMeasure: "1 tsp for the marinade, 1 tsp for the sauce", category: "dry goods" },
      { name: "Turmeric", grams: null, nonScaleMeasure: "1/2 tsp", category: "dry goods" },
      { name: "Ginger-garlic paste", grams: null, nonScaleMeasure: "1 tsp for the marinade, 1 tsp for the sauce", category: "dry goods" },
      { name: "Butter", grams: null, nonScaleMeasure: "1 tbsp for the base, plus 20g (1.5 tbsp) to finish", category: "dairy" },
      { name: "Onion", grams: null, nonScaleMeasure: "1/2, finely diced", category: "produce" },
      { name: "Tomato passata or crushed tomatoes", grams: 200, nonScaleMeasure: "about 3/4 cup", category: "dry goods" },
      { name: "Chilli powder", grams: null, nonScaleMeasure: "1/2 tsp", category: "dry goods" },
      { name: "Ground coriander", grams: null, nonScaleMeasure: "1/2 tsp", category: "dry goods" },
      { name: "Cream", grams: null, nonScaleMeasure: "60ml (1/4 cup), plus extra to drizzle", category: "dairy" },
      { name: "Sugar", grams: null, nonScaleMeasure: "1 tsp", category: "dry goods" },
      { name: "Garlic naan", grams: null, nonScaleMeasure: "1–2, warmed", category: "dry goods" },
      { name: "Fresh coriander", grams: null, nonScaleMeasure: "a small handful, to garnish", category: "produce" },
    ],
  },

  {
    key: "smash-burger",
    name: "Double Smash Burger",
    slotType: "dinner",
    kcal: 1210,
    proteinG: 50,
    fatG: 90,
    carbG: 49,

    notes: `${ESTIMATED}\n\nTwo patties. The pan being genuinely very hot is what produces the crust — this is the one step worth waiting for.`,
    method: [
      "Mix the special sauce ingredients in a small bowl and set aside.",
      "Divide the mince into 2 loose balls, about golf-ball sized. Don't compact them — loose is what gives the texture.",
      "Toast the cut sides of the bun in a dry pan or with the butter until golden. Set aside.",
      "Heat a heavy pan or flat griddle over high heat until it is very hot. Put the balls down and immediately smash them flat with a spatula for 5–10 seconds — about 0.5cm thick.",
      "Season the tops and cook about 90 seconds, until the edges look crispy and lacy.",
      "Flip, top each immediately with a cheese slice, and cook another 60–90 seconds until the cheese melts and the patty is through.",
      "Build it: bottom bun, sauce, patty, onions, pickles, second patty, more sauce, top bun.",
    ].join("\n"),
    ingredients: [
      { name: "Beef mince, 80/20", grams: 200, nonScaleMeasure: "about a small fist, as 2 patties", category: "meat" },
      { name: "Burger bun, brioche or sesame", grams: null, nonScaleMeasure: "1, split", category: "dry goods" },
      { name: "American cheese or cheddar slices", grams: null, nonScaleMeasure: "2 slices", category: "dairy" },
      { name: "Butter, for toasting the bun", grams: null, nonScaleMeasure: "1 tbsp", category: "dairy" },
      { name: "Pickle slices", grams: null, nonScaleMeasure: "4–5", category: "other" },
      { name: "Onion", grams: null, nonScaleMeasure: "1/4 small, very thinly sliced", category: "produce" },
      { name: "Mayonnaise", grams: null, nonScaleMeasure: "2 tbsp", category: "other" },
      { name: "Ketchup", grams: null, nonScaleMeasure: "1 tbsp", category: "other" },
      { name: "Yellow mustard", grams: null, nonScaleMeasure: "1 tsp", category: "other" },
      { name: "Pickle relish", grams: null, nonScaleMeasure: "1 tsp", category: "other" },
      { name: "Paprika", grams: null, nonScaleMeasure: "a pinch, for the sauce", category: "dry goods" },
      { name: "Salt and pepper", grams: null, nonScaleMeasure: "to taste", category: "other" },
    ],
  },

  {
    key: "loaded-nachos",
    name: "Loaded Nachos",
    slotType: "dinner",
    kcal: 1295,
    proteinG: 64,
    fatG: 83.5,
    carbG: 75,

    notes: `${ESTIMATED}\n\nA generous single portion. Figures assume beef mince; shredded chicken comes out lower in fat.`,
    method: [
      "Heat the oven to 200°C fan (220°C conventional).",
      "Brown the mince — or warm the shredded chicken — in a pan with the diced onion, cumin, paprika and chilli powder for 5–7 minutes until cooked through. Season with salt.",
      "Spread the tortilla chips on a baking tray in an even layer.",
      "Scatter the meat over the chips, then top generously with the cheese.",
      "Bake 6–8 minutes until the cheese is fully melted and bubbling.",
      "Straight out of the oven, top with the jalapenos, dollops of sour cream and guacamole, a drizzle of salsa, and coriander if using. Serve immediately while hot.",
    ].join("\n"),
    ingredients: [
      { name: "Tortilla chips", grams: 100, nonScaleMeasure: "4–5 handfuls, about half a standard bag", category: "dry goods" },
      { name: "Beef mince or shredded cooked chicken", grams: 150, nonScaleMeasure: "about a cupped palm", category: "meat" },
      { name: "Ground cumin", grams: null, nonScaleMeasure: "1/2 tsp", category: "dry goods" },
      { name: "Smoked paprika", grams: null, nonScaleMeasure: "1/2 tsp", category: "dry goods" },
      { name: "Chilli powder", grams: null, nonScaleMeasure: "1/2 tsp", category: "dry goods" },
      { name: "Onion", grams: null, nonScaleMeasure: "1/2 small, diced", category: "produce" },
      { name: "Cheddar or Mexican blend, shredded", grams: 100, nonScaleMeasure: "about 1 cup", category: "dairy" },
      { name: "Jarred jalapenos", grams: null, nonScaleMeasure: "1/4 cup, a small handful", category: "other" },
      { name: "Sour cream", grams: null, nonScaleMeasure: "2 tbsp", category: "dairy" },
      { name: "Guacamole", grams: null, nonScaleMeasure: "2 tbsp", category: "produce" },
      { name: "Salsa", grams: null, nonScaleMeasure: "2 tbsp", category: "other" },
      { name: "Fresh coriander (optional)", grams: null, nonScaleMeasure: "a small handful, chopped", category: "produce" },
    ],
  },

  {
    key: "korean-fried-chicken",
    name: "Gochujang Korean Fried Chicken",
    slotType: "dinner",
    kcal: 1250,
    proteinG: 60,
    fatG: 57.5,
    carbG: 118,

    notes: `${ESTIMATED}\n\nDeep-fried, so the fat figure depends heavily on oil absorption and is the least reliable number here. Includes the rice. The double fry is what makes it crunch — don't skip the second pass.`,
    method: [
      "Marinate the chicken with the salt, pepper, ginger, garlic and soy sauce for at least 15–20 minutes.",
      "Whisk all the glaze ingredients together in a small bowl and set aside.",
      "Dredge the marinated chicken in the potato starch, shaking off the excess, until fully coated.",
      "Heat the oil in a small deep pot or wok to 170–180°C — a cube of bread should sizzle and brown in about 20 seconds. Fry the chicken in batches 4–5 minutes until light golden and cooked through. Drain on paper towel.",
      "Bring the oil up to about 190°C and fry a second time for 2–3 minutes until deeply golden and extra crispy. This double fry is the whole point.",
      "Warm the glaze in a pan over low heat 1–2 minutes until it loosens and goes glossy.",
      "Toss the hot chicken through the glaze until fully coated.",
      "Serve over rice, topped with sesame seeds and spring onion, with pickled radish alongside if using.",
    ].join("\n"),
    ingredients: [
      { name: "Chicken thigh, boneless skinless", grams: 300, nonScaleMeasure: "about two palms' worth, in bite-sized pieces", category: "meat" },
      { name: "Fresh ginger", grams: null, nonScaleMeasure: "1 tsp grated for the marinade, 1 tsp for the glaze", category: "produce" },
      { name: "Garlic", grams: null, nonScaleMeasure: "1 tsp minced for the marinade, 1 tsp for the glaze", category: "produce" },
      { name: "Soy sauce", grams: null, nonScaleMeasure: "1 tbsp for the marinade, 1 tbsp for the glaze", category: "other" },
      { name: "Potato starch or cornstarch", grams: 60, nonScaleMeasure: "about 1/2 cup, for dredging", category: "dry goods" },
      { name: "Neutral oil, for frying", grams: null, nonScaleMeasure: "about 500ml (2 cups), 3–4cm depth", category: "other" },
      { name: "Gochujang", grams: null, nonScaleMeasure: "2 tbsp", category: "other" },
      { name: "Honey or brown sugar", grams: null, nonScaleMeasure: "1.5 tbsp", category: "dry goods" },
      { name: "Rice vinegar", grams: null, nonScaleMeasure: "1 tbsp", category: "other" },
      { name: "Sesame oil", grams: null, nonScaleMeasure: "1 tsp", category: "other" },
      { name: "Basmati rice", grams: 65, nonScaleMeasure: "5–6 tbsp uncooked, about 3/4–1 cup cooked", category: "dry goods" },
      { name: "Sesame seeds", grams: null, nonScaleMeasure: "1 tsp", category: "dry goods" },
      { name: "Spring onion", grams: null, nonScaleMeasure: "1, sliced", category: "produce" },
      { name: "Pickled radish (optional)", grams: null, nonScaleMeasure: "shop-bought, to serve", category: "other" },
    ],
  },
];
