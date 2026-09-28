-- FUEL-137 — the shopping list sums what it asks for.
--
-- Three parts, in this order, and all additive except the tick renames.
--
-- 1. Four columns on `meal_ingredients`: the shop's reading of a row beside
--    the kitchen's. Nullable, or defaulted, so the code already deployed —
--    which selects an explicit column list and never names them — reads and
--    writes exactly as before.
--
-- 2. The back-fill. The seed only runs at provisioning, so every row stored
--    before this file still has null shop columns and would keep printing
--    "1 clove ×5" to the owner while a fresh demo reads "5 cloves". No screen
--    edits an ingredient, so a stored row is a seed row verbatim and
--    `(name, non_scale_measure)` identifies it. `category` rides along for the
--    one row whose aisle changed ("Water or milk" is shopped as milk).
--
--    The VALUES are rendered by `src/lib/seed/shop-backfill.ts`, and
--    `shop-backfill.test.ts` asserts this file still contains that rendering
--    — the seed is authoritative, and these literals are this migration's
--    record of what it wrote.
--
-- 3. The ticks. `shopping_checks.item_key` is a line's normalised name, and
--    the line for "Olive oil (for the fish)" is now "olive oil". Each renamed
--    key's rows are copied to the new key, then the old rows deleted — an
--    UPDATE would collide on the unique index wherever two variants were
--    ticked in one week, or the new key already was. A merged line is ticked
--    if any of its variants was (the earliest `checked_at` is kept, since that
--    column records when the line was FIRST ticked). Keys that did not change
--    are not touched, which is P8's "unchanged items keep their check state".
--
-- Idempotent: a re-run matches the same rows, writes the same values, and
-- finds no old keys left to move.

ALTER TABLE "meal_ingredients" ADD COLUMN "shop_name" text;--> statement-breakpoint
ALTER TABLE "meal_ingredients" ADD COLUMN "shop_qty" numeric(7, 2);--> statement-breakpoint
ALTER TABLE "meal_ingredients" ADD COLUMN "shop_unit" text;--> statement-breakpoint
ALTER TABLE "meal_ingredients" ADD COLUMN "pantry" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "meal_ingredients" ADD CONSTRAINT "meal_ingredients_shop_qty_positive" CHECK ("shop_qty" is null or "shop_qty" > 0);--> statement-breakpoint
ALTER TABLE "meal_ingredients" ADD CONSTRAINT "meal_ingredients_shop_unit_needs_qty" CHECK ("shop_unit" is null or "shop_qty" is not null);--> statement-breakpoint
UPDATE "meal_ingredients" AS i
SET
  "shop_name" = v.shop_name,
  "shop_qty" = v.shop_qty,
  "shop_unit" = v.shop_unit,
  "pantry" = v.pantry,
  "category" = v.category
