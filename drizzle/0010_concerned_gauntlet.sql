ALTER TABLE "workout_exercises" ADD COLUMN "media_key" text;--> statement-breakpoint
ALTER TABLE "workout_exercises" ADD COLUMN "media_kind" text;--> statement-breakpoint
ALTER TABLE "workout_exercises" ADD COLUMN "media_alt" text;--> statement-breakpoint
ALTER TABLE "workout_exercises" ADD COLUMN "media_credit" text;--> statement-breakpoint
ALTER TABLE "workout_exercises" ADD CONSTRAINT "workout_exercises_media_kind" CHECK ("media_kind" in ('image', 'video'));--> statement-breakpoint
ALTER TABLE "workout_exercises" ADD CONSTRAINT "workout_exercises_media_complete" CHECK (("media_key" is null) = ("media_kind" is null)
          and ("media_key" is null) = ("media_alt" is null)
          and ("media_credit" is null or "media_key" is not null)
          and ("media_key" is null
               or (trim("media_key") <> '' and trim("media_alt") <> '')));