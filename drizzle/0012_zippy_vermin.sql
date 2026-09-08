CREATE TABLE "walk_routes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"workout_log_id" uuid NOT NULL,
	"points" jsonb NOT NULL,
	"point_count" integer NOT NULL,
	"simplified_tolerance_m" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "walk_routes_point_count_range" CHECK ("point_count" between 1 and 500),
	CONSTRAINT "walk_routes_tolerance_positive" CHECK ("simplified_tolerance_m" is null or "simplified_tolerance_m" > 0)
);
--> statement-breakpoint
ALTER TABLE "workout_logs" ADD COLUMN "distance_m" integer;--> statement-breakpoint
ALTER TABLE "walk_routes" ADD CONSTRAINT "walk_routes_log_fk" FOREIGN KEY ("workout_log_id","user_id") REFERENCES "public"."workout_logs"("id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "walk_routes_user_log_key" ON "walk_routes" USING btree ("user_id","workout_log_id");--> statement-breakpoint
ALTER TABLE "workout_logs" ADD CONSTRAINT "workout_logs_distance_range" CHECK ("distance_m" is null or "distance_m" between 1 and 100000);