FROM (VALUES
  ('Onion'::text, '1/2 small, diced'::text, NULL::text, 0.5::numeric, NULL::text, false, 'produce'::text),
  ('Garlic'::text, '1 clove, minced'::text, NULL::text, 1::numeric, 'clove'::text, false, 'produce'::text),
  ('Ground cumin'::text, '1/2 tsp'::text, NULL::text, NULL::numeric, NULL::text, true, 'dry goods'::text),
  ('Smoked paprika'::text, '1 tsp'::text, NULL::text, NULL::numeric, NULL::text, true, 'dry goods'::text),
  ('Dried oregano'::text, '1/4–1/2 tsp'::text, NULL::text, NULL::numeric, NULL::text, true, 'dry goods'::text),
  ('Chilli flakes'::text, '1/2–3/4 tsp'::text, NULL::text, NULL::numeric, NULL::text, true, 'dry goods'::text),
  ('Jalapeno or red chilli (optional)'::text, '1/2, finely diced'::text, NULL::text, 0.5::numeric, NULL::text, false, 'produce'::text),
  ('Worcestershire sauce'::text, '1 tsp'::text, NULL::text, NULL::numeric, NULL::text, true, 'other'::text),
  ('Olive oil'::text, '1 tsp'::text, NULL::text, NULL::numeric, NULL::text, true, 'other'::text),
  ('Salt and pepper'::text, 'to taste'::text, NULL::text, NULL::numeric, NULL::text, true, 'other'::text),
  ('Plain yoghurt'::text, '1 tbsp, to serve'::text, 'Plain Greek yoghurt'::text, 15::numeric, 'g'::text, false, 'dairy'::text),
  ('Grated cheese (optional)'::text, 'small handful, to serve'::text, 'Grated cheese'::text, 20::numeric, 'g'::text, false, 'dairy'::text),
  ('Chicken stock'::text, '120ml (1/2 cup)'::text, NULL::text, NULL::numeric, NULL::text, true, 'other'::text),
  ('Onion'::text, '1/2 small, sliced'::text, NULL::text, 0.5::numeric, NULL::text, false, 'produce'::text),
  ('Bell pepper, red or yellow'::text, '1/2, sliced into strips'::text, NULL::text, 0.5::numeric, NULL::text, false, 'produce'::text),
  ('Lemon'::text, '1/2, for squeezing'::text, NULL::text, 0.5::numeric, NULL::text, false, 'produce'::text),
  ('Parsley or coriander (optional)'::text, 'chopped, to garnish'::text, 'Fresh coriander'::text, NULL::numeric, NULL::text, false, 'produce'::text),
  ('Hot sauce (optional)'::text, 'a dash at the table'::text, 'Hot sauce'::text, NULL::numeric, NULL::text, true, 'other'::text),
  ('Olive oil (for the potatoes)'::text, '1 tsp'::text, 'Olive oil'::text, NULL::numeric, NULL::text, true, 'other'::text),
  ('Olive oil (for the fish)'::text, '1 tsp'::text, 'Olive oil'::text, NULL::numeric, NULL::text, true, 'other'::text),
  ('Lemon'::text, '1/2, plus slices to serve'::text, NULL::text, 0.5::numeric, NULL::text, false, 'produce'::text),
  ('Dried oregano'::text, '1/2 tsp'::text, NULL::text, NULL::numeric, NULL::text, true, 'dry goods'::text),
  ('Dried dill (or parsley)'::text, '1/2 tsp'::text, NULL::text, NULL::numeric, NULL::text, true, 'dry goods'::text),
  ('Chilli flakes or cayenne'::text, '1/2 tsp, or a pinch of cayenne'::text, 'Chilli flakes'::text, NULL::numeric, NULL::text, true, 'dry goods'::text),
  ('Salt and pepper'::text, 'to taste, generously'::text, NULL::text, NULL::numeric, NULL::text, true, 'other'::text),
  ('Flaky salt'::text, 'a pinch, to finish'::text, NULL::text, NULL::numeric, NULL::text, true, 'other'::text),
  ('Hot sauce (optional)'::text, 'to drizzle'::text, 'Hot sauce'::text, NULL::numeric, NULL::text, true, 'other'::text),
  ('Coffee beans'::text, 'freshly ground, for 1 cup'::text, NULL::text, NULL::numeric, NULL::text, true, 'dry goods'::text),
  ('MCT oil'::text, '1 tbsp'::text, NULL::text, NULL::numeric, NULL::text, true, 'other'::text),
  ('Ciabatta roll'::text, '1 roll'::text, NULL::text, 1::numeric, NULL::text, false, 'dry goods'::text),
  ('Provolone'::text, '1 slice'::text, NULL::text, 1::numeric, 'slice'::text, false, 'dairy'::text),
  ('Wholegrain mustard'::text, '1 tsp'::text, NULL::text, NULL::numeric, NULL::text, true, 'other'::text),
  ('Hot sauce or sriracha'::text, '1 tbsp'::text, 'Hot sauce'::text, NULL::numeric, NULL::text, true, 'other'::text),
  ('Balsamic glaze'::text, '1/2 tsp'::text, NULL::text, NULL::numeric, NULL::text, true, 'other'::text),
  ('Pickled jalapeno slices (optional)'::text, '3–4 slices'::text, 'Jarred jalapenos'::text, NULL::numeric, NULL::text, false, 'other'::text),
  ('Milk'::text, '200ml (3/4 cup + 1 tbsp)'::text, NULL::text, 200::numeric, 'ml'::text, false, 'dairy'::text),
  ('Whey protein powder'::text, '1 level scoop (~25–30g)'::text, NULL::text, NULL::numeric, NULL::text, true, 'dry goods'::text),
  ('Apple'::text, '1/2 medium, grated on the coarse side of a box grater'::text, NULL::text, 0.5::numeric, NULL::text, false, 'produce'::text),
  ('Ground cinnamon'::text, '1/2 tsp'::text, NULL::text, NULL::numeric, NULL::text, true, 'dry goods'::text),
  ('Smooth peanut butter'::text, '1 tbsp (~15–20g)'::text, NULL::text, NULL::numeric, NULL::text, true, 'dry goods'::text),
  ('Cocoa powder, unsweetened'::text, '1 tsp'::text, NULL::text, NULL::numeric, NULL::text, true, 'dry goods'::text),
  ('Vanilla extract'::text, '1/2 tsp'::text, NULL::text, NULL::numeric, NULL::text, true, 'other'::text),
  ('Berries, fresh or frozen'::text, '1/4 cup, a small handful'::text, 'Frozen berries'::text, NULL::numeric, NULL::text, false, 'produce'::text),
  ('Honey (optional)'::text, '1 tsp'::text, 'Honey'::text, NULL::numeric, NULL::text, true, 'dry goods'::text),
  ('Whey protein powder'::text, '1 scoop (~25–30g)'::text, NULL::text, NULL::numeric, NULL::text, true, 'dry goods'::text),
  ('Water or milk'::text, '250–300ml (1–1 1/4 cups)'::text, 'Milk'::text, 275::numeric, 'ml'::text, false, 'dairy'::text),
  ('Banana'::text, '1'::text, NULL::text, 1::numeric, NULL::text, false, 'produce'::text),
  ('Eggs'::text, '2 large'::text, NULL::text, 2::numeric, NULL::text, false, 'dairy'::text),
  ('Oil or butter, for frying'::text, '1 tsp'::text, 'Neutral oil'::text, NULL::numeric, NULL::text, true, 'other'::text),
  ('Bread, brioche or thick white'::text, '3 thick slices, about 1cm, ideally day-old'::text, NULL::text, 3::numeric, 'slice'::text, false, 'dry goods'::text),
  ('Milk'::text, '60ml (1/4 cup)'::text, NULL::text, 60::numeric, 'ml'::text, false, 'dairy'::text),
  ('Salt'::text, 'a pinch'::text, 'Salt and pepper'::text, NULL::numeric, NULL::text, true, 'other'::text),
  ('Bacon'::text, '4–6 rashers, each about the length of your palm'::text, NULL::text, 5::numeric, 'rasher'::text, false, 'meat'::text),
  ('Maple syrup'::text, '30ml (2 tbsp), plus more to drizzle'::text, NULL::text, NULL::numeric, NULL::text, true, 'dry goods'::text),
  ('Oil (for searing and for the chips)'::text, '2 tbsp total'::text, 'Neutral oil'::text, NULL::numeric, NULL::text, true, 'other'::text),
  ('Real butter (not a spread or margarine)'::text, '1.5 tbsp for the steak, plus 1 tbsp for the sauce'::text, 'Butter'::text, 35::numeric, 'g'::text, false, 'dairy'::text),
  ('Garlic'::text, '1 clove, smashed'::text, NULL::text, 1::numeric, 'clove'::text, false, 'produce'::text),
  ('Onion or shallot'::text, '1/4 small onion, or 1 shallot, finely diced'::text, 'Onion'::text, 0.25::numeric, NULL::text, false, 'produce'::text),
  ('Black peppercorns'::text, '1 tsp, crushed'::text, NULL::text, NULL::numeric, NULL::text, true, 'dry goods'::text),
  ('Low-sodium beef stock'::text, '60ml (1/4 cup) — full-salt stock tastes too salty once reduced'::text, NULL::text, NULL::numeric, NULL::text, true, 'other'::text),
  ('Cream'::text, '60ml (1/4 cup)'::text, NULL::text, 60::numeric, 'ml'::text, false, 'dairy'::text),
  ('Brandy or whisky (optional)'::text, 'a splash'::text, NULL::text, NULL::numeric, NULL::text, true, 'other'::text),
  ('Salt and pepper'::text, 'to taste — salt the sauce at the very end only'::text, NULL::text, NULL::numeric, NULL::text, true, 'other'::text),
  ('Plain yoghurt'::text, '2 tbsp'::text, 'Plain Greek yoghurt'::text, 30::numeric, 'g'::text, false, 'dairy'::text),
  ('Garam masala'::text, '1 tsp for the marinade, 1 tsp for the sauce'::text, NULL::text, NULL::numeric, NULL::text, true, 'dry goods'::text),
  ('Turmeric'::text, '1/2 tsp'::text, NULL::text, NULL::numeric, NULL::text, true, 'dry goods'::text),
  ('Ginger-garlic paste'::text, '1 tsp for the marinade, 1 tsp for the sauce'::text, NULL::text, NULL::numeric, NULL::text, true, 'dry goods'::text),
  ('Butter'::text, '1 tbsp for the base, plus 20g (1.5 tbsp) to finish'::text, NULL::text, 35::numeric, 'g'::text, false, 'dairy'::text),
  ('Onion'::text, '1/2, finely diced'::text, NULL::text, 0.5::numeric, NULL::text, false, 'produce'::text),
  ('Chilli powder'::text, '1/2 tsp'::text, NULL::text, NULL::numeric, NULL::text, true, 'dry goods'::text),
  ('Ground coriander'::text, '1/2 tsp'::text, NULL::text, NULL::numeric, NULL::text, true, 'dry goods'::text),
  ('Cream'::text, '60ml (1/4 cup), plus extra to drizzle'::text, NULL::text, 60::numeric, 'ml'::text, false, 'dairy'::text),
  ('Sugar'::text, '1 tsp'::text, NULL::text, NULL::numeric, NULL::text, true, 'dry goods'::text),
  ('Garlic naan'::text, '1–2, warmed'::text, NULL::text, 2::numeric, NULL::text, false, 'dry goods'::text),
  ('Burger bun, brioche or sesame'::text, '1, split'::text, NULL::text, 1::numeric, NULL::text, false, 'dry goods'::text),
  ('American cheese or cheddar slices'::text, '2 slices'::text, 'Cheese slices'::text, 2::numeric, 'slice'::text, false, 'dairy'::text),
  ('Butter, for toasting the bun'::text, '1 tbsp'::text, 'Butter'::text, 15::numeric, 'g'::text, false, 'dairy'::text),
  ('Pickle slices'::text, '4–5'::text, 'Pickles'::text, NULL::numeric, NULL::text, false, 'other'::text),
  ('Onion'::text, '1/4 small, very thinly sliced'::text, NULL::text, 0.25::numeric, NULL::text, false, 'produce'::text),
  ('Mayonnaise'::text, '2 tbsp'::text, NULL::text, NULL::numeric, NULL::text, true, 'other'::text),
  ('Ketchup'::text, '1 tbsp'::text, NULL::text, NULL::numeric, NULL::text, true, 'other'::text),
  ('Yellow mustard'::text, '1 tsp'::text, NULL::text, NULL::numeric, NULL::text, true, 'other'::text),
  ('Pickle relish'::text, '1 tsp'::text, NULL::text, NULL::numeric, NULL::text, true, 'other'::text),
  ('Paprika'::text, 'a pinch, for the sauce'::text, NULL::text, NULL::numeric, NULL::text, true, 'dry goods'::text),
  ('Smoked paprika'::text, '1/2 tsp'::text, NULL::text, NULL::numeric, NULL::text, true, 'dry goods'::text),
  ('Cheddar or Mexican blend, shredded'::text, 'about 1 cup'::text, 'Grated cheese'::text, NULL::numeric, NULL::text, false, 'dairy'::text),
  ('Fresh coriander (optional)'::text, 'a small handful, chopped'::text, 'Fresh coriander'::text, NULL::numeric, NULL::text, false, 'produce'::text),
  ('Garlic'::text, '1 tsp minced for the marinade, 1 tsp for the glaze'::text, NULL::text, 2::numeric, 'clove'::text, false, 'produce'::text),
  ('Soy sauce'::text, '1 tbsp for the marinade, 1 tbsp for the glaze'::text, NULL::text, NULL::numeric, NULL::text, true, 'other'::text),
  ('Potato starch or cornstarch'::text, 'about 1/2 cup, for dredging'::text, NULL::text, NULL::numeric, NULL::text, true, 'dry goods'::text),
  ('Neutral oil, for frying'::text, 'about 500ml (2 cups), 3–4cm depth'::text, 'Neutral oil'::text, NULL::numeric, NULL::text, true, 'other'::text),
  ('Gochujang'::text, '2 tbsp'::text, NULL::text, NULL::numeric, NULL::text, true, 'other'::text),
  ('Honey or brown sugar'::text, '1.5 tbsp'::text, 'Honey'::text, NULL::numeric, NULL::text, true, 'dry goods'::text),
  ('Rice vinegar'::text, '1 tbsp'::text, NULL::text, NULL::numeric, NULL::text, true, 'other'::text),
  ('Sesame oil'::text, '1 tsp'::text, NULL::text, NULL::numeric, NULL::text, true, 'other'::text),
  ('Sesame seeds'::text, '1 tsp'::text, NULL::text, NULL::numeric, NULL::text, true, 'dry goods'::text),
  ('Spring onion'::text, '1, sliced'::text, NULL::text, 1::numeric, NULL::text, false, 'produce'::text)
) AS v(name, non_scale_measure, shop_name, shop_qty, shop_unit, pantry, category)
WHERE i."name" = v.name
  AND i."non_scale_measure" IS NOT DISTINCT FROM v.non_scale_measure;
