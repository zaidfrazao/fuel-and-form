-- FUEL-98 — two daily walks, where the app modelled one.
--
-- A DATA migration, not a schema one. Nothing here alters a table: the
-- app-level fix is that two walks are two `workouts` rows, and
-- `workout_logs`' unique index on (user_id, date, workout_id) has always
-- allowed two rows on one date once they are two workouts. What this file
-- does is bring databases that already hold a single walk into line with
-- the seed, which now ships two.
--
-- The existing row is RENAMED and keeps its id. That is the whole of the
-- backward compatibility: every `workout_logs` row, every export line and
-- every dot that already points at it goes on pointing at it, and the
-- morning walk simply has a history that starts before the afternoon walk
-- existed. Deleting and re-creating would take the history with it.
--
-- The descriptions are ONE string literal each, with the line breaks as
-- \n escapes. Postgres' adjacent-literal concatenation does not apply to
-- E-strings the way it does to plain ones, and the failure is a syntax
-- error at migrate time rather than anything a reader would spot.
--
-- Idempotent, and guarded on a user having EXACTLY ONE walk. A database
-- seeded after this change already has two and is left untouched; a
-- re-run is a no-op. `src/lib/seed/workouts.ts` is authoritative for the
-- names and copy from here on — these literals are this migration's
-- record of what it wrote, not a second live definition.

-- 1. The existing walk becomes the morning one.
UPDATE "workouts" AS w
SET
  "name" = 'Morning Walk',
  "description" = E'Separate from the training sessions, and every day including weekends.\n\n20 min, mid-morning — the walk Snack 1 is anchored to. Brisk enough that you\ncould talk but wouldn''t want to sing.\n\nThis and the afternoon one together are the single biggest lever available\nagainst a desk job, and they cost nothing in hunger or recovery.'
WHERE
  w."type" = 'walk'
  AND (SELECT count(*) FROM "workouts" o WHERE o."user_id" = w."user_id" AND o."type" = 'walk') = 1;
--> statement-breakpoint

-- 2. One afternoon walk per user who has a morning one and nothing else.
INSERT INTO "workouts" ("user_id", "name", "type", "description", "rotation_group", "rotation_index")
SELECT
  w."user_id",
  'Afternoon Walk',
  'walk',
  E'Separate from the training sessions, and every day including weekends.\n\n20 min, late afternoon — the walk Snack 2 is anchored to. Do the lot in one\ngo if the morning got away from you; 30–45 min across the day is the target.',
  NULL,
  NULL
FROM "workouts" w
WHERE
  w."type" = 'walk'
  AND w."name" = 'Morning Walk'
  AND NOT EXISTS (
    SELECT 1 FROM "workouts" o
    WHERE o."user_id" = w."user_id" AND o."type" = 'walk' AND o."id" <> w."id"
  );
--> statement-breakpoint

-- 3. Schedule it on exactly the days the morning walk is already scheduled.
--
-- Not on all seven unconditionally: the template is editable, and a user
-- who took the walk off Sunday has said something this migration must not
-- overrule. `sort_order` 2 puts it after the session (0) and the morning
-- walk (1), which is where it happens.
INSERT INTO "training_template_entries" ("user_id", "day_of_week", "workout_id", "rotation_group", "sort_order")
SELECT
  e."user_id",
  e."day_of_week",
  pm."afternoon_id",
  NULL,
  2
FROM "training_template_entries" e
JOIN (
  SELECT
    m."user_id",
    m."id" AS "morning_id",
    a."id" AS "afternoon_id"
  FROM "workouts" m
  JOIN "workouts" a
    ON a."user_id" = m."user_id" AND a."type" = 'walk' AND a."name" = 'Afternoon Walk'
  WHERE m."type" = 'walk' AND m."name" = 'Morning Walk'
) pm ON pm."user_id" = e."user_id" AND pm."morning_id" = e."workout_id"
WHERE NOT EXISTS (
  SELECT 1 FROM "training_template_entries" x
  WHERE x."user_id" = e."user_id"
    AND x."day_of_week" = e."day_of_week"
    AND x."workout_id" = pm."afternoon_id"
);
