-- FUEL-91 — § P10's per-set logging: one additive table, additive columns.
--
-- REORDERED BY HAND, and it does not run otherwise. drizzle-kit emitted the two
-- composite foreign keys BEFORE the `unique(id, user_id)` constraints they
-- reference, and Postgres requires the referenced columns to carry a unique
-- constraint at the moment the key is created ("there is no unique constraint
-- matching given keys for referenced table"). The generator has no reason to
-- know that the constraints it added to two existing tables are what the new
-- table's keys point at. Nothing else is changed, and the snapshot in
-- drizzle/meta is the generator's own, so the next `db:generate` is unaffected.

ALTER TABLE "workout_exercises" ADD CONSTRAINT "workout_exercises_id_user_id_key" UNIQUE("id","user_id");--> statement-breakpoint
ALTER TABLE "workout_logs" ADD CONSTRAINT "workout_logs_id_user_id_key" UNIQUE("id","user_id");--> statement-breakpoint
CREATE TABLE "exercise_sets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"workout_log_id" uuid NOT NULL,
	"exercise_id" uuid NOT NULL,
	"set_index" integer NOT NULL,
	"reps" integer NOT NULL,
	"load_kg" numeric(5, 2),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "exercise_sets_set_index_range" CHECK ("set_index" between 1 and 20),
	CONSTRAINT "exercise_sets_reps_range" CHECK ("reps" between 1 and 999),
	CONSTRAINT "exercise_sets_load_positive" CHECK ("load_kg" is null or "load_kg" > 0)
);
--> statement-breakpoint
ALTER TABLE "workout_exercises" ADD COLUMN "target_sets" integer;--> statement-breakpoint
ALTER TABLE "workout_exercises" ADD COLUMN "target_reps_low" integer;--> statement-breakpoint
ALTER TABLE "workout_exercises" ADD COLUMN "target_reps_high" integer;--> statement-breakpoint
ALTER TABLE "exercise_sets" ADD CONSTRAINT "exercise_sets_log_fk" FOREIGN KEY ("workout_log_id","user_id") REFERENCES "public"."workout_logs"("id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exercise_sets" ADD CONSTRAINT "exercise_sets_exercise_fk" FOREIGN KEY ("exercise_id","user_id") REFERENCES "public"."workout_exercises"("id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "exercise_sets_user_log_exercise_index_key" ON "exercise_sets" USING btree ("user_id","workout_log_id","exercise_id","set_index");--> statement-breakpoint
CREATE INDEX "exercise_sets_user_log_idx" ON "exercise_sets" USING btree ("user_id","workout_log_id");--> statement-breakpoint
ALTER TABLE "workout_exercises" ADD CONSTRAINT "workout_exercises_target_sets_range" CHECK ("target_sets" is null or "target_sets" between 1 and 20);--> statement-breakpoint
ALTER TABLE "workout_exercises" ADD CONSTRAINT "workout_exercises_target_reps_range" CHECK (("target_reps_low" is null) = ("target_reps_high" is null)
          and ("target_reps_low" is null
               or ("target_reps_low" between 1 and 999
                   and "target_reps_high" between "target_reps_low" and 999)));