--> statement-breakpoint
INSERT INTO "shopping_checks" ("user_id", "week_start", "item_key", "checked_at")
SELECT c."user_id", c."week_start", r.new_key, min(c."checked_at")
FROM "shopping_checks" AS c
JOIN (VALUES
  ('american cheese or cheddar slices'::text, 'cheese slices'::text),
  ('berries, fresh or frozen'::text, 'frozen berries'::text),
  ('butter, for toasting the bun'::text, 'butter'::text),
  ('cheddar or mexican blend, shredded'::text, 'grated cheese'::text),
  ('chilli flakes or cayenne'::text, 'chilli flakes'::text),
  ('fresh coriander (optional)'::text, 'fresh coriander'::text),
  ('grated cheese (optional)'::text, 'grated cheese'::text),
  ('honey (optional)'::text, 'honey'::text),
  ('honey or brown sugar'::text, 'honey'::text),
  ('hot sauce (optional)'::text, 'hot sauce'::text),
  ('hot sauce or sriracha'::text, 'hot sauce'::text),
  ('neutral oil, for frying'::text, 'neutral oil'::text),
  ('oil (for searing and for the chips)'::text, 'neutral oil'::text),
  ('oil or butter, for frying'::text, 'neutral oil'::text),
  ('olive oil (for the fish)'::text, 'olive oil'::text),
  ('olive oil (for the potatoes)'::text, 'olive oil'::text),
  ('onion or shallot'::text, 'onion'::text),
  ('parsley or coriander (optional)'::text, 'fresh coriander'::text),
  ('pickle slices'::text, 'pickles'::text),
  ('pickled jalapeno slices (optional)'::text, 'jarred jalapenos'::text),
  ('plain yoghurt'::text, 'plain greek yoghurt'::text),
  ('real butter (not a spread or margarine)'::text, 'butter'::text),
  ('salt'::text, 'salt and pepper'::text),
  ('water or milk'::text, 'milk'::text)
) AS r(old_key, new_key) ON c."item_key" = r.old_key
GROUP BY c."user_id", c."week_start", r.new_key
ON CONFLICT ("user_id", "week_start", "item_key") DO NOTHING;
--> statement-breakpoint
DELETE FROM "shopping_checks" AS c
USING (VALUES
  ('american cheese or cheddar slices'::text, 'cheese slices'::text),
  ('berries, fresh or frozen'::text, 'frozen berries'::text),
  ('butter, for toasting the bun'::text, 'butter'::text),
  ('cheddar or mexican blend, shredded'::text, 'grated cheese'::text),
  ('chilli flakes or cayenne'::text, 'chilli flakes'::text),
  ('fresh coriander (optional)'::text, 'fresh coriander'::text),
  ('grated cheese (optional)'::text, 'grated cheese'::text),
  ('honey (optional)'::text, 'honey'::text),
  ('honey or brown sugar'::text, 'honey'::text),
  ('hot sauce (optional)'::text, 'hot sauce'::text),
  ('hot sauce or sriracha'::text, 'hot sauce'::text),
  ('neutral oil, for frying'::text, 'neutral oil'::text),
  ('oil (for searing and for the chips)'::text, 'neutral oil'::text),
  ('oil or butter, for frying'::text, 'neutral oil'::text),
  ('olive oil (for the fish)'::text, 'olive oil'::text),
  ('olive oil (for the potatoes)'::text, 'olive oil'::text),
  ('onion or shallot'::text, 'onion'::text),
  ('parsley or coriander (optional)'::text, 'fresh coriander'::text),
  ('pickle slices'::text, 'pickles'::text),
  ('pickled jalapeno slices (optional)'::text, 'jarred jalapenos'::text),
  ('plain yoghurt'::text, 'plain greek yoghurt'::text),
  ('real butter (not a spread or margarine)'::text, 'butter'::text),
  ('salt'::text, 'salt and pepper'::text),
  ('water or milk'::text, 'milk'::text)
) AS r(old_key, new_key)
WHERE c."item_key" = r.old_key;
