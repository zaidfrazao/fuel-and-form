CREATE TYPE "public"."meal_log_status" AS ENUM('eaten', 'skipped');--> statement-breakpoint
CREATE TYPE "public"."meal_slot" AS ENUM('breakfast', 'lunch', 'snack', 'dinner', 'extra');--> statement-breakpoint
CREATE TYPE "public"."user_kind" AS ENUM('owner', 'demo');--> statement-breakpoint
CREATE TYPE "public"."workout_log_status" AS ENUM('done', 'partial', 'skipped');--> statement-breakpoint
CREATE TABLE "day_plan_overrides" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"date" date NOT NULL,
	"slot" "meal_slot" NOT NULL,
	"meal_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "meal_ingredients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"meal_id" uuid NOT NULL,
	"name" text NOT NULL,
	"grams" numeric(7, 1),
	"non_scale_measure" text,
	"category" text,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "meal_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"date" date NOT NULL,
	"slot" "meal_slot" NOT NULL,
	"meal_id" uuid NOT NULL,
	"status" "meal_log_status" NOT NULL,
	"note" text,
	"logged_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "meals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"slot_type" "meal_slot" NOT NULL,
	"kcal" integer NOT NULL,
	"protein_g" numeric(6, 1) NOT NULL,
	"fat_g" numeric(6, 1) NOT NULL,
	"carb_g" numeric(6, 1) NOT NULL,
	"method" text,
	"notes" text,
	"is_archived" boolean DEFAULT false NOT NULL,
	CONSTRAINT "meals_id_user_id_key" UNIQUE("id","user_id")
);
--> statement-breakpoint
CREATE TABLE "plan_template_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"day_of_week" integer NOT NULL,
	"slot" "meal_slot" NOT NULL,
	"meal_id" uuid NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "plan_template_entries_day_of_week_range" CHECK ("day_of_week" between 0 and 6)
);
--> statement-breakpoint
CREATE TABLE "profiles" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"height_cm" integer NOT NULL,
	"start_weight_kg" numeric(5, 2) NOT NULL,
	"target_weight_kg" numeric(5, 2) NOT NULL,
	"goal_pace_kg_per_week" numeric(4, 2) NOT NULL,
	"target_kcal" integer NOT NULL,
	"target_protein_g" numeric(6, 1) NOT NULL,
	"target_fat_g" numeric(6, 1) NOT NULL,
	"target_carb_g" numeric(6, 1) NOT NULL,
	"slot_times" jsonb NOT NULL,
	"program_start_date" date NOT NULL,
	"timezone" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "training_template_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"day_of_week" integer NOT NULL,
	"workout_id" uuid,
	"rotation_group" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "training_template_entries_day_of_week_range" CHECK ("day_of_week" between 0 and 6),
	CONSTRAINT "training_template_entries_target" CHECK (("workout_id" is null) != ("rotation_group" is null))
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" "user_kind" NOT NULL,
	"display_name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "weight_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"date" date NOT NULL,
	"weight_kg" numeric(5, 2) NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workout_exercises" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"workout_id" uuid NOT NULL,
	"name" text NOT NULL,
	"prescription" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"notes" text
);
--> statement-breakpoint
CREATE TABLE "workout_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"date" date NOT NULL,
	"workout_id" uuid NOT NULL,
	"status" "workout_log_status" NOT NULL,
	"note" text,
	"duration_min" integer,
	"logged_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workouts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"description" text,
	"rotation_group" text,
	"rotation_index" integer,
	CONSTRAINT "workouts_id_user_id_key" UNIQUE("id","user_id"),
	CONSTRAINT "workouts_rotation_pair" CHECK (("rotation_group" is null) = ("rotation_index" is null))
);
--> statement-breakpoint
ALTER TABLE "day_plan_overrides" ADD CONSTRAINT "day_plan_overrides_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "day_plan_overrides" ADD CONSTRAINT "day_plan_overrides_meal_id_meals_id_fk" FOREIGN KEY ("meal_id") REFERENCES "public"."meals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meal_ingredients" ADD CONSTRAINT "meal_ingredients_meal_fk" FOREIGN KEY ("meal_id","user_id") REFERENCES "public"."meals"("id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meal_logs" ADD CONSTRAINT "meal_logs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meal_logs" ADD CONSTRAINT "meal_logs_meal_id_meals_id_fk" FOREIGN KEY ("meal_id") REFERENCES "public"."meals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meals" ADD CONSTRAINT "meals_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_template_entries" ADD CONSTRAINT "plan_template_entries_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_template_entries" ADD CONSTRAINT "plan_template_entries_meal_id_meals_id_fk" FOREIGN KEY ("meal_id") REFERENCES "public"."meals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_template_entries" ADD CONSTRAINT "training_template_entries_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_template_entries" ADD CONSTRAINT "training_template_entries_workout_id_workouts_id_fk" FOREIGN KEY ("workout_id") REFERENCES "public"."workouts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "weight_logs" ADD CONSTRAINT "weight_logs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workout_exercises" ADD CONSTRAINT "workout_exercises_workout_fk" FOREIGN KEY ("workout_id","user_id") REFERENCES "public"."workouts"("id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workout_logs" ADD CONSTRAINT "workout_logs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workout_logs" ADD CONSTRAINT "workout_logs_workout_id_workouts_id_fk" FOREIGN KEY ("workout_id") REFERENCES "public"."workouts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workouts" ADD CONSTRAINT "workouts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "day_plan_overrides_user_date_slot_key" ON "day_plan_overrides" USING btree ("user_id","date","slot");--> statement-breakpoint
CREATE INDEX "meal_ingredients_user_meal_idx" ON "meal_ingredients" USING btree ("user_id","meal_id");--> statement-breakpoint
CREATE INDEX "meal_logs_user_date_idx" ON "meal_logs" USING btree ("user_id","date");--> statement-breakpoint
CREATE INDEX "meals_user_slot_idx" ON "meals" USING btree ("user_id","slot_type");--> statement-breakpoint
CREATE INDEX "plan_template_entries_user_day_idx" ON "plan_template_entries" USING btree ("user_id","day_of_week");--> statement-breakpoint
CREATE INDEX "training_template_entries_user_day_idx" ON "training_template_entries" USING btree ("user_id","day_of_week");--> statement-breakpoint
CREATE INDEX "users_expires_at_idx" ON "users" USING btree ("expires_at") WHERE "expires_at" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "weight_logs_user_date_key" ON "weight_logs" USING btree ("user_id","date");--> statement-breakpoint
CREATE INDEX "workout_exercises_user_workout_idx" ON "workout_exercises" USING btree ("user_id","workout_id");--> statement-breakpoint
CREATE INDEX "workout_logs_user_date_idx" ON "workout_logs" USING btree ("user_id","date");--> statement-breakpoint
CREATE INDEX "workouts_user_rotation_idx" ON "workouts" USING btree ("user_id","rotation_group");