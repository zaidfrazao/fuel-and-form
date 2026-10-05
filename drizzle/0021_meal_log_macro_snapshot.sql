-- FUEL-146 — a meal's macros are copied onto its log, part 1 of 2.
--
-- `meal_logs` held only `meal_id`, so every logged total read kcal/P/F/C live
-- from `meals`, and editing a recipe would have rewritten every day it was
-- eaten on. The four columns hold the figures as they stood at log time.
--
-- Nullable HERE, and made `not null` by 0022, because the order is forced from
-- both ends. Columns that exist only after the deploy break the new code
-- (drizzle selects an explicit column list, and `scope.insert` returns every
-- column). `not null` columns that exist BEFORE the deploy break the old code,
-- which inserts a log without them. So: this file before merging (the deployed
-- code never names these columns), the deploy, then 0022.
--
-- The back-fill reads `meals` as it stands now. That is the only truth left —
-- no recipe has ever been editable, so it is also the value at log time.
ALTER TABLE "meal_logs" ADD COLUMN "kcal" integer;--> statement-breakpoint
ALTER TABLE "meal_logs" ADD COLUMN "protein_g" numeric(6, 1);--> statement-breakpoint
ALTER TABLE "meal_logs" ADD COLUMN "fat_g" numeric(6, 1);--> statement-breakpoint
ALTER TABLE "meal_logs" ADD COLUMN "carb_g" numeric(6, 1);--> statement-breakpoint
UPDATE "meal_logs" AS l
SET "kcal" = m."kcal", "protein_g" = m."protein_g", "fat_g" = m."fat_g", "carb_g" = m."carb_g"
FROM "meals" AS m
WHERE m."id" = l."meal_id" AND m."user_id" = l."user_id" AND l."kcal" IS NULL;
