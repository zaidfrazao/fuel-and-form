-- FUEL-123 — timed sets are stored as seconds, never as reps.
--
-- Additive except for one relaxation: `exercise_sets.reps` loses NOT NULL, and
-- `exercise_sets_one_unit` puts back what it guaranteed — every row holds exactly
-- one of reps and seconds. Every row already stored is a reps row, satisfies all
-- four checks as it stands, and needs no backfill.

ALTER TABLE "exercise_sets" ALTER COLUMN "reps" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "exercise_sets" ADD COLUMN "seconds" integer;--> statement-breakpoint
ALTER TABLE "workout_exercises" ADD COLUMN "target_seconds_low" integer;--> statement-breakpoint
ALTER TABLE "workout_exercises" ADD COLUMN "target_seconds_high" integer;--> statement-breakpoint
ALTER TABLE "exercise_sets" ADD CONSTRAINT "exercise_sets_seconds_range" CHECK ("seconds" between 1 and 3600);--> statement-breakpoint
ALTER TABLE "exercise_sets" ADD CONSTRAINT "exercise_sets_one_unit" CHECK (("reps" is null) <> ("seconds" is null));--> statement-breakpoint
ALTER TABLE "workout_exercises" ADD CONSTRAINT "workout_exercises_target_seconds_range" CHECK (("target_seconds_low" is null) = ("target_seconds_high" is null)
          and ("target_seconds_low" is null
               or ("target_seconds_low" between 1 and 3600
                   and "target_seconds_high" between "target_seconds_low" and 3600)));--> statement-breakpoint
ALTER TABLE "workout_exercises" ADD CONSTRAINT "workout_exercises_one_target_unit" CHECK ("target_reps_low" is null or "target_seconds_low" is null);