-- FUEL-146 — a meal's macros are copied onto its log, part 2 of 2.
--
-- Run AFTER the deploy that writes the snapshot is live — see 0021 for why the
-- two halves are split. Between 0021 and that deploy the old code could still
-- insert a log without figures, so the back-fill runs again first, over only
-- the rows that are still empty; then nothing may be empty again.
UPDATE "meal_logs" AS l
SET "kcal" = m."kcal", "protein_g" = m."protein_g", "fat_g" = m."fat_g", "carb_g" = m."carb_g"
FROM "meals" AS m
WHERE m."id" = l."meal_id" AND m."user_id" = l."user_id" AND l."kcal" IS NULL;--> statement-breakpoint
ALTER TABLE "meal_logs" ALTER COLUMN "kcal" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "meal_logs" ALTER COLUMN "protein_g" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "meal_logs" ALTER COLUMN "fat_g" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "meal_logs" ALTER COLUMN "carb_g" SET NOT NULL;
