CREATE TYPE "public"."step_source" AS ENUM('estimated', 'device');--> statement-breakpoint
ALTER TABLE "workout_logs" ADD COLUMN "steps" integer;--> statement-breakpoint
ALTER TABLE "workout_logs" ADD COLUMN "steps_source" "step_source";--> statement-breakpoint
ALTER TABLE "workout_logs" ADD CONSTRAINT "workout_logs_steps_paired" CHECK (("steps" is null) = ("steps_source" is null));--> statement-breakpoint
ALTER TABLE "workout_logs" ADD CONSTRAINT "workout_logs_steps_range" CHECK ("steps" is null or "steps" between 1 and 200000);